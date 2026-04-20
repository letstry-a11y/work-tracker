// ===== Project Management (MS Project style) =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, confirmDialog } from './utils.js';

state.projectsCache = state.projectsCache || [];
state.projectTasksCache = state.projectTasksCache || [];
state.currentProjectId = state.currentProjectId || null;
state.selectedProjectTaskId = state.selectedProjectTaskId || null;
state.projectView = state.projectView || 'table';
state.ganttInstance = null;
state.ganttViewMode = state.ganttViewMode || 'Day';

function canManage() {
  const role = state.currentUser && state.currentUser.role;
  return role === 'admin' || role === 'dept_leader';
}

// ===== Projects =====

export async function loadProjects() {
  const data = await api('/api/projects');
  if (!data) return;
  state.projectsCache = data;
  const select = document.getElementById('projectSelect');
  const current = state.currentProjectId;
  select.innerHTML = '<option value="">（未选择）</option>'
    + data.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (current && data.some(p => p.id === current)) {
    select.value = String(current);
  } else if (data.length > 0) {
    state.currentProjectId = data[0].id;
    select.value = String(data[0].id);
  } else {
    state.currentProjectId = null;
  }
  // bind change once
  if (!select.dataset.bound) {
    select.addEventListener('change', () => {
      state.currentProjectId = select.value ? Number(select.value) : null;
      state.selectedProjectTaskId = null;
      state.selectedBaselineId = null;
      state.baselineTaskMap = null;
      state.criticalTaskIds = new Set();
      const cpToggle = document.getElementById('projectCPToggle');
      if (cpToggle) cpToggle.checked = false;
      state.criticalPathOn = false;
      loadProjectTasks();
      loadBaselines();
    });
    select.dataset.bound = '1';
  }
  // toggle management buttons
  const mgr = canManage();
  document.getElementById('projectNewBtn').style.display = mgr ? '' : 'none';
  document.getElementById('projectEditBtn').style.display = mgr ? '' : 'none';
  document.getElementById('projectDeleteBtn').style.display = mgr ? '' : 'none';
  document.getElementById('projectTaskToolbar').style.display = mgr && state.currentProjectId ? 'flex' : 'none';
  loadProjectTasks();
  loadBaselines();
}

export function showProjectModal(editId) {
  const id = editId || state.currentProjectId;
  if (editId === undefined && !id) {
    // new project
    document.getElementById('projectEditId').value = '';
    document.getElementById('projectName').value = '';
    document.getElementById('projectStartDate').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('projectModalTitle').textContent = '新建项目';
    document.getElementById('projectModal').classList.add('show');
    return;
  }
  // new (explicit)
  document.getElementById('projectEditId').value = '';
  document.getElementById('projectName').value = '';
  document.getElementById('projectStartDate').value = '';
  document.getElementById('projectDescription').value = '';
  document.getElementById('projectModalTitle').textContent = '新建项目';
  document.getElementById('projectModal').classList.add('show');
}

export function editCurrentProject() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  const p = state.projectsCache.find(x => x.id === state.currentProjectId);
  if (!p) return;
  document.getElementById('projectEditId').value = p.id;
  document.getElementById('projectName').value = p.name;
  document.getElementById('projectStartDate').value = p.start_date || '';
  document.getElementById('projectDescription').value = p.description || '';
  document.getElementById('projectModalTitle').textContent = '编辑项目';
  document.getElementById('projectModal').classList.add('show');
}

export async function saveProject() {
  const editId = document.getElementById('projectEditId').value;
  const body = {
    name: document.getElementById('projectName').value.trim(),
    description: document.getElementById('projectDescription').value,
    start_date: document.getElementById('projectStartDate').value || null
  };
  if (!body.name) return toast('项目名称不能为空', 'error');
  const res = editId
    ? await api('/api/projects/' + editId, { method: 'PUT', body })
    : await api('/api/projects', { method: 'POST', body });
  if (!res) return;
  if (!editId && res.id) state.currentProjectId = res.id;
  closeModal('projectModal');
  toast('已保存');
  loadProjects();
}

export async function deleteCurrentProject() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  const p = state.projectsCache.find(x => x.id === state.currentProjectId);
  const ok = await confirmDialog({ title: '删除项目', message: `确认删除项目"${p ? p.name : ''}"？所有任务将一并删除。`, type: 'danger' });
  if (!ok) return;
  const res = await api('/api/projects/' + state.currentProjectId, { method: 'DELETE' });
  if (!res) return;
  state.currentProjectId = null;
  state.selectedProjectTaskId = null;
  toast('已删除');
  loadProjects();
}

// ===== Tasks =====

export async function loadProjectTasks() {
  const tbody = document.getElementById('projectTaskTableBody');
  if (!state.currentProjectId) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-table-cell">请先选择或创建项目</td></tr>';
    state.projectTasksCache = [];
    if (state.projectView === 'gantt') renderProjectGantt();
    return;
  }
  const tasks = await api(`/api/projects/${state.currentProjectId}/tasks`);
  if (!tasks) return;
  state.projectTasksCache = tasks;
  renderProjectTaskTable();
  if (state.projectView === 'gantt') renderProjectGantt();
}

// Build display order: depth-first by (parent_task_id, order_index).
// Respects collapsed nodes — skips children of collapsed parents.
// Returns array of { task, depth, displayIndex(1-based) }.
function buildDisplayList(tasks) {
  const byParent = new Map();
  for (const t of tasks) {
    const k = t.parent_task_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(t);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.order_index - b.order_index) || (a.id - b.id));
  }
  const out = [];
  const collapsed = state.collapsedProjectTaskIds;
  function walk(parentKey, depth) {
    const children = byParent.get(parentKey) || [];
    for (const t of children) {
      out.push({ task: t, depth });
      if (!collapsed.has(t.id)) walk(t.id, depth + 1);
    }
  }
  walk(0, 0);
  return out.map((x, i) => ({ ...x, displayIndex: i + 1 }));
}

function renderProjectTaskTable() {
  const tbody = document.getElementById('projectTaskTableBody');
  const tasks = state.projectTasksCache;
  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-table-cell">暂无任务，点击"新建任务"添加</td></tr>';
    return;
  }
  const disp = buildDisplayList(tasks);
  const idToIdx = new Map();
  for (const it of disp) idToIdx.set(it.task.id, it.displayIndex);

  const mgr = canManage();
  tbody.innerHTML = disp.map(({ task: t, depth, displayIndex }) => {
    const pad = depth * 24;
    const isSummary = tasks.some(x => x.parent_task_id === t.id);
    const deps = t.dependencies && t.dependencies.length
      ? t.dependencies
      : (t.predecessor_ids || '').split(',').filter(Boolean)
          .map(id => ({ predecessor_id: Number(id), dep_type: 'FS', lag_days: 0 }));
    const predDisp = deps.map(d => {
      const num = idToIdx.get(Number(d.predecessor_id)) || '?';
      return String(num);
    }).join(', ');
    const resourceDisp = (t.resources || []).map(r => esc(r.name || '')).join(', ');
    const isCritical = state.criticalPathOn && state.criticalTaskIds && state.criticalTaskIds.has(t.id);
    const progressPercent = t.progress_percent ?? 0;
    const isCompleted = progressPercent >= 100;
    const isSubLevel = depth > 0;
    let rowStyle = '';
    if (t.id === state.selectedProjectTaskId) {
      rowStyle = 'background:rgba(33,150,243,0.18);box-shadow:inset 3px 0 0 #42a5f5';
    } else if (isCompleted) {
      rowStyle = 'background:rgba(0,0,0,0.03)';
    } else if (isSubLevel) {
      rowStyle = 'background:rgba(33,150,243,0.04)';
    }
    if (isCritical && !isCompleted) rowStyle = 'background:rgba(229,57,53,0.08);box-shadow:inset 3px 0 0 #e53935';
    const isCollapsed = state.collapsedProjectTaskIds && state.collapsedProjectTaskIds.has(t.id);
    const toggleBtn = isSummary
      ? `<span style="cursor:pointer;user-select:none;margin-right:2px" data-action="toggleProjectTaskCollapse" data-id="${t.id}">${isCollapsed ? '▸' : '▾'}</span>`
      : `<span style="display:inline-block;width:14px;margin-right:2px"></span>`;

    // Inline editable cells — all levels are editable
    // For completed tasks, render as <span> with line-through (line-through doesn't work on <input>)
    const completedText = (text, extra) => isCompleted
      ? `<span style="text-decoration:line-through;opacity:0.7;font-size:12px;padding:2px 3px;${extra}">${esc(String(text || ''))}</span>`
      : null;

    const durInput = isCompleted
      ? completedText(t.duration_days, 'width:60px;display:inline-block')
      : `<input type="number" class="inline-edit" data-task-id="${t.id}" data-field="duration_days" value="${t.duration_days || 0}" min="1" step="1" style="width:60px;font-size:12px;padding:2px 3px;border:1px solid transparent;border-radius:3px;background:transparent" onfocus="this.style.borderColor='var(--primary)';this.style.background='var(--card-bg)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'" title="回车或失焦保存">`;

    const startDateInput = isCompleted
      ? completedText(t.start_date, 'width:105px;display:inline-block')
      : `<input type="date" class="inline-edit" data-task-id="${t.id}" data-field="start_date" value="${t.start_date || ''}" style="width:105px;font-size:12px;padding:2px 3px;border:1px solid transparent;border-radius:3px;background:transparent" onfocus="this.style.borderColor='var(--primary)';this.style.background='var(--card-bg)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'" title="回车或失焦保存">`;

    const finishDateInput = isCompleted
      ? completedText(t.finish_date, 'width:105px;display:inline-block')
      : `<input type="date" class="inline-edit" data-task-id="${t.id}" data-field="finish_date" value="${t.finish_date || ''}" style="width:105px;font-size:12px;padding:2px 3px;border:1px solid transparent;border-radius:3px;background:transparent" onfocus="this.style.borderColor='var(--primary)';this.style.background='var(--card-bg)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'" title="回车或失焦保存">`;

    const completedStyle = isCompleted ? 'text-decoration:line-through;opacity:0.7' : '';
    const predCell = `<span style="cursor:pointer;color:var(--primary-light);font-size:12px;padding:2px 3px;display:inline-block;min-width:20px;${completedStyle}" data-action="editProjectTaskDeps" data-id="${t.id}" onclick="window._editProjectTaskDeps(${t.id})" title="点击编辑前置任务">${predDisp || '-'}</span>`;

    const progressInput = isCompleted
      ? completedText(progressPercent, 'width:50px;display:inline-block')
      : `<input type="number" class="inline-edit" data-task-id="${t.id}" data-field="progress_percent" value="${progressPercent}" min="0" max="100" style="width:50px;font-size:12px;padding:2px 3px;border:1px solid transparent;border-radius:3px;background:transparent" onfocus="this.style.borderColor='var(--primary)';this.style.background='var(--card-bg)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'" title="回车或失焦保存">`;

    const resourceCell = `<span style="cursor:pointer;color:var(--primary-light);font-size:12px;padding:2px 3px;display:inline-block;min-width:20px;${completedStyle}" data-action="editProjectTaskResources" data-id="${t.id}" onclick="window._editProjectTaskResources(${t.id})" title="点击编辑资源">${resourceDisp || '-'}</span>`;

    const noteInput = isCompleted
      ? completedText(t.note || '-', 'width:100%;display:inline-block')
      : `<input type="text" class="inline-edit" data-task-id="${t.id}" data-field="note" value="${esc(t.note || '')}" placeholder="-" style="width:100%;font-size:12px;padding:2px 3px;border:1px solid transparent;border-radius:3px;background:transparent" onfocus="this.style.borderColor='var(--primary)';this.style.background='var(--card-bg)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'" title="回车或失焦保存">`;
    const okrBadge = t.objective_title
      ? `<span class="badge" style="background:rgba(156,39,176,0.15);color:#ba68c8;font-size:10px;margin-left:6px" title="${esc(t.objective_title)}">🎯 ${esc(t.objective_title)}</span>`
      : '';
    const krBadge = t.kr_title
      ? `<span class="badge" style="background:rgba(33,150,243,0.15);color:var(--primary-light);font-size:10px;margin-left:4px" title="${esc(t.kr_title)}">🔑 ${esc(t.kr_title)}</span>`
      : '';
    // Baseline variance (in calendar days)
    const bt = state.baselineTaskMap ? state.baselineTaskMap[t.id] : null;
    const dayDiff = (a, b) => {
      if (!a || !b) return null;
      return Math.round((new Date(a) - new Date(b)) / 86400000);
    };
    const startDiff = bt ? dayDiff(t.start_date, bt.start_date) : null;
    const finishDiff = bt ? dayDiff(t.finish_date, bt.finish_date) : null;
    const diffCell = (n) => {
      if (n === null || n === undefined) return '-';
      if (n === 0) return '<span style="color:var(--text-muted)">0d</span>';
      const col = n > 0 ? '#e53935' : '#2e7d32';
      const sign = n > 0 ? '+' : '';
      return `<span style="color:${col};font-size:11px">${sign}${n}d</span>`;
    };
    const titleStyle = `${isSummary ? 'font-weight:700' : ''}${isSubLevel ? 'border-left:2px solid rgba(33,150,243,0.25)' : ''}${isCritical && !isCompleted ? 'color:#e53935' : ''}${isCompleted ? 'text-decoration:line-through;opacity:0.6' : ''}`;
    const titleInput = isCompleted
      ? `<span style="text-decoration:line-through;opacity:0.7;font-size:12px;padding:2px 3px;width:100%;display:inline-block">${esc(t.title)}</span>`
      : `<input type="text" class="inline-edit" data-task-id="${t.id}" data-field="title" value="${esc(t.title)}" style="font-size:12px;padding:2px 3px;border:1px solid transparent;border-radius:3px;background:transparent;${isSummary ? 'font-weight:700' : ''}width:100%" onfocus="this.style.borderColor='var(--primary)';this.style.background='var(--card-bg)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'" title="失焦自动保存">`;
    const startCell = bt ? `${t.start_date || '-'}<br><span style="font-size:10px;color:var(--text-muted)">基线 ${bt.start_date || '-'}</span> ${diffCell(startDiff)}` : (t.start_date || '-');
    const finishCell = bt ? `${t.finish_date || '-'}<br><span style="font-size:10px;color:var(--text-muted)">基线 ${bt.finish_date || '-'}</span> ${diffCell(finishDiff)}` : (t.finish_date || '-');
    return `<tr data-task-id="${t.id}" data-action="selectProjectTaskRow" data-id="${t.id}" style="cursor:pointer;${rowStyle}">
      <td style="padding:2px !important;vertical-align:middle;text-align:center">${displayIndex}</td>
      <td style="padding:2px 2px 2px ${pad}px !important;vertical-align:middle;${isSubLevel ? 'border-left:2px solid rgba(33,150,243,0.25)' : ''}">${toggleBtn}${titleInput}${okrBadge}${krBadge}</td>
      <td style="padding:2px !important;vertical-align:middle">${durInput}</td>
      <td style="padding:2px !important;vertical-align:middle">${startDateInput}</td>
      <td style="padding:2px !important;vertical-align:middle">${finishDateInput}</td>
      <td style="padding:2px !important;vertical-align:middle">${predCell}</td>
      <td style="padding:2px !important;vertical-align:middle">${progressInput}</td>
      <td style="padding:2px !important;vertical-align:middle">${resourceCell}</td>
      <td style="padding:2px !important;vertical-align:middle">${noteInput}</td>
    </tr>`;
  }).join('');
}

export function selectProjectTaskRow(id) {
  state.selectedProjectTaskId = id;
  const editBtn = document.getElementById('projectTaskEditBtn');
  const deleteBtn = document.getElementById('projectTaskDeleteBtn');
  const show = id !== null && canManage();
  if (editBtn) editBtn.style.display = show ? '' : 'none';
  if (deleteBtn) deleteBtn.style.display = show ? '' : 'none';
  // Don't re-render if user is actively editing an inline input
  if (document.activeElement && document.activeElement.classList.contains('inline-edit')) return;
  renderProjectTaskTable();
}

// Build combobox suggestions for task title input, grouped as OKR -> KR with visual indent.
// Map entry: displayText -> { objective_id, kr_id, cleanTitle }
function populateTaskTitleDatalist() {
  const datalist = document.getElementById('projectTaskTitleList');
  const map = {};
  const personalObjs = [];
  for (const o of (state.objectivesCache || [])) {
    if (o.scope === 'personal' && o.approval_status === 'approved') personalObjs.push(o);
    if (o.children) {
      for (const c of o.children) {
        if (c.scope === 'personal' && c.approval_status === 'approved'
            && !personalObjs.some(x => x.id === c.id)) {
          personalObjs.push(c);
        }
      }
    }
  }
  const options = [];
  for (const o of personalObjs) {
    const emp = o.employee_name ? ` · ${o.employee_name}` : '';
    const objDisplay = `🎯 ${o.title}${emp}`;
    options.push(objDisplay);
    map[objDisplay] = { objective_id: o.id, kr_id: null, cleanTitle: o.title };
    const krs = o.key_results || [];
    krs.forEach((k, i) => {
      const branch = i === krs.length - 1 ? '└─' : '├─';
      const krDisplay = `   ${branch} 🔑 ${k.title}`;
      options.push(krDisplay);
      map[krDisplay] = { objective_id: o.id, kr_id: k.id, cleanTitle: k.title };
    });
  }
  datalist.innerHTML = options.map(v => `<option value="${esc(v)}"></option>`).join('');
  state.projectTaskTitleMap = map;
}

function prefillTaskTitleFromLinkage(task) {
  if (!task) return '';
  const map = state.projectTaskTitleMap || {};
  if (task.kr_id) {
    for (const [k, v] of Object.entries(map)) {
      if (v.kr_id === task.kr_id) return k;
    }
  }
  if (task.objective_id) {
    for (const [k, v] of Object.entries(map)) {
      if (v.objective_id === task.objective_id && !v.kr_id) return k;
    }
  }
  return task.title;
}

async function ensureObjectivesCache() {
  if (state.objectivesCache && state.objectivesCache.length) return;
  const data = await api('/api/objectives');
  if (data) state.objectivesCache = data;
}

function populateTaskModalSelects(editTask) {
  const tasks = state.projectTasksCache;
  const editId = editTask ? editTask.id : null;
  const descendants = new Set();
  if (editId) {
    const collect = (pid) => {
      for (const t of tasks) if (t.parent_task_id === pid) { descendants.add(t.id); collect(t.id); }
    };
    descendants.add(editId);
    collect(editId);
  }
  const disp = buildDisplayList(tasks);
  const parentSel = document.getElementById('projectTaskParent');
  parentSel.innerHTML = '<option value="">（无，作为顶级任务）</option>'
    + disp.filter(it => !descendants.has(it.task.id))
      .map(it => `<option value="${it.task.id}">${'— '.repeat(it.depth)}${esc(it.task.title)}</option>`).join('');
  if (editTask && editTask.parent_task_id) parentSel.value = String(editTask.parent_task_id);

  // Dependencies: row-based editor
  state.projectTaskDepCandidates = disp
    .filter(it => !descendants.has(it.task.id))
    .map(it => ({ id: it.task.id, label: `${it.displayIndex}. ${it.task.title}` }));
  const depsArr = (editTask && editTask.dependencies && editTask.dependencies.length)
    ? editTask.dependencies.map(d => ({ predecessor_id: d.predecessor_id, dep_type: d.dep_type || 'FS', lag_days: Number(d.lag_days) || 0 }))
    : [];
  state.projectTaskDeps = depsArr.slice();
  renderProjectTaskDepRows();

  // Resources: employee checkboxes
  const resBox = document.getElementById('projectTaskResources');
  const emps = state.employeesCache || [];
  const selectedIds = new Set((editTask && editTask.resources || []).map(r => r.id));
  resBox.innerHTML = emps.map(e => `
    <label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px">
      <input type="checkbox" class="project-task-resource" value="${e.id}" ${selectedIds.has(e.id) ? 'checked' : ''}>
      ${esc(e.name)}
    </label>
  `).join('') || '<div style="color:var(--text-muted);font-size:12px">暂无员工</div>';
}

function renderProjectTaskDepRows() {
  const box = document.getElementById('projectTaskDepsBox');
  const cands = state.projectTaskDepCandidates || [];
  const deps = state.projectTaskDeps || [];
  if (!deps.length) {
    box.innerHTML = '<div style="color:var(--text-muted);font-size:12px">暂无前置任务</div>';
    return;
  }
  box.innerHTML = deps.map((d, i) => {
    const opts = cands.map(c => `<option value="${c.id}" ${c.id === Number(d.predecessor_id) ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    return `<div style="display:flex;gap:4px;align-items:center">
      <select class="project-task-dep-pred" data-idx="${i}" style="flex:2">${opts}</select>
      <select class="project-task-dep-type" data-idx="${i}" style="flex:0 0 70px">
        ${['FS','SS','FF','SF'].map(t => `<option value="${t}" ${d.dep_type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input type="number" class="project-task-dep-lag" data-idx="${i}" value="${d.lag_days}" step="1" placeholder="lag" style="flex:0 0 70px">
      <button type="button" class="btn btn-danger btn-sm" data-action="removeProjectTaskDep" data-idx="${i}">&times;</button>
    </div>`;
  }).join('');
}

export function addProjectTaskDep() {
  const cands = state.projectTaskDepCandidates || [];
  if (!cands.length) return toast('没有可选前置任务', 'error');
  state.projectTaskDeps = state.projectTaskDeps || [];
  state.projectTaskDeps.push({ predecessor_id: cands[0].id, dep_type: 'FS', lag_days: 0 });
  renderProjectTaskDepRows();
}

export function removeProjectTaskDep(idx) {
  if (!state.projectTaskDeps) return;
  state.projectTaskDeps.splice(idx, 1);
  renderProjectTaskDepRows();
}

function collectDepsFromModal() {
  const rows = document.querySelectorAll('#projectTaskDepsBox .project-task-dep-pred');
  const result = [];
  rows.forEach(predEl => {
    const idx = Number(predEl.dataset.idx);
    const typeEl = document.querySelector(`.project-task-dep-type[data-idx="${idx}"]`);
    const lagEl = document.querySelector(`.project-task-dep-lag[data-idx="${idx}"]`);
    const pid = Number(predEl.value);
    if (!pid) return;
    result.push({
      predecessor_id: pid,
      dep_type: typeEl ? typeEl.value : 'FS',
      lag_days: Number(lagEl && lagEl.value) || 0
    });
  });
  return result;
}

export async function showProjectTaskModal() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  await ensureObjectivesCache();
  populateTaskTitleDatalist();
  document.getElementById('projectTaskEditId').value = '';
  document.getElementById('projectTaskTitle').value = '';
  document.getElementById('projectTaskDuration').value = '1';
  document.getElementById('projectTaskEstimated').checked = false;
  document.getElementById('projectTaskStart').value = '';
  document.getElementById('projectTaskFinish').value = '';
  document.getElementById('projectTaskProgress').value = '0';
  document.getElementById('projectTaskNote').value = '';
  populateTaskModalSelects(null);
  if (state.selectedProjectTaskId) {
    document.getElementById('projectTaskParent').value = String(state.selectedProjectTaskId);
  }
  document.getElementById('projectTaskModalTitle').textContent = '新建任务';
  document.getElementById('projectTaskModal').classList.add('show');
}

export async function showProjectTaskModalTopLevel() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  await ensureObjectivesCache();
  populateTaskTitleDatalist();
  document.getElementById('projectTaskEditId').value = '';
  document.getElementById('projectTaskTitle').value = '';
  document.getElementById('projectTaskDuration').value = '1';
  document.getElementById('projectTaskEstimated').checked = false;
  document.getElementById('projectTaskStart').value = '';
  document.getElementById('projectTaskFinish').value = '';
  document.getElementById('projectTaskProgress').value = '0';
  document.getElementById('projectTaskNote').value = '';
  populateTaskModalSelects(null);
  document.getElementById('projectTaskParent').value = '';
  document.getElementById('projectTaskModalTitle').textContent = '新建顶级任务';
  document.getElementById('projectTaskModal').classList.add('show');
}

export async function editProjectTask(id) {
  const t = state.projectTasksCache.find(x => x.id === id);
  if (!t) return;
  await ensureObjectivesCache();
  populateTaskTitleDatalist();
  document.getElementById('projectTaskEditId').value = id;
  document.getElementById('projectTaskTitle').value = prefillTaskTitleFromLinkage(t);
  document.getElementById('projectTaskDuration').value = t.duration_days || 1;
  document.getElementById('projectTaskEstimated').checked = !!t.is_estimated;
  document.getElementById('projectTaskStart').value = t.start_date || '';
  document.getElementById('projectTaskFinish').value = t.finish_date || '';
  document.getElementById('projectTaskProgress').value = t.progress_percent ?? 0;
  document.getElementById('projectTaskNote').value = t.note || '';
  populateTaskModalSelects(t);
  document.getElementById('projectTaskModalTitle').textContent = '编辑任务';
  document.getElementById('projectTaskModal').classList.add('show');
}

export async function saveProjectTask() {
  const editId = document.getElementById('projectTaskEditId').value;
  const resourceIds = Array.from(document.querySelectorAll('.project-task-resource:checked')).map(c => Number(c.value));
  const rawTitle = document.getElementById('projectTaskTitle').value.trim();
  const linkage = (state.projectTaskTitleMap || {})[rawTitle] || { objective_id: null, kr_id: null, cleanTitle: null };
  const dependencies = collectDepsFromModal();
  const body = {
    title: linkage.cleanTitle || rawTitle,
    parent_task_id: document.getElementById('projectTaskParent').value || null,
    duration_days: parseFloat(document.getElementById('projectTaskDuration').value) || 1,
    is_estimated: document.getElementById('projectTaskEstimated').checked ? 1 : 0,
    start_date: document.getElementById('projectTaskStart').value || null,
    dependencies,
    resource_ids: resourceIds,
    objective_id: linkage.objective_id,
    kr_id: linkage.kr_id,
    progress_percent: parseInt(document.getElementById('projectTaskProgress').value) || 0,
    note: document.getElementById('projectTaskNote').value.trim()
  };
  if (!body.title) return toast('任务名称不能为空', 'error');
  const url = editId
    ? `/api/projects/${state.currentProjectId}/tasks/${editId}`
    : `/api/projects/${state.currentProjectId}/tasks`;
  const res = await api(url, { method: editId ? 'PUT' : 'POST', body });
  if (!res) return;
  closeModal('projectTaskModal');
  toast('已保存');
  loadProjectTasks();
}

export async function deleteProjectTask(id) {
  const ok = await confirmDialog({ title: '删除任务', message: '确认删除该任务？子任务将一并删除。', type: 'danger' });
  if (!ok) return;
  const res = await api(`/api/projects/${state.currentProjectId}/tasks/${id}`, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadProjectTasks();
}

export function toggleProjectTaskCollapse(id) {
  const collapsed = state.collapsedProjectTaskIds;
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  renderProjectTaskTable();
}

export async function inlineUpdateTask(taskId, field, value) {
  const t = state.projectTasksCache.find(x => x.id === taskId);
  if (!t) return;
  let parsed = value;
  if (field === 'duration_days') parsed = parseFloat(value) || 1;
  if (field === 'progress_percent') parsed = Math.min(100, Math.max(0, parseInt(value) || 0));
  if (field === 'start_date' || field === 'finish_date') parsed = value || null;
  if (field === 'note') parsed = value.trim();
  const body = { [field]: parsed };
  const res = await api(`/api/projects/${state.currentProjectId}/tasks/${taskId}`, { method: 'PUT', body });
  if (!res) { renderProjectTaskTable(); return; }
  toast('已更新');
  loadProjectTasks();
}

export async function editProjectTaskDeps(id) {
  const t = state.projectTasksCache.find(x => x.id === id);
  if (!t) return;
  await ensureObjectivesCache();
  populateTaskTitleDatalist();
  document.getElementById('projectTaskEditId').value = id;
  document.getElementById('projectTaskTitle').value = prefillTaskTitleFromLinkage(t);
  document.getElementById('projectTaskDuration').value = t.duration_days || 1;
  document.getElementById('projectTaskEstimated').checked = !!t.is_estimated;
  document.getElementById('projectTaskStart').value = t.start_date || '';
  document.getElementById('projectTaskFinish').value = t.finish_date || '';
  document.getElementById('projectTaskProgress').value = t.progress_percent ?? 0;
  document.getElementById('projectTaskNote').value = t.note || '';
  populateTaskModalSelects(t);
  document.getElementById('projectTaskModalTitle').textContent = '编辑前置任务';
  document.getElementById('projectTaskModal').classList.add('show');
}

export async function editProjectTaskResources(id) {
  const t = state.projectTasksCache.find(x => x.id === id);
  if (!t) return;
  await ensureObjectivesCache();
  populateTaskTitleDatalist();
  document.getElementById('projectTaskEditId').value = id;
  document.getElementById('projectTaskTitle').value = prefillTaskTitleFromLinkage(t);
  document.getElementById('projectTaskDuration').value = t.duration_days || 1;
  document.getElementById('projectTaskEstimated').checked = !!t.is_estimated;
  document.getElementById('projectTaskStart').value = t.start_date || '';
  document.getElementById('projectTaskFinish').value = t.finish_date || '';
  document.getElementById('projectTaskProgress').value = t.progress_percent ?? 0;
  document.getElementById('projectTaskNote').value = t.note || '';
  populateTaskModalSelects(t);
  document.getElementById('projectTaskModalTitle').textContent = '编辑资源';
  document.getElementById('projectTaskModal').classList.add('show');
}

// ===== Indent / outdent / move =====

async function postReorder(items) {
  return await api(`/api/projects/${state.currentProjectId}/tasks/reorder`, { method: 'POST', body: items });
}

export async function indentProjectTask() {
  const id = state.selectedProjectTaskId;
  if (!id) return toast('请先选中任务', 'error');
  const tasks = state.projectTasksCache;
  const cur = tasks.find(t => t.id === id);
  if (!cur) return;
  // find previous sibling (same parent, smaller order_index)
  const siblings = tasks.filter(t => t.parent_task_id === cur.parent_task_id)
    .sort((a, b) => a.order_index - b.order_index);
  const idx = siblings.findIndex(t => t.id === id);
  if (idx <= 0) return toast('无法缩进：需要前一个同级任务', 'error');
  const newParent = siblings[idx - 1];
  const newParentChildren = tasks.filter(t => t.parent_task_id === newParent.id);
  const newOrder = newParentChildren.length;
  const res = await postReorder([{ id, parent_task_id: newParent.id, order_index: newOrder }]);
  if (!res) return;
  loadProjectTasks();
}

export async function outdentProjectTask() {
  const id = state.selectedProjectTaskId;
  if (!id) return toast('请先选中任务', 'error');
  const tasks = state.projectTasksCache;
  const cur = tasks.find(t => t.id === id);
  if (!cur || !cur.parent_task_id) return toast('已是顶级任务', 'error');
  const parent = tasks.find(t => t.id === cur.parent_task_id);
  if (!parent) return;
  const newParentId = parent.parent_task_id || null;
  const samelevel = tasks.filter(t => (t.parent_task_id || null) === newParentId);
  const newOrder = samelevel.length;
  const res = await postReorder([{ id, parent_task_id: newParentId, order_index: newOrder }]);
  if (!res) return;
  loadProjectTasks();
}

export async function moveProjectTaskUp() { return moveProjectTask(-1); }
export async function moveProjectTaskDown() { return moveProjectTask(1); }

async function moveProjectTask(dir) {
  const id = state.selectedProjectTaskId;
  if (!id) return toast('请先选中任务', 'error');
  const tasks = state.projectTasksCache;
  const cur = tasks.find(t => t.id === id);
  if (!cur) return;
  const siblings = tasks.filter(t => (t.parent_task_id || null) === (cur.parent_task_id || null))
    .sort((a, b) => a.order_index - b.order_index);
  const idx = siblings.findIndex(t => t.id === id);
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= siblings.length) return;
  const swap = siblings[targetIdx];
  const res = await postReorder([
    { id: cur.id, parent_task_id: cur.parent_task_id || null, order_index: swap.order_index },
    { id: swap.id, parent_task_id: swap.parent_task_id || null, order_index: cur.order_index }
  ]);
  if (!res) return;
  loadProjectTasks();
}

// ===== Gantt view =====

export function switchProjectView(view) {
  if (view !== 'table' && view !== 'gantt') return;
  state.projectView = view;
  document.querySelectorAll('[data-action="switchProjectView"]').forEach(b => {
    b.classList.toggle('active', b.dataset.projectView === view);
  });
  document.getElementById('projectTableView').style.display = view === 'table' ? '' : 'none';
  document.getElementById('projectGanttView').style.display = view === 'gantt' ? '' : 'none';
  if (view === 'gantt') renderProjectGantt();
}

function countWorkdays(startStr, endStr) {
  const s = new Date(startStr);
  const e = new Date(endStr);
  if (isNaN(s) || isNaN(e) || e < s) return 1;
  let n = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, n);
}

function renderProjectGantt() {
  const container = document.getElementById('projectGanttContainer');
  const empty = document.getElementById('projectGanttEmpty');
  const svg = document.getElementById('projectGanttSvg');
  if (!svg) return;

  // Map id→displayIndex for predecessor resolution (frappe-gantt expects task ids)
  const tasks = (state.projectTasksCache || []).filter(t => t.start_date && t.finish_date);
  if (!tasks.length) {
    container.style.display = 'none';
    empty.style.display = '';
    if (state.ganttInstance) { state.ganttInstance = null; }
    svg.innerHTML = '';
    return;
  }
  container.style.display = '';
  empty.style.display = 'none';

  const gTasks = tasks.map(t => {
    const deps = (t.predecessor_ids || '').split(',').map(s => s.trim()).filter(Boolean).join(',');
    const classes = [];
    if (t.id === state.selectedProjectTaskId) classes.push('bar-selected');
    if (state.criticalPathOn && state.criticalTaskIds && state.criticalTaskIds.has(t.id)) classes.push('bar-critical');
    return {
      id: String(t.id),
      name: t.title,
      start: t.start_date,
      end: t.finish_date,
      progress: 0,
      dependencies: deps,
      custom_class: classes.join(' ')
    };
  });

  if (typeof window.Gantt === 'undefined') {
    empty.textContent = '甘特图库未加载（请刷新页面）';
    container.style.display = 'none';
    empty.style.display = '';
    return;
  }

  // Re-create instance to reflect task list changes
  svg.innerHTML = '';
  state.ganttInstance = new window.Gantt('#projectGanttSvg', gTasks, {
    view_mode: state.ganttViewMode || 'Day',
    bar_height: 22,
    padding: 18,
    readonly: !canManage(),
    on_click: (task) => editProjectTask(Number(task.id)),
    on_date_change: async (task, start, end) => {
      if (!canManage()) return;
      const toStr = (d) => {
        if (typeof d === 'string') return d.slice(0, 10);
        const pad = n => n < 10 ? '0' + n : n;
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      };
      const startStr = toStr(start);
      const endStr = toStr(end);
      const duration = countWorkdays(startStr, endStr);
      const res = await api(`/api/projects/${state.currentProjectId}/tasks/${task.id}`, {
        method: 'PUT',
        body: { start_date: startStr, duration_days: duration }
      });
      if (!res) return;
      toast('已更新');
      loadProjectTasks();
    }
  });
}

export function ganttZoom(mode) {
  if (!mode) return;
  state.ganttViewMode = mode;
  if (state.ganttInstance && typeof state.ganttInstance.change_view_mode === 'function') {
    state.ganttInstance.change_view_mode(mode);
  } else {
    renderProjectGantt();
  }
}

// ===== XML Import / Export =====

export function importProjectXmlTrigger() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  const input = document.getElementById('projectXmlFileInput');
  if (!input) return;
  if (!input.dataset.bound) {
    input.addEventListener('change', onXmlFileSelected);
    input.dataset.bound = '1';
  }
  input.value = '';
  input.click();
}

async function onXmlFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const ok = await confirmDialog({
    title: '导入 Project XML',
    message: `将覆盖当前项目已有任务，继续？文件：${file.name}`,
    type: 'danger'
  });
  if (!ok) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mode', 'replace');
  try {
    const res = await fetch(`/api/projects/${state.currentProjectId}/import-xml`, {
      method: 'POST',
      headers: state.authToken ? { Authorization: 'Bearer ' + state.authToken } : {},
      body: fd
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '导入失败', 'error');
    toast(`已导入 ${data.imported || 0} 条任务`);
    loadProjectTasks();
  } catch (err) {
    toast('导入失败: ' + err.message, 'error');
  }
}

// ===== Critical Path =====

export async function toggleCriticalPath() {
  const on = document.getElementById('projectCPToggle').checked;
  state.criticalPathOn = on;
  if (on && state.currentProjectId) {
    const res = await api(`/api/projects/${state.currentProjectId}/critical-path`);
    state.criticalTaskIds = new Set((res && res.critical_task_ids) || []);
  } else {
    state.criticalTaskIds = new Set();
  }
  renderProjectTaskTable();
  if (state.projectView === 'gantt') renderProjectGantt();
}

// ===== Baselines =====

export async function loadBaselines() {
  if (!state.currentProjectId) return;
  const data = await api(`/api/projects/${state.currentProjectId}/baselines`);
  state.baselinesCache = data || [];
  const sel = document.getElementById('projectBaselineSelect');
  const cur = state.selectedBaselineId ? String(state.selectedBaselineId) : '';
  sel.innerHTML = '<option value="">（对比基线…）</option>'
    + state.baselinesCache.map(b => `<option value="${b.id}">${esc(b.name)} · ${esc(b.saved_at || '')}</option>`).join('');
  sel.value = cur;
  if (!sel.dataset.bound) {
    sel.addEventListener('change', async () => {
      const v = sel.value;
      state.selectedBaselineId = v ? Number(v) : null;
      await loadSelectedBaselineTasks();
      renderProjectTaskTable();
    });
    sel.dataset.bound = '1';
  }
}

async function loadSelectedBaselineTasks() {
  if (!state.selectedBaselineId) { state.baselineTaskMap = null; return; }
  const data = await api(`/api/projects/${state.currentProjectId}/baselines/${state.selectedBaselineId}/tasks`);
  state.baselineTaskMap = {};
  for (const t of (data && data.tasks || [])) state.baselineTaskMap[t.task_id] = t;
}

export async function saveBaseline() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  const name = prompt('基线名称（可留空使用时间戳）：', '');
  const res = await api(`/api/projects/${state.currentProjectId}/baselines`, {
    method: 'POST', body: { name: (name || '').trim() }
  });
  if (!res) return;
  toast(`已保存基线 (${res.saved} 条任务)`);
  loadBaselines();
}

export async function deleteSelectedBaseline() {
  if (!state.selectedBaselineId) return toast('请先在下拉中选中一条基线', 'error');
  const ok = await confirmDialog({ title: '删除基线', message: '确认删除当前选中的基线？', type: 'danger' });
  if (!ok) return;
  const res = await api(`/api/projects/${state.currentProjectId}/baselines/${state.selectedBaselineId}`, { method: 'DELETE' });
  if (!res) return;
  state.selectedBaselineId = null;
  state.baselineTaskMap = null;
  toast('已删除');
  loadBaselines();
  renderProjectTaskTable();
}

// ===== Resource Histogram =====

export async function toggleResourceHistogram() {
  const panel = document.getElementById('projectHistogramPanel');
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  const data = await api(`/api/projects/${state.currentProjectId}/resource-histogram`);
  if (!data) return;
  const { dates, employees } = data;
  if (!dates.length || !employees.length) {
    panel.style.display = '';
    panel.innerHTML = `<div class="card" style="padding:12px;color:var(--text-muted);font-size:13px">资源直方图：没有可聚合的数据（任务需要有日期和资源）</div>`;
    return;
  }
  const maxCount = Math.max(...employees.flatMap(e => e.counts));
  const cellSize = 14;
  const headerHtml = dates.map(d => {
    const day = d.slice(5);
    const dow = new Date(d).getDay();
    const dowLabel = ['日','一','二','三','四','五','六'][dow];
    return `<th style="min-width:${cellSize}px;font-weight:400;padding:2px;font-size:10px;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg)">${day} ${dowLabel}</th>`;
  }).join('');
  const rowsHtml = employees.map(e => {
    const tds = e.counts.map(c => {
      if (c === 0) return `<td style="padding:0;background:var(--card-bg)"></td>`;
      const intensity = Math.min(1, c / Math.max(1, maxCount));
      const bg = `rgba(33,150,243,${0.15 + intensity * 0.55})`;
      return `<td style="padding:0;background:${bg};text-align:center;font-size:10px;color:var(--text)" title="${c}">${c}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 8px;white-space:nowrap;font-size:12px;position:sticky;left:0;background:var(--card-bg);border-right:1px solid var(--border)">${esc(e.name)}</td>${tds}</tr>`;
  }).join('');
  panel.style.display = '';
  panel.innerHTML = `<div class="card" style="padding:8px">
    <div class="card-title" style="margin-bottom:8px"><span class="card-title-accent"></span> &#128202; 资源直方图（按工作日）</div>
    <div style="overflow:auto">
      <table style="border-collapse:collapse;font-size:11px">
        <thead><tr><th style="padding:2px 8px;position:sticky;left:0;background:var(--card-bg)">员工</th>${headerHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </div>`;
}

// ===== MPP Import =====

export function importProjectMppTrigger() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  const input = document.getElementById('projectMppFileInput');
  if (!input) return;
  if (!input.dataset.bound) {
    input.addEventListener('change', onMppFileSelected);
    input.dataset.bound = '1';
  }
  input.value = '';
  input.click();
}

async function onMppFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const ok = await confirmDialog({
    title: '导入 MPP',
    message: `将覆盖当前项目已有任务，继续？文件：${file.name}\n（首次转换可能需要数秒启动 Java）`,
    type: 'danger'
  });
  if (!ok) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mode', 'replace');
  toast('正在解析 MPP…');
  try {
    const res = await fetch(`/api/projects/${state.currentProjectId}/import-mpp`, {
      method: 'POST',
      headers: state.authToken ? { Authorization: 'Bearer ' + state.authToken } : {},
      body: fd
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || '导入失败', 'error');
    toast(`已导入 ${data.imported || 0} 条任务`);
    loadProjectTasks();
  } catch (err) {
    toast('导入失败: ' + err.message, 'error');
  }
}

export async function exportProjectXml() {
  if (!state.currentProjectId) return toast('请先选择项目', 'error');
  try {
    const res = await fetch(`/api/projects/${state.currentProjectId}/export-xml`, {
      headers: state.authToken ? { Authorization: 'Bearer ' + state.authToken } : {}
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return toast(data.error || '导出失败', 'error');
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^"]+)"?/i);
    const filename = m ? m[1] : `project-${state.currentProjectId}.xml`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    toast('已导出');
  } catch (err) {
    toast('导出失败: ' + err.message, 'error');
  }
}

// Expose for inline onclick handlers in HTML
window._editProjectTaskDeps = editProjectTaskDeps;
window._editProjectTaskResources = editProjectTaskResources;
