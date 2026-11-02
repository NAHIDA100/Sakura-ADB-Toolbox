import { icon } from '../icons.js';
import { esc, qsa } from '../dom.js';

let activeModal = null;
let modalSeed = 0;

function focusable(root) {
  return qsa('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])', root)
    .filter((node) => node.offsetParent !== null || node.getClientRects().length);
}

export function openModal(options = {}) {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return null;
  if (activeModal) activeModal.close();
  const seed = ++modalSeed;
  const width = options.width || 530;
  const danger = Boolean(options.danger);
  const className = options.className || '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.dataset.modal = String(seed);
  overlay.innerHTML =
    '<div class="modal ' + (danger ? 'modal--danger ' : '') + className + '" role="dialog" aria-modal="true" aria-labelledby="modal-title-' + seed + '" style="--modal-width:' + width + 'px">' +
      '<div class="modal__head">' +
        '<span class="modal__icon">' + icon(options.icon || 'sparkles') + '</span>' +
        '<div class="modal__heading">' +
          '<div class="modal__title" id="modal-title-' + seed + '">' + esc(options.title || '提示') + '</div>' +
          (options.subtitle ? '<div class="modal__subtitle">' + esc(options.subtitle) + '</div>' : '') +
        '</div>' +
        (options.closable === false ? '' : '<button class="icon-btn icon-btn--small modal__close" type="button" aria-label="关闭">' + icon('close') + '</button>') +
      '</div>' +
      '<div class="modal__body">' + (options.content || '') + '</div>' +
      (options.footer ? '<div class="modal__foot">' + options.footer + '</div>' : '') +
    '</div>';
  modalRoot.appendChild(overlay);

  const modal = overlay.querySelector('.modal');
  const body = overlay.querySelector('.modal__body');
  let closed = false;
  let childCleanup = null;

  const close = (reason = 'dismiss') => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    if (typeof childCleanup === 'function') {
      try { childCleanup(); } catch (error) { console.error(error); }
    }
    overlay.remove();
    if (activeModal && activeModal.overlay === overlay) activeModal = null;
    if (typeof options.onClose === 'function') options.onClose(reason);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && options.closable !== false) {
      event.preventDefault();
      close('escape');
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = focusable(modal);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay && options.closable !== false) close('backdrop');
  });
  const closeButton = overlay.querySelector('.modal__close');
  if (closeButton) closeButton.addEventListener('click', () => close('close'));
  document.addEventListener('keydown', onKeyDown, true);

  activeModal = { overlay, close };

  if (typeof options.onMount === 'function') {
    try { childCleanup = options.onMount({ root: modal, body, overlay, close, seed }); } catch (error) { console.error(error); }
  }

  requestAnimationFrame(() => {
    const target = modal.querySelector('[data-autofocus]') || modal.querySelector('input') || modal.querySelector('button.btn--primary') || modal.querySelector('button.btn--danger') || modal.querySelector('.modal__close');
    if (target) target.focus({ preventScroll: true });
  });

  return { overlay, modal, body, close };
}

export function confirmModal(options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const seed = ++modalSeed;
    const requireText = String(options.requireText || '');
    const confirmLabel = options.confirmLabel || '确认执行';
    const cancelLabel = options.cancelLabel || '取消';
    const detail = options.detail ? '<div class="callout callout--' + (options.danger ? 'danger' : 'warn') + '">' + icon('alert') + '<div>' + esc(options.detail) + '</div></div>' : '';
    const body = options.bodyHtml || ('<div class="modal-message">' + (options.message || '确定执行此操作吗？').split('\n').map(esc).join('<br>') + '</div>' + detail);
    const inputBlock = requireText
      ? '<div class="field" style="margin-top:13px"><label class="field__label" for="confirm-input-' + seed + '">输入 <span class="mono" style="color:var(--danger);font-weight:700">' + esc(requireText) + '</span> 以继续</label><input class="input" id="confirm-input-' + seed + '" autocomplete="off" spellcheck="false" data-confirm-input></div>'
      : '';
    const footer =
      '<button class="btn btn--ghost" type="button" data-confirm-cancel>' + esc(cancelLabel) + '</button>' +
      '<button class="btn ' + (options.danger ? 'btn--danger' : 'btn--primary') + '" type="button" data-confirm-ok>' + esc(confirmLabel) + '</button>';

    const instance = openModal({
      title: options.title || '确认操作',
      subtitle: options.subtitle || '',
      icon: options.icon || (options.danger ? 'alert' : 'sparkles'),
      content: body + inputBlock,
      footer,
      danger: Boolean(options.danger),
      closable: options.closable !== false,
      width: options.width || 540,
      onClose: () => done(false),
      onMount: ({ root, close }) => {
        const input = root.querySelector('[data-confirm-input]');
        const ok = root.querySelector('[data-confirm-ok]');
        const cancel = root.querySelector('[data-confirm-cancel]');
        const sync = () => {
          if (!ok) return;
          ok.disabled = Boolean(requireText) && (!input || input.value.trim() !== requireText);
        };
        if (input) {
          input.addEventListener('input', sync);
          input.setAttribute('data-autofocus', 'true');
        }
        sync();
        if (cancel) cancel.addEventListener('click', () => { done(false); close('cancel'); });
        if (ok) ok.addEventListener('click', () => {
          if (requireText && (!input || input.value.trim() !== requireText)) {
            if (input) {
              input.focus();
              input.classList.add('is-invalid');
              setTimeout(() => input.classList.remove('is-invalid'), 700);
            }
            return;
          }
          done(true);
          close('confirm');
        });
      }
    });
    if (!instance) done(false);
  });
}
