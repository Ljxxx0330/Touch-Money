/**
 * overlay.js —— 消费确认后的全屏现金动画。
 *
 * 调用时机：数据已经保存之后。这里只负责「让人看见这笔钱离开了钱包」，
 * 任何异常都不会回滚或影响数据；系统要求减少动态效果时直接展示结果。
 */

import { buildWallet, reducedMotion } from './wallet.js';
import { formatAmount } from '../core/money.js';

function overlayHost() {
  let el = document.getElementById('cash-overlay-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cash-overlay-root';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * @param {{amountCents:number, beforeCents:number, afterCents:number, title?:string, categoryLabel?:string}} opts
 * @returns {Promise<void>} 动画与展示结束后 resolve
 */
export function playCashAnimation(opts = {}) {
  const amountCents = Math.round(Number(opts.amountCents) || 0);
  const beforeCents = Math.round(Number(opts.beforeCents) || 0);
  const afterCents = Math.round(Number(opts.afterCents) || 0);

  const host = overlayHost();
  const previouslyFocused = document.activeElement;

  return new Promise((resolve) => {
    let settled = false;
    let autoTimer = 0;
    const backdrop = document.createElement('div');
    backdrop.className = 'cash-overlay';

    const card = document.createElement('div');
    card.className = 'cash-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');

    const head = document.createElement('p');
    head.className = 'cash-head';
    head.textContent = opts.title
      ? `${opts.title}${opts.categoryLabel ? ' · ' + opts.categoryLabel : ''}`
      : '本笔消费';
    card.appendChild(head);

    const amountEl = document.createElement('p');
    amountEl.className = 'cash-amount';
    amountEl.textContent = `-${formatAmount(amountCents)}`;
    card.appendChild(amountEl);

    const wallet = buildWallet({ balanceCents: beforeCents, compact: true });
    card.appendChild(wallet.root);

    const result = document.createElement('div');
    result.className = 'cash-result';
    result.hidden = true;
    const resultMain = document.createElement('p');
    resultMain.className = 'cash-result-main';
    resultMain.textContent = `余额 ${formatAmount(beforeCents)} → ${formatAmount(afterCents)}`;
    result.appendChild(resultMain);
    const resultSub = document.createElement('p');
    resultSub.className = 'cash-result-sub';
    resultSub.textContent = afterCents < 0
      ? '余额已经透支，这笔消费仍然被如实记录了。'
      : '这笔消费已经记入你的账本。';
    result.appendChild(resultSub);
    card.appendChild(result);

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'cash-skip';
    skip.textContent = '跳过动画';
    card.appendChild(skip);

    backdrop.appendChild(card);
    host.appendChild(backdrop);
    document.body.classList.add('has-cash-overlay');

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(autoTimer);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-cash-overlay');
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      wallet.destroy();
      if (previouslyFocused && previouslyFocused.focus) {
        try {
          previouslyFocused.focus();
        } catch {
          /* 原焦点元素已被移除 */
        }
      }
      resolve();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });
    skip.addEventListener('click', finish);

    const showResult = () => {
      result.hidden = false;
      skip.textContent = '完成';
      skip.focus?.();
      autoTimer = setTimeout(finish, reducedMotion() ? 1400 : 2600);
    };

    if (reducedMotion()) {
      wallet.setBalance(afterCents, { animate: false });
      showResult();
      return;
    }

    // 先播钱包动画，再播余额滚动；两步都受 runClosable 兜底保护。
    wallet
      .spend(amountCents, { updateBalance: false })
      .then(() => wallet.setBalance(afterCents, { animate: true }))
      .catch((err) => {
        console.warn('现金动画异常，直接展示结果：', err);
        try {
          wallet.setBalance(afterCents, { animate: false });
        } catch (err2) {
          console.warn('余额展示兜底失败：', err2);
        }
      })
      .then(showResult)
      .catch((err) => {
        console.warn('现金动画收尾异常：', err);
        showResult();
      });
  });
}
