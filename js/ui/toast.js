/**
 * toast.js —— 轻提示：出现在屏幕下方，几秒后自动退场，可以点掉。
 * 提示只是补充说明，重要信息不会只靠颜色区分（每条都带图标与文字）。
 */

import { icon } from './icons.js';

const LEVEL_ICONS = { info: 'info', success: 'check', error: 'close', warn: 'info' };

function root() {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-root';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

/**
 * 弹一条提示。
 * @param {string} text @param {{level?: 'info'|'success'|'error'|'warn', duration?: number}} [opts]
 * @returns {() => void} dismiss
 */
export function toast(text, opts = {}) {
  const level = ['info', 'success', 'error', 'warn'].includes(opts.level) ? opts.level : 'info';
  const duration = opts.duration === undefined ? (level === 'error' || level === 'warn' ? 5000 : 2600) : Math.max(0, Number(opts.duration) || 0);

  const el = document.createElement('div');
  el.className = `toast toast-${level}`;
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.appendChild(icon(LEVEL_ICONS[level], { size: 18 }));
  el.appendChild(mark);
  const msg = document.createElement('span');
  msg.textContent = String(text === undefined || text === null ? '' : text);
  el.appendChild(msg);
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭这条提示');
  close.textContent = '×';
  close.addEventListener('click', () => dismiss());
  el.appendChild(close);

  root().appendChild(el);

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.classList.add('is-leaving');
    const kill = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) kill();
    else { el.addEventListener('animationend', kill, { once: true }); setTimeout(kill, 320); }
  };
  const timer = duration > 0 ? setTimeout(dismiss, duration) : 0;
  return dismiss;
}

export const toastSuccess = (text, opts = {}) => toast(text, { ...opts, level: 'success' });
export const toastError = (text, opts = {}) => toast(text, { ...opts, level: 'error' });
export const toastWarn = (text, opts = {}) => toast(text, { ...opts, level: 'warn' });
