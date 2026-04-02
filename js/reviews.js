// ===== Reviews management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, confirmStatusText, confirmDialog } from './utils.js';

export async function loadReviews() {
  const type = document.getElementById('reviewTypeFilter') && document.getElementById('reviewTypeFilter').value;
  const status = document.getElementById('reviewStatusFilter') && document.getElementById('reviewStatusFilter').value;
  const empId = state.currentUser.role === 'admin'
    ? (document.getElementById('reviewEmpFilter') && document.getElementById('reviewEmpFilter').value)
    : state.currentUser.employee_id;

  let url = '/api/reviews?';
  if (type) url += 'type=' + type + '&';
  if (status) url += 'status=' + status + '&';
  if (empId) url += 'employee_id=' + empId + '&';

  const items = await api(url);
  if (!items) return;
  const isAdmin = state.currentUser.role === 'admin';
  document.getElementById('reviewCount').textContent = `（共 ${items.length} 条）`;

  document.getElementById('reviewsList').innerHTML = items.map(item => {
    const typeLabel = item.item_type === 'task' ? '任务' : '交付物';
    const typeColor = item.item_type === 'task' ? 'var(--primary-light)' : 'var(--success)';
    const statusBadge = `<span class="badge badge-${item.confirm_status === 'pending' ? 'P1' : item.confirm_status === 'confirmed' ? 'completed' : 'overdue'}">${confirmStatusText(item.confirm_status)}</span>`;
    const fileLink = item.file_name ? `<a href="/uploads/${esc(item.file_name)}" target="_blank" style="color:var(--primary-light);font-size:12px;margin-left:6px">${esc(item.file_name)}</a>` : '';
    const timeStr = item.confirmed_at ? item.confirmed_at.slice(0, 16).replace('T', ' ') : (item.created_at ? item.created_at.slice(0, 10) : '-');
    const noteStr = item.confirm_note ? `<div style="margin-top:4px;font-size:12px;color:var(--text-muted)">${item.confirm_status === 'rejected' ? '打回原因：' : '说明：'}${esc(item.confirm_note)}</div>` : '';
    let actions = '';
    if (isAdmin && item.confirm_status === 'pending') {
      actions = `<button class="btn btn-success btn-sm" data-action="reviewConfirm" data-type="${item.item_type}" data-id="${item.id}" style="margin-left:8px">通过</button>
                 <button class="btn btn-danger btn-sm" data-action="showReject" data-type="${item.item_type}" data-id="${item.id}">打回</button>`;
    }
    if (!isAdmin) {
      actions = `<button class="btn btn-danger btn-sm" data-action="reviewDelete" data-type="${item.item_type}" data-id="${item.id}" style="margin-left:8px">删除记录</button>`;
    }
    return `<div class="review-item">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="badge" style="background:${typeColor};color:#fff;font-size:10px;font-weight:700">${typeLabel}</span>
        <span style="flex:1;font-size:14px;font-weight:600;min-width:120px">${esc(item.title)}</span>
        ${fileLink}
        ${statusBadge}
        <span style="font-size:12px;color:var(--text-muted)">${esc(item.submitter_name) || ''}</span>
        <span style="font-size:12px;color:var(--text-muted)">${timeStr}</span>
        ${actions}
      </div>
      ${noteStr}
      ${item.reviewer_name ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">&#128100; 审核人：${esc(item.reviewer_name)}</div>` : ''}
    </div>`;
  }).join('') || '<div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-text">暂无审核记录</div></div>';
}

export async function doReviewConfirm(type, id) {
  const res = await api('/api/reviews/' + type + 's/' + id + '/confirm', { method: 'PUT' });
  if (!res) return;
  toast('已通过');
  loadReviews();
}

export function showReject(type, id) {
  document.getElementById('rejectItemType').value = type;
  document.getElementById('rejectItemId').value = id;
  document.getElementById('rejectReason').value = '';
  document.getElementById('rejectModal').classList.add('show');
}

export async function doReject() {
  const type = document.getElementById('rejectItemType').value;
  const id = document.getElementById('rejectItemId').value;
  const reason = document.getElementById('rejectReason').value;
  const res = await api('/api/reviews/' + type + 's/' + id + '/reject', {
    method: 'PUT', body: { reason }
  });
  if (!res) return;
  closeModal('rejectModal');
  toast('已打回');
  loadReviews();
}

export async function doReviewDelete(type, id) {
  const ok = await confirmDialog({ title: '删除审核记录', message: '确认删除该审核记录？' });
  if (!ok) return;
  const res = await api('/api/reviews/' + type + 's/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadReviews();
}
