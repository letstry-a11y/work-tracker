const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const multer = require('multer');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const router = express.Router();
const { all, get, run } = require('../db');

// ===== Utils =====

function pad(n) { return n < 10 ? '0' + n : String(n); }
function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Add N workdays to start. duration=1 → finish = start (same day). Weekends skipped.
function addWorkdays(startStr, days) {
  const start = parseDate(startStr);
  if (!start || !(days > 0)) return startStr;
  let remaining = days;
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  remaining -= 1;
  while (remaining > 0) {
    start.setDate(start.getDate() + 1);
    if (start.getDay() !== 0 && start.getDay() !== 6) remaining -= 1;
  }
  return toDateStr(start);
}

// Shift a date by n workdays (signed). Weekends skipped. n=0 returns the nearest workday.
function shiftWorkdays(dateStr, n) {
  const d = parseDate(dateStr);
  if (!d) return null;
  // normalize to a workday first (forward if n>=0, backward if n<0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + (n >= 0 ? 1 : -1));
  let remaining = Math.abs(Number(n) || 0);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining -= 1;
  }
  return toDateStr(d);
}

function canManage(user) {
  return user && (user.role === 'admin' || user.role === 'dept_leader');
}

function computeStartFromDeps(projectId, deps, duration) {
  if (!Array.isArray(deps) || !deps.length) return null;
  const ids = deps.map(d => Number(d.predecessor_id)).filter(Boolean);
  if (!ids.length) return null;
  const ph = ids.map(() => '?').join(',');
  const preds = all(
    `SELECT id, start_date, finish_date FROM project_tasks WHERE project_id = ? AND id IN (${ph})`,
    [projectId, ...ids]
  );
  const predMap = {};
  for (const p of preds) predMap[p.id] = p;
  let maxStart = null;
  const dur = Math.max(1, Number(duration) || 1);
  for (const dep of deps) {
    const p = predMap[Number(dep.predecessor_id)];
    if (!p) continue;
    const type = dep.dep_type || 'FS';
    const lag = Number(dep.lag_days) || 0;
    let candidate = null;
    if (type === 'FS' && p.finish_date) {
      candidate = shiftWorkdays(p.finish_date, lag + 1);
    } else if (type === 'SS' && p.start_date) {
      candidate = shiftWorkdays(p.start_date, lag);
    } else if (type === 'FF' && p.finish_date) {
      const f = shiftWorkdays(p.finish_date, lag);
      candidate = shiftWorkdays(f, -(dur - 1));
    } else if (type === 'SF' && p.start_date) {
      const f = shiftWorkdays(p.start_date, lag);
      candidate = shiftWorkdays(f, -(dur - 1));
    }
    if (candidate && (!maxStart || candidate > maxStart)) maxStart = candidate;
  }
  return maxStart;
}

function loadTaskResources(taskIds) {
  if (!taskIds.length) return {};
  const ph = taskIds.map(() => '?').join(',');
  const rows = all(
    `SELECT r.task_id, r.employee_id, e.name FROM project_task_resources r
     LEFT JOIN employees e ON r.employee_id = e.id
     WHERE r.task_id IN (${ph})`,
    taskIds
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.task_id]) map[r.task_id] = [];
    map[r.task_id].push({ id: r.employee_id, name: r.name });
  }
  return map;
}

function loadTaskDeps(taskIds) {
  if (!taskIds.length) return {};
  const ph = taskIds.map(() => '?').join(',');
  const rows = all(
    `SELECT task_id, predecessor_id, dep_type, lag_days FROM project_task_deps WHERE task_id IN (${ph})`,
    taskIds
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.task_id]) map[r.task_id] = [];
    map[r.task_id].push({ predecessor_id: r.predecessor_id, dep_type: r.dep_type, lag_days: r.lag_days });
  }
  return map;
}

function setTaskDeps(taskId, deps) {
  run('DELETE FROM project_task_deps WHERE task_id = ?', [taskId]);
  if (!Array.isArray(deps)) return;
  for (const d of deps) {
    const predId = Number(d.predecessor_id);
    if (!predId || predId === taskId) continue;
    const type = ['FS','SS','FF','SF'].includes(d.dep_type) ? d.dep_type : 'FS';
    const lag = Number(d.lag_days) || 0;
    try {
      run('INSERT INTO project_task_deps (task_id, predecessor_id, dep_type, lag_days) VALUES (?, ?, ?, ?)',
        [taskId, predId, type, lag]);
    } catch (e) { /* duplicate */ }
  }
}

// ===== Auto-schedule: propagate date changes to children and downstream dependents =====

function dayDiff(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(a) - new Date(b)) / 86400000);
}

function shiftDateByDays(dateStr, days) {
  if (!dateStr || days === 0) return dateStr;
  const d = parseDate(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function getAllDescendantIds(tasks, parentId) {
  const result = [];
  for (const t of tasks) {
    if (t.parent_task_id === parentId) {
      result.push(t.id);
      result.push(...getAllDescendantIds(tasks, t.id));
    }
  }
  return result;
}

function propagateDateChanges(projectId, changedTaskId, origStart) {
  const tasks = all('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY order_index, id', [projectId]);
  const changed = tasks.find(t => t.id === changedTaskId);
  if (!changed || !changed.start_date) return;

  // Build deps map
  const taskIds = tasks.map(t => t.id);
  const depsMap = loadTaskDeps(taskIds);

  // 1. Shift all direct children by the same delta as the parent
  const children = tasks.filter(t => t.parent_task_id === changedTaskId);
  for (const child of children) {
    const daysDelta = dayDiff(changed.start_date, origStart);
    const childNewStart = shiftDateByDays(child.start_date, daysDelta);
    const childNewFinish = child.finish_date ? shiftDateByDays(child.finish_date, daysDelta) : child.finish_date;
    if (childNewStart !== child.start_date || childNewFinish !== child.finish_date) {
      const childOrigStart = child.start_date;
      run('UPDATE project_tasks SET start_date=?, finish_date=? WHERE id=?', [childNewStart, childNewFinish, child.id]);
      // Recursively propagate to grandchildren
      propagateDateChanges(projectId, child.id, childOrigStart);
    }
  }

  // 2. Bubble up: recalc parent dates from children
  bubbleUpParentDates(projectId, changedTaskId, tasks);

  // 3. Find all tasks that depend on changedTaskId (directly or via descendants)
  const changedAndDescendants = new Set([changedTaskId, ...getAllDescendantIds(tasks, changedTaskId)]);
  const depTasks = [];
  for (const t of tasks) {
    const deps = depsMap[t.id] || [];
    for (const d of deps) {
      if (changedAndDescendants.has(Number(d.predecessor_id))) {
        depTasks.push(t);
        break;
      }
    }
  }

  for (const depTask of depTasks) {
    const newStart = computeStartFromDeps(projectId, depTask.dependencies || depsMap[depTask.id] || [], depTask.duration_days);
    if (!newStart) continue;
    const newFinish = depTask.finish_date
      ? shiftDateByDays(newStart, dayDiff(depTask.finish_date, depTask.start_date))
      : addWorkdays(newStart, depTask.duration_days);
    if (newStart !== depTask.start_date || newFinish !== depTask.finish_date) {
      const depOrigStart = depTask.start_date;
      run('UPDATE project_tasks SET start_date=?, finish_date=? WHERE id=?', [newStart, newFinish, depTask.id]);
      depTask.start_date = newStart;
      depTask.finish_date = newFinish;
      propagateDateChanges(projectId, depTask.id, depOrigStart);
      depTask.start_date = depOrigStart;
    }
  }
}

// Bubble up: ensure parent.start_date <= earliest child start_date
// and parent.finish_date >= latest child finish_date
function bubbleUpParentDates(projectId, taskId, tasks) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.parent_task_id) return;
  const parent = tasks.find(t => t.id === task.parent_task_id);
  if (!parent) return;
  const siblings = tasks.filter(t => t.parent_task_id === parent.id);
  const childStarts = siblings.map(c => c.start_date).filter(Boolean);
  const childFinishes = siblings.map(c => c.finish_date).filter(Boolean);
  if (!childStarts.length && !childFinishes.length) return;

  let newStart = parent.start_date;
  let newFinish = parent.finish_date;

  // Parent start should not be later than earliest child start
  if (childStarts.length) {
    const earliestChildStart = childStarts.reduce((a, b) => a < b ? a : b);
    if (!newStart || earliestChildStart < newStart) newStart = earliestChildStart;
  }

  // Parent finish should not be earlier than latest child finish
  if (childFinishes.length) {
    const latestChildFinish = childFinishes.reduce((a, b) => a > b ? a : b);
    if (!newFinish || latestChildFinish > newFinish) newFinish = latestChildFinish;
  }

  if (newStart !== parent.start_date || newFinish !== parent.finish_date) {
    run('UPDATE project_tasks SET start_date=?, finish_date=? WHERE id=?', [newStart, newFinish, parent.id]);
    // Update in-memory copy
    parent.start_date = newStart;
    parent.finish_date = newFinish;
    // Continue bubbling up
    bubbleUpParentDates(projectId, parent.id, tasks);
  }
}

function setTaskResources(taskId, resourceIds) {
  run('DELETE FROM project_task_resources WHERE task_id = ?', [taskId]);
  if (!Array.isArray(resourceIds)) return;
  for (const empId of resourceIds) {
    const eid = Number(empId);
    if (!eid) continue;
    try {
      run('INSERT INTO project_task_resources (task_id, employee_id) VALUES (?, ?)', [taskId, eid]);
    } catch (e) { /* duplicate */ }
  }
}

function depsToCSV(deps) {
  return (deps || []).map(d => Number(d.predecessor_id)).filter(Boolean).join(',');
}

// ===== Projects CRUD =====

router.get('/', (req, res) => {
  const projects = all(
    `SELECT p.*, u.username as created_by_name FROM projects p
     LEFT JOIN users u ON p.created_by = u.id
     ORDER BY p.id DESC`
  );
  res.json(projects);
});

router.post('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const { name, description, start_date } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const r = run(
    'INSERT INTO projects (name, description, start_date, created_by) VALUES (?, ?, ?, ?)',
    [name.trim(), description || '', start_date || null, req.user.id]
  );
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const id = Number(req.params.id);
  const p = get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const { name, description, start_date } = req.body;
  run(
    'UPDATE projects SET name=?, description=?, start_date=? WHERE id=?',
    [name !== undefined ? name : p.name,
     description !== undefined ? description : p.description,
     start_date !== undefined ? (start_date || null) : p.start_date,
     id]
  );
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const id = Number(req.params.id);
  run('DELETE FROM projects WHERE id = ?', [id]);
  res.json({ success: true });
});

// ===== Project Tasks =====

router.get('/:id/tasks', (req, res) => {
  const projectId = Number(req.params.id);
  const tasks = all(
    `SELECT pt.*, o.title as objective_title, kr.title as kr_title
     FROM project_tasks pt
     LEFT JOIN objectives o ON pt.objective_id = o.id
     LEFT JOIN tasks kr ON pt.kr_id = kr.id
     WHERE pt.project_id = ?
     ORDER BY pt.order_index, pt.id`,
    [projectId]
  );
  const taskIds = tasks.map(t => t.id);
  const resMap = loadTaskResources(taskIds);
  const depsMap = loadTaskDeps(taskIds);
  for (const t of tasks) {
    t.resources = resMap[t.id] || [];
    t.dependencies = depsMap[t.id] || [];
  }
  res.json(tasks);
});

function normalizeTaskBody(projectId, body, existing) {
  const title = (body.title !== undefined ? body.title : (existing && existing.title) || '').trim();
  const duration_days = body.duration_days !== undefined
    ? (parseFloat(body.duration_days) || 1)
    : (existing ? existing.duration_days : 1);
  const is_estimated = body.is_estimated !== undefined
    ? (body.is_estimated ? 1 : 0)
    : (existing ? existing.is_estimated : 0);
  const parent_task_id = body.parent_task_id !== undefined
    ? (body.parent_task_id ? Number(body.parent_task_id) : null)
    : (existing ? existing.parent_task_id : null);

  // Normalize dependencies: prefer `dependencies` array, fallback to CSV `predecessor_ids` (FS/0)
  let deps = null;
  if (body.dependencies !== undefined) {
    deps = Array.isArray(body.dependencies) ? body.dependencies : [];
  } else if (body.predecessor_ids !== undefined) {
    deps = String(body.predecessor_ids || '').split(',').map(s => s.trim()).filter(Boolean)
      .map(id => ({ predecessor_id: Number(id), dep_type: 'FS', lag_days: 0 }));
  }

  // start_date
  let start_date = body.start_date !== undefined
    ? (body.start_date || null)
    : (existing ? existing.start_date : null);
  if (!start_date && deps && deps.length) {
    start_date = computeStartFromDeps(projectId, deps, duration_days);
  }
  // finish_date: if explicitly provided, use it; otherwise calculate from start + duration
  const finish_date = body.finish_date !== undefined
    ? (body.finish_date || null)
    : (start_date && duration_days > 0 ? addWorkdays(start_date, duration_days) : null);

  // objective_id / kr_id (personal OKRs only)
  let objective_id = body.objective_id !== undefined
    ? (body.objective_id ? Number(body.objective_id) : null)
    : (existing ? existing.objective_id : null);
  let kr_id = body.kr_id !== undefined
    ? (body.kr_id ? Number(body.kr_id) : null)
    : (existing ? existing.kr_id : null);
  if (objective_id) {
    const obj = get('SELECT id, scope FROM objectives WHERE id = ?', [objective_id]);
    if (!obj || obj.scope === 'global') { objective_id = null; kr_id = null; }
  } else {
    kr_id = null;
  }
  if (kr_id) {
    const kr = get('SELECT id, objective_id FROM tasks WHERE id = ?', [kr_id]);
    if (!kr || kr.objective_id !== objective_id) kr_id = null;
  }

  const predecessor_ids = deps !== null ? depsToCSV(deps) : (existing ? (existing.predecessor_ids || '') : '');

  const progress_percent = body.progress_percent !== undefined
    ? Math.min(100, Math.max(0, Number(body.progress_percent) || 0))
    : (existing ? existing.progress_percent : 0);
  const note = body.note !== undefined
    ? (body.note || '')
    : (existing ? existing.note : '');

  return { title, duration_days, is_estimated, parent_task_id, predecessor_ids, start_date, finish_date, objective_id, kr_id, progress_percent, note, deps };
}

router.post('/:id/tasks', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const projectId = Number(req.params.id);
  const project = get('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const data = normalizeTaskBody(projectId, req.body, null);
  if (!data.title) return res.status(400).json({ error: '任务名称不能为空' });

  const parentCond = data.parent_task_id === null ? 'IS NULL' : '= ?';
  const parentParams = data.parent_task_id === null ? [] : [data.parent_task_id];
  const maxRow = get(
    `SELECT COALESCE(MAX(order_index), -1) as m FROM project_tasks WHERE project_id = ? AND parent_task_id ${parentCond}`,
    [projectId, ...parentParams]
  );
  const order_index = (maxRow && maxRow.m !== undefined ? maxRow.m : -1) + 1;

  const r = run(
    `INSERT INTO project_tasks (project_id, parent_task_id, order_index, title, duration_days, is_estimated, start_date, finish_date, predecessor_ids, objective_id, kr_id, progress_percent, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, data.parent_task_id, order_index, data.title, data.duration_days, data.is_estimated, data.start_date, data.finish_date, data.predecessor_ids, data.objective_id, data.kr_id, data.progress_percent, data.note]
  );
  const newId = r.lastInsertRowid;
  setTaskResources(newId, req.body.resource_ids);
  if (data.deps !== null) setTaskDeps(newId, data.deps);

  // Bubble up parent dates when creating a task with a parent
  if (data.parent_task_id) {
    const tasks = all('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY order_index, id', [projectId]);
    bubbleUpParentDates(projectId, newId, tasks);
  }

  res.json({ id: newId });
});

router.put('/:id/tasks/:taskId', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const projectId = Number(req.params.id);
  const taskId = Number(req.params.taskId);
  const existing = get('SELECT * FROM project_tasks WHERE id = ? AND project_id = ?', [taskId, projectId]);
  if (!existing) return res.status(404).json({ error: '任务不存在' });

  const data = normalizeTaskBody(projectId, req.body, existing);
  if (!data.title) return res.status(400).json({ error: '任务名称不能为空' });

  const origStart = existing.start_date;

  // When dependencies are provided, recalculate start_date from deps
  if (data.deps && data.deps.length) {
    const calcStart = computeStartFromDeps(projectId, data.deps, data.duration_days);
    if (calcStart && (!data.start_date || calcStart > data.start_date)) {
      data.start_date = calcStart;
      data.finish_date = data.duration_days > 0 ? addWorkdays(calcStart, data.duration_days) : calcStart;
    }
  }

  run(
    `UPDATE project_tasks SET parent_task_id=?, title=?, duration_days=?, is_estimated=?, start_date=?, finish_date=?, predecessor_ids=?, objective_id=?, kr_id=?, progress_percent=?, note=? WHERE id=?`,
    [data.parent_task_id, data.title, data.duration_days, data.is_estimated, data.start_date, data.finish_date, data.predecessor_ids, data.objective_id, data.kr_id, data.progress_percent, data.note, taskId]
  );
  if (req.body.resource_ids !== undefined) setTaskResources(taskId, req.body.resource_ids);
  if (data.deps !== null) setTaskDeps(taskId, data.deps);

  // Shift children by same delta when parent start_date changes
  if (origStart && origStart !== data.start_date) {
    const tasks = all('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY order_index, id', [projectId]);
    const daysDelta = dayDiff(data.start_date, origStart);
    for (const child of tasks.filter(t => t.parent_task_id === taskId)) {
      const childNewStart = shiftDateByDays(child.start_date, daysDelta);
      const childNewFinish = child.finish_date ? shiftDateByDays(child.finish_date, daysDelta) : child.finish_date;
      run('UPDATE project_tasks SET start_date=?, finish_date=? WHERE id=?', [childNewStart, childNewFinish, child.id]);
    }
  }

  // Always bubble up parent dates after any update to ensure parent covers all children
  const tasks = all('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY order_index, id', [projectId]);
  bubbleUpParentDates(projectId, taskId, tasks);

  res.json({ success: true });
});

router.delete('/:id/tasks/:taskId', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const projectId = Number(req.params.id);
  const taskId = Number(req.params.taskId);
  run('DELETE FROM project_tasks WHERE id = ? AND project_id = ?', [taskId, projectId]);
  res.json({ success: true });
});

router.post('/:id/tasks/reorder', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const projectId = Number(req.params.id);
  const items = Array.isArray(req.body) ? req.body : req.body.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items 必须是数组' });
  for (const it of items) {
    run(
      'UPDATE project_tasks SET parent_task_id = ?, order_index = ? WHERE id = ? AND project_id = ?',
      [it.parent_task_id ? Number(it.parent_task_id) : null, Number(it.order_index) || 0, Number(it.id), projectId]
    );
  }
  res.json({ success: true });
});

// ===== Project XML Import / Export (MSPDI format) =====

const xmlUpload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.(xml|mspdi)$/i.test(file.originalname)) return cb(new Error('仅支持 .xml 文件'));
    cb(null, true);
  }
});

// Parse ISO-8601 Duration like "PT40H0M0S" or "P5D" to workdays (8h/day).
function parseMspdiDuration(s) {
  if (!s) return 1;
  const str = String(s);
  // PT{H}H{M}M{S}S
  const hMatch = str.match(/PT(\d+)H/i);
  const dMatch = str.match(/P(\d+)D/i);
  if (hMatch) return Math.max(1, Math.round(Number(hMatch[1]) / 8));
  if (dMatch) return Math.max(1, Number(dMatch[1]));
  return 1;
}

function formatMspdiDuration(days) {
  return `PT${Math.max(1, Math.round(days)) * 8}H0M0S`;
}

function parseMspdiDate(s) {
  if (!s) return null;
  // e.g. "2025-11-10T08:00:00"
  return String(s).slice(0, 10);
}

router.post('/:id/import-xml', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  xmlUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const fs = require('fs');
    try {
      const projectId = Number(req.params.id);
      const project = get('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const xml = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path);

      const parser = new XMLParser({
        ignoreAttributes: true,
        parseTagValue: false,
        removeNSPrefix: true,
        alwaysCreateTextNode: false,
        isArray: (name) => ['Task', 'Resource', 'Assignment', 'PredecessorLink'].includes(name)
      });
      const doc = parser.parse(xml);
      const root = doc.Project || doc;
      const xmlTasks = (root.Tasks && root.Tasks.Task) || [];
      const xmlResources = (root.Resources && root.Resources.Resource) || [];
      const xmlAssignments = (root.Assignments && root.Assignments.Assignment) || [];

      const mode = (req.body && req.body.mode) || 'replace';
      if (mode === 'replace') {
        run('DELETE FROM project_tasks WHERE project_id = ?', [projectId]);
      }

      // Resource UID -> employee_id (by name match)
      const employees = all('SELECT id, name FROM employees');
      const empByName = {};
      for (const e of employees) empByName[e.name] = e.id;
      const resUidToEmpId = {};
      for (const r of xmlResources) {
        const name = r.Name;
        if (name && empByName[name]) resUidToEmpId[String(r.UID)] = empByName[name];
      }
      // TaskUID -> [employee_id]
      const taskAssign = {};
      for (const a of xmlAssignments) {
        const tu = String(a.TaskUID);
        const ru = String(a.ResourceUID);
        const eid = resUidToEmpId[ru];
        if (!eid) continue;
        (taskAssign[tu] = taskAssign[tu] || []).push(eid);
      }

      // Build parent map via OutlineLevel walk
      const uidToNewId = {};
      const outlineStack = []; // [{ level, taskId }]
      let createdCount = 0;
      let orderCounter = 0;

      for (const t of xmlTasks) {
        if (!t.Name || t.UID === '0' || t.UID === 0) continue; // skip project summary row
        const outlineLevel = Number(t.OutlineLevel || 1);
        // parent = top of stack with level < current
        while (outlineStack.length && outlineStack[outlineStack.length - 1].level >= outlineLevel) {
          outlineStack.pop();
        }
        const parent_task_id = outlineStack.length ? outlineStack[outlineStack.length - 1].taskId : null;
        const duration = parseMspdiDuration(t.Duration);
        const startDate = parseMspdiDate(t.Start);
        const finishDate = parseMspdiDate(t.Finish);
        const isMilestone = Number(t.Milestone || 0) === 1 ? 1 : 0;

        const r = run(
          `INSERT INTO project_tasks (project_id, parent_task_id, order_index, title, duration_days, is_estimated, start_date, finish_date, predecessor_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
          [projectId, parent_task_id, orderCounter++, String(t.Name).trim(), isMilestone ? 0 : duration, 0, startDate, finishDate]
        );
        uidToNewId[String(t.UID)] = r.lastInsertRowid;
        outlineStack.push({ level: outlineLevel, taskId: r.lastInsertRowid });

        // Resources
        const emps = taskAssign[String(t.UID)];
        if (emps && emps.length) setTaskResources(r.lastInsertRowid, emps);

        createdCount++;
      }

      // Second pass: PredecessorLinks
      for (const t of xmlTasks) {
        if (!t.PredecessorLink) continue;
        const myId = uidToNewId[String(t.UID)];
        if (!myId) continue;
        const deps = [];
        const predIds = [];
        for (const link of t.PredecessorLink) {
          const predNewId = uidToNewId[String(link.PredecessorUID)];
          if (!predNewId) continue;
          // Type mapping MSPDI: 0=FF, 1=FS, 2=SF, 3=SS (per MS docs)
          const typeMap = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
          const dep_type = typeMap[String(link.Type || '1')] || 'FS';
          const lagDur = String(link.LinkLag || '0');
          // LinkLag in MSPDI is in minutes * 10 (per schema); but many exports use minutes. Use a safe conversion: parse number, / 4800 → workdays approx.
          let lag = 0;
          const lagNum = Number(lagDur);
          if (!isNaN(lagNum) && lagNum !== 0) {
            // Interpret as minutes / 480 = workdays (8h = 480min)
            lag = Math.round(lagNum / 480);
          }
          deps.push({ predecessor_id: predNewId, dep_type, lag_days: lag });
          predIds.push(predNewId);
        }
        if (deps.length) {
          setTaskDeps(myId, deps);
          run('UPDATE project_tasks SET predecessor_ids = ? WHERE id = ?', [predIds.join(','), myId]);
        }
      }

      res.json({ success: true, imported: createdCount });
    } catch (err) {
      console.error('XML 导入失败:', err);
      res.status(500).json({ error: 'XML 导入失败: ' + err.message });
    }
  });
});

router.get('/:id/export-xml', (req, res) => {
  const projectId = Number(req.params.id);
  const project = get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const tasks = all('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY order_index, id', [projectId]);
  const depsMap = loadTaskDeps(tasks.map(t => t.id));
  const resMap = loadTaskResources(tasks.map(t => t.id));

  // Task id → UID (sequential, 1-based)
  const idToUid = {};
  tasks.forEach((t, i) => { idToUid[t.id] = i + 1; });

  // Compute OutlineLevel by walking parent chain
  const taskById = {};
  for (const t of tasks) taskById[t.id] = t;
  function outlineLevelOf(t) {
    let lvl = 1, cur = t;
    while (cur.parent_task_id && taskById[cur.parent_task_id]) {
      lvl += 1; cur = taskById[cur.parent_task_id];
    }
    return lvl;
  }

  // Resources: unique employees across tasks
  const empSet = new Map();
  for (const list of Object.values(resMap)) {
    for (const r of list) empSet.set(r.id, r.name);
  }
  const resources = Array.from(empSet.entries()).map(([id, name], i) => ({ uid: i + 1, id, name }));
  const empIdToResUid = {};
  for (const r of resources) empIdToResUid[r.id] = r.uid;

  const typeReverse = { FS: 1, FF: 0, SF: 2, SS: 3 };

  // Build XML via fast-xml-parser builder
  const xmlTasks = [{ UID: 0, ID: 0, Name: project.name, Active: 1, Summary: 1, OutlineLevel: 0 }];
  tasks.forEach((t, i) => {
    const uid = idToUid[t.id];
    const level = outlineLevelOf(t);
    const task = {
      UID: uid,
      ID: i + 1,
      Name: t.title,
      Active: 1,
      Manual: 1,
      OutlineLevel: level,
      Duration: formatMspdiDuration(t.duration_days || 1),
      Start: t.start_date ? `${t.start_date}T08:00:00` : undefined,
      Finish: t.finish_date ? `${t.finish_date}T17:00:00` : undefined
    };
    const deps = depsMap[t.id] || [];
    if (deps.length) {
      task.PredecessorLink = deps.map(d => ({
        PredecessorUID: idToUid[d.predecessor_id],
        Type: typeReverse[d.dep_type] != null ? typeReverse[d.dep_type] : 1,
        LinkLag: Math.round((Number(d.lag_days) || 0) * 480)
      }));
    }
    xmlTasks.push(task);
  });

  const xmlAssignments = [];
  let assignUid = 1;
  for (const t of tasks) {
    for (const r of (resMap[t.id] || [])) {
      xmlAssignments.push({
        UID: assignUid++,
        TaskUID: idToUid[t.id],
        ResourceUID: empIdToResUid[r.id],
        Units: 1
      });
    }
  }

  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    Project: {
      '@_xmlns': 'http://schemas.microsoft.com/project',
      Name: project.name,
      Title: project.name,
      Tasks: { Task: xmlTasks },
      Resources: { Resource: resources.map(r => ({ UID: r.uid, ID: r.uid, Name: r.name })) },
      Assignments: { Assignment: xmlAssignments }
    }
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    attributeNamePrefix: '@_',
    suppressEmptyNode: true
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build({ Project: doc.Project });

  const safeName = project.name.replace(/[^\w\u4e00-\u9fa5.-]/g, '_');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xml"`);
  res.send(xml);
});

// ===== Critical Path =====

function computeCriticalPath(projectId) {
  const tasks = all(
    'SELECT id, parent_task_id, duration_days, start_date, finish_date FROM project_tasks WHERE project_id = ?',
    [projectId]
  );
  const deps = all(
    'SELECT d.task_id, d.predecessor_id, d.dep_type, d.lag_days FROM project_task_deps d JOIN project_tasks t ON d.task_id = t.id WHERE t.project_id = ?',
    [projectId]
  );
  // Consider only leaf tasks (no children) with dates set
  const hasChild = new Set();
  for (const t of tasks) if (t.parent_task_id) hasChild.add(t.parent_task_id);
  const leaves = tasks.filter(t => !hasChild.has(t.id) && t.start_date && t.finish_date);
  if (!leaves.length) return [];
  const byId = {};
  for (const t of leaves) byId[t.id] = t;

  // Find the latest-finishing leaf task(s)
  let maxFinish = null;
  for (const t of leaves) if (!maxFinish || t.finish_date > maxFinish) maxFinish = t.finish_date;
  const endTasks = leaves.filter(t => t.finish_date === maxFinish);

  // Walk back along "tight" predecessor chains
  const critical = new Set();
  const visited = new Set();
  function walk(taskId) {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    critical.add(taskId);
    const t = byId[taskId];
    if (!t) return;
    const predDeps = deps.filter(d => d.task_id === taskId);
    for (const d of predDeps) {
      const pred = byId[d.predecessor_id];
      if (!pred || !pred.start_date || !pred.finish_date) continue;
      const lag = Number(d.lag_days) || 0;
      let expectedStart = null;
      if (d.dep_type === 'FS') {
        expectedStart = shiftWorkdays(pred.finish_date, lag + 1);
      } else if (d.dep_type === 'SS') {
        expectedStart = shiftWorkdays(pred.start_date, lag);
      } else if (d.dep_type === 'FF') {
        const f = shiftWorkdays(pred.finish_date, lag);
        expectedStart = shiftWorkdays(f, -(t.duration_days - 1));
      } else if (d.dep_type === 'SF') {
        const f = shiftWorkdays(pred.start_date, lag);
        expectedStart = shiftWorkdays(f, -(t.duration_days - 1));
      }
      // If this dependency is "tight" (actual start matches expected), chain is critical
      if (expectedStart && expectedStart === t.start_date) walk(pred.id);
    }
  }
  for (const t of endTasks) walk(t.id);
  return Array.from(critical);
}

router.get('/:id/critical-path', (req, res) => {
  const projectId = Number(req.params.id);
  const project = get('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({ critical_task_ids: computeCriticalPath(projectId) });
});

// ===== Baselines =====

router.get('/:id/baselines', (req, res) => {
  const projectId = Number(req.params.id);
  const list = all(
    `SELECT b.*, u.username as saved_by_name FROM project_baselines b
     LEFT JOIN users u ON b.saved_by = u.id
     WHERE b.project_id = ? ORDER BY b.id DESC`,
    [projectId]
  );
  res.json(list);
});

router.post('/:id/baselines', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const projectId = Number(req.params.id);
  const project = get('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const name = (req.body && req.body.name || '').trim() || `基线 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const r = run(
    'INSERT INTO project_baselines (project_id, name, saved_by) VALUES (?, ?, ?)',
    [projectId, name, req.user.id]
  );
  const bid = r.lastInsertRowid;
  const tasks = all('SELECT id, start_date, finish_date, duration_days FROM project_tasks WHERE project_id = ?', [projectId]);
  for (const t of tasks) {
    run(
      'INSERT INTO project_baseline_tasks (baseline_id, task_id, start_date, finish_date, duration_days) VALUES (?, ?, ?, ?, ?)',
      [bid, t.id, t.start_date, t.finish_date, t.duration_days]
    );
  }
  res.json({ id: bid, saved: tasks.length });
});

router.get('/:id/baselines/:bid/tasks', (req, res) => {
  const projectId = Number(req.params.id);
  const bid = Number(req.params.bid);
  const b = get('SELECT * FROM project_baselines WHERE id = ? AND project_id = ?', [bid, projectId]);
  if (!b) return res.status(404).json({ error: '基线不存在' });
  const rows = all(
    'SELECT task_id, start_date, finish_date, duration_days FROM project_baseline_tasks WHERE baseline_id = ?',
    [bid]
  );
  res.json({ baseline: b, tasks: rows });
});

router.delete('/:id/baselines/:bid', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  const projectId = Number(req.params.id);
  const bid = Number(req.params.bid);
  run('DELETE FROM project_baselines WHERE id = ? AND project_id = ?', [bid, projectId]);
  res.json({ success: true });
});

// ===== Resource Histogram =====
// Returns: { dates: ['YYYY-MM-DD', ...], employees: [{ id, name, counts: [n per date] }] }
// Counts: how many tasks each employee is assigned on each day (0 on weekends for task-active days).

router.get('/:id/resource-histogram', (req, res) => {
  const projectId = Number(req.params.id);
  const tasks = all(
    `SELECT pt.id, pt.start_date, pt.finish_date, pt.parent_task_id
     FROM project_tasks pt
     WHERE pt.project_id = ? AND pt.start_date IS NOT NULL AND pt.finish_date IS NOT NULL`,
    [projectId]
  );
  if (!tasks.length) return res.json({ dates: [], employees: [] });
  const taskIds = tasks.map(t => t.id);
  const ph = taskIds.map(() => '?').join(',');
  const assigns = all(
    `SELECT r.task_id, r.employee_id, e.name FROM project_task_resources r
     LEFT JOIN employees e ON r.employee_id = e.id
     WHERE r.task_id IN (${ph})`,
    taskIds
  );
  // project date range
  let minDate = null, maxDate = null;
  for (const t of tasks) {
    if (!minDate || t.start_date < minDate) minDate = t.start_date;
    if (!maxDate || t.finish_date > maxDate) maxDate = t.finish_date;
  }
  if (!minDate || !maxDate) return res.json({ dates: [], employees: [] });

  // Build workday list
  const dates = [];
  {
    const start = parseDate(minDate);
    const end = parseDate(maxDate);
    const d = new Date(start);
    while (d <= end) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) dates.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
  }
  const dateIdx = {};
  dates.forEach((dStr, i) => { dateIdx[dStr] = i; });

  // Build task map
  const taskById = {};
  for (const t of tasks) taskById[t.id] = t;

  // For each employee, count tasks on each workday
  const empMap = {}; // emp_id -> { name, counts: [] }
  for (const a of assigns) {
    const key = a.employee_id;
    if (!empMap[key]) empMap[key] = { id: a.employee_id, name: a.name || `#${a.employee_id}`, counts: new Array(dates.length).fill(0) };
    const t = taskById[a.task_id];
    if (!t) continue;
    // iterate each workday in [start_date, finish_date]
    const s = parseDate(t.start_date);
    const e = parseDate(t.finish_date);
    if (!s || !e) continue;
    const cur = new Date(s);
    while (cur <= e) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        const key2 = toDateStr(cur);
        const idx = dateIdx[key2];
        if (idx !== undefined) empMap[key].counts[idx] += 1;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  const employees = Object.values(empMap).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ dates, employees });
});

// ===== MPP Import (via Java + MPXJ) =====
// Dockerfile installs openjdk17 and MPXJ lib under /app/server/vendor/mpxj/lib.
// Conversion: java -cp "lib/*" net.sf.mpxj.sample.MpxjConvert input.mpp output.xml

const MPXJ_LIB_DIR = path.join(__dirname, '..', 'vendor', 'mpxj', 'lib');

function convertMppToXml(mppPath, xmlPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MPXJ_LIB_DIR)) {
      return reject(new Error('MPXJ 未安装（容器内缺少 ' + MPXJ_LIB_DIR + '），请重建 Docker 镜像。'));
    }
    const args = ['-cp', `${MPXJ_LIB_DIR}/*`, 'net.sf.mpxj.sample.MpxjConvert', mppPath, xmlPath];
    const p = spawn('java', args);
    let stderr = '';
    p.stderr.on('data', d => { stderr += String(d); });
    p.on('error', err => reject(new Error('启动 java 失败：' + err.message)));
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`MPXJ 转换失败 (exit ${code}): ${stderr}`));
    });
  });
}

const mppUpload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.(mpp)$/i.test(file.originalname)) return cb(new Error('仅支持 .mpp 文件'));
    cb(null, true);
  }
});

router.post('/:id/import-mpp', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: '权限不足' });
  mppUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const mppPath = req.file.path;
    const xmlPath = mppPath + '.xml';
    try {
      await convertMppToXml(mppPath, xmlPath);
      // Redirect to internal XML import logic by re-parsing with the existing handler's parser
      const xml = fs.readFileSync(xmlPath, 'utf8');
      // Clean up temp files
      try { fs.unlinkSync(mppPath); } catch (e) {}
      try { fs.unlinkSync(xmlPath); } catch (e) {}

      const projectId = Number(req.params.id);
      const project = get('SELECT id FROM projects WHERE id = ?', [projectId]);
      if (!project) return res.status(404).json({ error: '项目不存在' });

      const parser = new XMLParser({
        ignoreAttributes: true,
        parseTagValue: false,
        removeNSPrefix: true,
        isArray: (name) => ['Task', 'Resource', 'Assignment', 'PredecessorLink'].includes(name)
      });
      const doc = parser.parse(xml);
      const root = doc.Project || doc;
      const xmlTasks = (root.Tasks && root.Tasks.Task) || [];
      const xmlResources = (root.Resources && root.Resources.Resource) || [];
      const xmlAssignments = (root.Assignments && root.Assignments.Assignment) || [];

      const mode = (req.body && req.body.mode) || 'replace';
      if (mode === 'replace') {
        run('DELETE FROM project_tasks WHERE project_id = ?', [projectId]);
      }

      const employees = all('SELECT id, name FROM employees');
      const empByName = {};
      for (const e of employees) empByName[e.name] = e.id;
      const resUidToEmpId = {};
      for (const r of xmlResources) {
        if (r.Name && empByName[r.Name]) resUidToEmpId[String(r.UID)] = empByName[r.Name];
      }
      const taskAssign = {};
      for (const a of xmlAssignments) {
        const tu = String(a.TaskUID);
        const eid = resUidToEmpId[String(a.ResourceUID)];
        if (!eid) continue;
        (taskAssign[tu] = taskAssign[tu] || []).push(eid);
      }

      const uidToNewId = {};
      const outlineStack = [];
      let createdCount = 0;
      let orderCounter = 0;
      for (const t of xmlTasks) {
        if (!t.Name || t.UID === '0' || t.UID === 0) continue;
        const outlineLevel = Number(t.OutlineLevel || 1);
        while (outlineStack.length && outlineStack[outlineStack.length - 1].level >= outlineLevel) outlineStack.pop();
        const parent_task_id = outlineStack.length ? outlineStack[outlineStack.length - 1].taskId : null;
        const duration = parseMspdiDuration(t.Duration);
        const startDate = parseMspdiDate(t.Start);
        const finishDate = parseMspdiDate(t.Finish);
        const isMilestone = Number(t.Milestone || 0) === 1 ? 1 : 0;

        const r2 = run(
          `INSERT INTO project_tasks (project_id, parent_task_id, order_index, title, duration_days, is_estimated, start_date, finish_date, predecessor_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
          [projectId, parent_task_id, orderCounter++, String(t.Name).trim(), isMilestone ? 0 : duration, 0, startDate, finishDate]
        );
        uidToNewId[String(t.UID)] = r2.lastInsertRowid;
        outlineStack.push({ level: outlineLevel, taskId: r2.lastInsertRowid });
        const emps = taskAssign[String(t.UID)];
        if (emps && emps.length) setTaskResources(r2.lastInsertRowid, emps);
        createdCount++;
      }
      for (const t of xmlTasks) {
        if (!t.PredecessorLink) continue;
        const myId = uidToNewId[String(t.UID)];
        if (!myId) continue;
        const deps = [];
        const predIds = [];
        for (const link of t.PredecessorLink) {
          const predNewId = uidToNewId[String(link.PredecessorUID)];
          if (!predNewId) continue;
          const typeMap = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };
          const dep_type = typeMap[String(link.Type || '1')] || 'FS';
          const lagNum = Number(link.LinkLag || 0);
          const lag = !isNaN(lagNum) && lagNum !== 0 ? Math.round(lagNum / 480) : 0;
          deps.push({ predecessor_id: predNewId, dep_type, lag_days: lag });
          predIds.push(predNewId);
        }
        if (deps.length) {
          setTaskDeps(myId, deps);
          run('UPDATE project_tasks SET predecessor_ids = ? WHERE id = ?', [predIds.join(','), myId]);
        }
      }

      res.json({ success: true, imported: createdCount });
    } catch (e) {
      try { fs.unlinkSync(mppPath); } catch (_) {}
      try { fs.unlinkSync(xmlPath); } catch (_) {}
      console.error('MPP 导入失败:', e);
      res.status(500).json({ error: 'MPP 导入失败: ' + e.message });
    }
  });
});

module.exports = router;
