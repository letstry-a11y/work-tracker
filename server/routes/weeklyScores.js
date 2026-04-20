const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { adminOnly, getDeptEmployeeIds } = require('../auth/middleware');

// GET /api/weekly-scores
router.get('/', (req, res) => {
  const { employee_id, week_start } = req.query;
  let sql = 'SELECT ws.*, e.name as employee_name FROM weekly_scores ws LEFT JOIN employees e ON ws.employee_id = e.id WHERE 1=1';
  const params = [];

  if (req.user.role === 'dept_leader' && req.user.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (deptEmpIds.length > 0) {
      sql += ` AND ws.employee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      params.push(...deptEmpIds);
    } else {
      sql += ' AND 1=0';
    }
    if (employee_id) { sql += ' AND ws.employee_id = ?'; params.push(Number(employee_id)); }
  } else if (req.user.role !== 'admin') {
    if (req.user.employee_id) {
      sql += ' AND ws.employee_id = ?';
      params.push(req.user.employee_id);
    } else {
      sql += ' AND 1=0';
    }
  } else {
    if (employee_id) { sql += ' AND ws.employee_id = ?'; params.push(Number(employee_id)); }
  }

  if (week_start) { sql += ' AND ws.week_start = ?'; params.push(week_start); }
  sql += ' ORDER BY ws.total_score DESC';
  res.json(all(sql, params));
});

// POST /api/weekly-scores/generate - 仅管理员
router.post('/generate', adminOnly, (req, res) => {
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: '需要 week_start 参数 (YYYY-MM-DD)' });

  const start = new Date(week_start);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const week_end = end.toISOString().slice(0, 10);

  // Delete existing scores for this week
  run('DELETE FROM weekly_scores WHERE week_start = ?', [week_start]);

  // Fix 2.3: Mark overdue tasks using current date instead of week_end
  run(`UPDATE tasks SET status = 'overdue' WHERE status IN ('pending', 'in_progress') AND deadline IS NOT NULL AND deadline < date('now','localtime')`);

  const employees = all('SELECT * FROM employees');
  const results = [];

  for (const emp of employees) {
    // Get all tasks assigned to this employee
    const empTasks = all('SELECT * FROM tasks WHERE assignee_id = ?', [emp.id]);

    // Get logs for this week
    const logs = all('SELECT * FROM daily_logs WHERE employee_id = ? AND date >= ? AND date <= ?', [emp.id, week_start, week_end]);

    // Fix 2.1: Use task.status === 'completed' instead of max(progress_percent) >= 100
    // Count tasks that were active during this week (had logs or were completed during this week)
    const taskIdsWithLogs = [...new Set(logs.filter(l => l.task_id).map(l => l.task_id))];
    const relevantTasks = empTasks.filter(t =>
      taskIdsWithLogs.includes(t.id) ||
      (t.completed_at && t.completed_at.slice(0, 10) >= week_start && t.completed_at.slice(0, 10) <= week_end)
    );

    // 1. Completion rate: based on task.status
    const completedTasks = relevantTasks.filter(t => t.status === 'completed').length;
    const completionRate = relevantTasks.length > 0 ? (completedTasks / relevantTasks.length) * 100 : 0;

    // Fix 2.2: On-time rate - only count tasks completed within this scoring week
    let onTimeTasks = 0;
    let totalCompletedWithDeadline = 0;
    for (const task of relevantTasks) {
      if (task.status !== 'completed') continue;
      // Only count tasks completed within this week's time range
      if (!task.completed_at || task.completed_at.slice(0, 10) < week_start || task.completed_at.slice(0, 10) > week_end) continue;

      totalCompletedWithDeadline++;
      if (task.deadline) {
        if (task.completed_at.slice(0, 10) <= task.deadline) {
          onTimeTasks++;
        }
      } else {
        // No deadline = considered on-time
        onTimeTasks++;
      }
    }
    const ontimeRate = totalCompletedWithDeadline > 0 ? (onTimeTasks / totalCompletedWithDeadline) * 100 : (completedTasks > 0 ? 100 : 0);

    // 3. Workload
    const totalHours = logs.reduce((sum, l) => sum + (l.hours || 0), 0);
    const workloadRate = Math.min((totalHours / 40) * 100, 100);

    const totalScore = Math.round((completionRate * 0.4 + ontimeRate * 0.35 + workloadRate * 0.25) * 100) / 100;

    let comment = '';
    if (totalScore >= 90) comment = '表现优秀，继续保持！';
    else if (totalScore >= 75) comment = '表现良好，部分指标可进一步提升。';
    else if (totalScore >= 60) comment = '表现一般，需关注任务完成率和工时饱和度。';
    else comment = '表现待改进，建议加强任务管理和时间规划。';

    const crScore = Math.round(completionRate * 100) / 100;
    const otScore = Math.round(ontimeRate * 100) / 100;
    const wlScore = Math.round(workloadRate * 100) / 100;

    run(
      `INSERT INTO weekly_scores (employee_id, week_start, week_end, completion_rate_score, ontime_rate_score, workload_score, total_score, auto_comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.id, week_start, week_end, crScore, otScore, wlScore, totalScore, comment]
    );

    results.push({
      employee_id: emp.id,
      employee_name: emp.name,
      completion_rate_score: crScore,
      ontime_rate_score: otScore,
      workload_score: wlScore,
      total_score: totalScore,
      auto_comment: comment
    });
  }

  res.json(results);
});

module.exports = router;
