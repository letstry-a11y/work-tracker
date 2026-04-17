// ===== Objectives & KR management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, statusText, confirmDialog, getMonday, getSunday } from './utils.js';

export async function loadObjectives() {
  const empId = document.getElementById('objFilterEmployee') && document.getElementById('objFilterEmployee').value;
  const deptId = document.getElementById('objFilterDept') && document.getElementById('objFilterDept').value;
  const scopeFilter = document.getElementById('objFilterScope') && document.getElementById('objFilterScope').value;
  const approvalFilter = document.getElementById('objFilterApproval') && document.getElementById('objFilterApproval').value;
  const isAdmin = state.currentUser.role === 'admin';
  const isDeptLeader = state.currentUser.role === 'dept_leader';
  const canManage = isAdmin || isDeptLeader;

  let url = '/api/objectives?';
  if (empId) url += 'employee_id=' + empId + '&';
  if (scopeFilter) url += 'scope=' + scopeFilter + '&';
  if (approvalFilter) url += 'approval_status=' + approvalFilter + '&';

  const monday = getMonday();
  const sunday = getSunday();
  const [data, weekLogs] = await Promise.all([
    api(url),
    api(`/api/daily-logs?start_date=${monday}&end_date=${sunday}`)
  ]);
  if (!data) return;
  state.objectivesCache = data;

  const logsByKR = {};
  for (const l of (weekLogs || [])) {
    if (!l.task_id) continue;
    (logsByKR[l.task_id] = logsByKR[l.task_id] || []).push(l);
  }
  for (const list of Object.values(logsByKR)) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  }

  const globalContainer = document.getElementById('objGlobalList');
  const personalContainer = document.getElementById('objPersonalList');

  // Split into global and personal
  const globalObjs = state.objectivesCache.filter(o => o.scope === 'global');
  const isEmployee = !isAdmin && !isDeptLeader;
  const myEmpId = state.currentUser.employee_id;
  // 筛选目标员工ID：如果选了员工筛选就用筛选值，否则普通员工用自己的ID
  const filterEmpId = empId ? Number(empId) : (isEmployee ? myEmpId : null);
  // 部门筛选：解析该部门的员工ID集合
  const deptEmpIdSet = deptId
    ? new Set((state.employeesCache || []).filter(e => String(e.department_id) === String(deptId)).map(e => e.id))
    : null;
  const passesPeople = (eid) => {
    if (filterEmpId && eid !== filterEmpId) return false;
    if (deptEmpIdSet && !deptEmpIdSet.has(eid)) return false;
    return true;
  };

  // Collect all personal objectives: independent ones + children of global objectives
  const personalObjs = state.objectivesCache
    .filter(o => o.scope !== 'global' && !o.parent_objective_id)
    .filter(o => passesPeople(o.employee_id));
  for (const g of globalObjs) {
    if (g.children) {
      for (const child of g.children) {
        if (child.scope === 'personal' && passesPeople(child.employee_id)) {
          personalObjs.push(child);
        }
      }
    }
  }

  // === Render global objectives ===
  // 选了员工/部门时，只显示与其相关的整体OKR
  let visibleGlobalObjs = globalObjs;
  if (filterEmpId || deptEmpIdSet) {
    visibleGlobalObjs = globalObjs.filter(obj => {
      const hasRelatedKR = (obj.key_results || []).some(kr => kr.assignee_id && passesPeople(kr.assignee_id));
      const hasRelatedChild = (obj.children || []).some(c => passesPeople(c.employee_id));
      return hasRelatedKR || hasRelatedChild;
    });
  }
  if (visibleGlobalObjs.length > 0) {
    let gHtml = '';
    for (const obj of visibleGlobalObjs) {
      gHtml += `<div class="card" style="margin-top:12px;border-left:4px solid var(--primary-light)">`;
      gHtml += renderObjective(obj, canManage, isAdmin, isDeptLeader);
      // Progress bar
      const progress = obj.progress || 0;
      gHtml += `<div style="margin:0 12px 8px 28px">
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);margin-bottom:4px">
          <span>整体进度</span><span style="font-weight:700;color:var(--primary-light)">${progress}%</span>
        </div>
        <div style="background:var(--card-bg);border-radius:6px;height:8px;overflow:hidden;border:1px solid var(--border)">
          <div style="width:${progress}%;height:100%;background:var(--primary-light);border-radius:6px;transition:width .3s"></div>
        </div>
      </div>`;
      // Children tree: filter by selected employee / department / own employee
      const visibleChildren = (filterEmpId || deptEmpIdSet)
        ? (obj.children || []).filter(c => passesPeople(c.employee_id))
        : (obj.children || []);
      if (visibleChildren.length > 0) {
        gHtml += `<div style="margin:8px 0 12px 28px;border-left:2px solid var(--border);padding-left:12px">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">&#128279; 子OKR (${visibleChildren.length})</div>`;
        for (const child of visibleChildren) {
          gHtml += renderChildObjective(child, canManage, isAdmin, isDeptLeader, logsByKR);
        }
        gHtml += '</div>';
      }
      gHtml += '</div>';
    }
    globalContainer.innerHTML = gHtml;
  } else {
    globalContainer.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#127760;</div>
      <div class="empty-state-text">暂无整体OKR</div>
      <div class="empty-state-hint">点击按钮创建整体OKR</div>
    </div>`;
  }

  // === Render personal objectives ===
  if (personalObjs.length > 0) {
    let pHtml = '';
    const byEmp = {};
    for (const obj of personalObjs) {
      const key = obj.employee_id || 'other';
      if (!byEmp[key]) byEmp[key] = { name: obj.employee_name || '未分配', objectives: [] };
      byEmp[key].objectives.push(obj);
    }
    for (const [, empData] of Object.entries(byEmp)) {
      pHtml += `<div class="card" style="margin-top:12px">
        <div class="card-title" style="margin-bottom:12px"><span class="card-title-accent"></span> &#128101; ${esc(empData.name)} 的OKR</div>`;
      for (const obj of empData.objectives) {
        pHtml += renderObjective(obj, canManage, isAdmin, isDeptLeader, logsByKR);
      }
      pHtml += '</div>';
    }
    personalContainer.innerHTML = pHtml;
  } else {
    personalContainer.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#127919;</div>
      <div class="empty-state-text">暂无个人OKR</div>
      <div class="empty-state-hint">点击按钮创建个人OKR</div>
    </div>`;
  }

  // Auto-switch tab based on scope filter
  if (scopeFilter === 'global') {
    switchObjTab('global');
  } else if (scopeFilter === 'personal') {
    switchObjTab('personal');
  }
}

export function switchObjTab(tab) {
  const globalPane = document.getElementById('objGlobalContent');
  const personalPane = document.getElementById('objPersonalContent');
  const tabs = document.querySelectorAll('.obj-sub-tab');
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.objTab === tab);
  });
  globalPane.style.display = tab === 'global' ? '' : 'none';
  personalPane.style.display = tab === 'personal' ? '' : 'none';
}

function renderKRDescTrigger(kr) {
  if (!kr.description) return '';
  return `<button class="btn btn-secondary btn-sm" data-action="toggleKRDesc" data-id="${kr.id}"
    style="padding:2px 8px;font-size:11px;margin-left:6px;vertical-align:middle">📄 描述</button>`;
}

function renderKRDescPanel(kr) {
  if (!kr.description) return '';
  return `<div id="kr-desc-${kr.id}" style="display:none;margin:4px 0 8px 28px;padding:8px 12px;font-size:12px;white-space:pre-wrap;color:var(--text);background:var(--card-bg);border-left:3px solid var(--primary-light);border-radius:4px">${esc(kr.description)}</div>`;
}

export function toggleKRDesc(id) {
  const panel = document.getElementById(`kr-desc-${id}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function renderKRWeekLogs(logs) {
  if (!logs || logs.length === 0) {
    return `<div style="padding:0 0 8px 28px;font-size:12px;color:var(--text-muted)">📋 本周暂无进展</div>`;
  }
  const totalHours = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const hoursStr = Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1);
  const items = logs.map(l => `
    <div style="padding:4px 0;border-top:1px dashed var(--border);font-size:12px">
      <span style="color:var(--text-muted)">${esc(l.date)}</span>
      <span style="margin-left:6px">${esc(l.employee_name || '')}</span>
      <span class="badge badge-in_progress" style="font-size:10px;margin-left:6px">${esc(String(l.hours || 0))}h</span>
      <div style="margin-top:2px;color:var(--text);white-space:pre-wrap">${esc(l.work_content || '—')}</div>
    </div>`).join('');
  return `<details style="margin:0 0 8px 28px">
    <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);padding:2px 0">
      📋 本周进展（${logs.length}条，合计 ${hoursStr}h）
    </summary>
    <div style="padding:4px 0 2px 0">${items}</div>
  </details>`;
}

function renderObjective(obj, canManage, isAdmin, isDeptLeader, logsByKR) {
  const krs = obj.key_results || [];
  const isGlobal = obj.scope === 'global';
  const showWeekLogs = obj.scope === 'personal' && logsByKR;
  const isPending = obj.approval_status === 'pending';
  const isRejected = obj.approval_status === 'rejected';
  const isOwnObj = obj.employee_id === state.currentUser.employee_id;
  const isEmployee = state.currentUser.role === 'employee';

  // Approval badge
  let approvalBadge = '';
  if (isPending) {
    approvalBadge = '<span class="badge badge-P1" style="font-size:10px;margin-left:6px">待审批</span>';
  } else if (isRejected) {
    approvalBadge = '<span class="badge badge-overdue" style="font-size:10px;margin-left:6px">已驳回</span>';
  }

  // Action buttons
  let actions = '';
  if (isAdmin) {
    // Admin: full control on everything
    if (isPending) {
      actions += `<button class="btn btn-success btn-sm" data-action="approveObj" data-id="${obj.id}">&#10004; 通过</button>`;
      actions += `<button class="btn btn-danger btn-sm" data-action="rejectObj" data-id="${obj.id}">&#10006; 驳回</button>`;
    }
    actions += `<button class="btn btn-primary btn-sm" data-action="addKR" data-id="${obj.id}">&#10010; KR</button>`;
    actions += `<button class="btn btn-secondary btn-sm" data-action="editObj" data-id="${obj.id}">&#9998; 编辑</button>`;
    actions += `<button class="btn btn-danger btn-sm" data-action="deleteObj" data-id="${obj.id}">&#10006; 删除</button>`;
  } else if (isDeptLeader) {
    if (isPending) {
      actions += `<button class="btn btn-success btn-sm" data-action="approveObj" data-id="${obj.id}">&#10004; 通过</button>`;
      actions += `<button class="btn btn-danger btn-sm" data-action="rejectObj" data-id="${obj.id}">&#10006; 驳回</button>`;
    }
    if (isGlobal) {
      actions += `<button class="btn btn-primary btn-sm" data-action="addKR" data-id="${obj.id}">&#10010; KR</button>`;
    } else {
      actions += `<button class="btn btn-primary btn-sm" data-action="addKR" data-id="${obj.id}">&#10010; KR</button>`;
      actions += `<button class="btn btn-secondary btn-sm" data-action="editObj" data-id="${obj.id}">&#9998; 编辑</button>`;
      actions += `<button class="btn btn-danger btn-sm" data-action="deleteObj" data-id="${obj.id}">&#10006; 删除</button>`;
    }
  } else {
    // Employee
    if (isGlobal) {
      actions += `<button class="btn btn-primary btn-sm" data-action="claimKR" data-id="${obj.id}">&#128588; 认领KR</button>`;
    } else if (isOwnObj && isPending) {
      actions += `<button class="btn btn-secondary btn-sm" data-action="editObj" data-id="${obj.id}">&#9998; 编辑</button>`;
      actions += `<button class="btn btn-danger btn-sm" data-action="deleteObj" data-id="${obj.id}">&#10006; 撤回</button>`;
    }
  }

  const krHtml = krs.map(kr => {
    const badge = kr.confirm_status === 'pending' ? '<span class="badge badge-P1" style="font-size:10px;margin-left:4px">待审核</span>' :
                  kr.confirm_status === 'confirmed' ? '<span class="badge badge-completed" style="font-size:10px;margin-left:4px">已通过</span>' :
                  kr.confirm_status === 'rejected' ? '<span class="badge badge-overdue" style="font-size:10px;margin-left:4px">已打回</span>' : '';
    const assigneeLabel = kr.assignee_name ? `<span style="font-size:11px;color:var(--text-muted);margin-left:6px">&#128100; ${esc(kr.assignee_name)}</span>` : '';
    const deadlineExpired = kr.deadline && kr.status !== 'completed' && new Date(kr.deadline) < new Date(new Date().toDateString());
    const deadlineLabel = kr.deadline ? `<span style="font-size:11px;color:${deadlineExpired ? 'var(--danger, #e53935)' : 'var(--text-muted)'};margin-left:6px">${deadlineExpired ? '⚠️' : '📅'} ${kr.deadline}</span>` : '';
    const krActions = canManage ? `<button class="btn btn-secondary btn-sm" data-action="editKR" data-id="${kr.id}">编辑</button>
            <button class="btn btn-danger btn-sm" data-action="deleteKR" data-id="${kr.id}">删除</button>` : '';
    const weekBlock = showWeekLogs ? renderKRWeekLogs(logsByKR[kr.id] || []) : '';
    const descTrigger = renderKRDescTrigger(kr);
    const descPanel = renderKRDescPanel(kr);
    return `<div style="border-bottom:1px solid var(--border)">
      <div style="padding:8px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
          <span class="badge badge-okr" style="font-size:9px">KR</span>
          <a href="#" class="kr-task-link" data-action="viewTaskFromKR" data-obj-id="${kr.objective_id}"
             style="color:var(--text);text-decoration:none;border-bottom:1px dashed var(--text-muted)">
            ${esc(kr.title)}
          </a>
          ${descTrigger}
          ${assigneeLabel}
          ${deadlineLabel}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span class="badge badge-${kr.status}">${statusText(kr.status)}</span>${badge}
          ${krActions}
        </div>
      </div>
      ${descPanel}
      ${weekBlock}
    </div>`;
  }).join('');

  const icon = isGlobal ? '&#127760;' : '&#127919;';

  return `<div class="obj-card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:${krHtml ? '12px' : '0'};flex-wrap:wrap">
      <span style="font-size:18px">${icon}</span>
      <span style="flex:1;font-weight:700;font-size:15px;min-width:120px">${esc(obj.title)}</span>
      <span class="badge badge-in_progress">权重 ${Math.round((obj.weight || 0) * 100)}%</span>
      ${approvalBadge}
      ${actions}
    </div>
    ${krHtml || '<div style="color:var(--text-muted);font-size:13px;padding-left:28px">暂无关键结果</div>'}
  </div>`;
}

function renderChildObjective(obj, canManage, isAdmin, isDeptLeader, logsByKR) {
  const krs = obj.key_results || [];
  const showWeekLogs = !!logsByKR;
  const allCompleted = krs.length > 0 && krs.every(k => k.status === 'completed');
  const statusIcon = allCompleted ? '&#10004;' : '&#9675;';
  const statusColor = allCompleted ? 'var(--success, #4caf50)' : 'var(--text-muted)';

  // Approval badge
  let approvalBadge = '';
  if (obj.approval_status === 'pending') {
    approvalBadge = '<span class="badge badge-P1" style="font-size:10px;margin-left:6px">待审批</span>';
  } else if (obj.approval_status === 'rejected') {
    approvalBadge = '<span class="badge badge-overdue" style="font-size:10px;margin-left:6px">已驳回</span>';
  }

  // Action buttons
  let actions = '';
  if (isAdmin) {
    actions += `<button class="btn btn-primary btn-sm" data-action="addKR" data-id="${obj.id}">&#10010; KR</button>`;
    actions += `<button class="btn btn-secondary btn-sm" data-action="editObj" data-id="${obj.id}">&#9998;</button>`;
    actions += `<button class="btn btn-danger btn-sm" data-action="deleteObj" data-id="${obj.id}">&#10006;</button>`;
  } else if (isDeptLeader && obj.scope !== 'global') {
    actions += `<button class="btn btn-primary btn-sm" data-action="addKR" data-id="${obj.id}">&#10010; KR</button>`;
    actions += `<button class="btn btn-secondary btn-sm" data-action="editObj" data-id="${obj.id}">&#9998;</button>`;
  }

  const krHtml = krs.map(kr => {
    const badge = kr.status === 'completed' ? '<span class="badge badge-completed" style="font-size:9px">&#10004;</span>' :
                  `<span class="badge badge-${kr.status}" style="font-size:9px">${statusText(kr.status)}</span>`;
    const assigneeLabel = kr.assignee_name ? `<span style="font-size:10px;color:var(--text-muted)">&#128100; ${esc(kr.assignee_name)}</span>` : '';
    const deadlineExpired = kr.deadline && kr.status !== 'completed' && new Date(kr.deadline) < new Date(new Date().toDateString());
    const deadlineLabel = kr.deadline ? `<span style="font-size:10px;color:${deadlineExpired ? 'var(--danger, #e53935)' : 'var(--text-muted)'};margin-left:4px">${deadlineExpired ? '⚠️' : '📅'} ${kr.deadline}</span>` : '';
    const weekBlock = showWeekLogs ? renderKRWeekLogs(logsByKR[kr.id] || []) : '';
    const descTrigger = renderKRDescTrigger(kr);
    const descPanel = renderKRDescPanel(kr);
    return `<div style="padding:4px 0;font-size:13px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <div style="flex:1;min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:6px">
          <span class="badge badge-okr" style="font-size:8px">KR</span>
          <span>${esc(kr.title)}</span>
          ${descTrigger}
          ${assigneeLabel}
          ${deadlineLabel}
        </div>
        ${badge}
      </div>
      ${descPanel}
      ${weekBlock}
    </div>`;
  }).join('');

  const parentKRBadge = obj.parent_kr_title
    ? `<span class="badge" style="background:rgba(33,150,243,0.15);color:var(--primary-light);font-size:10px" title="${esc(obj.parent_kr_title)}">&#128279; 关联KR: ${esc(obj.parent_kr_title)}</span>`
    : '';

  return `<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="color:${statusColor};font-size:14px">${statusIcon}</span>
      <span style="flex:1;font-weight:600;font-size:13px">${esc(obj.title)}</span>
      ${parentKRBadge}
      ${obj.employee_name ? `<span style="font-size:11px;color:var(--text-muted)">&#128100; ${esc(obj.employee_name)}</span>` : ''}
      <span class="badge badge-in_progress" style="font-size:10px">权重 ${Math.round((obj.weight || 0) * 100)}%</span>
      ${approvalBadge}
      ${actions}
    </div>
    ${krHtml || '<div style="color:var(--text-muted);font-size:12px;padding-left:22px;margin-top:4px">暂无 KR</div>'}
  </div>`;
}

export function populateParentKRSelect(parentObjId, selectedKrId) {
  const krGroup = document.getElementById('objParentKRGroup');
  const krSelect = document.getElementById('objParentKR');
  if (!krGroup || !krSelect) return;
  if (!parentObjId) {
    krSelect.innerHTML = '<option value="">不关联具体 KR</option>';
    krSelect.value = '';
    krGroup.style.display = 'none';
    return;
  }
  const parent = (state.objectivesCache || []).find(o => o.id === Number(parentObjId));
  const krs = (parent && parent.key_results) || [];
  krSelect.innerHTML = '<option value="">不关联具体 KR</option>'
    + krs.map(k => `<option value="${k.id}">${esc(k.title)}</option>`).join('');
  krSelect.value = selectedKrId ? String(selectedKrId) : '';
  krGroup.style.display = krs.length > 0 ? '' : 'none';
}

export function showObjModal(editId) {
  document.getElementById('objEditId').value = editId || '';
  document.getElementById('objScope').value = 'personal';
  document.getElementById('objTitle').value = '';
  document.getElementById('objWeight').value = '0';
  document.getElementById('objScopeInfo').style.display = 'none';
  document.getElementById('objEmployeeGroup').style.display = '';

  const isEmployee = state.currentUser.role === 'employee';
  // Employee: hide employee dropdown, show approval note
  if (isEmployee) {
    document.getElementById('objEmployeeGroup').style.display = 'none';
    document.getElementById('objApprovalNote').style.display = '';
  } else {
    document.getElementById('objApprovalNote').style.display = 'none';
  }

  // Show parent objective dropdown for personal scope
  const parentGroup = document.getElementById('objParentGroup');
  if (parentGroup) {
    parentGroup.style.display = '';
    document.getElementById('objParentObjective').value = '';
  }
  populateParentKRSelect('', '');

  if (editId) {
    // Find in main cache or in children of global objectives
    let obj = state.objectivesCache.find(o => o.id === editId);
    if (!obj) {
      for (const g of state.objectivesCache) {
        if (g.children) {
          const found = g.children.find(c => c.id === editId);
          if (found) { obj = found; break; }
        }
      }
    }
    if (obj) {
      document.getElementById('objTitle').value = obj.title;
      document.getElementById('objWeight').value = Math.round((obj.weight || 0) * 100);
      document.getElementById('objScope').value = obj.scope || 'personal';
      if (obj.scope === 'global') {
        document.getElementById('objScopeInfo').style.display = '';
        document.getElementById('objEmployeeGroup').style.display = 'none';
        document.getElementById('objApprovalNote').style.display = 'none';
        if (parentGroup) parentGroup.style.display = 'none';
      }
      // Populate employee select for editing
      if (obj.employee_id) {
        document.getElementById('objEmployee').value = obj.employee_id;
      }
      // Set parent objective value
      if (obj.parent_objective_id && parentGroup) {
        document.getElementById('objParentObjective').value = obj.parent_objective_id;
        populateParentKRSelect(obj.parent_objective_id, obj.parent_kr_id);
      }
    }
  }
  document.getElementById('objModalTitle').textContent = editId ? '编辑OKR' : '添加个人OKR';
  document.getElementById('objModal').classList.add('show');
}

export function showGlobalObjModal() {
  document.getElementById('objEditId').value = '';
  document.getElementById('objScope').value = 'global';
  document.getElementById('objTitle').value = '';
  document.getElementById('objWeight').value = '0';
  document.getElementById('objScopeInfo').style.display = '';
  document.getElementById('objEmployeeGroup').style.display = 'none';
  document.getElementById('objApprovalNote').style.display = 'none';
  const parentGroup = document.getElementById('objParentGroup');
  if (parentGroup) parentGroup.style.display = 'none';
  const parentKRGroup = document.getElementById('objParentKRGroup');
  if (parentKRGroup) parentKRGroup.style.display = 'none';
  document.getElementById('objModalTitle').textContent = '创建整体OKR';
  document.getElementById('objModal').classList.add('show');
}

export function editObj(id) { showObjModal(id); }

export async function saveObj() {
  const editId = document.getElementById('objEditId').value;
  const scope = document.getElementById('objScope').value;
  const body = {
    title: document.getElementById('objTitle').value.trim(),
    weight: parseFloat(document.getElementById('objWeight').value) / 100 || 0,
    scope
  };

  if (scope !== 'global') {
    body.employee_id = document.getElementById('objEmployee').value ? parseInt(document.getElementById('objEmployee').value) : null;
    const parentVal = document.getElementById('objParentObjective').value;
    body.parent_objective_id = parentVal ? parseInt(parentVal) : null;
    const krSel = document.getElementById('objParentKR');
    const parentKrVal = krSel ? krSel.value : '';
    body.parent_kr_id = parentKrVal ? parseInt(parentKrVal) : null;
  }

  if (!body.title) return toast('OKR名称不能为空', 'error');

  if (editId) {
    const res = await api('/api/objectives/' + editId, { method: 'PUT', body });
    if (!res) return;
  } else {
    const res = await api('/api/objectives', { method: 'POST', body });
    if (!res) return;
    if (res.approval_status === 'pending') {
      toast('OKR已提交，等待审批', 'info');
    } else {
      toast('已保存');
    }
    closeModal('objModal');
    loadObjectives();
    return;
  }
  closeModal('objModal');
  toast('已保存');
  loadObjectives();
}

export async function deleteObj(id) {
  let obj = state.objectivesCache.find(o => o.id === id);
  if (!obj) {
    for (const g of state.objectivesCache) {
      if (g.children) {
        const found = g.children.find(c => c.id === id);
        if (found) { obj = found; break; }
      }
    }
  }
  const isOwnPending = obj && obj.approval_status === 'pending' && obj.employee_id === state.currentUser.employee_id;
  const msg = isOwnPending ? '确认撤回该OKR？' : '确认删除该OKR？其下所有KR也会一并删除。';
  const title = isOwnPending ? '撤回OKR' : '删除OKR';
  const ok = await confirmDialog({ title, message: msg });
  if (!ok) return;
  const res = await api('/api/objectives/' + id, { method: 'DELETE' });
  if (!res) return;
  toast(isOwnPending ? '已撤回' : '已删除');
  loadObjectives();
}

export async function approveObj(id) {
  const res = await api('/api/objectives/' + id + '/approve', { method: 'POST', body: { action: 'approve' } });
  if (!res) return;
  toast('OKR已审批通过');
  loadObjectives();
}

export async function rejectObj(id) {
  const ok = await confirmDialog({ title: '驳回OKR', message: '确认驳回该OKR？' });
  if (!ok) return;
  const res = await api('/api/objectives/' + id + '/approve', { method: 'POST', body: { action: 'reject' } });
  if (!res) return;
  toast('OKR已驳回');
  loadObjectives();
}

export function claimKR(objId) {
  document.getElementById('krEditId').value = '';
  document.getElementById('krObjId').value = objId;
  document.getElementById('krTitle').value = '';
  document.getElementById('krDesc').value = '';
  document.getElementById('krPriority').value = 'P2';
  document.getElementById('krHours').value = '8';
  document.getElementById('krDeadline').value = '';
  document.getElementById('krStatus').value = 'pending';
  document.getElementById('krModalTitle').textContent = '认领关键结果';
  // Pre-select self as assignee
  const krAssignee = document.getElementById('krAssignee');
  if (krAssignee && state.currentUser.employee_id) {
    krAssignee.value = state.currentUser.employee_id;
  }
  document.getElementById('krModal').classList.add('show');
}

export function addKR(objId) {
  document.getElementById('krEditId').value = '';
  document.getElementById('krObjId').value = objId;
  document.getElementById('krTitle').value = '';
  document.getElementById('krDesc').value = '';
  document.getElementById('krPriority').value = 'P2';
  document.getElementById('krHours').value = '8';
  document.getElementById('krDeadline').value = '';
  const krAssignee = document.getElementById('krAssignee');
  if (krAssignee) krAssignee.value = '';
  document.getElementById('krStatus').value = 'pending';
  document.getElementById('krModalTitle').textContent = '添加关键结果';
  document.getElementById('krModal').classList.add('show');
}

export function editKR(id) {
  let kr = null;
  for (const obj of state.objectivesCache) {
    const found = (obj.key_results || []).find(k => k.id === id);
    if (found) { kr = found; break; }
    // Search in children too
    if (obj.children) {
      for (const child of obj.children) {
        const cfound = (child.key_results || []).find(k => k.id === id);
        if (cfound) { kr = cfound; break; }
      }
      if (kr) break;
    }
  }
  if (!kr) return;
  document.getElementById('krEditId').value = id;
  document.getElementById('krObjId').value = kr.objective_id;
  document.getElementById('krTitle').value = kr.title;
  document.getElementById('krDesc').value = kr.description || '';
  document.getElementById('krPriority').value = kr.priority;
  document.getElementById('krHours').value = kr.estimated_hours || 8;
  document.getElementById('krDeadline').value = kr.deadline || '';
  const krAssignee = document.getElementById('krAssignee');
  if (krAssignee) krAssignee.value = kr.assignee_id || '';
  document.getElementById('krStatus').value = kr.status || 'pending';
  document.getElementById('krModalTitle').textContent = '编辑关键结果';
  document.getElementById('krModal').classList.add('show');
}

export async function saveKR() {
  const editId = document.getElementById('krEditId').value;
  const objective_id = parseInt(document.getElementById('krObjId').value);
  const body = {
    title: document.getElementById('krTitle').value.trim(),
    description: document.getElementById('krDesc').value,
    objective_id,
    assignee_id: document.getElementById('krAssignee').value ? parseInt(document.getElementById('krAssignee').value) : null,
    priority: document.getElementById('krPriority').value,
    estimated_hours: parseFloat(document.getElementById('krHours').value) || 8,
    deadline: document.getElementById('krDeadline').value || null,
    status: document.getElementById('krStatus').value
  };
  if (!body.title) return toast('KR名称不能为空', 'error');
  if (editId) {
    const res = await api('/api/tasks/' + editId, { method: 'PUT', body });
    if (!res) return;
  } else {
    const res = await api('/api/tasks', { method: 'POST', body });
    if (!res) return;
  }
  closeModal('krModal');
  toast('已保存');
  loadObjectives();
}

export async function deleteKR(id) {
  const ok = await confirmDialog({ title: '删除 OKR', message: '确认删除该 OKR？' });
  if (!ok) return;
  const res = await api('/api/tasks/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadObjectives();
}
