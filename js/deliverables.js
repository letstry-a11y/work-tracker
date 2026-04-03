// ===== Deliverables management =====

import { state } from './state.js';
import { api, apiUpload } from './api.js';
import { toast, closeModal, esc, confirmStatusText, confirmDialog } from './utils.js';
import { loadReviews } from './reviews.js';

export async function loadDeliverables() {
  const isAdmin = state.currentUser.role === 'admin';
  const canReview = isAdmin || state.currentUser.role === 'dept_leader';
  const empId = canReview ? (document.getElementById('delivEmpFilter') && document.getElementById('delivEmpFilter').value) : state.currentUser.employee_id;
  let url = '/api/deliverables';
  if (empId) url += '?employee_id=' + empId;
  const items = await api(url);
  if (!items) return;
  const tbody = document.getElementById('deliverableTableBody');

  tbody.innerHTML = items.map(d => {
    const csBadge = d.confirm_status && d.confirm_status !== 'none'
      ? `<span class="badge badge-${d.confirm_status === 'pending' ? 'P1' : d.confirm_status === 'confirmed' ? 'completed' : 'overdue'}">${confirmStatusText(d.confirm_status)}</span>`
      : '<span style="color:var(--text-muted);font-size:12px">-</span>';
    let actions = '';
    if (canReview) {
      if (d.confirm_status === 'pending') {
        actions = `<button class="btn btn-success btn-sm" data-action="reviewConfirm" data-type="deliverable" data-id="${d.id}">通过</button>
                   <button class="btn btn-danger btn-sm" data-action="showReject" data-type="deliverable" data-id="${d.id}">打回</button>`;
      } else {
        actions = `<button class="btn btn-danger btn-sm" data-action="deleteDeliverable" data-id="${d.id}">删除</button>`;
      }
    } else {
      if (d.confirm_status !== 'pending') {
        actions = `<button class="btn btn-primary btn-sm" data-action="applyDelivConfirm" data-id="${d.id}">申请审核</button>
                   <button class="btn btn-danger btn-sm" data-action="deleteDeliverable" data-id="${d.id}">删除</button>`;
      } else {
        actions = `<span style="color:var(--text-muted);font-size:12px">待审核中</span>
                   <button class="btn btn-danger btn-sm" data-action="deleteDeliverable" data-id="${d.id}">删除</button>`;
      }
    }
    const fileLink = d.file_name && d.file_path
      ? `<a href="/uploads/${esc(d.file_path.split('/').pop())}" target="_blank" style="color:var(--primary-light)">${esc(d.file_name)}</a>`
      : '-';
    return `<tr>
      <td>${d.id}</td>
      <td>${esc(d.title)}</td>
      <td>${esc(d.task_title) || '-'}</td>
      <td>${esc(d.employee_name) || '-'}</td>
      <td>${csBadge}</td>
      <td>${fileLink}</td>
      <td>${d.created_at ? d.created_at.slice(0, 16).replace('T', ' ') : '-'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="empty-table-cell">暂无交付物</td></tr>';
}

export function showDeliverableUploadModal() {
  document.getElementById('deliverableTitle').value = '';
  document.getElementById('deliverableTask').value = '';
  document.getElementById('deliverableFile').value = '';
  document.getElementById('deliverableDesc').value = '';
  const sel = document.getElementById('deliverableTask');
  sel.innerHTML = '<option value="">无</option>';
  if (state.tasksCache.length) {
    sel.innerHTML += state.tasksCache.map(t => `<option value="${t.id}">[${t.priority}] ${esc(t.title)}</option>`).join('');
  }
  document.getElementById('deliverableModal').classList.add('show');
}

export async function saveDeliverable() {
  const title = document.getElementById('deliverableTitle').value.trim();
  if (!title) return toast('交付物名称不能为空', 'error');
  const fileInput = document.getElementById('deliverableFile');
  const taskId = document.getElementById('deliverableTask').value;
  const description = document.getElementById('deliverableDesc').value;
  const formData = new FormData();
  formData.append('title', title);
  if (taskId) formData.append('task_id', taskId);
  if (description) formData.append('description', description);
  if (fileInput.files.length > 0) formData.append('file', fileInput.files[0]);
  const data = await apiUpload('/api/deliverables/upload', formData);
  if (!data) return;
  closeModal('deliverableModal');
  toast('交付物已上传');
  loadDeliverables();
}

export async function deleteDeliverable(id) {
  const ok = await confirmDialog({ title: '删除交付物', message: '确认删除该交付物？' });
  if (!ok) return;
  const res = await api('/api/deliverables/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadDeliverables();
}

export async function applyDelivConfirm(id) {
  const note = prompt('请描述交付物内容：') || '';
  const res = await api('/api/deliverables/' + id + '/apply-confirm', {
    method: 'POST', body: { confirm_note: note }
  });
  if (!res) return;
  toast('已提交审核');
  loadDeliverables();
  loadReviews();
}
