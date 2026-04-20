const express = require('express');
const router = express.Router();
const { all, get, run, transaction } = require('../db');
const { adminOnly } = require('../auth/middleware');

// GET /api/departments - 获取所有部门
router.get('/', (req, res) => {
  const depts = all(`
    SELECT d.*, e.name as leader_name,
      (SELECT COUNT(*) FROM employees WHERE department_id = d.id) as member_count
    FROM departments d
    LEFT JOIN employees e ON d.leader_employee_id = e.id
    ORDER BY d.id
  `);
  res.json(depts);
});

// GET /api/departments/:id - 部门详情+成员
router.get('/:id', (req, res) => {
  const dept = get(`
    SELECT d.*, e.name as leader_name
    FROM departments d
    LEFT JOIN employees e ON d.leader_employee_id = e.id
    WHERE d.id = ?
  `, [Number(req.params.id)]);
  if (!dept) return res.status(404).json({ error: '部门不存在' });

  const members = all('SELECT * FROM employees WHERE department_id = ?', [Number(req.params.id)]);
  dept.members = members;
  res.json(dept);
});

// POST /api/departments - 创建部门 (admin only)
router.post('/', adminOnly, (req, res) => {
  const { name, leader_employee_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '部门名称不能为空' });

  const existing = get('SELECT id FROM departments WHERE name = ?', [name.trim()]);
  if (existing) return res.status(409).json({ error: '部门名称已存在' });

  const result = run('INSERT INTO departments (name, leader_employee_id) VALUES (?, ?)',
    [name.trim(), leader_employee_id ? Number(leader_employee_id) : null]);

  // If leader set, update their department_id and user role
  if (leader_employee_id) {
    run('UPDATE employees SET department_id = ? WHERE id = ?', [result.lastInsertRowid, Number(leader_employee_id)]);
    syncLeaderRole(Number(leader_employee_id));
  }

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/departments/:id - 编辑部门 (admin only)
router.put('/:id', adminOnly, (req, res) => {
  const dept = get('SELECT * FROM departments WHERE id = ?', [Number(req.params.id)]);
  if (!dept) return res.status(404).json({ error: '部门不存在' });

  const { name, leader_employee_id } = req.body;

  if (name !== undefined) {
    const dup = get('SELECT id FROM departments WHERE name = ? AND id != ?', [name.trim(), Number(req.params.id)]);
    if (dup) return res.status(409).json({ error: '部门名称已存在' });
  }

  const oldLeaderId = dept.leader_employee_id;
  const newLeaderId = leader_employee_id !== undefined ? (leader_employee_id ? Number(leader_employee_id) : null) : dept.leader_employee_id;

  run('UPDATE departments SET name = ?, leader_employee_id = ? WHERE id = ?', [
    name !== undefined ? name.trim() : dept.name,
    newLeaderId,
    Number(req.params.id)
  ]);

  // Sync roles: demote old leader if they are no longer a leader of any dept
  if (oldLeaderId && oldLeaderId !== newLeaderId) {
    demoteIfNotLeader(oldLeaderId);
  }
  // Promote new leader and set their department_id
  if (newLeaderId) {
    run('UPDATE employees SET department_id = ? WHERE id = ?', [Number(req.params.id), newLeaderId]);
    syncLeaderRole(newLeaderId);
  }

  res.json({ success: true });
});

// DELETE /api/departments/:id - 删除部门 (admin only)
router.delete('/:id', adminOnly, (req, res) => {
  const dept = get('SELECT * FROM departments WHERE id = ?', [Number(req.params.id)]);
  if (!dept) return res.status(404).json({ error: '部门不存在' });

  const oldLeaderId = dept.leader_employee_id;

  // Clear department_id from all members
  run('UPDATE employees SET department_id = NULL WHERE department_id = ?', [Number(req.params.id)]);
  run('DELETE FROM departments WHERE id = ?', [Number(req.params.id)]);

  // Demote old leader if they are no longer a leader of any dept
  if (oldLeaderId) {
    demoteIfNotLeader(oldLeaderId);
  }

  res.json({ success: true });
});

// PUT /api/departments/:id/members - 批量设置成员 (admin only)
router.put('/:id/members', adminOnly, (req, res) => {
  const dept = get('SELECT * FROM departments WHERE id = ?', [Number(req.params.id)]);
  if (!dept) return res.status(404).json({ error: '部门不存在' });

  const { employee_ids } = req.body;
  if (!Array.isArray(employee_ids)) return res.status(400).json({ error: 'employee_ids 必须是数组' });

  transaction(() => {
    // Remove current members
    run('UPDATE employees SET department_id = NULL WHERE department_id = ?', [Number(req.params.id)]);
    // Set new members
    for (const eid of employee_ids) {
      run('UPDATE employees SET department_id = ? WHERE id = ?', [Number(req.params.id), Number(eid)]);
    }
  });

  res.json({ success: true });
});

// Helper: promote employee's user to dept_leader
function syncLeaderRole(employeeId) {
  const user = get('SELECT * FROM users WHERE employee_id = ?', [employeeId]);
  if (user && user.role === 'employee') {
    run('UPDATE users SET role = ? WHERE id = ?', ['dept_leader', user.id]);
  }
}

// Helper: demote employee's user from dept_leader if they don't lead any dept
function demoteIfNotLeader(employeeId) {
  const stillLeader = get('SELECT id FROM departments WHERE leader_employee_id = ?', [employeeId]);
  if (!stillLeader) {
    const user = get('SELECT * FROM users WHERE employee_id = ?', [employeeId]);
    if (user && user.role === 'dept_leader') {
      run('UPDATE users SET role = ? WHERE id = ?', ['employee', user.id]);
    }
  }
}

module.exports = router;
