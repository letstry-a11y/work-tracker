const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { auth, getDeptEmployeeIds } = require('../auth/middleware');

// GET /api/objectives - Fix 3.3: Eliminate N+1 queries
router.get('/', auth, (req, res) => {
  const { employee_id } = req.query;
  let sql = 'SELECT o.*, e.name as employee_name FROM objectives o LEFT JOIN employees e ON o.employee_id = e.id WHERE 1=1';
  const params = [];
  if (employee_id) { sql += ' AND o.employee_id = ?'; params.push(Number(employee_id)); }

  if (req.user.role === 'dept_leader' && req.user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (deptEmpIds.length > 0) {
      sql += ` AND o.employee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      params.push(...deptEmpIds);
    } else {
      sql += ' AND 1=0';
    }
  } else if (req.user.role !== 'admin' && req.user.employee_id) {
    sql += ' AND o.employee_id = ?';
    params.push(req.user.employee_id);
  }
  sql += ' ORDER BY o.employee_id, o.id';
  const objectives = all(sql, params);

  if (objectives.length > 0) {
    const objIds = objectives.map(o => o.id);
    const placeholders = objIds.map(() => '?').join(',');

    // Batch load all KRs (tasks) for these objectives
    const allKrs = all(`SELECT t.* FROM tasks t WHERE t.objective_id IN (${placeholders}) ORDER BY t.id`, objIds);

    // Batch load all deliverables for these KRs
    const krIds = allKrs.map(k => k.id);
    let allDelivs = [];
    if (krIds.length > 0) {
      const krPlaceholders = krIds.map(() => '?').join(',');
      allDelivs = all(`SELECT id, title, file_name, file_type, created_at, task_id FROM deliverables WHERE task_id IN (${krPlaceholders})`, krIds);
    }

    // Build deliverables map by task_id
    const delivsMap = {};
    for (const d of allDelivs) {
      if (!delivsMap[d.task_id]) delivsMap[d.task_id] = [];
      delivsMap[d.task_id].push({ id: d.id, title: d.title, file_name: d.file_name, file_type: d.file_type, created_at: d.created_at });
    }

    // Build KRs map by objective_id
    const krsMap = {};
    for (const kr of allKrs) {
      kr.deliverables = delivsMap[kr.id] || [];
      if (!krsMap[kr.objective_id]) krsMap[kr.objective_id] = [];
      krsMap[kr.objective_id].push(kr);
    }

    // Attach to objectives
    for (const obj of objectives) {
      obj.key_results = krsMap[obj.id] || [];
    }
  }

  res.json(objectives);
});

// POST /api/objectives
router.post('/', auth, (req, res) => {
  const { title, weight, employee_id } = req.body;
  if (!title) return res.status(400).json({ error: '目标名称不能为空' });

  // dept_leader can create for their department members
  if (req.user.role === 'dept_leader') {
    if (employee_id) {
      const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
      if (!deptEmpIds.includes(Number(employee_id))) {
        return res.status(403).json({ error: '只能为本部门成员创建目标' });
      }
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }

  const result = run('INSERT INTO objectives (title, weight, employee_id) VALUES (?, ?, ?)', [title, weight || 0, employee_id ? Number(employee_id) : null]);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/objectives/:id
router.put('/:id', auth, (req, res) => {
  const obj = get('SELECT * FROM objectives WHERE id = ?', [Number(req.params.id)]);
  if (!obj) return res.status(404).json({ error: '目标不存在' });

  if (req.user.role === 'dept_leader') {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (!deptEmpIds.includes(obj.employee_id)) {
      return res.status(403).json({ error: '只能编辑本部门成员的目标' });
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }

  const { title, weight, employee_id } = req.body;
  run('UPDATE objectives SET title=?, weight=?, employee_id=? WHERE id=?', [
    title !== undefined ? title : obj.title,
    weight !== undefined ? weight : obj.weight,
    employee_id !== undefined ? (employee_id ? Number(employee_id) : null) : obj.employee_id,
    Number(req.params.id)
  ]);
  res.json({ success: true });
});

// DELETE /api/objectives/:id
router.delete('/:id', auth, (req, res) => {
  const obj = get('SELECT * FROM objectives WHERE id = ?', [Number(req.params.id)]);
  if (!obj) return res.status(404).json({ error: '目标不存在' });

  if (req.user.role === 'dept_leader') {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (!deptEmpIds.includes(obj.employee_id)) {
      return res.status(403).json({ error: '只能删除本部门成员的目标' });
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }

  run('DELETE FROM objectives WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

module.exports = router;
