// ===== Weekly activity grid =====

import { state } from './state.js';
import { api } from './api.js';
import { esc, parseLocalDate, toDateStr, closeModal } from './utils.js';

export async function loadWeeklyGrid(weekStart) {
  if (!weekStart) weekStart = state.gridWeekStart;
  state.gridWeekStart = weekStart;
  const deptEl = document.getElementById('dashboardDeptFilter');
  const deptId = deptEl ? deptEl.value : '';
  const deptParam = deptId ? '&department_id=' + deptId : '';
  const data = await api('/api/dashboard/weekly-grid?week_start=' + weekStart + deptParam);
  if (!data) return;
  document.getElementById('gridWeekLabel').textContent = weekStart + ' ~ ' + data.weekEnd;
  const container = document.getElementById('weeklyGrid');
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  let html = '<table class="weekly-grid-table"><thead><tr><th class="emp-col">员工</th>';
  for (let i = 0; i < data.dayDates.length; i++) {
    html += `<th>${dayNames[i]}<br><span style="font-weight:400;font-size:10px;color:var(--text-muted)">${data.dayDates[i].slice(5)}</span></th>`;
  }
  html += '<th>周合计</th></tr></thead><tbody>';
  for (const emp of data.employees) {
    html += `<tr><td class="emp-name">${esc(emp.name)}</td>`;
    let empTotal = 0;
    for (const date of data.dayDates) {
      const logs = emp.days[date] || [];
      empTotal += logs.reduce((s, l) => s + (l.hours || 0), 0);
      if (!logs.length) {
        html += `<td class="day-cell empty-cell"><span class="cell-empty-dash">--</span></td>`;
      } else {
        const items = logs.map(l => `<div class="cell-log-item"><span class="cell-log-title" title="${esc(l.task_title || '')}">${esc(l.task_title || '未命名')}</span><span class="cell-hours-badge">${l.hours}h</span></div>`).join('');
        html += `<td class="day-cell" data-action="showGridDetail" data-emp-id="${emp.id}" data-emp-name="${esc(emp.name)}" data-date="${date}">${items}</td>`;
      }
    }
    html += `<td class="day-total">${empTotal}h</td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

export function gridPrevWeek() {
  const d = parseLocalDate(state.gridWeekStart);
  d.setDate(d.getDate() - 7);
  loadWeeklyGrid(toDateStr(d));
}

export function gridNextWeek() {
  const d = parseLocalDate(state.gridWeekStart);
  d.setDate(d.getDate() + 7);
  loadWeeklyGrid(toDateStr(d));
}

export async function showGridDetail(empId, empName, date) {
  const logs = await api(`/api/daily-logs?employee_id=${empId}&date=${date}`);
  if (!logs) return;
  const dt = parseLocalDate(date);
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  document.getElementById('gridDetailTitle').textContent = empName + ' — ' + (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + dayNames[dt.getDay()] + ' 日志详情';
  const content = document.getElementById('gridDetailContent');
  if (!logs.length) {
    content.innerHTML = '<div class="detail-empty">该日未填报任何日志</div>';
  } else {
    content.innerHTML = logs.map(l => `<div class="detail-log-item">
      <div class="detail-log-header">
        <strong>${esc(l.task_title || '无关联任务')}</strong>
        <span style="margin-left:auto;font-weight:700;color:var(--primary-light)">${l.hours}h</span>
      </div>
      ${l.work_content ? `<div class="detail-log-body">${esc(l.work_content)}</div>` : ''}
      ${l.remark ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">备注：${esc(l.remark)}</div>` : ''}
    </div>`).join('');
  }
  document.getElementById('gridDetailModal').classList.add('show');
}
