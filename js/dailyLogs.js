// ===== Daily logs management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, confirmDialog, toDateStr, todayStr } from './utils.js';

// View state: 'day' | 'week'
state.logView = state.logView || 'day';
state.logWeekStart = state.logWeekStart || computeMondayStr(todayStr());

function computeMondayStr(dateStr) {
  const d = new Date(dateStr);
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - dow + 1);
  return toDateStr(d);
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function formatHours(h) {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

export function switchLogView(view) {
  if (view !== 'day' && view !== 'week') return;
  state.logView = view;
  document.querySelectorAll('[data-action="switchLogView"]').forEach(b => {
    b.classList.toggle('active', b.dataset.logView === view);
  });
  document.getElementById('logDayNav').style.display = view === 'day' ? '' : 'none';
  document.getElementById('logWeekNav').style.display = view === 'week' ? '' : 'none';
  document.getElementById('logDayView').style.display = view === 'day' ? '' : 'none';
  document.getElementById('logWeekView').style.display = view === 'week' ? '' : 'none';
  document.getElementById('logCopyPrevBtn').style.display = view === 'day' ? '' : 'none';
  document.getElementById('logHoursLabel').innerHTML = view === 'day' ? '&#9201; 当日工时合计:' : '&#9201; 本周工时合计:';
  if (view === 'week' && !state.logWeekStart) {
    state.logWeekStart = computeMondayStr(todayStr());
  }
  loadDailyLogs();
}

export function prevLogWeek() {
  state.logWeekStart = addDaysStr(state.logWeekStart, -7);
  loadDailyLogs();
}

export function nextLogWeek() {
  state.logWeekStart = addDaysStr(state.logWeekStart, 7);
  loadDailyLogs();
}

export function thisLogWeek() {
  state.logWeekStart = computeMondayStr(todayStr());
  loadDailyLogs();
}

export async function loadDailyLogs() {
  if (state.logView === 'week') return loadWeekLogs();
  const empId = document.getElementById('logEmployee').value;
  const date = document.getElementById('logDate').value;
  let url = '/api/daily-logs?date=' + date;
  if (empId) url += '&employee_id=' + empId;
  const logs = await api(url);
  if (!logs) return;
  state.logsCache = logs;
  const totalHours = logs.reduce((s, l) => s + (l.hours || 0), 0);
  document.getElementById('todayHoursTotal').textContent = formatHours(totalHours);
  document.getElementById('logTableBody').innerHTML = logs.map(l => `
    <tr>
      <td>${esc(l.employee_name) || '-'}</td>
      <td>${esc(l.task_title) || '-'}</td>
      <td>${esc(l.work_content)}</td>
      <td>${l.hours}h</td>
      <td>${esc(l.remark) || '-'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="editLog" data-id="${l.id}">编辑</button>
        <button class="btn btn-danger btn-sm" data-action="deleteLog" data-id="${l.id}">删除</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty-table-cell">暂无记录</td></tr>';
}

async function loadWeekLogs() {
  const empId = document.getElementById('logEmployee').value;
  const start = state.logWeekStart;
  const end = addDaysStr(start, 6);
  document.getElementById('logWeekRange').textContent = `${start} ~ ${end}`;
  let url = `/api/daily-logs?start_date=${start}&end_date=${end}`;
  if (empId) url += '&employee_id=' + empId;
  const logs = await api(url);
  if (!logs) return;
  state.logsCache = logs;
  const totalHours = logs.reduce((s, l) => s + (l.hours || 0), 0);
  document.getElementById('todayHoursTotal').textContent = formatHours(totalHours);

  const logsByDate = {};
  for (const l of logs) {
    (logsByDate[l.date] = logsByDate[l.date] || []).push(l);
  }
  const weekDays = [0,1,2,3,4,5,6].map(i => addDaysStr(start, i));
  const dowNames = ['周日','周一','周二','周三','周四','周五','周六'];
  const container = document.getElementById('logWeekView');
  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#128197;</div><div class="empty-state-text">本周暂无填报</div></div>';
    return;
  }
  container.innerHTML = weekDays.map(d => {
    const dayLogs = (logsByDate[d] || []).sort((a,b) => a.employee_id - b.employee_id);
    const dayTotal = dayLogs.reduce((s, l) => s + (l.hours || 0), 0);
    const dowName = dowNames[new Date(d).getDay()];
    const rows = dayLogs.map(l => `
      <tr>
        <td>${esc(l.employee_name) || '-'}</td>
        <td>${esc(l.task_title) || '-'}</td>
        <td>${esc(l.work_content)}</td>
        <td>${l.hours}h</td>
        <td>${esc(l.remark) || '-'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" data-action="editLog" data-id="${l.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-action="deleteLog" data-id="${l.id}">删除</button>
        </td>
      </tr>
    `).join('');
    return `<div class="card" style="margin-bottom:var(--space-md)">
      <div class="card-title" style="margin-bottom:8px">
        <span class="card-title-accent"></span> &#128197; ${d} ${dowName}
        <span style="font-size:13px;color:var(--text-muted);margin-left:8px">合计 <span style="color:var(--primary-light);font-weight:700">${formatHours(dayTotal)}</span> h · ${dayLogs.length} 条</span>
      </div>
      ${dayLogs.length > 0 ? `<div class="table-wrap"><table>
        <thead><tr><th>员工</th><th>KR</th><th>工作内容</th><th>工时</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div style="color:var(--text-muted);font-size:13px;padding:4px 0 8px 0">无填报</div>'}
    </div>`;
  }).join('');
}

export function showLogModal() {
  if (!document.getElementById('logEmployee').value) return toast('请先选择员工', 'error');
  document.getElementById('logEditId').value = '';
  document.getElementById('logModalTitle').textContent = '新增记录';
  document.getElementById('logTask').value = '';
  document.getElementById('logContent').value = '';
  document.getElementById('logHours').value = '1';
  document.getElementById('logRemark').value = '';
  const defaultDate = state.logView === 'day'
    ? (document.getElementById('logDate').value || todayStr())
    : todayStr();
  document.getElementById('logModalDate').value = defaultDate;
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
  const l = (state.logsCache || []).find(x => x.id === id);
  if (!l) return;
  document.getElementById('logEditId').value = id;
  document.getElementById('logModalTitle').textContent = '编辑记录';
  document.getElementById('logModalDate').value = l.date;
  await populateLogTaskSelect();
  const logTaskEl = document.getElementById('logTask');
  if (l.task_id) {
    logTaskEl.value = l.task_id;
    if (logTaskEl.value != l.task_id) {
      const opt = document.createElement('option');
      opt.value = l.task_id;
      opt.textContent = l.task_title || '(已关联KR)';
      logTaskEl.appendChild(opt);
      logTaskEl.value = l.task_id;
    }
  }
  document.getElementById('logContent').value = l.work_content;
  document.getElementById('logHours').value = l.hours;
  document.getElementById('logRemark').value = l.remark || '';
  document.getElementById('logModal').classList.add('show');
}

export async function saveLog() {
  const editId = document.getElementById('logEditId').value;
  const body = {
    employee_id: parseInt(document.getElementById('logEmployee').value),
    date: document.getElementById('logModalDate').value || document.getElementById('logDate').value,
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
