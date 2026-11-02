import { icon } from '../icons.js';
import { esc, toastIcon } from '../dom.js';

const root = () => document.getElementById('toast-root');

export function toast(message, type = 'success', detail = '', timeout = 3900) {
  const host = root();
  if (!host) return;
  const current = host.querySelectorAll('.toast');
  if (current.length >= 4) current[0].remove();
  const node = document.createElement('div');
  node.className = 'toast toast--' + type;
  node.innerHTML =
    '<span class="toast__icon">' + icon(toastIcon(type)) + '</span>' +
    '<div class="toast__body"><div class="toast__title">' + esc(message) + '</div>' +
    (detail ? '<div class="toast__detail">' + esc(detail) + '</div>' : '') + '</div>';
  const dismiss = () => {
    if (!node.isConnected || node.classList.contains('is-leaving')) return;
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 260);
  };
  node.addEventListener('click', dismiss);
  host.appendChild(node);
  const timer = setTimeout(dismiss, timeout);
  node.addEventListener('remove', () => clearTimeout(timer), { once: true });
  return dismiss;
}

export function toastError(error, fallback = '操作失败') {
  const message = error && error.message ? error.message : fallback;
  const detail = error && error.detail ? String(error.detail).split(/\r?\n/).filter(Boolean).slice(-3).join(' · ').slice(0, 260) : '';
  return toast(message, 'error', detail);
}
