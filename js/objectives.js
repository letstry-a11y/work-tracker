// ===== Objectives & KR management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, statusText, confirmDialog } from './utils.js';

export async function loadObjectives() {
  const empId = document.getElementById('objFilterEmployee') && document.getElementById('objFilterEmployee').value;
  const isAdmin = state.currentUser.role === 'admin';
  const canManage = isAdmin || state.currentUser.role === 'dept_leader';
  let url = '/api/objectives';
  if (empId) url += '?employee_id=' + empId;
  if (!canManage && state.currentUser.employee_id) url = '/api/objectives?employee_id=' + state.currentUser.employee_id;

  const data = await api(url);
  if (!data) return;
  state.objectivesCache = data;
  const container = document.getElementById('objContent');

  if (!state.objectivesCache || !state.objectivesCache.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#128203;</div>
      <div class="empty-state-text">暂无目标</div>
      ${canManage ? '<div class="empty-state-hint">点击"添加目标"创建第一个 OKR</div>' : '<div class="empty-state-hint">管理员尚未为您设置目标</div>'}
    </div>`;
    return;
  }

  const byEmp = {};
  for (const obj of state.objectivesCache) {
    const key = obj.employee_id || 'other';
    if (!byEmp[key]) byEmp[key] = { name: obj.employee_name || '未分配', objectives: [] };
    byEmp[key].objectives.push(obj);
  }

  let html = '';
  for (const [, empData] of Object.entries(byEmp)) {
    html += `<div class="card" style="margin-top:16px">
      <div class="card-title" style="margin-bottom:12px"><span class="card-title-accent"></span> &#128101; ${esc(empData.name)} 的目标</div>`;
    for (const obj of empData.objectives) {
      const krs = obj.key_results || [];
      const krHtml = krs.map(kr => {
        const badge = kr.confirm_status === 'pending' ? '<span class="badge badge-P1" style="font-size:10px;margin-left:4px">待审核</span>' :
                      kr.confirm_status === 'confirmed' ? '<span class="badge badge-completed" style="font-size:10px;margin-left:4px">已通过</span>' :
                      kr.confirm_status === 'rejected' ? '<span class="badge badge-overdue" style="font-size:10px;margin-left:4px">已打回</span>' : '';
        return `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <span style="flex:1;min-width:0">
            <span class="badge badge-okr" style="font-size:9px;margin-right:4px">OKR</span>
            <a href="#" class="kr-task-link" data-action="viewTaskFromKR" data-obj-id="${kr.objective_id}"
               style="color:var(--text);text-decoration:none;border-bottom:1px dashed var(--text-muted)">
              ${esc(kr.title)}
            </a>
          </span>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span class="badge badge-${kr.status}">${statusText(kr.status)}</span>${badge}
            ${canManage ? `<button class="btn btn-secondary btn-sm" data-action="editKR" data-id="${kr.id}">编辑</button>
            <button class="btn btn-danger btn-sm" data-action="deleteKR" data-id="${kr.id}">删除</button>` : ''}
          </div>
        </div>`;
      }).join('');
      html += `<div class="obj-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${krHtml ? '12px' : '0'};flex-wrap:wrap">
          <span style="font-size:18px">&#127919;</span>
          <span style="flex:1;font-weight:700;font-size:15px;min-width:120px">${esc(obj.title)}</span>
          <span class="badge badge-in_progress">权重 ${Math.round((obj.weight || 0) * 100)}%</span>
          ${canManage ? `<button class="btn btn-primary btn-sm" data-action="addKR" data-id="${obj.id}">&#10010; KR</button>
          <button class="btn btn-secondary btn-sm" data-action="editObj" data-id="${obj.id}">&#9998; 编辑</button>
          <button class="btn btn-danger btn-sm" data-action="deleteObj" data-id="${obj.id}">&#10006; 删除</button>` : ''}
        </div>
        ${krHtml || '<div style="color:var(--text-muted);font-size:13px;padding-left:28px">暂无关键结果</div>'}
      </div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

export function showObjModal(editId) {
  document.getElementById('objEditId').value = editId || '';
  document.getElementById('objTitle').value = '';
  document.getElementById('objWeight').value = '0';
  if (editId) {
    const obj = state.objectivesCache.find(o => o.id === editId);
    if (obj) {
      document.getElementById('objTitle').value = obj.title;
      document.getElementById('objWeight').value = Math.round((obj.weight || 0) * 100);
    }
  }
  document.getElementById('objModalTitle').textContent = editId ? '编辑目标' : '添加目标';
  document.getElementById('objModal').classList.add('show');
}

export function editObj(id) { showObjModal(id); }

export async function saveObj() {
  const editId = document.getElementById('objEditId').value;
  const body = {
    title: document.getElementById('objTitle').value.trim(),
    weight: parseFloat(document.getElementById('objWeight').value) / 100 || 0,
    employee_id: document.getElementById('objEmployee').value ? parseInt(document.getElementById('objEmployee').value) : null
  };
  if (!body.title) return toast('目标名称不能为空', 'error');
  if (editId) {
    const res = await api('/api/objectives/' + editId, { method: 'PUT', body });
    if (!res) return;
  } else {
    const res = await api('/api/objectives', { method: 'POST', body });
    if (!res) return;
  }
  closeModal('objModal');
  toast('已保存');
  loadObjectives();
}

export async function deleteObj(id) {
  const ok = await confirmDialog({ title: '删除目标', message: '确认删除该目标？其下所有 OKR 任务也会一并删除。' });
  if (!ok) return;
  const res = await api('/api/objectives/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadObjectives();
}

export function addKR(objId) {
  document.getElementById('krEditId').value = '';
  document.getElementById('krObjId').value = objId;
  document.getElementById('krTitle').value = '';
  document.getElementById('krPriority').value = 'P2';
  document.getElementById('krHours').value = '8';
  document.getElementById('krDeadline').value = '';
  document.getElementById('krModalTitle').textContent = '添加关键结果';
  document.getElementById('krModal').classList.add('show');
}

export function editKR(id) {
  let kr = null;
  for (const obj of state.objectivesCache) {
    const found = (obj.key_results || []).find(k => k.id === id);
    if (found) { kr = found; break; }
  }
  if (!kr) return;
  document.getElementById('krEditId').value = id;
  document.getElementById('krObjId').value = kr.objective_id;
  document.getElementById('krTitle').value = kr.title;
  document.getElementById('krPriority').value = kr.priority;
  document.getElementById('krHours').value = kr.estimated_hours || 8;
  document.getElementById('krDeadline').value = kr.deadline || '';
  document.getElementById('krModalTitle').textContent = '编辑关键结果';
  document.getElementById('krModal').classList.add('show');
}

export async function saveKR() {
  const editId = document.getElementById('krEditId').value;
  const objective_id = parseInt(document.getElementById('krObjId').value);
  const body = {
    title: document.getElementById('krTitle').value.trim(),
    objective_id,
    assignee_id: document.getElementById('krAssignee').value ? parseInt(document.getElementById('krAssignee').value) : null,
    priority: document.getElementById('krPriority').value,
    estimated_hours: parseFloat(document.getElementById('krHours').value) || 8,
    deadline: document.getElementById('krDeadline').value || null
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
