// ===== Task management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, statusText, confirmStatusText, confirmDialog } from './utils.js';
import { loadReviews } from './reviews.js';

export async function loadTasks() {
  const params = new URLSearchParams();
  const a = document.getElementById('taskFilterAssignee') && document.getElementById('taskFilterAssignee').value;
  const s = document.getElementById('taskFilterStatus') && document.getElementById('taskFilterStatus').value;
  const p = document.getElementById('taskFilterPriority') && document.getElementById('taskFilterPriority').value;
  const o = document.getElementById('taskFilterObjective') && document.getElementById('taskFilterObjective').value;
  if (a) params.set('assignee_id', a);
  if (s) params.set('status', s);
  if (p) params.set('priority', p);
  if (o === 'none') params.set('objective_id', '0');
  else if (o) params.set('objective_id', o);

  const data = await api('/api/tasks?' + params);
  if (!data) return;
  state.tasksCache = data;

  const tbody = document.getElementById('taskTableBody');
  const isAdmin = state.currentUser.role === 'admin';

  tbody.innerHTML = (state.tasksCache || []).map(t => {
    const csBadge = t.confirm_status && t.confirm_status !== 'none'
      ? `<span class="badge badge-${t.confirm_status === 'pending' ? 'P1' : t.confirm_status === 'confirmed' ? 'completed' : 'overdue'}" style="margin-left:6px;font-size:10px">${confirmStatusText(t.confirm_status)}</span>` : '';
    let actions = '';
    if (isAdmin) {
      if (t.confirm_status === 'pending') {
        actions = `<button class="btn btn-success btn-sm" data-action="reviewConfirm" data-type="task" data-id="${t.id}">通过</button>
                   <button class="btn btn-danger btn-sm" data-action="showReject" data-type="task" data-id="${t.id}">打回</button>`;
      } else {
        actions = `<button class="btn btn-secondary btn-sm" data-action="editTask" data-id="${t.id}">编辑</button>
                   <button class="btn btn-danger btn-sm" data-action="deleteTask" data-id="${t.id}">删除</button>`;
      }
    } else {
      if (t.confirm_status !== 'pending' && t.confirm_status !== 'confirmed' && t.status !== 'completed') {
        actions = `<button class="btn btn-primary btn-sm" data-action="applyTaskComplete" data-id="${t.id}">申请完成</button>`;
      }
    }
    return `<tr>
      <td>${t.id}</td>
      <td>${esc(t.title)}</td>
      <td>${t.objective_title ? '<span class="badge badge-objective">' + esc(t.objective_title) + '</span>' : '<span style="color:var(--text-muted)">-</span>'}</td>
      <td>${esc(t.assignee_name) || '-'}</td>
      <td><span class="badge badge-${t.status}">${statusText(t.status)}</span>${csBadge}</td>
      <td><span class="badge badge-${t.priority}">${t.priority}</span></td>
      <td>${t.difficulty}</td>
      <td>${t.estimated_hours}h</td>
      <td>${t.deadline || '-'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" class="empty-table-cell">暂无任务</td></tr>';
}

export function showTaskModal(editId) {
  document.getElementById('taskEditId').value = '';
  document.getElementById('taskModalTitle').textContent = '创建任务';
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDesc').value = '';
  document.getElementById('taskAssignee').value = '';
  document.getElementById('taskPriority').value = 'P2';
  document.getElementById('taskDifficulty').value = '3';
  document.getElementById('taskEstHours').value = '8';
  document.getElementById('taskDeadline').value = '';
  // Reset to base options when creating
  const statusEl = document.getElementById('taskStatus');
  const completedOpt = statusEl.querySelector('option[value="completed"]');
  if (completedOpt) completedOpt.remove();
  statusEl.value = 'pending';
  document.getElementById('taskObjective').value = '';
  document.getElementById('taskModal').classList.add('show');
}

export function editTask(id) {
  const t = state.tasksCache.find(x => x.id === id);
  if (!t) return;
  document.getElementById('taskEditId').value = id;
  document.getElementById('taskModalTitle').textContent = '编辑任务';
  document.getElementById('taskTitle').value = t.title;
  document.getElementById('taskDesc').value = t.description;
  document.getElementById('taskAssignee').value = t.assignee_id || '';
  // Filter objectives by current assignee before setting value
  document.getElementById('taskAssignee').dispatchEvent(new Event('change'));
  document.getElementById('taskPriority').value = t.priority;
  document.getElementById('taskDifficulty').value = t.difficulty;
  document.getElementById('taskEstHours').value = t.estimated_hours;
  document.getElementById('taskDeadline').value = t.deadline || '';
  // Admin gets "已完成" option
  const statusEl = document.getElementById('taskStatus');
  if (state.currentUser.role === 'admin' && !statusEl.querySelector('option[value="completed"]')) {
    statusEl.insertAdjacentHTML('beforeend', '<option value="completed">已完成</option>');
  }
  statusEl.value = t.status;
  document.getElementById('taskObjective').value = t.objective_id || '';
  document.getElementById('taskModal').classList.add('show');
}

export async function saveTask() {
  const editId = document.getElementById('taskEditId').value;
  const body = {
    title: document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDesc').value,
    assignee_id: document.getElementById('taskAssignee').value || null,
    priority: document.getElementById('taskPriority').value,
    difficulty: parseInt(document.getElementById('taskDifficulty').value),
    estimated_hours: parseFloat(document.getElementById('taskEstHours').value),
    deadline: document.getElementById('taskDeadline').value || null,
    status: document.getElementById('taskStatus').value,
    objective_id: document.getElementById('taskObjective').value || null
  };
  if (!body.title) return toast('标题不能为空', 'error');
  if (editId) {
    const res = await api('/api/tasks/' + editId, { method: 'PUT', body });
    if (!res) return;
  } else {
    const res = await api('/api/tasks', { method: 'POST', body });
    if (!res) return;
  }
  closeModal('taskModal');
  toast('任务已保存');
  loadTasks();
}

export async function deleteTask(id) {
  const ok = await confirmDialog({ title: '删除任务', message: '确认删除该任务？此操作不可撤销。' });
  if (!ok) return;
  const res = await api('/api/tasks/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadTasks();
}

export async function applyTaskComplete(id) {
  const note = prompt('请描述本次完成的工作内容：') || '';
  const res = await api('/api/tasks/' + id + '/apply-complete', {
    method: 'POST', body: { confirm_note: note }
  });
  if (!res) return;
  toast('已提交审核，等待管理员确认');
  loadTasks();
  loadReviews();
}
