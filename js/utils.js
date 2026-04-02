// ===== Utility functions =====

// XSS protection: escape HTML entities (Phase 1.4)
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Toast notification system (Phase 5.4: enhanced)
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function toast(msg, type = 'success') {
  // Support legacy boolean signature: toast(msg, true) = error
  if (type === true) type = 'error';
  if (type === false || type === undefined) type = 'success';

  const container = getToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;

  const icons = {
    success: '&#10003;',
    error: '&#10007;',
    warning: '&#9888;',
    info: '&#8505;'
  };

  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${esc(msg)}</span>
    <button class="toast-close" aria-label="关闭">&times;</button>
  `;

  el.querySelector('.toast-close').addEventListener('click', () => el.remove());

  container.appendChild(el);

  const duration = type === 'error' ? 5000 : 3000;
  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('show');
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('show');
}

export function statusText(s) {
  return { pending: '待开始', in_progress: '进行中', completed: '已完成', overdue: '已延期' }[s] || s;
}

export function confirmStatusText(cs) {
  return { none: '', pending: '待审核', confirmed: '已通过', rejected: '已打回' }[cs] || cs;
}

// Date helpers
export function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr() {
  return toDateStr(new Date());
}

// Custom confirm dialog
export function confirmDialog({ title = '确认操作', message = '确定要执行此操作吗？', confirmText = '确认', cancelText = '取消', type = 'danger' } = {}) {
  return new Promise(resolve => {
    const icons = { danger: '&#9888;', warning: '&#9888;', info: '&#8505;' };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show confirm-dialog-overlay';
    overlay.innerHTML = `
      <div class="modal confirm-dialog">
        <div class="confirm-dialog-icon confirm-dialog-icon-${type}">${icons[type] || icons.danger}</div>
        <h3 class="confirm-dialog-title">${title}</h3>
        <p class="confirm-dialog-message">${message}</p>
        <div class="confirm-dialog-actions">
          <button class="btn btn-secondary confirm-dialog-cancel">${cancelText}</button>
          <button class="btn btn-${type === 'danger' ? 'danger' : 'primary'} confirm-dialog-confirm">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('.confirm-dialog-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.confirm-dialog-confirm').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); } };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.confirm-dialog-confirm').focus();
  });
}

// Get current Monday
export function getMonday() {
  const today = new Date();
  const dow = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dow + 1);
  return toDateStr(monday);
}
