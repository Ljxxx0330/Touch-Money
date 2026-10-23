/**
 * overlay.js —— 记账之后的全屏现金动画。
 *
 * 调用时机：数据已经保存之后。这里只负责「让人看见这笔钱离开/进入钱包」，
 * 任何异常都不会回滚、也不会影响数据；系统要求减少动态效果时直接展示结果。
 *
 * 视觉结构（与 css/styles.css 对应）：
 *   .cash-overlay > .cash-card
 *     > .cash-head（.cash-kicker + .cash-title + .cash-amount）
 *     > .cash-wallet > .cash-stage.cash-stage-compact > 钱包
 *     > .cash-composition（sr-only，钱包里有哪些面额，只给读屏软件）
 *     > .cash-foot（.cash-timeline > .cash-timeline-fill + 按钮）
 *
  * 钱包下面不再摆文字：余额从多少变成多少写在钱包自己的金属牌上（数字滚动）。
 * 消费只演「抽出这笔钱本身的钞票」：花了多少就抽多少，向上展开的也正是这几张。
 * 拆法取自这笔钱自己的最少张数（notes.js 的 spendBills），不看钱包新旧构成的差：
 * 找回属于钱包内部重新数一遍的结果，演成「飞回来」会让人以为花的不是那些钱。
 */

import { buildWallet, reducedMotion } from './wallet.js';
import { formatAmount } from '../core/money.js';
import { describeComposition } from '../core/notes.js';

/** 覆盖层挂在 body 末尾的独立容器里，视图重渲染不会把它带走 */
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
 * @param {{amountCents:number, beforeCents:number, afterCents:number, title?:string,
 *            categoryLabel?:string, direction?:'in'|'out', resultNote?:string}} opts
 *   direction 省略时按余额变化自动判断：after > before 视为「存入」。
 * @returns {Promise<void>} 动画与展示结束后 resolve
 */
export function playCashAnimation(opts = {}) {
  const amountCents = Math.round(Number(opts.amountCents) || 0);
  const beforeCents = Math.round(Number(opts.beforeCents) || 0);
  const afterCents = Math.round(Number(opts.afterCents) || 0);
  // 余额变大说明这笔钱在「进入」钱包（调高生活费、把存下的钱放回预算），
  // 变小说明是消费。方向决定动画与文案，不靠调用方自己声明。
  const isDeposit = opts.direction === 'in'
    ? true : opts.direction === 'out' ? false : afterCents > beforeCents;
  const sign = isDeposit ? '+' : '-';
  const name = opts.title || (isDeposit ? '这笔钱进入钱包' : '这笔消费');

  const host = overlayHost();
  const previouslyFocused = document.activeElement;

  return new Promise((resolve) => {
    let settled = false;
    let autoTimer = 0;
    let tickTimer = 0;

    const backdrop = document.createElement('div');
    backdrop.className = 'cash-overlay';

    const card = document.createElement('div');
    card.className = 'cash-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');

    /* ---------- 顶部：这是什么钱 ---------- */
    const head = document.createElement('div');
    head.className = 'cash-head';
    const kicker = document.createElement('span');
    kicker.className = 'cash-kicker';
    kicker.textContent = isDeposit ? '这笔钱进入钱包' : '消费记录成功';
    head.appendChild(kicker);
    const title = document.createElement('span');
    title.className = 'cash-title';
    title.textContent = opts.title
      ? `${opts.title}${opts.categoryLabel ? ' · ' + opts.categoryLabel : ''}`
      : (isDeposit ? '存入' : '本笔消费');
    head.appendChild(title);
    const amountEl = document.createElement('span');
    amountEl.className = `cash-amount${isDeposit ? ' is-plus' : ''}`;
    amountEl.textContent = `${sign}${formatAmount(amountCents)}`;
    head.appendChild(amountEl);
    card.appendChild(head);

    /* ---------- 中间：钱包本体（覆盖层里用紧凑尺寸） ---------- */
    const walletRow = document.createElement('div');
    walletRow.className = 'cash-wallet';
    const stage = document.createElement('div');
    stage.className = 'cash-stage cash-stage-compact';
    const wallet = buildWallet({
      balanceCents: beforeCents,
      compact: true,
      showComposition: false,
    });
    stage.appendChild(wallet.wrap);
    walletRow.appendChild(stage);
    card.appendChild(walletRow);

    /* ---------- 钱包下面：只留一条给读屏软件的构成 ---------- */
    const composition = document.createElement('p');
    // 构成说明只留给读屏软件：这一屏视觉上只要钱包与飞出去/飞回来的钞票。
    // 「钱包里有哪些面额」对读屏用户仍是有效信息，所以不是删掉而是转成 sr-only。
    composition.className = 'cash-composition sr-only';
    composition.hidden = true;
    card.appendChild(composition);

    /* ---------- 底部：进度条 + 跳过/完成 ---------- */
    const foot = document.createElement('div');
    foot.className = 'cash-foot';
    const timeline = document.createElement('div');
    timeline.className = 'cash-timeline';
    const fill = document.createElement('div');
    fill.className = 'cash-timeline-fill';
    timeline.appendChild(fill);
    foot.appendChild(timeline);
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn btn-ghost';
    action.textContent = '跳过动画';
    foot.appendChild(action);
    card.appendChild(foot);

    backdrop.appendChild(card);
    host.appendChild(backdrop);
    document.body.classList.add('has-cash-overlay');

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(autoTimer);
      clearInterval(tickTimer);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-cash-overlay');
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      wallet.destroy();
      if (previouslyFocused && previouslyFocused.focus) {
        try {
          previouslyFocused.focus();
        } catch {
          /* 原焦点元素已经被换掉了，没什么可归还的 */
        }
      }
      resolve();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
        return;
      }
      // 覆盖层里只有一个可操作元素：把 Tab 锁在它身上，键盘用户不会掉进背后的页面。
      if (e.key === 'Tab') {
        e.preventDefault();
        action.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) finish();
    });
    action.addEventListener('click', finish);

    // 进度条只是示意：动画真正结束与否由 runClosable 决定，这里只让它别停在 0。
    let progress = 6;
    const startTimeline = () => {
      fill.style.width = `${progress}%`;
      tickTimer = setInterval(() => {
        progress = Math.min(88, progress + 7);
        fill.style.width = `${progress}%`;
      }, 170);
    };

    const showResult = () => {
      clearInterval(tickTimer);
      fill.style.width = '100%';
      if (afterCents > 0) {
        composition.textContent = `钱包里：${describeComposition(afterCents)}`;
        composition.hidden = false;
      }
      action.textContent = '完成';
      if (action.focus) action.focus();
      autoTimer = setTimeout(finish, reducedMotion() ? 1400 : 1800);
    };

    action.focus?.();

    if (reducedMotion()) {
      // 减少动态效果：不飞钞票、不滚数字，直接把结果摆出来。
      wallet.setBalance(afterCents, { animate: false, from: beforeCents });
      fill.style.width = '100%';
      showResult();
      return;
    }

    startTimeline();
    // 先播钱包动画（消费 = 抽出这笔钱本身的钞票；存入 = 钞票逐张落进），
    // 再播余额滚动；两步都受 runClosable 兜底保护。
    const play = isDeposit
          ? wallet.income(amountCents, { updateBalance: false })
          : wallet.spend(amountCents, { updateBalance: false });
    play
      .then(() => wallet.setBalance(afterCents, { animate: true, from: beforeCents }))
      .catch((err) => {
        console.warn('现金动画异常，直接展示结果：', err);
        try {
          wallet.setBalance(afterCents, { animate: false, from: beforeCents });
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
