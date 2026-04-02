const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { adminOnly } = require('../auth/middleware');

// GET /api/employees
router.get('/', (req, res) => {
  res.json(all('SELECT e.*, u.role as user_role FROM employees e LEFT JOIN users u ON e.id = u.employee_id ORDER BY e.id'));
});

// POST /api/employees
router.post('/', adminOnly, (req, res) => {
  const { name, role, group_name } = req.body;
  if (!name) return res.status(400).json({ error: '员工姓名不能为空' });
  const result = run('INSERT INTO employees (name, role, group_name) VALUES (?, ?, ?)', [name, role || '', group_name || '']);
  res.json({ id: result.lastInsertRowid, name, role: role || '', group_name: group_name || '' });
});

// DELETE /api/employees/:id
router.delete('/:id', adminOnly, (req, res) => {
  run('DELETE FROM employees WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

module.exports = router;
