// ===== API helper with unified error handling (Phase 4.3) =====

import { state, clearSession } from './state.js';
import { toast } from './utils.js';

export async function api(path, opts = {}) {
  const headers = {};
  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (state.authToken) headers['Authorization'] = 'Bearer ' + state.authToken;

  try {
    const fetchOpts = { headers, ...opts };
    if (opts.body && !(opts.body instanceof FormData)) {
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, fetchOpts);

    if (res.status === 401) {
      clearSession();
      showLoginPage();
      return null;
    }

    const data = await res.json();

    if (data && data.error) {
      toast(data.error, 'error');
      return null;
    }

    return data;
  } catch (err) {
    toast('网络请求失败，请检查连接', 'error');
    console.error('API error:', err);
    return null;
  }
}

// Raw fetch for cases where we need FormData or custom handling
export async function apiUpload(path, formData) {
  const headers = {};
  if (state.authToken) headers['Authorization'] = 'Bearer ' + state.authToken;

  try {
    const res = await fetch(path, {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await res.json();
    if (data && data.error) {
      toast(data.error, 'error');
      return null;
    }
    return data;
  } catch (err) {
    toast('上传失败，请检查连接', 'error');
    console.error('Upload error:', err);
    return null;
  }
}

// Reference to showLoginPage - will be set by app.js
let showLoginPage = () => {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app-page').style.display = 'none';
};

export function setShowLoginPage(fn) {
  showLoginPage = fn;
}
