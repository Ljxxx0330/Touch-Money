/**
 * toast.js —— 轻量操作反馈（成功 / 错误 / 提示）。
 * 与顶部 notices 的区别：toast 是一次性的即时反馈，notices 是需要持续看到的状态提示。
 */

const LEVELS = { info: '提示', success: '成功', error: '错误', warn: '注意' };

function container() {
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
 * @param {string} text
 * @param {{level?:'info'|'success'|'error'|'warn', duration?:number}} [opts]
 * @returns {() => void} 手动关闭函数
 */
export function toast(text, opts = {}) {
  const level = LEVELS[opts.level] ? opts.level : 'info';
  const duration = opts.duration === undefined ? (level === 'error' ? 5000 : 2600) : opts.duration;

  const root = container();
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;

  const badge = document.createElement('span');
  badge.className = 'toast-badge';
  badge.textContent = LEVELS[level];
  el.appendChild(badge);

  const msg = document.createElement('span');
  msg.className = 'toast-text';
  msg.textContent = String(text === undefined || text === null ? '' : text);
  el.appendChild(msg);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭提示');
  el.appendChild(close);

  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    el.classList.add('toast-leaving');
    const kill = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    if (prefersReduced()) kill();
    else setTimeout(kill, 220);
  };
  const timer = duration > 0 ? setTimeout(dismiss, duration) : null;
  close.addEventListener('click', dismiss);

  root.appendChild(el);
  while (root.children.length > 3) root.removeChild(root.firstChild);
  return dismiss;

  function prefersReduced() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
      return false;
    }
  }
}

export const toastSuccess = (text, opts = {}) => toast(text, { ...opts, level: 'success' });
export const toastError = (text, opts = {}) => toast(text, { ...opts, level: 'error' });
export const toastWarn = (text, opts = {}) => toast(text, { ...opts, level: 'warn' });
