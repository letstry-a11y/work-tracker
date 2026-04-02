// ===== Daily logs management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, confirmDialog } from './utils.js';

export async function loadDailyLogs() {
  const empId = document.getElementById('logEmployee').value;
  const date = document.getElementById('logDate').value;
  if (!empId) {
    document.getElementById('logTableBody').innerHTML = '<tr><td colspan="5" class="empty-table-cell">请先选择员工</td></tr>';
    return;
  }
  const logs = await api(`/api/daily-logs?employee_id=${empId}&date=${date}`);
  if (!logs) return;
  const totalHours = logs.reduce((s, l) => s + (l.hours || 0), 0);
  document.getElementById('todayHoursTotal').textContent = totalHours;
  document.getElementById('logTableBody').innerHTML = logs.map(l => `
    <tr>
      <td>${esc(l.task_title) || '-'}</td>
      <td>${esc(l.work_content)}</td>
      <td>${l.hours}h</td>
      <td>${esc(l.remark) || '-'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="editLog" data-id="${l.id}">编辑</button>
        <button class="btn btn-danger btn-sm" data-action="deleteLog" data-id="${l.id}">删除</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-table-cell">暂无记录</td></tr>';
}

export function showLogModal() {
  if (!document.getElementById('logEmployee').value) return toast('请先选择员工', 'error');
  document.getElementById('logEditId').value = '';
  document.getElementById('logModalTitle').textContent = '新增记录';
  document.getElementById('logTask').value = '';
  document.getElementById('logContent').value = '';
  document.getElementById('logHours').value = '1';
  document.getElementById('logRemark').value = '';
  populateLogTaskSelect();
  document.getElementById('logModal').classList.add('show');
}

export async function populateLogTaskSelect() {
  const empId = document.getElementById('logEmployee') && document.getElementById('logEmployee').value;
  const url = empId ? '/api/tasks?assignee_id=' + empId : '/api/tasks';
  const tasks = await api(url);
  if (!tasks) return;
  document.getElementById('logTask').innerHTML = '<option value="">无</option>' + tasks.map(t => `<option value="${t.id}">[${t.priority}] ${esc(t.title)}</option>`).join('');
}

export async function editLog(id) {
  const empId = document.getElementById('logEmployee').value;
  const date = document.getElementById('logDate').value;
  const logs = await api(`/api/daily-logs?employee_id=${empId}&date=${date}`);
  if (!logs) return;
  const l = logs.find(x => x.id === id);
  if (!l) return;
  document.getElementById('logEditId').value = id;
  document.getElementById('logModalTitle').textContent = '编辑记录';
  document.getElementById('logTask').value = l.task_id || '';
  document.getElementById('logContent').value = l.work_content;
  document.getElementById('logHours').value = l.hours;
  document.getElementById('logRemark').value = l.remark || '';
  await populateLogTaskSelect();
  document.getElementById('logModal').classList.add('show');
}

export async function saveLog() {
  const editId = document.getElementById('logEditId').value;
  const body = {
    employee_id: parseInt(document.getElementById('logEmployee').value),
    date: document.getElementById('logDate').value,
    task_id: document.getElementById('logTask').value ? parseInt(document.getElementById('logTask').value) : null,
    work_content: document.getElementById('logContent').value,
    hours: parseFloat(document.getElementById('logHours').value) || 0,
    remark: document.getElementById('logRemark').value
  };
  if (!body.work_content) return toast('工作内容不能为空', 'error');
  if (editId) {
    const res = await api('/api/daily-logs/' + editId, { method: 'PUT', body });
    if (!res) return;
  } else {
    const res = await api('/api/daily-logs', { method: 'POST', body });
    if (!res) return;
  }
  closeModal('logModal');
  toast('记录已保存');
  loadDailyLogs();
}

export async function deleteLog(id) {
  const ok = await confirmDialog({ title: '删除记录', message: '确认删除该日志记录？' });
  if (!ok) return;
  const res = await api('/api/daily-logs/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadDailyLogs();
}

export async function copyPreviousDay() {
  const empId = document.getElementById('logEmployee').value;
  if (!empId) return toast('请先选择员工', 'error');
  const date = document.getElementById('logDate').value;
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  const fromDate = prev.toISOString().slice(0, 10);
  const logs = await api(`/api/daily-logs?employee_id=${empId}&date=${fromDate}`);
  if (!logs || !logs.length) return toast('昨日无记录可复制', 'error');
  const today = document.getElementById('logDate').value;
  for (const l of logs) {
    await api('/api/daily-logs', {
      method: 'POST',
      body: { employee_id: parseInt(empId), date: today, task_id: l.task_id, work_content: l.work_content, hours: l.hours, remark: l.remark }
    });
  }
  toast(`已复制${logs.length}条记录`);
  loadDailyLogs();
}
