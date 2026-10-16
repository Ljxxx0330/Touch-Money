/**
 * wallet.js —— 虚拟钱包视觉组件 + 动画基础设施。
 *
 * 关键约束：动画只是「表现层」。数据在调用动画之前就已经保存并更新，
 * 动画出错或被系统关闭（prefers-reduced-motion）都不会影响记账结果。
 */

import { centsToYuan, formatAmount, formatCentsWhole } from '../core/money.js';

/** 系统是否要求减少动态效果。 */
export function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** 等待若干帧（rAF 不可用时退化为 setTimeout）。 */
export function nextFrames(n = 2) {
  const raf = typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (cb) => setTimeout(cb, 16);
  return new Promise((resolve) => {
    let left = Math.max(1, n);
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else raf(step);
    };
    raf(step);
  });
}

/**
 * 带兜底的动画执行器：无论动画是否成功、是否超时，cleanup 都会执行一次，
 * Promise 也一定会 settle。所有钱包动画都必须走这里。
 * @param {(finish:()=>void)=>void} run 启动动画，内部调用 finish 表示结束
 * @param {number} ms 最长等待时间（超时后自动结束）
 * @returns {Promise<void>}
 */
export function runClosable(run, ms = 1200) {
  let done = false;
  let rafId = 0;
  let timer = 0;
  return new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (rafId) cancelAnimationFrame(rafId);
      resolve();
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    timer = setTimeout(finish, ms + 300);
    try {
      run(finish);
    } catch (err) {
      console.warn('钱包动画执行出错，已跳过动画（数据不受影响）：', err);
      finish();
    }
  });
}

/**
 * 数字滚动。
 * @param {HTMLElement} el 目标元素
 * @param {(value:number)=>string} format 展示格式
 * @param {{from:number, to:number, duration?:number}} opts
 * @param {()=>void} [onFrame] 每帧回调（用于同步小数位）
 */
export function animateNumber(el, format, { from, to, duration = 700 }, onFrame) {
  if (!el) return Promise.resolve();
  const render = (value) => {
    el.textContent = format(value);
    if (onFrame) onFrame(value);
  };
  if (reducedMotion() || from === to || typeof window.requestAnimationFrame !== 'function') {
    render(to);
    if (onFrame) onFrame(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const span = to - from;
    const step = (now) => {
      const t = Math.min(1, (now - start) / Math.max(1, duration));
      const eased = 1 - Math.pow(1 - t, 3);
      render(Math.round(from + span * eased));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

const DENOMS = [10000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1];

/** 把余额拆成虚拟纸币面额（最多 6 张，按从大到小）。 */
export function noteDenominations(balanceCents) {
  let yuan = Math.max(0, Math.floor(centsToYuan(balanceCents || 0)));
  if (yuan <= 0) return [];
  const out = [];
  for (const d of DENOMS) {
    while (out.length < 6 && yuan >= d) {
      out.push(d);
      yuan -= d;
    }
    if (out.length >= 6) break;
  }
  if (out.length === 0) out.push(1);
  return out;
}

/**
 * 构建虚拟钱包 DOM。
 * @param {{balanceCents:number, periodLabel?:string, compact?:boolean}} opts
 * @returns {{root:HTMLElement, setBalance:(cents:number, opts?:{animate?:boolean})=>void,
 *              spend:(amountCents:number)=>Promise<void>, income:(amountCents:number)=>Promise<void>,
 *              destroy:()=>void, balanceDisplay:HTMLElement}}
 */
export function buildWallet(opts = {}) {
  const root = document.createElement('div');
  root.className = `wallet${opts.compact ? ' wallet-compact' : ''}`;

  if (!opts.compact) root.dataset.wallet = 'main';

  const back = document.createElement('div');
  back.className = 'wallet-back';
  root.appendChild(back);

  const stack = document.createElement('div');
  stack.className = 'wallet-stack';
  root.appendChild(stack);

  const front = document.createElement('div');
  front.className = 'wallet-front';

  const flap = document.createElement('div');
  flap.className = 'wallet-flap';
  flap.setAttribute('aria-hidden', 'true');
  front.appendChild(flap);

  const clasp = document.createElement('span');
  clasp.className = 'wallet-clasp';
  clasp.setAttribute('aria-hidden', 'true');
  front.appendChild(clasp);

  const face = document.createElement('div');
  face.className = 'wallet-face';

  const labelEl = document.createElement('p');
  labelEl.className = 'wallet-label';
  labelEl.textContent = '当前可支配余额';
  face.appendChild(labelEl);

  const amountRow = document.createElement('div');
  amountRow.className = 'wallet-amount';
  const currency = document.createElement('span');
  currency.className = 'wallet-currency';
  currency.textContent = '¥';
  const wholeEl = document.createElement('span');
  wholeEl.className = 'wallet-whole';
  wholeEl.textContent = '0';
  const fracEl = document.createElement('span');
  fracEl.className = 'wallet-frac';
  fracEl.textContent = '.00';
  amountRow.appendChild(currency);
  amountRow.appendChild(wholeEl);
  amountRow.appendChild(fracEl);
  face.appendChild(amountRow);

  const periodEl = document.createElement('p');
  periodEl.className = 'wallet-period';
  periodEl.textContent = opts.periodLabel || '';
  face.appendChild(periodEl);

  const srEl = document.createElement('span');
  srEl.className = 'sr-only';
  face.appendChild(srEl);

  front.appendChild(face);
  root.appendChild(front);

  const tag = document.createElement('div');
  tag.className = 'wallet-tag';
  tag.hidden = true;
  root.appendChild(tag);

  let currentCents = Math.round(Number(opts.balanceCents) || 0);
  let destroyed = false;

  function renderStack() {
    const denoms = noteDenominations(currentCents);
    stack.textContent = '';
    denoms.forEach((d, i) => {
      const note = document.createElement('div');
      note.className = `note note-d${d}`;
      note.style.setProperty('--i', String(i));
      const inner = document.createElement('span');
      inner.className = 'note-face';
      inner.textContent = `¥${d}`;
      note.appendChild(inner);
      stack.appendChild(note);
    });
    stack.classList.toggle('is-empty', denoms.length === 0);
    root.classList.toggle('wallet-empty', denoms.length === 0);
  }

  function renderText(valueCents) {
    const text = formatAmount(valueCents);
    const [whole, frac] = text.split('.');
    wholeEl.textContent = whole;
    fracEl.textContent = '.' + frac;
    root.classList.toggle('is-negative', valueCents < 0);
    srEl.textContent = `当前可支配余额 ${formatAmount(valueCents)} 元`;
  }

  renderText(currentCents);
  renderStack();

  function setBalance(nextCents, setOpts = {}) {
    const next = Math.round(Number(nextCents) || 0);
    const from = currentCents;
    currentCents = next;
    renderStack();
    if (setOpts.animate === false || reducedMotion() || from === next) {
      renderText(next);
      return Promise.resolve();
    }
    return animateNumber(
      wholeEl,
      (v) => formatCentsWhole(v),
      { from, to: next, duration: 650 },
      (v) => {
        fracEl.textContent = '.' + String(Math.abs(Math.round(v) % 100)).padStart(2, '0');
        srEl.textContent = `当前可支配余额 ${formatAmount(v)} 元`;
        root.classList.toggle('is-negative', v < 0);
      },
    ).then(() => renderText(next));
  }

  /** 消费动画：夹扣弹开 → 纸币飞出 → 余额滚动 → 合上。 */
  function spend(amountCents, spendOpts = {}) {
    const cents = Math.round(Number(amountCents) || 0);
    const from = currentCents;
    const to = from - cents;
    const keepBalance = spendOpts.updateBalance === false;
    currentCents = to;
    if (!keepBalance) renderText(to);

    if (reducedMotion()) {
      renderStack();
      return Promise.resolve();
    }

    tag.textContent = `-${formatAmount(cents)}`;
    tag.hidden = false;
    root.classList.add('is-spending');

    const top = stack.lastElementChild;
    if (top) top.classList.add('note-flying');

    return runClosable((finish) => {
      if (!destroyed) root.classList.add('is-open');
      setTimeout(() => {
        if (!destroyed) root.classList.add('note-gone');
      }, 260);
      setTimeout(() => {
        if (!destroyed) root.classList.remove('is-open');
      }, 700);
      setTimeout(finish, 1000);
    }, 1100).then(() => {
      if (destroyed) return;
      root.classList.remove('is-spending', 'is-open', 'note-gone');
      tag.hidden = true;
      renderStack();
      if (keepBalance) renderText(from);
    });
  }

  /** 入账动画：纸币从上方落回钱包。 */
  function income(amountCents) {
    const cents = Math.round(Number(amountCents) || 0);
    const from = currentCents;
    const to = from + cents;
    currentCents = to;
    renderText(to);

    if (reducedMotion()) {
      renderStack();
      return Promise.resolve();
    }

    tag.textContent = `+${formatAmount(cents)}`;
    tag.hidden = false;
    root.classList.add('is-income', 'is-open');
    const fresh = document.createElement('div');
    fresh.className = 'note note-fresh';
    const inner = document.createElement('span');
    inner.className = 'note-face';
    inner.textContent = `¥${Math.max(1, Math.round(centsToYuan(cents)))}`;
    fresh.appendChild(inner);
    stack.appendChild(fresh);

    return runClosable((finish) => {
      setTimeout(() => {
        if (!destroyed) root.classList.remove('is-open');
      }, 600);
      setTimeout(finish, 900);
    }, 1000).then(() => {
      if (destroyed) return;
      root.classList.remove('is-income', 'is-open');
      tag.hidden = true;
      renderStack();
      renderText(currentCents);
    });
  }

  function destroy() {
    destroyed = true;
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { root, setBalance, spend, income, destroy, balanceDisplay: wholeEl, stack, front };
}
