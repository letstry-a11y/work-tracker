const express = require('express');
const router = express.Router();
const { all, get } = require('../db');
const { deptLeaderOrAdmin, getDeptEmployeeIds } = require('../auth/middleware');

// GET /api/dashboard
router.get('/', deptLeaderOrAdmin, (req, res) => {
  const isDeptLeader = req.user.role === 'dept_leader' && req.user.department_id;
  // Admin can pass department_id to filter by department
  const filterDeptId = isDeptLeader ? req.user.department_id
    : (req.user.role === 'admin' && req.query.department_id ? Number(req.query.department_id) : null);
  let empFilter = '';
  let empFilterParams = [];

  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      empFilter = ` WHERE assignee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      empFilterParams = [...deptEmpIds];
    } else {
      empFilter = ' WHERE 1=0';
    }
  }

  // Aggregated task stats in a single query
  const taskStats = get(`
    SELECT
      COUNT(*) as totalTasks,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTasks,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
      SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdueTasks
    FROM tasks ${empFilter}
  `, empFilterParams);

  const totalTasks = taskStats.totalTasks || 0;
  const completedTasks = taskStats.completedTasks || 0;
  const inProgressTasks = taskStats.inProgressTasks || 0;
  const pendingTasks = taskStats.pendingTasks || 0;
  const overdueTasks = taskStats.overdueTasks || 0;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Objective progress with LEFT JOIN + GROUP BY instead of N+1
  let objSql = `
    SELECT o.*, e.name as employee_name,
      COUNT(t.id) as kr_count,
      SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as kr_completed
    FROM objectives o
    LEFT JOIN employees e ON o.employee_id = e.id
    LEFT JOIN tasks t ON t.objective_id = o.id
    WHERE o.approval_status = 'approved'
  `;
  const objParams = [];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      const ph = deptEmpIds.map(() => '?').join(',');
      objSql += ` AND (o.employee_id IN (${ph}) OR o.scope = 'global')`;
      objParams.push(...deptEmpIds);
    } else {
      objSql += ` AND o.scope = 'global'`;
    }
  }
  objSql += ' GROUP BY o.id ORDER BY o.scope ASC, o.id';
  const objectivesWithProgress = all(objSql, objParams);

  // Compute progress including child objectives for global objectives
  const globalObjIds = objectivesWithProgress.filter(o => o.scope === 'global').map(o => o.id);
  let childStatsMap = {};
  if (globalObjIds.length > 0) {
    const gph = globalObjIds.map(() => '?').join(',');
    // For each child objective, check if all its KRs are completed
    const childObjs = all(`SELECT o.id, o.parent_objective_id FROM objectives o WHERE o.parent_objective_id IN (${gph})`, globalObjIds);
    const childIds = childObjs.map(c => c.id);
    let childKrStats = {};
    if (childIds.length > 0) {
      const cph = childIds.map(() => '?').join(',');
      const childKrRows = all(`SELECT objective_id, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM tasks WHERE objective_id IN (${cph}) GROUP BY objective_id`, childIds);
      for (const r of childKrRows) {
        childKrStats[r.objective_id] = r;
      }
    }
    // Aggregate per parent
    for (const child of childObjs) {
      const pid = child.parent_objective_id;
      if (!childStatsMap[pid]) childStatsMap[pid] = { childCount: 0, childCompleted: 0 };
      const krStat = childKrStats[child.id];
      if (krStat && krStat.total > 0) {
        childStatsMap[pid].childCount++;
        if (krStat.completed === krStat.total) childStatsMap[pid].childCompleted++;
      }
    }
  }

  for (const obj of objectivesWithProgress) {
    if (obj.scope === 'global' && childStatsMap[obj.id]) {
      const cs = childStatsMap[obj.id];
      const totalItems = obj.kr_count + cs.childCount;
      const completedItems = obj.kr_completed + cs.childCompleted;
      obj.progress = totalItems > 0 ? Math.round(completedItems / totalItems * 100) : 0;
    } else {
      obj.progress = obj.kr_count > 0 ? Math.round((obj.kr_completed / obj.kr_count) * 100) : 0;
    }
  }

  // 交付物统计
  let delivSql, delivParams = [];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      const ph = deptEmpIds.map(() => '?').join(',');
      delivSql = `SELECT COUNT(*) as count FROM deliverables WHERE employee_id IN (${ph})`;
      delivParams = [...deptEmpIds];
    } else {
      delivSql = 'SELECT 0 as count';
    }
  } else {
    delivSql = 'SELECT COUNT(*) as count FROM deliverables';
  }
  const totalDeliverables = get(delivSql, delivParams).count;

  let recentDelivSql = `
    SELECT d.id, d.title, d.file_name, d.created_at, e.name as employee_name, t.title as task_title
    FROM deliverables d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN tasks t ON d.task_id = t.id
  `;
  const recentDelivParams = [];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      recentDelivSql += ` WHERE d.employee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      recentDelivParams.push(...deptEmpIds);
    } else {
      recentDelivSql += ' WHERE 1=0';
    }
  }
  recentDelivSql += ' ORDER BY d.created_at DESC LIMIT 10';
  const recentDeliverables = all(recentDelivSql, recentDelivParams);

  // 延期任务
  let overdueSql = `
    SELECT t.*, e.name as assignee_name, o.title as objective_title
    FROM tasks t LEFT JOIN employees e ON t.assignee_id = e.id
    LEFT JOIN objectives o ON t.objective_id = o.id
    WHERE (t.status = 'overdue' OR (t.status IN ('pending','in_progress') AND t.deadline IS NOT NULL AND t.deadline < date('now','localtime')))
  `;
  const overdueParams = [];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      overdueSql += ` AND t.assignee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      overdueParams.push(...deptEmpIds);
    } else {
      overdueSql += ' AND 1=0';
    }
  }
  overdueSql += ' ORDER BY t.deadline LIMIT 20';
  const overdueList = all(overdueSql, overdueParams);

  // 待确认任务
  let pendingConfirmSql = `
    SELECT t.*, e.name as assignee_name
    FROM tasks t LEFT JOIN employees e ON t.assignee_id = e.id
    WHERE t.confirm_status = 'pending'
  `;
  const pendingConfirmParams = [];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      pendingConfirmSql += ` AND t.assignee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      pendingConfirmParams.push(...deptEmpIds);
    } else {
      pendingConfirmSql += ' AND 1=0';
    }
  }
  pendingConfirmSql += ' ORDER BY t.id DESC LIMIT 20';
  const pendingConfirmList = all(pendingConfirmSql, pendingConfirmParams);

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
router.get('/weekly-grid', deptLeaderOrAdmin, (req, res) => {
  let { week_start, department_id } = req.query;
  const isDeptLeader = req.user.role === 'dept_leader' && req.user.department_id;
  const filterDeptId = isDeptLeader ? req.user.department_id
    : (req.user.role === 'admin' && department_id ? Number(department_id) : null);

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

  let logSql = `
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
  `;
  const logParams = [week_start, weekEnd];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      logSql += ` AND dl.employee_id IN (${deptEmpIds.map(() => '?').join(',')})`;
      logParams.push(...deptEmpIds);
    } else {
      logSql += ' AND 1=0';
    }
  }
  logSql += ' ORDER BY dl.employee_id, dl.date';

  const rows = all(logSql, logParams);

  // Include employees (filtered for dept_leader)
  let empSql = 'SELECT id, name FROM employees';
  const empParams = [];
  if (filterDeptId) {
    const deptEmpIds = getDeptEmployeeIds(filterDeptId);
    if (deptEmpIds.length > 0) {
      empSql += ` WHERE id IN (${deptEmpIds.map(() => '?').join(',')})`;
      empParams.push(...deptEmpIds);
    } else {
      empSql += ' WHERE 1=0';
    }
  }
  empSql += ' ORDER BY id';
  const allEmployees = all(empSql, empParams);

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
