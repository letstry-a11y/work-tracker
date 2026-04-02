const express = require('express');
const router = express.Router();
const { all, get } = require('../db');
const { adminOnly } = require('../auth/middleware');

// GET /api/dashboard - Fix 3.5: Use aggregated queries instead of N+1
router.get('/', adminOnly, (req, res) => {
  // Aggregated task stats in a single query
  const taskStats = get(`
    SELECT
      COUNT(*) as totalTasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTasks,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
      SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdueTasks
    FROM tasks
  `);

  const totalTasks = taskStats.totalTasks || 0;
  const completedTasks = taskStats.completedTasks || 0;
  const inProgressTasks = taskStats.inProgressTasks || 0;
  const pendingTasks = taskStats.pendingTasks || 0;
  const overdueTasks = taskStats.overdueTasks || 0;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Objective progress with LEFT JOIN + GROUP BY instead of N+1
  const objectivesWithProgress = all(`
    SELECT o.*, e.name as employee_name,
      COUNT(t.id) as kr_count,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as kr_completed
    FROM objectives o
    LEFT JOIN employees e ON o.employee_id = e.id
    LEFT JOIN tasks t ON t.objective_id = o.id
    GROUP BY o.id
    ORDER BY o.id
  `);

  for (const obj of objectivesWithProgress) {
    obj.progress = obj.kr_count > 0 ? Math.round((obj.kr_completed / obj.kr_count) * 100) : 0;
  }

  // 交付物统计
  const totalDeliverables = get('SELECT COUNT(*) as count FROM deliverables').count;
  const recentDeliverables = all(`
    SELECT d.id, d.title, d.file_name, d.created_at, e.name as employee_name, t.title as task_title
    FROM deliverables d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN tasks t ON d.task_id = t.id
    ORDER BY d.created_at DESC
    LIMIT 10
  `);

  // 延期任务
  const overdueList = all(`
    SELECT t.*, e.name as assignee_name, o.title as objective_title
    FROM tasks t LEFT JOIN employees e ON t.assignee_id = e.id
    LEFT JOIN objectives o ON t.objective_id = o.id
    WHERE t.status = 'overdue' OR (t.status IN ('pending','in_progress') AND t.deadline IS NOT NULL AND t.deadline < date('now','localtime'))
    ORDER BY t.deadline
    LIMIT 20
  `);

  // 待确认任务
  const pendingConfirmList = all(`
    SELECT t.*, e.name as assignee_name
    FROM tasks t LEFT JOIN employees e ON t.assignee_id = e.id
    WHERE t.confirm_status = 'pending'
    ORDER BY t.id DESC
    LIMIT 20
  `);

  res.json({
    totalTasks,
    completedTasks,
    inProgressTasks,
    pendingTasks,
    overdueTasks,
    completionRate,
    objectives: objectivesWithProgress,
    totalDeliverables,
    recentDeliverables,
    overdueList,
    pendingConfirmList
  });
});

// GET /api/dashboard/weekly-grid
router.get('/weekly-grid', adminOnly, (req, res) => {
  let { week_start } = req.query;

  if (!week_start) {
    const today = new Date();
    const dow = today.getDay() || 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - dow + 1);
    week_start = monday.toISOString().slice(0, 10);
  }

  const sunday = new Date(week_start);
  sunday.setDate(sunday.getDate() + 6);
  const weekEnd = sunday.toISOString().slice(0, 10);

  const dayDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(week_start);
    d.setDate(d.getDate() + i);
    dayDates.push(d.toISOString().slice(0, 10));
  }

  const rows = all(`
    SELECT
      dl.employee_id,
      e.name         AS employee_name,
      dl.date,
      dl.hours,
      dl.id          AS log_id,
      dl.task_id,
      dl.work_content,
      t.title        AS task_title
    FROM daily_logs dl
    LEFT JOIN employees e ON dl.employee_id = e.id
    LEFT JOIN tasks    t  ON dl.task_id      = t.id
    WHERE dl.date >= ? AND dl.date <= ?
    ORDER BY dl.employee_id, dl.date
  `, [week_start, weekEnd]);

  // Include ALL employees, not just those with logs
  const allEmployees = all('SELECT id, name FROM employees ORDER BY id');
  const empMap = {};
  for (const emp of allEmployees) {
    empMap[emp.id] = {
      id: emp.id,
      name: emp.name,
      days: Object.fromEntries(dayDates.map(d => [d, []]))
    };
  }

  for (const row of rows) {
    if (!row.employee_id || !empMap[row.employee_id]) continue;
    empMap[row.employee_id].days[row.date].push({
      log_id: row.log_id,
      task_id: row.task_id,
      task_title: row.task_title || '',
      hours: row.hours,
      work_content: row.work_content
    });
  }

  res.json({
    weekStart: week_start,
    weekEnd,
    dayDates,
    employees: Object.values(empMap)
  });
});

module.exports = router;
