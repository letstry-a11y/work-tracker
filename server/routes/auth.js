const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { get, run, all } = require('../db');
const { auth, getDeptEmployeeIds } = require('../auth/middleware');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const PASSWORD_PEPPER = 'work-tracker-secret-2024';

// Legacy SHA256 hash for migration detection
function legacyHashPassword(password) {
  return crypto.createHash('sha256').update(password + PASSWORD_PEPPER).digest('hex');
}

// New bcrypt hash
function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

// Verify password: supports both bcrypt and legacy SHA256 (auto-migrates)
function verifyPassword(password, storedHash, userId) {
  // Detect legacy SHA256 hash (64-char hex string)
  if (/^[a-f0-9]{64}$/.test(storedHash)) {
    const legacyHash = legacyHashPassword(password);
    if (legacyHash === storedHash) {
      // Auto-migrate to bcrypt
      const newHash = hashPassword(password);
      run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
      return true;
    }
    return false;
  }
  // bcrypt verification
  return bcrypt.compareSync(password, storedHash);
}

// 生成随机 token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /register 注册
router.post('/register', (req, res) => {
  const { username, password, employee_id, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.trim().length < 2) {
    return res.status(400).json({ error: '用户名至少2个字符' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }

  // 检查用户名是否已存在
  const existing = get('SELECT id FROM users WHERE username = ?', [username.trim()]);
  if (existing) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  // 检查是否是第一个用户（自动成为管理员）
  const userCount = get('SELECT COUNT(*) as count FROM users');
  const isFirst = userCount && userCount.count === 0;

  // 管理员可以指定 role，否则第一个是 admin，其他是 employee
  let finalRole = role;
  if (!finalRole) {
    finalRole = isFirst ? 'admin' : 'employee';
  }
  if (!['admin', 'employee', 'dept_leader'].includes(finalRole)) {
    return res.status(400).json({ error: '无效的角色' });
  }

  const password_hash = hashPassword(password);
  let empId = employee_id || null;

  // 如果没指定 employee_id，就用 username 作为名字创建一个空的 employee 记录
  if (!empId) {
    const empResult = run(
      'INSERT INTO employees (name, role, group_name) VALUES (?, ?, ?)',
      [username.trim(), '', '']
    );
    empId = empResult.lastInsertRowid;
  }

  const result = run(
    'INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)',
    [username.trim(), password_hash, finalRole, empId]
  );

  // 注册为 dept_leader → 同步部门负责人
  if (finalRole === 'dept_leader' && empId) {
    const emp = get('SELECT department_id FROM employees WHERE id = ?', [empId]);
    if (emp && emp.department_id) {
      run('UPDATE departments SET leader_employee_id = ? WHERE id = ?', [empId, emp.department_id]);
    }
  }

  // 生成 session（注册成功后直接登录）
  const token = generateToken();
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  run(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)',
    [result.lastInsertRowid, token, expires_at]
  );

  res.json({
    token,
    user: {
      id: result.lastInsertRowid,
      username: username.trim(),
      role: finalRole,
      employee_id: empId,
    }
  });
});

// POST /login 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = get('SELECT * FROM users WHERE username = ?', [username.trim()]);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  if (!verifyPassword(password, user.password_hash, user.id)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // 删除旧 session
  run('DELETE FROM sessions WHERE user_id = ?', [user.id]);

  // 生成新 session
  const token = generateToken();
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  run(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)',
    [user.id, token, expires_at]
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      employee_id: user.employee_id,
    }
  });
});

// POST /logout 登出
router.post('/logout', auth, (req, res) => {
  const header = req.headers['authorization'];
  const token = header.slice(7);
  run('DELETE FROM sessions WHERE token = ?', [token]);
  res.json({ ok: true });
});

// GET /me 获取当前用户信息
router.get('/me', auth, (req, res) => {
  const user = get(
    `SELECT u.id, u.username, u.role, u.employee_id, e.name as employee_name, e.department_id, d.name as department_name
     FROM users u
     LEFT JOIN employees e ON u.employee_id = e.id
     LEFT JOIN departments d ON e.department_id = d.id
     WHERE u.id = ?`,
    [req.user.id]
  );
  // For dept_leader, also include the department they lead
  if (user && user.role === 'dept_leader' && user.employee_id) {
    const dept = get('SELECT id, name FROM departments WHERE leader_employee_id = ?', [user.employee_id]);
    if (dept) {
      user.leader_department_id = dept.id;
      user.leader_department_name = dept.name;
    }
  }
  res.json(user);
});

// GET /users 获取所有用户（管理员用）
router.get('/users', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }
  const users = all(
    'SELECT u.id, u.username, u.role, u.employee_id, e.name as employee_name FROM users u LEFT JOIN employees e ON u.employee_id = e.id ORDER BY u.id'
  );
  res.json({ users });
});

// PUT /users/:id/role 修改用户角色（管理员用）
router.put('/users/:id/role', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }
  const { role } = req.body;
  if (!['admin', 'employee', 'dept_leader'].includes(role)) {
    return res.status(400).json({ error: '无效的角色' });
  }
  const { id } = req.params;

  // 角色从 dept_leader 改为其他 → 清除部门负责人
  const oldUser = get('SELECT role, employee_id FROM users WHERE id = ?', [id]);
  if (oldUser && oldUser.role === 'dept_leader' && role !== 'dept_leader' && oldUser.employee_id) {
    run('UPDATE departments SET leader_employee_id = NULL WHERE leader_employee_id = ?', [oldUser.employee_id]);
  }

  run('UPDATE users SET role = ? WHERE id = ?', [role, id]);

  // 角色改为 dept_leader → 同步部门负责人
  if (role === 'dept_leader') {
    const user = get('SELECT employee_id FROM users WHERE id = ?', [id]);
    if (user && user.employee_id) {
      const emp = get('SELECT department_id FROM employees WHERE id = ?', [user.employee_id]);
      if (emp && emp.department_id) {
        run('UPDATE departments SET leader_employee_id = ? WHERE id = ?', [user.employee_id, emp.department_id]);
      }
    }
  }

  res.json({ ok: true });
});

// DELETE /users/:id 删除用户账号（管理员用）
router.delete('/users/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }
  const { id } = req.params;
  // 防止删除自己
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }
  run('DELETE FROM sessions WHERE user_id = ?', [Number(id)]);
  run('DELETE FROM users WHERE id = ?', [Number(id)]);
  res.json({ ok: true });
});

// PUT /users/:id/reset-password 重置用户密码（管理员用）
router.put('/users/:id/reset-password', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }
  const { id } = req.params;
  const user = get('SELECT id FROM users WHERE id = ?', [Number(id)]);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const newPassword = '123456';
  const newHash = hashPassword(newPassword);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, Number(id)]);
  // 清除该用户所有 session，强制重新登录
  run('DELETE FROM sessions WHERE user_id = ?', [Number(id)]);
  res.json({ ok: true, default_password: newPassword });
});

// PUT /users/:id/username 修改用户名（管理员用）
router.put('/users/:id/username', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '权限不足' });
  }
  const { username } = req.body;
  if (!username || username.trim().length < 2) {
    return res.status(400).json({ error: '用户名至少2个字符' });
  }
  const existing = get('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), Number(req.params.id)]);
  if (existing) {
    return res.status(409).json({ error: '用户名已被占用' });
  }
  run('UPDATE users SET username = ? WHERE id = ?', [username.trim(), Number(req.params.id)]);
  res.json({ ok: true });
});

// PUT /me/password 修改当前用户密码
router.put('/me/password', auth, (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ error: '旧密码和新密码都不能为空' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: '新密码至少6位' });
  }
  const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(old_password, user.password_hash, user.id)) {
    return res.status(400).json({ error: '旧密码错误' });
  }
  const newHash = hashPassword(new_password);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);
  // 删除旧session，强制重新登录
  run('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

// GET /me/reviews 获取当前员工的审核记录
router.get('/me/reviews', auth, (req, res) => {
  const empId = req.user.employee_id;
  if (!empId) return res.json([]);

  const reviews = all(`
    SELECT t.id as task_id, t.title, t.confirm_status, t.confirm_note, t.confirmed_at, u.username as confirmed_by_name
    FROM tasks t
    LEFT JOIN users u ON t.confirmed_by = u.id
    WHERE t.assignee_id = ? AND t.confirm_status IN ('confirmed', 'rejected')
    ORDER BY t.confirmed_at DESC
    LIMIT 50
  `, [empId]);

  res.json(reviews);
});

// DELETE /me/reviews/:taskId 删除审核记录（员工重置任务）
router.delete('/me/reviews/:taskId', auth, (req, res) => {
  const empId = req.user.employee_id;
  if (!empId) return res.status(400).json({ error: '无关联员工' });
  const task = get('SELECT * FROM tasks WHERE id = ? AND assignee_id = ?', [Number(req.params.taskId), empId]);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  run("UPDATE tasks SET confirm_status='none', confirm_note='', confirmed_by=NULL, confirmed_at=NULL, status='in_progress' WHERE id=?", [Number(req.params.taskId)]);
  res.json({ ok: true });
});

// GET /me/stats 获取当前用户的个人统计（员工视图用）
router.get('/me/stats', auth, (req, res) => {
  if (!req.user.employee_id) {
    return res.json({ weeklyHours: 0, totalTasks: 0, inProgressTasks: 0, completedTasks: 0, overdueTasks: 0, pendingTasks: 0, myTasks: [], overdueList: [] });
  }

  const empId = req.user.employee_id;
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + 1);
  const weekStart = monday.toISOString().slice(0, 10);

  const weekLogs = all('SELECT COALESCE(SUM(hours), 0) as total FROM daily_logs WHERE employee_id = ? AND date >= ?', [empId, weekStart]);
  const weeklyHours = weekLogs[0] ? weekLogs[0].total : 0;

  const myTasks = all(`SELECT t.id, t.objective_id, t.title, t.status, t.priority, t.deadline, t.completed_at, t.confirm_status, t.confirm_note FROM tasks t WHERE t.assignee_id = ? ORDER BY t.objective_id, t.id DESC`, [empId]);

  // 获取员工的个人目标（带KR树）
  const myObjectives = all('SELECT * FROM objectives WHERE employee_id = ? ORDER BY id', [empId]);
  for (const obj of myObjectives) {
    obj.key_results = myTasks.filter(t => t.objective_id === obj.id);
    if (obj.parent_objective_id) {
      const parent = get('SELECT title FROM objectives WHERE id = ?', [obj.parent_objective_id]);
      if (parent) obj.parent_title = parent.title;
    }
  }

  // 加载该员工参与的整体目标（有KR分配给自己的）
  const globalObjs = all(`
    SELECT DISTINCT o.* FROM objectives o
    INNER JOIN tasks t ON t.objective_id = o.id AND t.assignee_id = ?
    WHERE o.scope = 'global' AND o.approval_status = 'approved'
  `, [empId]);
  for (const obj of globalObjs) {
    obj.key_results = myTasks.filter(t => t.objective_id === obj.id);
  }
  const allMyObjectives = [...globalObjs, ...myObjectives];
  const completedTasks = myTasks.filter(t => t.status === 'completed').length;
  const inProgressTasks = myTasks.filter(t => t.status === 'in_progress').length;
  const pendingTasks = myTasks.filter(t => t.status === 'pending').length;
  const overdueTasks = myTasks.filter(t => t.status === 'overdue').length;

  // Fix 3.6: Batch load deliverables for all tasks instead of N+1
  const taskIds = myTasks.map(t => t.id);
  let delivsMap = {};
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    const allDelivs = all(`SELECT id, title, file_name, file_type, created_at, task_id FROM deliverables WHERE task_id IN (${placeholders})`, taskIds);
    for (const d of allDelivs) {
      if (!delivsMap[d.task_id]) delivsMap[d.task_id] = [];
      delivsMap[d.task_id].push({ id: d.id, title: d.title, file_name: d.file_name, file_type: d.file_type, created_at: d.created_at });
    }
  }
  for (const t of myTasks) {
    t.deliverables = delivsMap[t.id] || [];
  }

  const overdueList = myTasks.filter(t =>
    t.status === 'overdue' || (t.status !== 'completed' && t.deadline && t.deadline < new Date().toISOString().slice(0, 10))
  ).slice(0, 10);

  const result = { weeklyHours, totalTasks: myTasks.length, inProgressTasks, completedTasks, overdueTasks, pendingTasks, myTasks, myObjectives: allMyObjectives, overdueList, weekStart };

  // dept_leader: add department stats
  if (req.user.role === 'dept_leader') {
    const dept = get('SELECT id, name FROM departments WHERE leader_employee_id = ?', [empId]);
    if (dept) {
      const deptEmpIds = getDeptEmployeeIds(dept.id);
      result.department_name = dept.name;
      result.department_member_count = deptEmpIds.length;
      if (deptEmpIds.length > 0) {
        const ph = deptEmpIds.map(() => '?').join(',');
        const deptTaskStats = get(`SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN confirm_status='pending' THEN 1 ELSE 0 END) as pending_review FROM tasks WHERE assignee_id IN (${ph})`, deptEmpIds);
        result.dept_total_tasks = deptTaskStats.total || 0;
        result.dept_completed_tasks = deptTaskStats.completed || 0;
        result.dept_pending_reviews = deptTaskStats.pending_review || 0;
      }
    }
  }

  res.json(result);
});

module.exports = router;
