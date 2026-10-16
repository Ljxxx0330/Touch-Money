/**
 * modal.js —— 通用模态框：ESC 关闭、点击遮罩关闭、焦点陷阱、关闭后归还焦点。
 * 支持堆叠（后开的模态框优先响应 ESC）。
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack = [];
// 键盘监听只绑定一次：中途关到空会解绑，再开时重新绑定，避免同一函数重复挂到 document 上。
let keyListenerBound = false;

function overlayEl() {
  let el = document.getElementById('modal-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modal-root';
    document.body.appendChild(el);
  }
  return el;
}

function lockScroll() {
  document.body.classList.add('has-modal');
}

function unlockScroll() {
  if (stack.length === 0) document.body.classList.remove('has-modal');
}

function onKeydown(e) {
  if (stack.length === 0) return;
  const top = stack[stack.length - 1];
  if (e.key === 'Escape') {
    // handle 上保存了本次打开的选项：只有显式 closeOnEsc:false 才不响应 ESC。
    if (top.closeOnEsc === false) return;
    e.preventDefault();
    top.close('esc');
    return;
  }
  if (e.key === 'Tab') {
    const nodes = Array.from(top.panel.querySelectorAll(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/**
 * 打开一个模态框。
 * @param {object} opts
 *   title      {string}      标题
 *   body       {Node|string} 内容节点或 HTML 字符串
 *   footer     {Node}        自定义底部（与 buttons 二选一）
 *   buttons    {Array}       [{text, kind:'primary'|'ghost'|'danger', onClick(handle), type}]
 *   closeOnEsc {boolean}     默认 true
 *   closeOnBackdrop {boolean}默认 true
 *   labelledByFallback {string} 无标题时给模态框的无障碍名称
 *   onClose    {function(reason)}
 * @returns {{close:(reason?:string)=>void, panel:HTMLElement, body:HTMLElement, footer:HTMLElement, titleText:string}}
 */
export function openModal(opts = {}) {
  const root = overlayEl();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const panel = document.createElement('div');
  panel.className = 'modal';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const titleId = 'modal-title-' + (stack.length + 1) + '-' + Math.random().toString(36).slice(2, 7);

  const header = document.createElement('header');
  header.className = 'modal-head';
  const h2 = document.createElement('h2');
  h2.id = titleId;
  h2.textContent = opts.title || opts.labelledByFallback || '窗口';
  panel.setAttribute('aria-labelledby', titleId);
  header.appendChild(h2);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '关闭';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.addEventListener('click', () => handle.close('button'));
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);
  panel.appendChild(body);

  let footer = null;
  if (opts.footer) {
    footer = opts.footer;
  } else if (Array.isArray(opts.buttons) && opts.buttons.length) {
    footer = document.createElement('footer');
    footer.className = 'modal-foot';
    for (const spec of opts.buttons) {
      const btn = document.createElement('button');
      btn.type = (spec.type || 'button') === 'submit' ? 'submit' : 'button';
      btn.className = 'btn ' + (spec.kind === 'primary' ? 'btn-primary' : spec.kind === 'danger' ? 'btn-danger' : 'btn-ghost');
      btn.textContent = spec.text;
      btn.addEventListener('click', () => spec.onClick(handle));
      footer.appendChild(btn);
    }
  }
  if (footer) panel.appendChild(footer);

  backdrop.appendChild(panel);

  const previouslyFocused = document.activeElement;
  const handle = {
    panel,
    body,
    footer,
    titleText: h2.textContent,
    // 把打开选项存进 handle：onKeydown 与关闭回调都从这里读，避免依赖闭包外的状态。
    closeOnEsc: opts.closeOnEsc !== false,
    closeOnBackdrop: opts.closeOnBackdrop !== false,
    close(reason = 'api') {
      const idx = stack.indexOf(handle);
      if (idx < 0) return;
      stack.splice(idx, 1);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      unlockScroll();
      if (stack.length === 0 && keyListenerBound && document.removeEventListener) {
        document.removeEventListener('keydown', onKeydown);
        keyListenerBound = false;
      }
      if (previouslyFocused && previouslyFocused.focus) {
        try {
          previouslyFocused.focus();
        } catch {
          /* 原焦点元素已被移除 */
        }
      }
      if (typeof opts.onClose === 'function') {
        try {
          opts.onClose(reason);
        } catch (err) {
          console.error('模态框关闭回调出错：', err);
        }
      }
    },
  };

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && handle.closeOnBackdrop !== false) handle.close('backdrop');
  });

  root.appendChild(backdrop);
  stack.push(handle);
  lockScroll();
  if (!keyListenerBound && document.addEventListener) {
    document.addEventListener('keydown', onKeydown);
    keyListenerBound = true;
  }

  const primary = footer ? footer.querySelector('.btn-primary, .btn-danger') : null;
  const focusTarget =
    panel.querySelector('[data-autofocus]') ||
    (opts.focusPrimary ? primary : null) ||
    body.querySelector(FOCUSABLE) ||
    (footer ? footer.querySelector(FOCUSABLE) : null) ||
    primary ||
    closeBtn;
  if (focusTarget) focusTarget.focus();

  return handle;
}

/**
 * 确认对话框，返回 Promise<boolean>。
 * @param {{title:string, message:string, confirmText?:string, cancelText?:string, danger?:boolean, detail?:string|Node}} opts
 */
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const wrap = document.createElement('div');
    wrap.className = 'confirm-body';
    const p = document.createElement('p');
    p.className = 'confirm-message';
    p.textContent = opts.message || '';
    wrap.appendChild(p);
    if (opts.detail) {
      const d = document.createElement('div');
      d.className = 'confirm-detail';
      if (typeof opts.detail === 'string') d.textContent = opts.detail;
      else d.appendChild(opts.detail);
      wrap.appendChild(d);
    }

    openModal({
      title: opts.title || '请确认',
      body: wrap,
      focusPrimary: true,
      buttons: [
        {
          text: opts.cancelText || '取消',
          kind: 'ghost',
          onClick: (h) => {
            h.close('cancel');
            done(false);
          },
        },
        {
          text: opts.confirmText || '确认',
          kind: opts.danger ? 'danger' : 'primary',
          onClick: (h) => {
            h.close('confirm');
            done(true);
          },
        },
      ],
      onClose: (reason) => {
        if (reason === 'esc' || reason === 'backdrop' || reason === 'button') done(false);
      },
    });

  });
}

/** 当前打开的模态框数量（测试与调试用）。 */
export function openModalCount() {
  return stack.length;
}

/** 关闭全部模态框（路由切换时调用）。 */
export function closeAllModals(reason = 'route') {
  for (const h of stack.slice().reverse()) h.close(reason);
}
