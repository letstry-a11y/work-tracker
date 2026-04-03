const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { getDeptEmployeeIds } = require('../auth/middleware');

function canAccessTask(task, user) {
  if (user.role === 'admin') return true;
  if (user.role === 'dept_leader' && user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(user.department_id);
    if (deptEmpIds.includes(task.assignee_id)) return true;
  }
  return task.assignee_id === user.employee_id;
}

// Fix 2.4: BFS circular dependency detection
function hasCircularDependency(taskId, newDependencies) {
  const visited = new Set();
  const queue = [...newDependencies];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === taskId) return true; // Cycle detected
    if (visited.has(current)) continue;
    visited.add(current);
    // Get dependencies of current task
    const deps = all('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?', [current]);
    for (const dep of deps) {
      queue.push(dep.depends_on_task_id);
    }
  }
  return false;
}

// GET /api/tasks - Fix 3.2: Eliminate N+1 queries
router.get('/', (req, res) => {
  const { assignee_id, status, priority, objective_id } = req.query;
  let sql = 'SELECT t.*, e.name as assignee_name, o.title as objective_title FROM tasks t LEFT JOIN employees e ON t.assignee_id = e.id LEFT JOIN objectives o ON t.objective_id = o.id WHERE 1=1';
  const params = [];

  if (req.user.role === 'dept_leader' && req.user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (deptEmpIds.length > 0) {
      sql += ` AND t.assignee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      params.push(...deptEmpIds);
    } else {
      sql += ' AND 1=0';
    }
  } else if (req.user.role !== 'admin') {
    if (req.user.employee_id) {
      sql += ' AND t.assignee_id = ?';
      params.push(req.user.employee_id);
    } else {
      sql += ' AND 1=0';
    }
  }

  if (assignee_id) { sql += ' AND t.assignee_id = ?'; params.push(Number(assignee_id)); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  if (objective_id === '0') { sql += ' AND t.objective_id IS NULL'; }
  else if (objective_id) { sql += ' AND t.objective_id = ?'; params.push(Number(objective_id)); }
  sql += ' ORDER BY t.id DESC';

  const rows = all(sql, params);

  if (rows.length > 0) {
    const taskIds = rows.map(r => r.id);
    const placeholders = taskIds.map(() => '?').join(',');

    // Batch load dependencies
    const allDeps = all(`SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (${placeholders})`, taskIds);
    const depsMap = {};
    for (const d of allDeps) {
      if (!depsMap[d.task_id]) depsMap[d.task_id] = [];
      depsMap[d.task_id].push(d.depends_on_task_id);
    }

    // Batch load deliverables
    const allDelivs = all(`SELECT id, title, file_name, file_type, created_at, task_id FROM deliverables WHERE task_id IN (${placeholders})`, taskIds);
    const delivsMap = {};
    for (const d of allDelivs) {
      if (!delivsMap[d.task_id]) delivsMap[d.task_id] = [];
      delivsMap[d.task_id].push({ id: d.id, title: d.title, file_name: d.file_name, file_type: d.file_type, created_at: d.created_at });
    }

    for (const row of rows) {
      row.dependencies = depsMap[row.id] || [];
      row.deliverables = delivsMap[row.id] || [];
    }
  }

  res.json(rows);
});

// POST /api/tasks
router.post('/', (req, res) => {
  const { title, description, assignee_id, objective_id, status, priority, difficulty, estimated_hours, deadline } = req.body;
  if (!title) return res.status(400).json({ error: '任务标题不能为空' });

  let finalAssignee = assignee_id ? Number(assignee_id) : null;

  if (req.user.role === 'dept_leader') {
    // dept_leader can create tasks for dept members
    if (finalAssignee) {
      const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
      if (!deptEmpIds.includes(finalAssignee)) {
        return res.status(403).json({ error: '只能为本部门成员创建任务' });
      }
    }
  } else if (req.user.role !== 'admin' && req.user.employee_id) {
    finalAssignee = req.user.employee_id;
  }

  // Fix 2.7: Validate objective ownership - objective.employee_id must match assignee
  if (objective_id) {
    const obj = get('SELECT * FROM objectives WHERE id = ?', [Number(objective_id)]);
    if (obj && finalAssignee && obj.employee_id !== finalAssignee) {
      return res.status(400).json({ error: '目标归属与任务负责人不一致' });
    }
  }

  const result = run(
    'INSERT INTO tasks (title, description, assignee_id, objective_id, status, priority, difficulty, estimated_hours, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [title, description || '', finalAssignee, objective_id ? Number(objective_id) : null, status || 'pending', priority || 'P2', difficulty || 3, estimated_hours || 0, deadline || null]
  );
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/tasks/:id
router.put('/:id', (req, res) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  if (!canAccessTask(task, req.user)) {
    return res.status(403).json({ error: '只能修改自己的任务' });
  }

  const { title, description, assignee_id, objective_id, status, priority, difficulty, estimated_hours, deadline } = req.body;
  const newStatus = status || task.status;
  const completed_at = (newStatus === 'completed' && task.status !== 'completed')
    ? new Date().toISOString().slice(0, 19).replace('T', ' ')
    : task.completed_at;

  run(
    'UPDATE tasks SET title=?, description=?, assignee_id=?, objective_id=?, status=?, priority=?, difficulty=?, estimated_hours=?, deadline=?, completed_at=? WHERE id=?',
    [
      title || task.title,
      description !== undefined ? description : task.description,
      assignee_id !== undefined ? (assignee_id ? Number(assignee_id) : null) : task.assignee_id,
      objective_id !== undefined ? (objective_id ? Number(objective_id) : null) : task.objective_id,
      newStatus,
      priority || task.priority,
      difficulty || task.difficulty,
      estimated_hours !== undefined ? estimated_hours : task.estimated_hours,
      deadline !== undefined ? deadline : task.deadline,
      completed_at,
      Number(req.params.id)
    ]
  );
  res.json({ success: true });
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (!canAccessTask(task, req.user)) {
    return res.status(403).json({ error: '只能删除自己的任务' });
  }
  run('DELETE FROM tasks WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// POST /api/tasks/:id/apply-complete
router.post('/:id/apply-complete', (req, res) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  if (req.user.role !== 'admin' && req.user.role !== 'dept_leader' && task.assignee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '只能操作自己的任务' });
  }

  if (task.status === 'completed') {
    return res.status(400).json({ error: '任务已完成，无需重复申请' });
  }

  // Fix 2.6: Check if already pending confirmation
  if (task.confirm_status === 'pending') {
    return res.status(400).json({ error: '任务已在审核中，请勿重复提交' });
  }

  const { confirm_note } = req.body;
  run(
    "UPDATE tasks SET confirm_status='pending', confirm_note=?, confirmed_by=NULL, confirmed_at=NULL WHERE id=?",
    [confirm_note || '', Number(req.params.id)]
  );
  res.json({ success: true });
});

// PUT /api/tasks/:id/confirm
router.put('/:id/confirm', (req, res) => {
  const task = get('SELECT * FROM tasks WHERE id = ?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  // Allow admin or dept_leader (for their dept members)
  if (req.user.role === 'dept_leader') {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (!deptEmpIds.includes(task.assignee_id)) {
      return res.status(403).json({ error: '只能审核本部门成员的任务' });
    }
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '只有管理员或部门负责人可以确认任务' });
  }

  const { action, reject_reason } = req.body;
  if (!['confirm', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action 必须是 confirm 或 reject' });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (action === 'confirm') {
    run(
      "UPDATE tasks SET status='completed', confirm_status='confirmed', confirmed_by=?, confirmed_at=?, completed_at=? WHERE id=?",
      [req.user.id, now, now, Number(req.params.id)]
    );
  } else {
    run(
      "UPDATE tasks SET status='in_progress', confirm_status='rejected', confirm_note=?, confirmed_by=NULL, confirmed_at=NULL WHERE id=?",
      [reject_reason || '交付物不合格，请重新处理', Number(req.params.id)]
    );
  }

  res.json({ success: true });
});

// POST /api/tasks/:id/dependencies - Fix 2.4: with circular dependency detection
router.post('/:id/dependencies', (req, res) => {
  const taskId = Number(req.params.id);
  const task = get('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (!canAccessTask(task, req.user)) {
    return res.status(403).json({ error: '权限不足' });
  }
  const { depends_on } = req.body;
  if (!Array.isArray(depends_on)) return res.status(400).json({ error: 'depends_on 必须是数组' });

  const depIds = depends_on.map(Number);

  // Self-dependency check
  if (depIds.includes(taskId)) {
    return res.status(400).json({ error: '任务不能依赖自身' });
  }

  // Circular dependency detection using BFS
  // Temporarily remove existing deps for this task, then check
  run('DELETE FROM task_dependencies WHERE task_id = ?', [taskId]);

  // Now insert new deps and check for cycles
  for (const depId of depIds) {
    run('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)', [taskId, depId]);
  }

  // Check if any cycle exists after inserting
  if (depIds.length > 0 && hasCircularDependency(taskId, depIds)) {
    // Rollback: remove the deps we just added
    run('DELETE FROM task_dependencies WHERE task_id = ?', [taskId]);
    return res.status(400).json({ error: '检测到循环依赖，请检查依赖关系' });
  }

  res.json({ success: true });
});

module.exports = router;
