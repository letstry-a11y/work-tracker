// ===== App entry point - ES Module =====

import { state } from './state.js';
import { api, setShowLoginPage } from './api.js';
import { esc, closeModal, getMonday, todayStr } from './utils.js';
import { showLoginPage, showAppPage, showRegister, showLogin, doLogin, doRegister, doLogout, showPwdModal, doChangePwd } from './auth.js';
import { loadDashboard, loadEmpDashboard } from './dashboard.js';
import { loadObjectives, showObjModal, editObj, saveObj, deleteObj, addKR, editKR, saveKR, deleteKR } from './objectives.js';
import { loadTasks, showTaskModal, editTask, saveTask, deleteTask, applyTaskComplete } from './tasks.js';
import { loadDailyLogs, showLogModal, editLog, saveLog, deleteLog, copyPreviousDay } from './dailyLogs.js';
import { loadDeliverables, showDeliverableUploadModal, saveDeliverable, deleteDeliverable, applyDelivConfirm } from './deliverables.js';
import { loadReviews, doReviewConfirm, showReject, doReject, doReviewDelete } from './reviews.js';
import { loadEmployees, deleteEmployee, showEmployeeModal, saveEmployee, loadUsers, toggleUserRole, renameUser, doRenameUser, deleteUser, showUserModal, saveUser } from './employees.js';
import { loadWeeklyGrid, gridPrevWeek, gridNextWeek, showGridDetail } from './weeklyGrid.js';

// Set up the login page reference for API module
setShowLoginPage(showLoginPage);

// Initialize grid week start
state.gridWeekStart = getMonday();

// ===== Tab Navigation =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    const loaders = {
      dashboard: () => state.currentUser.role === 'admin' ? loadDashboard() : loadEmpDashboard(),
      objectives: loadObjectives,
      tasks: loadTasks,
      'daily-log': loadDailyLogs,
      deliverables: loadDeliverables,
      reviews: loadReviews,
      employees: loadEmployees
    };
    if (loaders[btn.dataset.tab]) loaders[btn.dataset.tab]();
  });
});

// ===== Event Delegation (Phase 4.2) =====
// Replaces all inline onclick handlers with centralized event delegation

document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id ? Number(btn.dataset.id) : null;
  const type = btn.dataset.type || null;

  switch (action) {
    // Auth
    case 'doLogin': doLogin(initApp); break;
    case 'doRegister': doRegister(initApp); break;
    case 'showRegister': showRegister(); break;
    case 'showLogin': showLogin(); break;
    case 'doLogout': doLogout(); break;
    case 'showPwdModal': showPwdModal(); break;
    case 'doChangePwd': doChangePwd(); break;

    // Employees
    case 'showEmployeeModal': showEmployeeModal(); break;
    case 'saveEmployee': saveEmployee(); break;
    case 'deleteEmployee': deleteEmployee(id); break;
    case 'showUserModal': showUserModal(); break;
    case 'saveUser': saveUser(); break;
    case 'renameUser': renameUser(id); break;
    case 'doRenameUser': doRenameUser(); break;
    case 'toggleUserRole': toggleUserRole(id); break;
    case 'deleteUser': deleteUser(id); break;

    // Objectives
    case 'showObjModal': showObjModal(); break;
    case 'saveObj': saveObj(); break;
    case 'editObj': editObj(id); break;
    case 'deleteObj': deleteObj(id); break;
    case 'addKR': addKR(id); break;
    case 'editKR': editKR(id); break;
    case 'saveKR': saveKR(); break;
    case 'deleteKR': deleteKR(id); break;

    // Tasks
    case 'showTaskModal': showTaskModal(); break;
    case 'saveTask': saveTask(); break;
    case 'editTask': editTask(id); break;
    case 'deleteTask': deleteTask(id); break;
    case 'applyTaskComplete': applyTaskComplete(id); break;

    // Daily logs
    case 'showLogModal': showLogModal(); break;
    case 'saveLog': saveLog(); break;
    case 'editLog': editLog(id); break;
    case 'deleteLog': deleteLog(id); break;
    case 'copyPreviousDay': copyPreviousDay(); break;

    // Deliverables
    case 'showDeliverableUploadModal': showDeliverableUploadModal(); break;
    case 'saveDeliverable': saveDeliverable(); break;
    case 'deleteDeliverable': deleteDeliverable(id); break;
    case 'applyDelivConfirm': applyDelivConfirm(id); break;

    // Reviews
    case 'reviewConfirm': doReviewConfirm(type, id); break;
    case 'showReject': showReject(type, id); break;
    case 'doReject': doReject(); break;
    case 'reviewDelete': doReviewDelete(type, id); break;

    // Weekly grid
    case 'gridPrevWeek': gridPrevWeek(); break;
    case 'gridNextWeek': gridNextWeek(); break;
    case 'showGridDetail':
      showGridDetail(
        Number(btn.dataset.empId),
        btn.dataset.empName,
        btn.dataset.date
      );
      break;

    // KR -> Tasks navigation
    case 'viewTaskFromKR': {
      const objId = btn.dataset.objId;
      const filterEl = document.getElementById('taskFilterObjective');
      if (filterEl) filterEl.value = objId;
      document.querySelector('.tab-btn[data-tab="tasks"]').click();
      break;
    }

    // Modal close
    case 'closeModal': closeModal(btn.dataset.modal); break;

    // Theme toggle
    case 'toggleTheme': toggleTheme(); break;
  }
});

// ===== Theme Toggle (Phase 5.1) =====
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerHTML = next === 'dark' ? '&#9728; 主题' : '&#9790; 主题';
}

// Restore saved theme
(function restoreTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerHTML = saved === 'dark' ? '&#9728; 主题' : '&#9790; 主题';
  }
})();

// ===== Keyboard Shortcuts (Phase 5.8) =====
document.addEventListener('keydown', (e) => {
  // Esc closes any open modal
  if (e.key === 'Escape') {
    const openModal = document.querySelector('.modal-overlay.show');
    if (openModal) {
      openModal.classList.remove('show');
      e.preventDefault();
    }
  }

  // Ctrl+1~7 switch tabs
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const tabMap = { '1': 'dashboard', '2': 'objectives', '3': 'tasks', '4': 'daily-log', '5': 'deliverables', '6': 'reviews', '7': 'employees' };
    if (tabMap[e.key]) {
      e.preventDefault();
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabMap[e.key]}"]`);
      if (tabBtn && tabBtn.style.display !== 'none') tabBtn.click();
    }
  }
});

// ===== INIT =====
async function initApp() {
  const me = await api('/api/auth/me');
  if (!me || !me.id) { showLoginPage(); return; }
  state.currentUser = me;

  const isAdmin = state.currentUser.role === 'admin';
  document.getElementById('currentUserName').textContent = (isAdmin ? '管理员' : '员工') + '：' + (state.currentUser.username || '');
  document.getElementById('headerSubtitle').textContent = me.employee_name ? '你好，' + me.employee_name : '';

  // 员工管理 Tab（仅管理员可见）
  document.getElementById('empTabBtn').style.display = isAdmin ? '' : 'none';

  // Load employees cache
  const empData = await api('/api/employees');
  if (empData) {
    state.employeesCache = empData;
  }
  const empOpts = state.employeesCache.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const filterEmpOpts = '<option value="">全部</option>' + empOpts;
  document.getElementById('logEmployee').innerHTML = empOpts;
  document.getElementById('taskAssignee').innerHTML = '<option value="">无</option>' + empOpts;
  document.getElementById('objEmployee').innerHTML = empOpts;
  document.getElementById('krAssignee').innerHTML = empOpts;
  document.getElementById('objFilterEmployee').innerHTML = filterEmpOpts;
  document.getElementById('taskFilterAssignee').innerHTML = filterEmpOpts;
  document.getElementById('delivEmpFilter').innerHTML = filterEmpOpts;
  document.getElementById('reviewEmpFilter').innerHTML = filterEmpOpts;

  // Load objectives cache and populate filter/modal selectors
  const objData = await api('/api/objectives');
  if (objData) state.objectivesCache = objData;

  const objFilterEl = document.getElementById('taskFilterObjective');
  if (objFilterEl) {
    objFilterEl.innerHTML = '<option value="">全部</option><option value="none">无目标</option>'
      + (state.objectivesCache || []).map(o =>
        `<option value="${o.id}">${esc(o.title)}</option>`
      ).join('');
  }

  const taskObjSelect = document.getElementById('taskObjective');
  if (taskObjSelect) {
    taskObjSelect.innerHTML = '<option value="">无 (独立任务)</option>'
      + (state.objectivesCache || []).map(o =>
        `<option value="${o.id}">${esc(o.title)} (${esc(o.employee_name || '')})</option>`
      ).join('');
  }

  // Assignee change -> filter objectives in task modal
  document.getElementById('taskAssignee').addEventListener('change', function() {
    const sel = this.value;
    const tObjSel = document.getElementById('taskObjective');
    if (tObjSel) {
      tObjSel.innerHTML = '<option value="">无 (独立任务)</option>'
        + (state.objectivesCache || []).filter(o => !sel || String(o.employee_id) === sel)
          .map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('');
    }
  });

  // 员工自动选中自己
  if (!isAdmin && state.currentUser.employee_id) {
    document.getElementById('logEmployee').value = state.currentUser.employee_id;
    document.getElementById('logEmpFilterGroup').querySelector('label').textContent = '员工';
  }

  // UI visibility toggles
  document.getElementById('adminDelivBar').style.display = isAdmin ? '' : 'none';
  document.getElementById('empDelivBar').style.display = isAdmin ? 'none' : '';
  document.getElementById('reviewEmpFilterGroup').style.display = isAdmin ? '' : 'none';
  document.getElementById('adminTaskFilters').style.display = isAdmin ? '' : 'none';
  document.getElementById('btnCreateTask').style.display = isAdmin ? '' : 'none';
  document.getElementById('objFilterBar').style.display = isAdmin ? '' : 'none';
  document.getElementById('btnCreateObj').style.display = isAdmin ? '' : 'none';
  document.getElementById('adminDashboard').style.display = isAdmin ? '' : 'none';
  document.getElementById('empDashboard').style.display = isAdmin ? 'none' : '';

  // Daily log defaults
  document.getElementById('logDate').value = todayStr();
  document.getElementById('logDate').addEventListener('change', loadDailyLogs);
  document.getElementById('logEmployee').addEventListener('change', loadDailyLogs);

  // Task filter listeners
  ['taskFilterAssignee', 'taskFilterStatus', 'taskFilterPriority', 'taskFilterObjective'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadTasks);
  });

  // Assignee filter change -> update objective filter options
  document.getElementById('taskFilterAssignee').addEventListener('change', function() {
    const sel = this.value;
    const ofEl = document.getElementById('taskFilterObjective');
    if (ofEl) {
      const prev = ofEl.value;
      ofEl.innerHTML = '<option value="">全部</option><option value="none">无目标</option>'
        + (state.objectivesCache || []).filter(o => !sel || String(o.employee_id) === sel)
          .map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('');
      ofEl.value = prev;
      if (ofEl.value !== prev) ofEl.value = '';
    }
  });

  // Objective filter listener
  const objFilter = document.getElementById('objFilterEmployee');
  if (objFilter) objFilter.addEventListener('change', loadObjectives);

  // Deliverable filter listener
  const delivFilter = document.getElementById('delivEmpFilter');
  if (delivFilter) delivFilter.addEventListener('change', loadDeliverables);

  // Review filter listeners
  ['reviewTypeFilter', 'reviewStatusFilter', 'reviewEmpFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadReviews);
  });

  showAppPage();

  if (isAdmin) {
    loadDashboard();
  } else {
    loadEmpDashboard();
  }
}

// ===== START =====
initApp();
