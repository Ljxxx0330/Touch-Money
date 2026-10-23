/**
 * modal.js —— 模态框：ESC 关闭、Tab 焦点陷阱、遮罩关闭、滚动锁、焦点归还。
 *
 * 关键实现选择（都是实测换来的）：
 * - ESC 监听挂在每个面板自己身上，不挂 document：焦点被陷阱锁在面板内，
 *   ESC 一定派发到面板；节点一移除监听自然消失，不会留下陈旧监听。
 * - document 级只管 Tab 焦点陷阱，用一个布尔标志管理注册，并在取不到栈顶时直接返回。
 * - 关闭时先加 .is-leaving 播退场动画，动画结束或超时再真正移除。
 */

import { icon } from './icons.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** @type {Array<object>} 打开中的模态（后打开的在上面） */
const stack = [];
let docKeydownBound = false;

function root() {
  let el = document.getElementById('modal-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modal-root';
    document.body.appendChild(el);
  }
  return el;
}

function lockScroll() {
  if (stack.length !== 1) return;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.body.classList.add('has-modal');
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
}

function unlockScroll() {
  if (stack.length !== 0) return;
  document.body.classList.remove('has-modal');
  document.body.style.paddingRight = '';
}

function bindDocTrap() {
  if (docKeydownBound || !document.addEventListener) return;
  document.addEventListener('keydown', onDocKeydown);
  docKeydownBound = true;
}

function maybeUnbindDocTrap() {
  if (!docKeydownBound || stack.length > 0 || !document.removeEventListener) return;
  document.removeEventListener('keydown', onDocKeydown);
  docKeydownBound = false;
}

/** Tab 焦点陷阱（document 级；ESC 不在这里处理） */
function onDocKeydown(event) {
  if (!event || event.key !== 'Tab') return;
  const top = stack[stack.length - 1];
  if (!top || !top.panel) return; // 防御：栈空或面板已拆
  const nodes = Array.from(top.panel.querySelectorAll(FOCUSABLE))
    .filter((el) => !el.hasAttribute('hidden') && !el.closest('[hidden]'));
  if (!nodes.length) {
    event.preventDefault();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!top.panel.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * 打开一个模态。
 * @param {{title?: string, sub?: string, body: Node|string, wide?: boolean, footer?: Node,
 *   buttons?: Array<{text: string, kind?: 'primary'|'ghost'|'danger', onClick?: (handle: object) => void, type?: string, autofocus?: boolean}>,
 *   closeOnEsc?: boolean, closeOnBackdrop?: boolean, focusPrimary?: boolean, onClose?: (reason: string) => void,
 *   labelledByFallback?: string}} opts
 * @returns {{close: (reason?: string) => void, panel: HTMLElement, body: HTMLElement, footer: HTMLElement, titleText: string}}
 */
export function openModal(opts = {}) {
  const closeOnEsc = opts.closeOnEsc !== false;
  const closeOnBackdrop = opts.closeOnBackdrop !== false;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const panel = document.createElement('div');
  panel.className = `modal${opts.wide ? ' modal-wide' : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const titleText = opts.title || opts.labelledByFallback || '窗口';
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  panel.setAttribute('aria-labelledby', titleId);

  const head = document.createElement('header');
  head.className = 'modal-head';
  const titleBlock = document.createElement('div');
  titleBlock.style.minWidth = '0';
  const h2 = document.createElement('h2');
  h2.id = titleId;
  h2.textContent = titleText;
  titleBlock.appendChild(h2);
  if (opts.sub) {
    const sub = document.createElement('p');
    sub.className = 'modal-sub';
    sub.textContent = opts.sub;
    titleBlock.appendChild(sub);
  }
  head.appendChild(titleBlock);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.appendChild(icon('close', { size: 18 }));
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  panel.appendChild(body);

  let footer = opts.footer || null;
  const buttonRows = [];
  if (Array.isArray(opts.buttons) && opts.buttons.length) {
    footer = footer || document.createElement('footer');
    footer.className = 'modal-foot';
    for (const spec of opts.buttons) {
      const btn = document.createElement('button');
      btn.type = spec.type || 'button';
      const kind = spec.kind === 'primary' ? 'btn-primary' : spec.kind === 'danger' ? 'btn-danger' : 'btn-ghost';
      btn.className = `btn ${kind}`;
      btn.textContent = spec.text;
      if (spec.autofocus) btn.setAttribute('data-autofocus', 'true');
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        if (spec.onClick) spec.onClick(handle);
        else handle.close('button');
      });
      footer.appendChild(btn);
      buttonRows.push(btn);
    }
  }
  if (footer) panel.appendChild(footer);

  const previouslyFocused = document.activeElement;
  const handle = {
    panel,
    body,
    footer,
    titleText,
    close,
  };

  function focusFirst() {
    const target = panel.querySelector('[data-autofocus]')
      || (opts.focusPrimary ? buttonRows.find((b) => b.classList.contains('btn-primary')) : null)
      || (body.querySelector(FOCUSABLE))
      || (footer && footer.querySelector(FOCUSABLE))
      || buttonRows[0]
      || closeBtn;
    if (target && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    }
  }

  function close(reason = 'close') {
    const idx = stack.indexOf(handle);
    if (idx < 0) return;
    stack.splice(idx, 1);
    // 退场动画：加 is-leaving，动画结束或 320ms 后真正移除
    backdrop.classList.add('is-leaving');
    let removed = false;
    const finish = () => {
      if (removed) return;
      removed = true;
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      unlockScroll();
      maybeUnbindDocTrap();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus({ preventScroll: true }); } catch { previouslyFocused.focus(); }
      }
      if (opts.onClose) {
        try { opts.onClose(reason); } catch (err) { console.warn('模态 onClose 出错：', err); }
      }
    };
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
    } else {
      backdrop.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 320);
    }
  }

  // ESC：挂在面板上（焦点在面板内，ESC 必然走到这里），不依赖 document 级监听的开关配对
  panel.addEventListener('keydown', (event) => {
    if (!event || event.key !== 'Escape') return;
    if (!closeOnEsc) return;
    // 只有栈顶这个面板能关，堆叠时 ESC 只关最上面一层
    if (stack[stack.length - 1] !== handle) return;
    event.preventDefault();
    event.stopPropagation();
    close('esc');
  });

  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    close('button');
  });

  backdrop.addEventListener('mousedown', (event) => {
    if (!closeOnBackdrop) return;
    if (event.target !== backdrop) return;
    close('backdrop');
  });

  root().appendChild(backdrop);
  backdrop.appendChild(panel);
  stack.push(handle);
  lockScroll();
  bindDocTrap();
  focusFirst();

  return handle;
}

/**
 * 二次确认。
 * @param {{title: string, message: string, detail?: string, confirmText?: string, cancelText?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    const message = document.createElement('p');
    message.className = 'confirm-message';
    message.textContent = opts.message || '';
    wrap.appendChild(message);
    if (opts.detail) {
      const detail = document.createElement('p');
      detail.className = 'confirm-detail';
      if (typeof opts.detail === 'string') detail.textContent = opts.detail;
      else detail.appendChild(opts.detail);
      wrap.appendChild(detail);
    }
    let settled = false;
    const done = (value, reason) => {
      if (settled) return;
      settled = true;
      resolve(value);
      void reason;
    };
    openModal({
      title: opts.title || '确认一下？',
      body: wrap,
      onClose: (reason) => {
        // 遮罩/ESC/关闭按钮都算「先不」
        if (reason !== 'confirm') done(false, reason);
      },
      buttons: [
        {
          text: opts.cancelText || '取消',
          kind: 'ghost',
          onClick: (handle) => { done(false, 'cancel'); handle.close('cancel'); },
        },
        {
          text: opts.confirmText || '确认',
          kind: opts.danger ? 'danger' : 'primary',
          autofocus: true,
          onClick: (handle) => { done(true, 'confirm'); handle.close('confirm'); },
        },
      ],
    });
  });
}

/** @returns {number} 当前打开的模态数（测试与调试用） */
export function openModalCount() {
  return stack.length;
}

/** 切路由时把还开着的模态全关掉（从最上层往下关） */
export function closeAllModals(reason = 'route') {
  for (const handle of stack.slice().reverse()) {
    try { handle.close(reason); } catch (err) { console.warn('关闭模态失败：', err); }
  }
}
