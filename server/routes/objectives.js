const express = require('express');
const router = express.Router();
const { all, get, run } = require('../db');
const { auth, getDeptEmployeeIds } = require('../auth/middleware');

// GET /api/objectives
router.get('/', auth, (req, res) => {
  const { employee_id, scope, approval_status } = req.query;
  const isAdmin = req.user.role === 'admin';
  const isDeptLeader = req.user.role === 'dept_leader' && req.user.department_id;
  const deptEmpIds = isDeptLeader ? getDeptEmployeeIds(req.user.department_id) : [];

  let sql = `SELECT o.*, e.name as employee_name, uc.username as created_by_name, pkr.title as parent_kr_title
    FROM objectives o
    LEFT JOIN employees e ON o.employee_id = e.id
    LEFT JOIN users uc ON o.created_by = uc.id
    LEFT JOIN tasks pkr ON o.parent_kr_id = pkr.id
    WHERE (o.parent_objective_id IS NULL OR o.scope = 'global')`;
  const params = [];

  // Scope filter
  if (scope) {
    sql += ' AND o.scope = ?';
    params.push(scope);
  }

  // Approval status filter
  if (approval_status) {
    sql += ' AND o.approval_status = ?';
    params.push(approval_status);
  }

  // Employee filter: keep global objectives (children loaded separately)
  if (employee_id) {
    sql += " AND (o.employee_id = ? OR o.scope = 'global')";
    params.push(Number(employee_id));
  }

  // Visibility rules by role
  if (isAdmin) {
    // Admin sees all
  } else if (isDeptLeader) {
    if (deptEmpIds.length > 0) {
      const ph = deptEmpIds.map(() => '?').join(',');
      sql += ` AND (
        (o.scope = 'global' AND o.approval_status = 'approved')
        OR (o.scope = 'personal' AND o.employee_id IN (${ph}))
      )`;
      params.push(...deptEmpIds);
    } else {
      sql += ` AND (o.scope = 'global' AND o.approval_status = 'approved')`;
    }
  } else {
    if (req.user.employee_id) {
      sql += ` AND (
        (o.scope = 'global' AND o.approval_status = 'approved')
        OR (o.scope = 'personal' AND o.employee_id = ?)
      )`;
      params.push(req.user.employee_id);
    } else {
      sql += ` AND (o.scope = 'global' AND o.approval_status = 'approved')`;
    }
  }

  sql += ' ORDER BY o.scope ASC, o.employee_id, o.id';

  const objectives = all(sql, params);

  // Collect all objective IDs (including children to load) for KR batch loading
  const globalObjIds = objectives.filter(o => o.scope === 'global').map(o => o.id);

  // Batch load child objectives for global objectives
  let childObjectives = [];
  if (globalObjIds.length > 0) {
    const gph = globalObjIds.map(() => '?').join(',');
    childObjectives = all(`SELECT o.*, e.name as employee_name, pkr.title as parent_kr_title FROM objectives o LEFT JOIN employees e ON o.employee_id = e.id LEFT JOIN tasks pkr ON o.parent_kr_id = pkr.id WHERE o.parent_objective_id IN (${gph}) ORDER BY o.id`, globalObjIds);
  }

  // All objective IDs for KR loading (main + children)
  const allObjIds = [...objectives.map(o => o.id), ...childObjectives.map(o => o.id)];

  if (allObjIds.length > 0) {
    const placeholders = allObjIds.map(() => '?').join(',');

    // Batch load all KRs (tasks) for these objectives, with assignee name
    const allKrs = all(`SELECT t.*, e.name as assignee_name FROM tasks t LEFT JOIN employees e ON t.assignee_id = e.id WHERE t.objective_id IN (${placeholders}) ORDER BY t.id`, allObjIds);

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

    // Attach KRs to all objectives (main + children)
    for (const obj of objectives) {
      obj.key_results = krsMap[obj.id] || [];
    }
    for (const child of childObjectives) {
      child.key_results = krsMap[child.id] || [];
    }

    // Attach children to global objectives + compute progress
    const childrenMap = {};
    for (const child of childObjectives) {
      if (!childrenMap[child.parent_objective_id]) childrenMap[child.parent_objective_id] = [];
      childrenMap[child.parent_objective_id].push(child);
    }
    for (const obj of objectives) {
      if (obj.scope === 'global') {
        obj.children = childrenMap[obj.id] || [];
        // Progress: directKRs + child objectives with KRs
        const directKrs = obj.key_results || [];
        const childrenWithKr = obj.children.filter(c => (c.key_results || []).length > 0);
        const totalItems = directKrs.length + childrenWithKr.length;
        const completedDirectKrs = directKrs.filter(k => k.status === 'completed').length;
        const completedChildren = childrenWithKr.filter(c => c.key_results.every(k => k.status === 'completed')).length;
        const completedItems = completedDirectKrs + completedChildren;
        obj.progress = totalItems > 0 ? Math.round(completedItems / totalItems * 100) : 0;
      }
    }
  }

  res.json(objectives);
});

// POST /api/objectives
router.post('/', auth, (req, res) => {
  const { title, weight, employee_id, scope, parent_objective_id, parent_kr_id } = req.body;
  if (!title) return res.status(400).json({ error: '目标名称不能为空' });

  const isAdmin = req.user.role === 'admin';
  const isDeptLeader = req.user.role === 'dept_leader';

  // Global objective: only admin can create, no parent
  if (scope === 'global') {
    if (!isAdmin) {
      return res.status(403).json({ error: '只有管理员可以创建整体目标' });
    }
    const result = run(
      'INSERT INTO objectives (title, weight, employee_id, scope, approval_status, created_by) VALUES (?, ?, NULL, ?, ?, ?)',
      [title, weight || 0, 'global', 'approved', req.user.id]
    );
    return res.json({ id: result.lastInsertRowid });
  }

  // Validate parent_objective_id if provided
  let finalParentId = null;
  if (parent_objective_id) {
    const parent = get('SELECT * FROM objectives WHERE id = ?', [Number(parent_objective_id)]);
    if (!parent || parent.scope !== 'global' || parent.approval_status !== 'approved') {
      return res.status(400).json({ error: '父目标必须是已审批的整体目标' });
    }
    finalParentId = Number(parent_objective_id);
  }

  // Validate parent_kr_id if provided: must belong to parent_objective_id
  let finalParentKrId = null;
  if (parent_kr_id) {
    if (!finalParentId) {
      return res.status(400).json({ error: '关联KR 必须与父整体OKR 一起指定' });
    }
    const pkr = get('SELECT objective_id FROM tasks WHERE id = ?', [Number(parent_kr_id)]);
    if (!pkr || pkr.objective_id !== finalParentId) {
      return res.status(400).json({ error: '关联KR 不属于所选父整体OKR' });
    }
    finalParentKrId = Number(parent_kr_id);
  }

  // Personal objective
  let finalEmpId;
  let approvalStatus;

  if (isAdmin || isDeptLeader) {
    finalEmpId = employee_id ? Number(employee_id) : null;
    approvalStatus = 'approved';

    if (isDeptLeader && finalEmpId) {
      const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
      if (!deptEmpIds.includes(finalEmpId)) {
        return res.status(403).json({ error: '只能为本部门成员创建目标' });
      }
    }
  } else {
    finalEmpId = req.user.employee_id;
    approvalStatus = 'pending';
  }

  const result = run(
    'INSERT INTO objectives (title, weight, employee_id, scope, approval_status, created_by, parent_objective_id, parent_kr_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [title, weight || 0, finalEmpId, 'personal', approvalStatus, req.user.id, finalParentId, finalParentKrId]
  );
  res.json({ id: result.lastInsertRowid, approval_status: approvalStatus });
});

// PUT /api/objectives/:id
router.put('/:id', auth, (req, res) => {
  const obj = get('SELECT * FROM objectives WHERE id = ?', [Number(req.params.id)]);
  if (!obj) return res.status(404).json({ error: '目标不存在' });

  const isAdmin = req.user.role === 'admin';
  const isDeptLeader = req.user.role === 'dept_leader';

  if (isAdmin) {
    // Admin can edit all
  } else if (isDeptLeader) {
    // dept_leader can edit department personal objectives, not global
    if (obj.scope === 'global') {
      return res.status(403).json({ error: '部门负责人不能编辑整体目标' });
    }
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (!deptEmpIds.includes(obj.employee_id)) {
      return res.status(403).json({ error: '只能编辑本部门成员的目标' });
    }
  } else {
    // Employee can only edit own pending personal objectives
    if (obj.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: '只能编辑自己的目标' });
    }
    if (obj.approval_status !== 'pending') {
      return res.status(403).json({ error: '只能编辑待审批的目标' });
    }
  }

  const { title, weight, employee_id, parent_objective_id, parent_kr_id } = req.body;

  // Validate parent_objective_id
  let finalParentId = obj.parent_objective_id;
  if (parent_objective_id !== undefined) {
    if (obj.scope === 'global') {
      finalParentId = null; // global objectives cannot have parent
    } else if (parent_objective_id === null || parent_objective_id === '') {
      finalParentId = null; // unbind
    } else {
      const parent = get('SELECT * FROM objectives WHERE id = ?', [Number(parent_objective_id)]);
      if (!parent || parent.scope !== 'global' || parent.approval_status !== 'approved') {
        return res.status(400).json({ error: '父目标必须是已审批的整体目标' });
      }
      finalParentId = Number(parent_objective_id);
    }
  }

  // Validate parent_kr_id (follows parent_objective_id)
  let finalParentKrId = obj.parent_kr_id;
  if (parent_kr_id !== undefined) {
    if (parent_kr_id === null || parent_kr_id === '') {
      finalParentKrId = null;
    } else {
      if (!finalParentId) {
        return res.status(400).json({ error: '关联KR 必须与父整体OKR 一起指定' });
      }
      const pkr = get('SELECT objective_id FROM tasks WHERE id = ?', [Number(parent_kr_id)]);
      if (!pkr || pkr.objective_id !== finalParentId) {
        return res.status(400).json({ error: '关联KR 不属于所选父整体OKR' });
      }
      finalParentKrId = Number(parent_kr_id);
    }
  }
  // If parent objective was unbound, also unbind parent_kr_id
  if (finalParentId === null) finalParentKrId = null;

  run('UPDATE objectives SET title=?, weight=?, employee_id=?, parent_objective_id=?, parent_kr_id=? WHERE id=?', [
    title !== undefined ? title : obj.title,
    weight !== undefined ? weight : obj.weight,
    employee_id !== undefined ? (employee_id ? Number(employee_id) : null) : obj.employee_id,
    finalParentId,
    finalParentKrId,
    Number(req.params.id)
  ]);
  res.json({ success: true });
});

// DELETE /api/objectives/:id
router.delete('/:id', auth, (req, res) => {
  const obj = get('SELECT * FROM objectives WHERE id = ?', [Number(req.params.id)]);
  if (!obj) return res.status(404).json({ error: '目标不存在' });

  const isAdmin = req.user.role === 'admin';
  const isDeptLeader = req.user.role === 'dept_leader';

  if (obj.scope === 'global') {
    if (!isAdmin) {
      return res.status(403).json({ error: '只有管理员可以删除整体目标' });
    }
  } else if (isAdmin) {
    // Admin can delete all personal objectives
  } else if (isDeptLeader) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (!deptEmpIds.includes(obj.employee_id)) {
      return res.status(403).json({ error: '只能删除本部门成员的目标' });
    }
  } else {
    // Employee can only withdraw own pending objectives
    if (obj.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: '只能撤回自己的目标' });
    }
    if (obj.approval_status !== 'pending') {
      return res.status(403).json({ error: '只能撤回待审批的目标' });
    }
  }

  // Unbind child objectives before deleting
  if (obj.scope === 'global') {
    run('UPDATE objectives SET parent_objective_id = NULL WHERE parent_objective_id = ?', [Number(req.params.id)]);
  }

  run('DELETE FROM objectives WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// POST /api/objectives/:id/approve - Approve or reject objective
router.post('/:id/approve', auth, (req, res) => {
  const obj = get('SELECT o.*, e.department_id FROM objectives o LEFT JOIN employees e ON o.employee_id = e.id WHERE o.id = ?', [Number(req.params.id)]);
  if (!obj) return res.status(404).json({ error: '目标不存在' });

  const { action } = req.body;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action 必须是 approve 或 reject' });
  }

  // Permission check: admin or dept_leader of the employee's department
  const isAdmin = req.user.role === 'admin';
  const isDeptLeader = req.user.role === 'dept_leader';

  if (isAdmin) {
    // OK
  } else if (isDeptLeader && obj.department_id) {
    const deptEmpIds = getDeptEmployeeIds(req.user.department_id);
    if (!deptEmpIds.includes(obj.employee_id)) {
      return res.status(403).json({ error: '只能审批本部门成员的目标' });
    }
  } else {
    return res.status(403).json({ error: '权限不足' });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (action === 'approve') {
    run('UPDATE objectives SET approval_status=?, approved_by=?, approved_at=? WHERE id=?',
      ['approved', req.user.id, now, Number(req.params.id)]);
  } else {
    run('UPDATE objectives SET approval_status=? WHERE id=?',
      ['rejected', Number(req.params.id)]);
  }

  res.json({ success: true });
});

module.exports = router;
