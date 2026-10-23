/**
 * add-view.js —— 记一笔。
 *
 * 流程是「先填、再看、最后确认」：数据只有在确认之后才写进去。
 * 取消、关闭模态、按 ESC 都等于没发生，余额一分不会动。
 * 余额不足只提醒，不阻止——真实花掉的钱必须能记下来。
 */

import { card, emptyState, meter } from '../ui/common.js';
import { field, moneyField, selectField, toggleField, categoryChips, submitGuard, formErrorBox, button, todayInputValue } from '../ui/form.js';
import { openModal } from '../ui/modal.js';
import { buildWallet } from '../ui/wallet.js';
import { playCashAnimation } from '../ui/overlay.js';
import { icon } from '../ui/icons.js';
import { CATEGORIES } from '../core/budget.js';
import { spendBills } from '../core/notes.js';
import { formatAmount, parseAmountToCents, toPercent, percentText } from '../core/money.js';

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** 确认页里的小格子（.confirm-grid > .confirm-cell） */
function confirmCell(label, value, kind) {
  const cell = el('div', `confirm-cell${kind ? ' is-' + kind : ''}`);
  cell.appendChild(el('span', null, label));
  cell.appendChild(el('b', null, value));
  return cell;
}

/**
 * 消费感知确认：把这笔钱离开钱包之后的样子摆在你面前。
 * @param {{amountCents:number, title:string, category:string, date:string,
 *            note:string, isNonEssential:boolean}} draft
 * @param {object} ctx
 * @returns {Promise<boolean>} true = 确认并记录
 */
export function openRecordConfirm(draft, ctx) {
  const view = ctx.getBudgetView();
  const before = view.balanceCents;
  const after = before - draft.amountCents;
  const spentAfter = view.monthSpentCents + draft.amountCents;
  const leftAfter = view.remainingCents - draft.amountCents;
  const share = view.monthlyFeeCents > 0 ? draft.amountCents / view.monthlyFeeCents : 0;
  const label = ctx.categoryLabel(draft.category);

  const body = el('div');

  // 顶部：这笔钱是什么、多少钱
  const top = el('div', 'confirm-top');
  top.appendChild(el('span', 'confirm-name', draft.title));
  top.appendChild(el('span', 'confirm-meta', `${label} · ${draft.date}${draft.isNonEssential ? ' · 非必需' : ''}`));
  top.appendChild(el('span', 'confirm-amt', `-${formatAmount(draft.amountCents)}`));
  body.appendChild(top);

  // 中间：一只钱包。堆里参与这笔的那几种面额就是「这笔要动的钱」，不再另摆一层示意。
  // 收起时它们和别的钞票一样塞在袋口里；鼠标放上去这几张抬回原位（= 先飞出去一半），
  // 不再摆「消费前 / 消费后」两只小钱包：挤在一起太乱，而且小到你看不出差别。
  // 点确认之后这几张整个飞出去；找回属于钱包内部重新数一遍，不演成飞回来。
  const stage = el('div', 'cash-stage');
  const wallet = buildWallet({ balanceCents: before, showComposition: true });
  stage.appendChild(wallet.wrap);
  // 要动哪几张由这笔钱自己决定：花了多少就按这笔钱的最少张数拆法去抽。
  // 不再看钱包新旧构成的差 —— 那会把本来不花的整沓也算成「要动的钱」，
  // 于是你花 98 元却看见好几张 ¥100 一起展开。
  wallet.setTransaction(draft.amountCents);
  body.appendChild(stage);

  const note = el('p', 'compare-note', `放在钱包上，要动的那几张会抬起来给你看；点确认之后它们整个飞出去。确认之后：可支配余额 ${formatAmount(before)} 元 → ${formatAmount(after)} 元。`);
  body.appendChild(note);

  if (after < 0) {
    const warn = el('p', 'live-preview is-warn', '余额会不足，但这笔消费是真实发生的，触钱不会阻止你记录它。');
    body.appendChild(warn);
  }

  // 下面：本月口径的四个数字，确认前再看一遍
  const grid = el('div', 'confirm-grid');
  grid.appendChild(confirmCell('本月初始生活费', `${formatAmount(view.monthlyFeeCents)} 元`, 'fee'));
  grid.appendChild(confirmCell('本月已消费（含这笔）', `${formatAmount(spentAfter)} 元`, 'spent'));
  grid.appendChild(confirmCell('本月剩余预算（含这笔）', `${formatAmount(leftAfter)} 元`, 'left'));
  grid.appendChild(confirmCell('当前可支配余额', `${formatAmount(after)} 元`, 'balance'));
  body.appendChild(grid);

  // 这笔占本月生活费的百分之几：用条表示，比纯数字好读
  const shareBar = meter(share, {
    label: `本笔占本月初始生活费（${formatAmount(view.monthlyFeeCents)} 元）的 ${percentText(toPercent(draft.amountCents, view.monthlyFeeCents))}%`,
    detail: `${formatAmount(draft.amountCents)} 元`,
  });
  shareBar.wrap.style.marginTop = '14px';
  body.appendChild(shareBar.wrap);
  body.appendChild(el('p', 'share-note', '确认之后才会写进记录；返回修改或关掉这个窗口，余额都不会变。'));

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // 模态一关（无论什么方式）都要拆掉钱包，别留下悬空动画定时器
    const cleanup = () => {
      try {
        wallet.destroy();
      } catch (err) {
        console.warn('钱包清理失败：', err);
      }
    };

    openModal({
      title: '确认这笔消费',
      sub: '先看清楚这笔钱离开钱包之后的样子，再决定要不要记下来。',
      body,
      wide: true,
      onClose: () => { cleanup(); settle(false); },
      buttons: [
        { text: '返回修改', kind: 'ghost', onClick: (h) => { settle(false); h.close('back'); } },
        { text: '确认并记录', kind: 'primary', onClick: (h) => { settle(true); h.close('confirm'); } },
      ],
    });
  });
}

export function renderAddView(content, ctx) {
  const state = ctx.getState();
  if (!ctx.isConfigured()) {
    const intro = card({
      title: '先设定每月生活费',
      sub: '有了基准，「记一笔」才知道这笔钱占了多少预算。',
    });
    intro.body.appendChild(emptyState(
      '你还没设过生活费。设好之后再来记账，这里会实时显示消费后的余额。',
      button('去设定生活费', { kind: 'primary', icon: 'coin', onClick: () => ctx.navigate('budget') }),
      'coin',
    ));
    content.appendChild(intro.section);
    return;
  }

  const view = ctx.getBudgetView();

  /* ---------------- 左边：填这笔消费 ---------------- */
  const amount = moneyField({
    label: '金额（元）',
    placeholder: '18.00',
    hint: '支持两位小数。金额以「分」保存，不会因为浮点数丢掉零头。',
  });
  amount.wrap.classList.add('field-amount');
  const title = field({ label: '这笔钱花在哪', maxlength: 40, placeholder: '楼下便利店' });
  const chips = categoryChips({
    label: '分类',
    categories: CATEGORIES,
    value: 'food',
  });
  const date = field({ label: '日期', type: 'date', value: todayInputValue() });
  date.input.max = todayInputValue();
  const note = field({ label: '备注', type: 'textarea', maxlength: 120, optionalLabel: '可留空', placeholder: '和同学拼的单。' });
  const nonEssential = toggleField({
    label: '这笔不是必需的',
    hint: '标上它，统计里会单独算「非必需支出」，余额不受影响。',
  });

  const form = el('form', 'form');
  form.noValidate = true;
  form.append(amount.wrap, title.wrap, chips.wrap, date.wrap, note.wrap, nonEssential.wrap);
  const error = formErrorBox();
  form.appendChild(error.el);

  const submit = button('下一步：确认这笔消费', { kind: 'primary', icon: 'arrowRight', type: 'submit', block: true });
  const reset = button('清空', { kind: 'plain', icon: 'close', type: 'button' });
  const actions = el('div', 'btn-row');
  actions.style.marginTop = '4px';
  actions.classList.add('sticky-actions');
  actions.append(submit, reset);
  form.appendChild(actions);

  const formCard = card({
    title: '这笔消费',
    sub: '金额和名称是必填的，其他都可以先放着。',
  });
  formCard.body.appendChild(form);
  // 宽屏时表单在左、实时预览在右（.split 在 ≤1040px 自动变单列）；
  // 这里先只建容器，等 previewCard 建好再一起挂进 content。
  const split = el('div', 'split');

  /* ---------------- 右边：这笔钱离开钱包之后的样子 ---------------- */
  const previewCard = card({ title: '确认之前，先看一眼', headingLevel: 3 });
  const compare = el('div', 'compare');
  compare.style.margin = '0 0 14px';
  const colBefore = el('div', 'compare-col');
  colBefore.appendChild(el('span', 'compare-label', '现在'));
  const beforeValue = el('b', 'stat-value', formatAmount(view.balanceCents));
  colBefore.appendChild(beforeValue);
  compare.appendChild(colBefore);
  const arrow = el('span', 'compare-arrow');
  arrow.appendChild(icon('arrowRight', { size: 18 }));
  compare.appendChild(arrow);
  const colAfter = el('div', 'compare-col compare-after');
  colAfter.appendChild(el('span', 'compare-label', '这笔之后'));
  const afterValue = el('b', 'stat-value', formatAmount(view.balanceCents));
  colAfter.appendChild(afterValue);
  compare.appendChild(colAfter);
  previewCard.body.appendChild(compare);

  const live = el('p', 'live-preview', '');
  previewCard.body.appendChild(live);

  const budgetMeter = meter(view.usedRatio, {
    label: '本月预算使用',
    detail: `${percentText(toPercent(view.monthSpentCents, view.monthlyFeeCents))}%`,
    note: `本月初始生活费 ${formatAmount(view.monthlyFeeCents)} 元 · 已消费 ${formatAmount(view.monthSpentCents)} 元 · 剩余 ${formatAmount(view.remainingCents)} 元`,
  });
  budgetMeter.wrap.style.marginTop = '14px';
  previewCard.body.appendChild(budgetMeter.wrap);

  const hint = el('p', 'field-hint', '输入金额后，这里会实时显示消费后的余额与预算。它只是预览，不会写进任何数据。');
  hint.style.marginTop = '12px';
  previewCard.body.appendChild(hint);

  split.append(formCard.section, previewCard.section);
  content.appendChild(split);

  /** 金额一变就重算预览：口径和确认页完全一致，避免「预览和确认不一样」 */
  function renderPreview() {
    const parsed = parseAmountToCents(amount.getValue());
    if (!parsed.ok) {
      afterValue.textContent = formatAmount(view.balanceCents);
      live.classList.remove('is-warn', 'is-danger');
      live.textContent = '输入一个有效金额之后，这里会告诉你这笔钱花掉之后还剩多少。';
      budgetMeter.setRatio(view.usedRatio);
      return;
    }
    const after = view.balanceCents - parsed.cents;
    const spent = view.monthSpentCents + parsed.cents;
    const left = view.remainingCents - parsed.cents;
    beforeValue.textContent = formatAmount(view.balanceCents);
    afterValue.textContent = formatAmount(after);
    budgetMeter.setRatio(view.monthlyFeeCents > 0 ? spent / view.monthlyFeeCents : 0);
    live.classList.remove('is-warn', 'is-danger');
    if (after < 0) {
      live.classList.add('is-danger');
      live.textContent = `余额会不足 ${formatAmount(-after)} 元。这笔钱你已经花出去了，触钱照样让你记下来。`;
    } else if (left < 0) {
      live.classList.add('is-warn');
      live.textContent = `本月预算会用超 ${formatAmount(-left)} 元，余额还有 ${formatAmount(after)} 元（带着往期的结余）。`;
    } else {
      live.textContent = `本月已消费 ${formatAmount(view.monthSpentCents)} → ${formatAmount(spent)} 元 · 剩余预算 ${formatAmount(view.remainingCents)} → ${formatAmount(left)} 元`;
    }
  }
  amount.input.addEventListener('input', renderPreview);
  renderPreview();

  /* ---------------- 提交 ---------------- */
  const onSubmit = submitGuard(async (event) => {
    event.preventDefault();
    error.hide();

    const parsed = parseAmountToCents(amount.getValue());
    if (!parsed.ok) { amount.setError(parsed.error); amount.input.focus(); return; }
    if (!title.input.value.trim()) { title.setError('给它起个名字，日后才认得出来'); title.input.focus(); return; }
    if (!date.input.value) { date.setError('选一个日期'); date.input.focus(); return; }

    const draft = {
      amountCents: parsed.cents,
      title: title.input.value.trim(),
      category: chips.getValue(),
      date: date.input.value,
      note: note.input.value.trim(),
      isNonEssential: nonEssential.input.checked,
    };

    submit.disabled = true;
    submit.textContent = '正在确认…';
    let confirmed = false;
    try {
      confirmed = await openRecordConfirm(draft, ctx);
    } finally {
      submit.disabled = false;
      submit.textContent = '下一步：确认这笔消费';
    }
    if (!confirmed) return;

    const result = ctx.actions.addRecord({
      amount: draft.amountCents,
      title: draft.title,
      category: draft.category,
      date: draft.date,
      note: draft.note,
      isNonEssential: draft.isNonEssential,
    });
    if (!result || !result.ok) {
      error.show((result && result.error) || '保存失败，这笔消费没有写进去。');
      return;
    }

    // 数据已经落库，动画只是让人「看见」；动画失败也不影响这笔账。
    const after = view.balanceCents - draft.amountCents;
    await playCashAnimation({
      amountCents: draft.amountCents,
      beforeCents: view.balanceCents,
      afterCents: after,
      title: draft.title,
      categoryLabel: ctx.categoryLabel(draft.category),
      direction: 'out',
    });
    ctx.toastSuccess(`已记录：${draft.title} ${formatAmount(draft.amountCents)} 元 · 余额 ${formatAmount(after)} 元`);
    ctx.navigate('wallet');
  });

  form.addEventListener('submit', onSubmit);

  reset.addEventListener('click', () => {
    form.reset();
    chips.setValue('food');
    nonEssential.renderState();
    amount.clearError();
    title.clearError();
    date.clearError();
    error.hide();
    date.input.value = todayInputValue();
    renderPreview();
    amount.input.focus();
  });

  amount.input.focus();
}
