// ===== App entry point - ES Module =====

import { state } from './state.js';
import { api, setShowLoginPage } from './api.js';
import { esc, closeModal, getMonday, todayStr } from './utils.js';
import { showLoginPage, showAppPage, showRegister, showLogin, doLogin, doRegister, doLogout, showPwdModal, doChangePwd } from './auth.js';
import { loadDashboard, loadEmpDashboard } from './dashboard.js';
import { loadObjectives, switchObjTab, showObjModal, showGlobalObjModal, editObj, saveObj, deleteObj, addKR, editKR, saveKR, deleteKR, claimKR, approveObj, rejectObj } from './objectives.js';
import { loadTasks, showTaskModal, editTask, saveTask, deleteTask, applyTaskComplete } from './tasks.js';
import { loadDailyLogs, showLogModal, editLog, saveLog, deleteLog, copyPreviousDay } from './dailyLogs.js';
import { loadDeliverables, showDeliverableUploadModal, saveDeliverable, deleteDeliverable, applyDelivConfirm } from './deliverables.js';
import { loadReviews, doReviewConfirm, showReject, doReject, doReviewDelete } from './reviews.js';
import { loadEmployees, deleteEmployee, showEmployeeModal, saveEmployee, loadUsers, toggleUserRole, renameUser, doRenameUser, resetPassword, deleteUser, showUserModal, saveUser } from './employees.js';
import { loadWeeklyGrid, gridPrevWeek, gridNextWeek, showGridDetail } from './weeklyGrid.js';
import { loadDepartments, showDeptModal, saveDept, deleteDept, manageDeptMembers, saveDeptMembers } from './departments.js';

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
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';
    const isDeptLeader = state.currentUser && state.currentUser.role === 'dept_leader';
    const loaders = {
      dashboard: () => (isAdmin || isDeptLeader) ? loadDashboard() : loadEmpDashboard(),
      objectives: loadObjectives,
      tasks: loadTasks,
      'daily-log': loadDailyLogs,
      deliverables: loadDeliverables,
      reviews: loadReviews,
      employees: loadEmployees,
      departments: loadDepartments
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
    case 'resetPassword': resetPassword(id); break;
    case 'deleteUser': deleteUser(id); break;

    // Departments
    case 'showDeptModal': showDeptModal(); break;
    case 'editDept': showDeptModal(id); break;
    case 'saveDept': saveDept(); break;
    case 'deleteDept': deleteDept(id); break;
    case 'manageDeptMembers': manageDeptMembers(id); break;
    case 'saveDeptMembers': saveDeptMembers(); break;

    // Objectives
    case 'objSubTab': switchObjTab(btn.dataset.objTab); break;
    case 'showObjModal': showObjModal(); break;
    case 'showGlobalObjModal': showGlobalObjModal(); break;
    case 'saveObj': saveObj(); break;
    case 'editObj': editObj(id); break;
    case 'deleteObj': deleteObj(id); break;
    case 'approveObj': approveObj(id); break;
    case 'rejectObj': rejectObj(id); break;
    case 'claimKR': claimKR(id); break;
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

  // Ctrl+1~8 switch tabs
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const tabMap = { '1': 'dashboard', '2': 'objectives', '3': 'tasks', '4': 'daily-log', '5': 'deliverables', '6': 'reviews', '7': 'departments', '8': 'employees' };
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

  const isAdmin = me.role === 'admin';
  const isDeptLeader = me.role === 'dept_leader';
  const isLeaderOrAdmin = isAdmin || isDeptLeader;

  const roleLabel = isAdmin ? '管理员' : (isDeptLeader ? '部门负责人' : '员工');
  document.getElementById('currentUserName').textContent = roleLabel + '：' + (me.username || '');
  document.getElementById('headerSubtitle').textContent = me.employee_name ? '你好，' + me.employee_name : '';

  // Tab visibility
  document.getElementById('empTabBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('deptTabBtn').style.display = isAdmin ? '' : 'none';

  // Load employees cache
  const empData = await api('/api/employees');
  if (empData) {
    state.employeesCache = empData;
  }

  // Load departments cache
  const deptData = await api('/api/departments');
  if (deptData) {
    state.departmentsCache = deptData;
  }

  // For dept_leader, determine which employees are in their department
  let deptEmployeeIds = null;
  if (isDeptLeader && me.leader_department_id) {
    deptEmployeeIds = state.employeesCache
      .filter(e => e.department_id === me.leader_department_id)
      .map(e => e.id);
  }

  // Build employee options - for dept_leader, limit to department members
  const visibleEmployees = (isDeptLeader && deptEmployeeIds)
    ? state.employeesCache.filter(e => deptEmployeeIds.includes(e.id))
    : state.employeesCache;

  const empOpts = visibleEmployees.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const allEmpOpts = state.employeesCache.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  const filterEmpOpts = '<option value="">全部</option>' + empOpts;

  document.getElementById('logEmployee').innerHTML = empOpts;
  document.getElementById('taskAssignee').innerHTML = '<option value="">无</option>' + empOpts;
  document.getElementById('objEmployee').innerHTML = empOpts;
  document.getElementById('krAssignee').innerHTML = empOpts;
  document.getElementById('objFilterEmployee').innerHTML = filterEmpOpts;
  document.getElementById('taskFilterAssignee').innerHTML = filterEmpOpts;
  document.getElementById('delivEmpFilter').innerHTML = filterEmpOpts;
  document.getElementById('reviewEmpFilter').innerHTML = filterEmpOpts;

  // Populate department filter dropdowns (admin only sees these)
  const deptOpts = '<option value="">全部</option>' + (state.departmentsCache || [])
    .map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  ['dashboardDeptFilter', 'objFilterDept', 'taskFilterDept', 'logFilterDept', 'delivDeptFilter', 'reviewDeptFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = deptOpts;
  });

  // Helper: link department dropdown to employee dropdown
  // When department changes, filter employee options and trigger data reload
  function setupDeptEmpLink(deptSelectId, empSelectId, loadFn) {
    const deptEl = document.getElementById(deptSelectId);
    const empEl = document.getElementById(empSelectId);
    if (!deptEl || !empEl) return;
    deptEl.addEventListener('change', () => {
      const deptId = deptEl.value;
      const filtered = deptId
        ? visibleEmployees.filter(e => String(e.department_id) === deptId)
        : visibleEmployees;
      empEl.innerHTML = '<option value="">全部</option>' + filtered.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      if (loadFn) loadFn();
    });
  }

  // Setup dept-employee linkage for pages with both filters
  setupDeptEmpLink('objFilterDept', 'objFilterEmployee', loadObjectives);
  setupDeptEmpLink('taskFilterDept', 'taskFilterAssignee', loadTasks);
  setupDeptEmpLink('delivDeptFilter', 'delivEmpFilter', loadDeliverables);
  setupDeptEmpLink('reviewDeptFilter', 'reviewEmpFilter', loadReviews);

  // Daily log: dept filter links to logEmployee (no "全部" option for log employee)
  const logDeptEl = document.getElementById('logFilterDept');
  if (logDeptEl) {
    logDeptEl.addEventListener('change', () => {
      const deptId = logDeptEl.value;
      const filtered = deptId
        ? visibleEmployees.filter(e => String(e.department_id) === deptId)
        : visibleEmployees;
      const logEmpEl = document.getElementById('logEmployee');
      logEmpEl.innerHTML = filtered.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      loadDailyLogs();
    });
  }

  // Dashboard: dept filter directly triggers reload (no employee dropdown)
  const dashDeptEl = document.getElementById('dashboardDeptFilter');
  if (dashDeptEl) dashDeptEl.addEventListener('change', loadDashboard);

  // Load objectives cache and populate filter/modal selectors
  const objData = await api('/api/objectives');
  if (objData) state.objectivesCache = objData;

  // Populate parent objective dropdown (approved global objectives)
  const objParentSelect = document.getElementById('objParentObjective');
  if (objParentSelect) {
    objParentSelect.innerHTML = '<option value="">无（独立个人OKR）</option>'
      + (state.objectivesCache || [])
        .filter(o => o.scope === 'global' && o.approval_status === 'approved')
        .map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('');
  }

  const objFilterEl = document.getElementById('taskFilterObjective');
  if (objFilterEl) {
    objFilterEl.innerHTML = '<option value="">全部</option><option value="none">无OKR</option>'
      + (state.objectivesCache || []).map(o => {
        const prefix = o.scope === 'global' ? '[整体] ' : '';
        return `<option value="${o.id}">${prefix}${esc(o.title)}</option>`;
      }).join('');
  }

  const taskObjSelect = document.getElementById('taskObjective');
  if (taskObjSelect) {
    taskObjSelect.innerHTML = '<option value="">无 (独立KR)</option>'
      + (state.objectivesCache || []).filter(o => o.approval_status === 'approved').map(o => {
        const prefix = o.scope === 'global' ? '[整体] ' : '';
        const suffix = o.scope !== 'global' && o.employee_name ? ` (${esc(o.employee_name)})` : '';
        return `<option value="${o.id}">${prefix}${esc(o.title)}${suffix}</option>`;
      }).join('');
  }

  // Assignee change -> filter objectives in task modal (global always shown)
  document.getElementById('taskAssignee').addEventListener('change', function() {
    const sel = this.value;
    const tObjSel = document.getElementById('taskObjective');
    if (tObjSel) {
      tObjSel.innerHTML = '<option value="">无 (独立KR)</option>'
        + (state.objectivesCache || []).filter(o => o.approval_status === 'approved' && (o.scope === 'global' || !sel || String(o.employee_id) === sel))
          .map(o => {
            const prefix = o.scope === 'global' ? '[整体] ' : '';
            return `<option value="${o.id}">${prefix}${esc(o.title)}</option>`;
          }).join('');
    }
  });

  // 员工自动选中自己
  if (!isLeaderOrAdmin && state.currentUser.employee_id) {
    document.getElementById('logEmployee').value = state.currentUser.employee_id;
    document.getElementById('logEmpFilterGroup').querySelector('label').textContent = '员工';
  }

  // UI visibility toggles - dept_leader sees filter bars and can create tasks/objectives
  document.getElementById('adminDelivBar').style.display = isLeaderOrAdmin ? '' : 'none';
  document.getElementById('empDelivBar').style.display = isLeaderOrAdmin ? 'none' : '';
  document.getElementById('reviewEmpFilterGroup').style.display = isLeaderOrAdmin ? '' : 'none';
  document.getElementById('adminTaskFilters').style.display = isLeaderOrAdmin ? '' : 'none';
  document.getElementById('btnCreateTask').style.display = isLeaderOrAdmin ? '' : 'none';
  // Objective filter bar: always visible (employees need scope filter)
  document.getElementById('objFilterBar').style.display = '';
  // Global obj button: admin only
  document.getElementById('btnCreateGlobalObj').style.display = isAdmin ? '' : 'none';
  // Personal obj button: always visible (employees can submit for approval)
  document.getElementById('btnCreateObj').style.display = '';
  // Approval filter: admin/leader only
  const objApprovalGroup = document.getElementById('objFilterApprovalGroup');
  if (objApprovalGroup) objApprovalGroup.style.display = isLeaderOrAdmin ? '' : 'none';
  document.getElementById('adminDashboard').style.display = isLeaderOrAdmin ? '' : 'none';
  document.getElementById('empDashboard').style.display = isLeaderOrAdmin ? 'none' : '';

  // Department filter visibility: only admin sees dept filters (dept_leader already scoped by backend)
  const deptFilterDisplay = isAdmin ? '' : 'none';
  ['dashboardFilterBar', 'logDeptFilterGroup'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = deptFilterDisplay;
  });
  // Hide individual dept selects inside shared filter bars for non-admin
  ['objFilterDept', 'taskFilterDept', 'delivDeptFilter', 'reviewDeptFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.closest('.form-group').style.display = deptFilterDisplay;
  });

  // Daily log defaults
  document.getElementById('logDate').value = todayStr();
  document.getElementById('logDate').addEventListener('change', loadDailyLogs);
  document.getElementById('logEmployee').addEventListener('change', loadDailyLogs);

  // Task filter listeners
  ['taskFilterAssignee', 'taskFilterStatus', 'taskFilterPriority', 'taskFilterObjective'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadTasks);
  });

  // Assignee filter change -> update objective filter options (global always shown)
  document.getElementById('taskFilterAssignee').addEventListener('change', function() {
    const sel = this.value;
    const ofEl = document.getElementById('taskFilterObjective');
    if (ofEl) {
      const prev = ofEl.value;
      ofEl.innerHTML = '<option value="">全部</option><option value="none">无OKR</option>'
        + (state.objectivesCache || []).filter(o => o.scope === 'global' || !sel || String(o.employee_id) === sel)
          .map(o => {
            const prefix = o.scope === 'global' ? '[整体] ' : '';
            return `<option value="${o.id}">${prefix}${esc(o.title)}</option>`;
          }).join('');
      ofEl.value = prev;
      if (ofEl.value !== prev) ofEl.value = '';
    }
  });

  // Objective filter listeners
  const objFilter = document.getElementById('objFilterEmployee');
  if (objFilter) objFilter.addEventListener('change', loadObjectives);
  const objScopeFilter = document.getElementById('objFilterScope');
  if (objScopeFilter) objScopeFilter.addEventListener('change', loadObjectives);
  const objApprovalFilter = document.getElementById('objFilterApproval');
  if (objApprovalFilter) objApprovalFilter.addEventListener('change', loadObjectives);

  // Deliverable filter listener
  const delivFilter = document.getElementById('delivEmpFilter');
  if (delivFilter) delivFilter.addEventListener('change', loadDeliverables);

  // Review filter listeners
  ['reviewTypeFilter', 'reviewStatusFilter', 'reviewEmpFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadReviews);
  });

  showAppPage();

  if (isLeaderOrAdmin) {
    loadDashboard();
  } else {
    loadEmpDashboard();
  }
}

// ===== START =====
initApp();
