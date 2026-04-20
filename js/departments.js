// ===== Department management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, confirmDialog } from './utils.js';

export async function loadDepartments() {
  const data = await api('/api/departments');
  if (!data) return;
  state.departmentsCache = data;

  const tbody = document.getElementById('deptTableBody');
  tbody.innerHTML = data.map(d => `
    <tr>
      <td>${d.id}</td>
      <td>${esc(d.name)}</td>
      <td>${esc(d.leader_name) || '<span style="color:var(--text-muted)">未设置</span>'}</td>
      <td>${d.member_count || 0}</td>
      <td>${d.created_at ? d.created_at.slice(0, 10) : '-'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="editDept" data-id="${d.id}">编辑</button>
        <button class="btn btn-secondary btn-sm" data-action="manageDeptMembers" data-id="${d.id}">成员</button>
        <button class="btn btn-danger btn-sm" data-action="deleteDept" data-id="${d.id}">删除</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">暂无部门</td></tr>';
}

export function showDeptModal(editId) {
  document.getElementById('deptEditId').value = editId || '';
  document.getElementById('deptModalTitle').textContent = editId ? '编辑部门' : '创建部门';

  const leaderSel = document.getElementById('deptLeader');
  leaderSel.innerHTML = '<option value="">无</option>' + state.employeesCache.map(e =>
    `<option value="${e.id}">${esc(e.name)}</option>`
  ).join('');

  if (editId) {
    const dept = state.departmentsCache.find(d => d.id === editId);
    if (dept) {
      document.getElementById('deptName').value = dept.name;
      leaderSel.value = dept.leader_employee_id || '';
    }
  } else {
    document.getElementById('deptName').value = '';
    leaderSel.value = '';
  }

  document.getElementById('deptModal').classList.add('show');
}

export async function saveDept() {
  const editId = document.getElementById('deptEditId').value;
  const name = document.getElementById('deptName').value.trim();
  const leader_employee_id = document.getElementById('deptLeader').value || null;

  if (!name) return toast('部门名称不能为空', 'error');

  const body = { name, leader_employee_id: leader_employee_id ? Number(leader_employee_id) : null };

  if (editId) {
    const res = await api('/api/departments/' + editId, { method: 'PUT', body });
    if (!res) return;
    toast('部门已更新');
  } else {
    const res = await api('/api/departments', { method: 'POST', body });
    if (!res) return;
    toast('部门已创建');
  }

  closeModal('deptModal');
  loadDepartments();
}

export async function deleteDept(id) {
  const ok = await confirmDialog({ title: '删除部门', message: '确认删除该部门？部门成员将被取消部门关联。' });
  if (!ok) return;
  const res = await api('/api/departments/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('部门已删除');
  loadDepartments();
}

export async function manageDeptMembers(id) {
  const dept = await api('/api/departments/' + id);
  if (!dept) return;

  document.getElementById('deptMembersTitle').textContent = '管理成员 - ' + dept.name;
  document.getElementById('deptMembersId').value = id;

  const memberIds = (dept.members || []).map(m => m.id);
  const container = document.getElementById('deptMembersList');
  container.innerHTML = state.employeesCache.map(e => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
      <input type="checkbox" value="${e.id}" ${memberIds.includes(e.id) ? 'checked' : ''} style="width:16px;height:16px">
      <span>${esc(e.name)}</span>
      <span style="color:var(--text-muted);font-size:12px">${e.department_name && e.department_id !== id ? '(当前: ' + esc(e.department_name) + ')' : ''}</span>
    </label>
  `).join('');

  document.getElementById('deptMembersModal').classList.add('show');
}

export async function saveDeptMembers() {
  const id = document.getElementById('deptMembersId').value;
  const checkboxes = document.querySelectorAll('#deptMembersList input[type="checkbox"]:checked');
  const employee_ids = Array.from(checkboxes).map(cb => Number(cb.value));

  const res = await api('/api/departments/' + id + '/members', {
    method: 'PUT',
    body: { employee_ids }
  });
  if (!res) return;

  closeModal('deptMembersModal');
  toast('成员已更新');
  loadDepartments();

  // Refresh employees cache
  const empData = await api('/api/employees');
  if (empData) state.employeesCache = empData;
}
