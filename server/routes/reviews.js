const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { getDeptEmployeeIds } = require('../auth/middleware');

// GET /api/reviews - Fix 3.4: Eliminate N+1 for reviewer names
router.get('/', (req, res) => {
  const { type, status, employee_id } = req.query;
  const isAdmin = req.user.role === 'admin';
  const isDeptLeader = req.user.role === 'dept_leader' && req.user.department_id;
  const deptEmpIds = isDeptLeader ? getDeptEmployeeIds(req.user.department_id) : [];

  const results = [];

  // 任务待审核
  if (!type || type === 'task') {
    let taskSql = `
      SELECT t.id, t.title, t.confirm_status, t.confirm_note, t.confirmed_at,
             t.assignee_id, e.name as submitter_name, t.created_at,
             t.confirmed_by, u.username as reviewer_name,
             'task' as item_type
      FROM tasks t
      LEFT JOIN employees e ON t.assignee_id = e.id
      LEFT JOIN users u ON t.confirmed_by = u.id
      WHERE t.confirm_status != 'none'
    `;
    const taskParams = [];

    if (isDeptLeader) {
      if (deptEmpIds.length > 0) {
        taskSql += ` AND t.assignee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
        taskParams.push(...deptEmpIds);
      } else {
        taskSql += ' AND 1=0';
      }
    } else if (!isAdmin) {
      taskSql += ' AND t.assignee_id = ?';
      taskParams.push(req.user.employee_id);
    }

    if (isAdmin && employee_id) {
      taskSql += ' AND t.assignee_id = ?';
      taskParams.push(Number(employee_id));
    } else if (isDeptLeader && employee_id) {
      taskSql += ' AND t.assignee_id = ?';
      taskParams.push(Number(employee_id));
    }

    if (status) {
      taskSql += ' AND t.confirm_status = ?';
      taskParams.push(status);
    }

    taskSql += " ORDER BY t.confirm_status = 'pending' DESC, t.confirmed_at DESC";
    const tasks = all(taskSql, taskParams);
    results.push(...tasks.map(t => ({ ...t, item_type: 'task' })));
  }

  // 交付物待审核
  if (!type || type === 'deliverable') {
    let delSql = `
      SELECT d.id, d.title, d.confirm_status, d.confirm_note, d.confirmed_at,
             d.employee_id, e.name as submitter_name, d.description, d.file_name,
             d.created_at, d.confirmed_by, u.username as reviewer_name,
             'deliverable' as item_type
      FROM deliverables d
      LEFT JOIN employees e ON d.employee_id = e.id
      LEFT JOIN users u ON d.confirmed_by = u.id
      WHERE d.confirm_status != 'none'
    `;
    const delParams = [];

    if (isDeptLeader) {
      if (deptEmpIds.length > 0) {
        delSql += ` AND d.employee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
        delParams.push(...deptEmpIds);
      } else {
        delSql += ' AND 1=0';
      }
    } else if (!isAdmin) {
      delSql += ' AND d.employee_id = ?';
      delParams.push(req.user.employee_id);
    }

    if (isAdmin && employee_id) {
      delSql += ' AND d.employee_id = ?';
      delParams.push(Number(employee_id));
    } else if (isDeptLeader && employee_id) {
      delSql += ' AND d.employee_id = ?';
      delParams.push(Number(employee_id));
    }

    if (status) {
      delSql += ' AND d.confirm_status = ?';
      delParams.push(status);
    }

    delSql += " ORDER BY d.confirm_status = 'pending' DESC, d.confirmed_at DESC";
    const dels = all(delSql, delParams);
    results.push(...dels.map(d => ({ ...d, item_type: 'deliverable' })));
  }

  // 按时间排序
  results.sort((a, b) => {
    const aTime = a.confirmed_at || a.created_at || '';
    const bTime = b.confirmed_at || b.created_at || '';
    return bTime.localeCompare(aTime);
  });

  res.json(results);
});

// Helper: check if user can review this item
function canReview(req, employeeId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'dept_leader' && req.user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    return deptEmpIds.includes(employeeId);
  }
  return false;
}

// PUT /api/reviews/tasks/:id/confirm
router.put('/tasks/:id/confirm', (req, res) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  if (!canReview(req, task.assignee_id)) {
    return res.status(403).json({ error: '只有管理员或部门负责人可以审核' });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  run(
    "UPDATE tasks SET status='completed', confirm_status='confirmed', confirmed_by=?, confirmed_at=?, completed_at=? WHERE id=?",
    [req.user.id, now, now, Number(req.params.id)]
  );
  res.json({ success: true });
});

// PUT /api/reviews/tasks/:id/reject
router.put('/tasks/:id/reject', (req, res) => {
  const { reason } = req.body;
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  if (!canReview(req, task.assignee_id)) {
    return res.status(403).json({ error: '只有管理员或部门负责人可以审核' });
  }

  run(
    "UPDATE tasks SET status='in_progress', confirm_status='rejected', confirm_note=?, confirmed_by=NULL, confirmed_at=NULL WHERE id=?",
    [reason || '交付物不合格，请重新处理', Number(req.params.id)]
  );
  res.json({ success: true });
});

// PUT /api/reviews/deliverables/:id/confirm
router.put('/deliverables/:id/confirm', (req, res) => {
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });

  if (!canReview(req, item.employee_id)) {
    return res.status(403).json({ error: '只有管理员或部门负责人可以审核' });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  run(
    "UPDATE deliverables SET confirm_status='confirmed', confirmed_by=?, confirmed_at=? WHERE id=?",
    [req.user.id, now, Number(req.params.id)]
  );
  res.json({ success: true });
});

// PUT /api/reviews/deliverables/:id/reject
router.put('/deliverables/:id/reject', (req, res) => {
  const { reason } = req.body;
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });

  if (!canReview(req, item.employee_id)) {
    return res.status(403).json({ error: '只有管理员或部门负责人可以审核' });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  run(
    "UPDATE deliverables SET confirm_status='rejected', confirm_note=?, confirmed_by=?, confirmed_at=? WHERE id=?",
    [reason || '不合格，请重新处理', req.user.id, now, Number(req.params.id)]
  );
  res.json({ success: true });
});

// DELETE /api/reviews/tasks/:id
router.delete('/tasks/:id', (req, res) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  if (req.user.role !== 'admin' && task.assignee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '权限不足' });
  }

  run("UPDATE tasks SET confirm_status='none', confirm_note='', confirmed_by=NULL, confirmed_at=NULL, status='in_progress' WHERE id=?", [Number(req.params.id)]);
  res.json({ success: true });
});

// DELETE /api/reviews/deliverables/:id
router.delete('/deliverables/:id', (req, res) => {
  const item = get('SELECT * FROM deliverables WHERE id = ?', [Number(req.params.id)]);
  if (!item) return res.status(404).json({ error: '交付物不存在' });

  if (req.user.role !== 'admin' && item.employee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '权限不足' });
  }

  run("UPDATE deliverables SET confirm_status='none', confirm_note='', confirmed_by=NULL, confirmed_at='' WHERE id=?", [Number(req.params.id)]);
  res.json({ success: true });
});

module.exports = router;
