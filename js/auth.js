// ===== Authentication UI =====

import { state, saveSession, clearSession } from './state.js';
import { toast, closeModal } from './utils.js';
import { api } from './api.js';

export function showLoginPage() {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app-page').style.display = 'none';
}

export function showAppPage() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-page').style.display = '';
}

export function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = '';
  document.getElementById('login-error').textContent = '';
}

export function showLogin() {
  document.getElementById('login-form').style.display = '';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('login-error').textContent = '';
}

export async function doLogin(initAppFn) {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) {
    document.getElementById('login-error').textContent = '请输入用户名和密码';
    return;
  }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) {
      document.getElementById('login-error').textContent = data.error;
      return;
    }
    saveSession(data.token, data.user);
    await initAppFn();
  } catch (err) {
    document.getElementById('login-error').textContent = '网络错误，请重试';
  }
}

export async function doRegister(initAppFn) {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const name = document.getElementById('regName').value.trim();
  if (!username || !password || !name) {
    document.getElementById('login-error').textContent = '请填写所有字段';
    return;
  }
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name })
    });
    const data = await res.json();
    if (data.error) {
      document.getElementById('login-error').textContent = data.error;
      return;
    }
    saveSession(data.token, data.user);
    await initAppFn();
  } catch (err) {
    document.getElementById('login-error').textContent = '网络错误，请重试';
  }
}

export async function doLogout() {
  if (state.authToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + state.authToken }
      });
    } catch (e) { /* ignore */ }
  }
  clearSession();
  showLoginPage();
}

export function showPwdModal() {
  document.getElementById('pwdOld').value = '';
  document.getElementById('pwdNew').value = '';
  document.getElementById('pwdNew2').value = '';
  document.getElementById('pwdModal').classList.add('show');
}

export async function doChangePwd() {
  const oldPwd = document.getElementById('pwdOld').value;
  const newPwd = document.getElementById('pwdNew').value;
  const newPwd2 = document.getElementById('pwdNew2').value;
  if (!oldPwd || !newPwd) return toast('请填写所有字段', 'error');
  if (newPwd.length < 6) return toast('新密码至少6位', 'error');
  if (newPwd !== newPwd2) return toast('两次新密码不一致', 'error');
  const res = await api('/api/auth/me/password', { method: 'PUT', body: { old_password: oldPwd, new_password: newPwd } });
  if (!res) return;
  closeModal('pwdModal');
  toast('密码修改成功，请重新登录');
  doLogout();
}
