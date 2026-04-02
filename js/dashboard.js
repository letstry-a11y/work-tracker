// ===== Dashboard views =====

import { state } from './state.js';
import { api } from './api.js';
import { esc, statusText, parseLocalDate, toDateStr } from './utils.js';
import { loadWeeklyGrid } from './weeklyGrid.js';

export async function loadDashboard() {
  const data = await api('/api/dashboard');
  if (!data) return;
  document.getElementById('dashboardStats').innerHTML = `
    <div class="stat-card info">
      <div class="stat-icon">&#128203;</div>
      <div class="stat-value">${data.totalTasks}</div>
      <div class="stat-label">总任务数</div>
    </div>
    <div class="stat-card success">
      <div class="stat-icon">&#10004;</div>
      <div class="stat-value">${data.completedTasks}</div>
      <div class="stat-label">已完成</div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon">&#9881;</div>
      <div class="stat-value">${data.inProgressTasks}</div>
      <div class="stat-label">进行中</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">&#9203;</div>
      <div class="stat-value">${data.pendingTasks}</div>
      <div class="stat-label">待开始</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-icon">&#9888;</div>
      <div class="stat-value">${data.overdueTasks}</div>
      <div class="stat-label">已延期</div>
    </div>
  `;
  document.getElementById('objectivesOverview').innerHTML = (data.objectives || []).map(obj => `
    <div style="padding:12px 0;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="flex:1;font-weight:700;font-size:14px">${esc(obj.title)}</span>
        <span class="badge badge-in_progress">${obj.kr_completed || 0}/${obj.kr_count || 0} KR</span>
        <div class="progress-bar" style="width:140px"><div class="fill" style="width:${obj.progress || 0}%">${obj.progress || 0}%</div></div>
      </div>
    </div>`).join('') || '<div class="empty-state"><div class="empty-state-icon">&#127919;</div><div class="empty-state-text">暂无目标</div><div class="empty-state-hint">创建目标来跟踪团队 OKR 进度</div></div>';
  document.getElementById('overdueList').innerHTML = (data.overdueList || []).map(t =>
    `<div class="overdue-item"><span class="task-name">&#9888; ${esc(t.title)} <span style="color:var(--text-muted);font-size:12px">(${esc(t.assignee_name) || '未指派'})</span>${t.objective_title ? ' <span class="badge badge-objective" style="font-size:9px">' + esc(t.objective_title) + '</span>' : ''}</span><span class="deadline">${t.deadline || '-'}</span></div>`
  ).join('') || '<div class="empty-state"><div class="empty-state-icon">&#127881;</div><div class="empty-state-text">无延期任务</div><div class="empty-state-hint">所有任务均在进度内</div></div>';
  await loadWeeklyGrid(data.weekStart);
}

export async function loadEmpDashboard() {
  const stats = await api('/api/auth/me/stats');
  if (!stats) return;
  document.getElementById('empStats').innerHTML = `
    <div class="stat-card info">
      <div class="stat-icon">&#9201;</div>
      <div class="stat-value">${stats.weeklyHours || 0}h</div>
      <div class="stat-label">本周已填工时</div>
    </div>
    <div class="stat-card success">
      <div class="stat-icon">&#10004;</div>
      <div class="stat-value">${stats.completedTasks || 0}</div>
      <div class="stat-label">已完成</div>
    </div>
    <div class="stat-card warning">
      <div class="stat-icon">&#9881;</div>
      <div class="stat-value">${stats.inProgressTasks || 0}</div>
      <div class="stat-label">进行中</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-icon">&#9888;</div>
      <div class="stat-value">${stats.overdueTasks || 0}</div>
      <div class="stat-label">已延期</div>
    </div>
  `;
  const myObjectives = stats.myObjectives || [];
  let taskHtml = '';
  if (myObjectives.length > 0) {
    for (const obj of myObjectives) {
      const krHtml = (obj.key_results || []).map(kr => `
        <div style="padding:10px 0 10px 20px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:10px">
          <span class="badge badge-okr" style="flex-shrink:0">KR</span>
          <span style="flex:1;font-size:13px;font-weight:500">${esc(kr.title)}</span>
          <span class="badge badge-${kr.status}">${statusText(kr.status)}</span>
        </div>`).join('');
      taskHtml += `<div class="obj-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:${krHtml ? '12px' : '0'}">
          <span style="font-size:18px">&#127919;</span>
          <span style="flex:1;font-weight:700;font-size:15px">${esc(obj.title)}</span>
          <span class="badge badge-in_progress">权重 ${Math.round((obj.weight || 0) * 100)}%</span>
        </div>
        ${krHtml || '<div style="color:var(--text-muted);font-size:13px;padding-left:28px">暂无关键结果</div>'}
      </div>`;
    }
  } else {
    taskHtml = (stats.myTasks || []).slice(0, 10).map(t => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:10px">
        <span style="font-size:14px;flex:1;font-weight:500">${esc(t.title)}</span>
        <span class="badge badge-${t.status}">${statusText(t.status)}</span>
      </div>`).join('') || '<div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-text">暂无任务</div></div>';
  }
  document.getElementById('empTaskList').innerHTML = taskHtml;
  document.getElementById('empOverdueList').innerHTML = (stats.overdueList || []).map(t =>
    `<div class="overdue-item"><span class="task-name">&#9888; ${esc(t.title)}</span><span class="deadline">${t.deadline || '-'}</span></div>`
  ).join('') || '<div class="empty-state"><div class="empty-state-icon">&#127881;</div><div class="empty-state-text">无延期任务</div><div class="empty-state-hint">所有任务均在进度内</div></div>';
}
