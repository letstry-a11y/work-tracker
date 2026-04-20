const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { getDeptEmployeeIds } = require('../auth/middleware');

// GET /api/daily-logs
router.get('/', (req, res) => {
  const { employee_id, date, task_id, start_date, end_date } = req.query;
  let sql = `SELECT dl.*, t.title as task_title, e.name as employee_name
    FROM daily_logs dl
    LEFT JOIN tasks t ON dl.task_id = t.id
    LEFT JOIN employees e ON dl.employee_id = e.id
    WHERE 1=1`;
  const params = [];

  if (req.user.role === 'dept_leader' && req.user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (deptEmpIds.length > 0) {
      sql += ` AND dl.employee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      params.push(...deptEmpIds);
    } else {
      sql += ' AND 1=0';
    }
    if (employee_id) { sql += ' AND dl.employee_id = ?'; params.push(Number(employee_id)); }
  } else if (req.user.role !== 'admin') {
    if (req.user.employee_id) {
      sql += ' AND dl.employee_id = ?';
      params.push(req.user.employee_id);
    } else {
      sql += ' AND 1=0';
    }
  } else {
    if (employee_id) { sql += ' AND dl.employee_id = ?'; params.push(Number(employee_id)); }
  }

  if (date) { sql += ' AND dl.date = ?'; params.push(date); }
  if (start_date) { sql += ' AND dl.date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND dl.date <= ?'; params.push(end_date); }
  if (task_id) { sql += ' AND dl.task_id = ?'; params.push(Number(task_id)); }
  sql += ' ORDER BY dl.id DESC';
  res.json(all(sql, params));
});

// Validate work hours (no daily cap)
function validateHours(hours) {
  if (hours < 0) return '工时不能为负数';
  return null;
}

// POST /api/daily-logs
router.post('/', (req, res) => {
  const { employee_id, date, task_id, work_content, hours, remark } = req.body;
  if (!date) return res.status(400).json({ error: '日期不能为空' });

  let finalEmployeeId = employee_id ? Number(employee_id) : null;
  if (req.user.role !== 'admin' && req.user.role !== 'dept_leader' && req.user.employee_id) {
    finalEmployeeId = req.user.employee_id;
  }
  if (!finalEmployeeId) return res.status(400).json({ error: '员工ID不能为空' });

  const h = parseFloat(hours) || 0;
  const hoursError = validateHours(h);
  if (hoursError) return res.status(400).json({ error: hoursError });

  const result = run(
    `INSERT INTO daily_logs (employee_id, date, task_id, work_content, hours, remark)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [finalEmployeeId, date, task_id ? Number(task_id) : null, work_content || '', h, remark || '']
  );

  res.json({ id: result.lastInsertRowid });
});

// PUT /api/daily-logs/:id
router.put('/:id', (req, res) => {
  const log = get('SELECT * FROM daily_logs WHERE id = ?', [Number(req.params.id)]);
  if (!log) return res.status(404).json({ error: '记录不存在' });

  if (req.user.role !== 'admin' && log.employee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '只能修改自己的日志' });
  }

  const { task_id, work_content, hours, remark } = req.body;
  const newHours = hours !== undefined ? parseFloat(hours) || 0 : log.hours;

  // Validate hours if changed
  if (hours !== undefined) {
    const hoursError = validateHours(newHours);
    if (hoursError) return res.status(400).json({ error: hoursError });
  }

  run(
    `UPDATE daily_logs SET task_id=?, work_content=?, hours=?, remark=? WHERE id=?`,
    [
      task_id !== undefined ? (task_id ? Number(task_id) : null) : log.task_id,
      work_content !== undefined ? work_content : log.work_content,
      newHours,
      remark !== undefined ? remark : log.remark,
      Number(req.params.id)
    ]
  );
  res.json({ success: true });
});

// DELETE /api/daily-logs/:id
router.delete('/:id', (req, res) => {
  const log = get('SELECT * FROM daily_logs WHERE id = ?', [Number(req.params.id)]);
  if (!log) return res.status(404).json({ error: '记录不存在' });

  if (req.user.role !== 'admin' && log.employee_id !== req.user.employee_id) {
    return res.status(403).json({ error: '只能修改自己的日志' });
  }

  run('DELETE FROM daily_logs WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

module.exports = router;
