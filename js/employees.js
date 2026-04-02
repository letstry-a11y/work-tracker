// ===== Employees & Users management =====

import { state } from './state.js';
import { api } from './api.js';
import { toast, closeModal, esc, confirmDialog } from './utils.js';

export async function loadEmployees() {
  const data = await api('/api/employees');
  if (!data) return;
  state.employeesCache = data;
  const tbody = document.getElementById('empTableBody');
  tbody.innerHTML = state.employeesCache.map(e => `
    <tr>
      <td>${e.id}</td>
      <td>${esc(e.name)}</td>
      <td>${esc(e.group_name) || '-'}</td>
      <td>${e.created_at ? e.created_at.slice(0, 10) : '-'}</td>
      <td><button class="btn btn-danger btn-sm" data-action="deleteEmployee" data-id="${e.id}">删除</button></td>
    </tr>
  `).join('');
  loadUsers();
}

export async function deleteEmployee(id) {
  const ok = await confirmDialog({ title: '删除员工', message: '确认删除该员工？' });
  if (!ok) return;
  const res = await api('/api/employees/' + id, { method: 'DELETE' });
  if (!res) return;
  toast('已删除');
  loadEmployees();
}

export function showEmployeeModal() {
  document.getElementById('empName').value = '';
  document.getElementById('empRole').value = '';
  document.getElementById('empGroup').value = '';
  document.getElementById('empModal').classList.add('show');
}

export async function saveEmployee() {
  const name = document.getElementById('empName').value.trim();
  if (!name) return toast('姓名不能为空', 'error');
  const res = await api('/api/employees', {
    method: 'POST',
    body: { name, role: document.getElementById('empRole').value, group_name: document.getElementById('empGroup').value }
  });
  if (!res) return;
  closeModal('empModal');
  toast('员工已添加');
  loadEmployees();
}

// ===== USERS =====

export async function loadUsers() {
  const res = await api('/api/auth/users');
  if (!res || !res.users) return;
  state.usersCache = res.users;
  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = state.usersCache.map(u => `
    <tr>
      <td>${esc(u.username)}</td>
      <td>${esc(u.employee_name) || '-'}</td>
      <td><span class="badge badge-${u.role === 'admin' ? 'P0' : 'P2'}">${u.role === 'admin' ? '管理员' : '员工'}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" data-action="renameUser" data-id="${u.id}">改名</button>
        <button class="btn btn-secondary btn-sm" data-action="toggleUserRole" data-id="${u.id}">${u.role === 'admin' ? '降为员工' : '升为管理员'}</button>
        <button class="btn btn-danger btn-sm" data-action="deleteUser" data-id="${u.id}">删除账号</button>
      </td>
    </tr>
  `).join('');
}

export async function toggleUserRole(userId) {
  const u = state.usersCache.find(x => x.id === userId);
  if (!u) return;
  const res = await api('/api/auth/users/' + userId + '/role', {
    method: 'PUT', body: { role: u.role === 'admin' ? 'employee' : 'admin' }
  });
  if (!res) return;
  toast('权限已更新');
  loadUsers();
}

let renamingUserId = null;
export function renameUser(userId) {
  const u = state.usersCache.find(x => x.id === userId);
  if (!u) return;
  renamingUserId = userId;
  document.getElementById('renameUserId').value = userId;
  document.getElementById('renameInput').value = u.username;
  document.getElementById('renameOldName').textContent = u.username;
  document.getElementById('renameModal').classList.add('show');
}

export async function doRenameUser() {
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName || newName.length < 2) return toast('用户名至少2个字符', 'error');
  const res = await api('/api/auth/users/' + renamingUserId + '/username', {
    method: 'PUT', body: { username: newName }
  });
  if (!res) return;
  closeModal('renameModal');
  toast('用户名已修改');
  loadUsers();
}

export async function deleteUser(userId) {
  const ok = await confirmDialog({ title: '删除账号', message: '确认删除该用户账号？' });
  if (!ok) return;
  const res = await api('/api/auth/users/' + userId, { method: 'DELETE' });
  if (!res) return;
  toast('账号已删除');
  loadUsers();
}

export function showUserModal() {
  document.getElementById('userName').value = '';
  document.getElementById('userPass').value = '';
  document.getElementById('userRole').value = 'employee';
  const sel = document.getElementById('userEmployee');
  sel.innerHTML = '<option value="">请选择员工</option>' + state.employeesCache.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  document.getElementById('userModal').classList.add('show');
}

export async function saveUser() {
  const username = document.getElementById('userName').value.trim();
  const password = document.getElementById('userPass').value;
  const employee_id = document.getElementById('userEmployee').value ? Number(document.getElementById('userEmployee').value) : null;
  const role = document.getElementById('userRole').value;
  if (!username) return toast('用户名不能为空', 'error');
  if (!password || password.length < 6) return toast('密码至少6位', 'error');
  if (!employee_id) return toast('请选择关联员工', 'error');
  const res = await api('/api/auth/register', { method: 'POST', body: { username, password, employee_id, role } });
  if (!res) return;
  closeModal('userModal');
  toast('账号创建成功');
  loadUsers();
}
