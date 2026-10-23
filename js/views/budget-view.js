/**
 * budget-view.js —— 生活费管理：初始生活费、预算周期、结余结转、提醒阈值。
 *
 * 四个数字永远分开放：本月初始生活费 / 本月累计消费 / 本月剩余预算 / 当前可支配余额。
 * 改生活费时先预览余额怎么变，确认之后才写入，绝不静默覆盖；
 * 所有消费记录保留，往期各期的生活费与统计不受影响。
 */

import { humanPeriod, periodRange, normalizeCycleDay } from '../core/dates.js';
import { formatAmount, parseAmountToCents, toPercent, percentText } from '../core/money.js';
import { earliestPeriodKey, feeForPeriod } from '../core/budget.js';
import { card, emptyState, linkButton, detailCell, meter } from '../ui/common.js';
import { moneyField, field, selectField, toggleField, button, formErrorBox } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';
import { playCashAnimation } from '../ui/overlay.js';

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** '2026-10' → '2026 年 10 月' */
function formatPeriodKey(key) {
  const [y, m] = String(key).split('-');
  return `${y} 年 ${Number(m)} 月`;
}

/** 结转金额带正负号写清楚，别把「-300」看成「减 300」 */
function carryText(cents) {
  if (cents === 0) return '0.00 元';
  // 数字口径与同一张卡里的其他金额一致：不带 ¥，符号表意（带进本期的是正数）
  return `${cents < 0 ? '-' : '+'}${formatAmount(Math.abs(cents))} 元`;
}

export function renderBudgetView(content, ctx) {
  const state = ctx.getState();
  const settings = state.settings;
  const view = ctx.getBudgetView();

  const split = el('div', 'split');
  const left = el('div');
  const right = el('div');
  split.append(left, right);
  content.appendChild(split);

  /* ---------------- 现在的情况：四个数字各归其位 ---------------- */
  const nowCard = card({
    title: '现在的情况',
    sub: '这四个数字口径不同，把它们分开看，才不会把「还剩多少」想错。',
    action: linkButton('看统计', () => ctx.navigate('stats')),
  });
  const list = el('dl', 'detail-list');
  list.appendChild(detailCell('本月初始生活费', `${formatAmount(view.monthlyFeeCents)} 元`, 'fee', '这个周期你给自己多少钱'));
  list.appendChild(detailCell('本月累计消费', `${formatAmount(view.monthSpentCents)} 元`, 'spent', '只算本周期内的消费'));
  list.appendChild(detailCell('本月剩余预算', `${formatAmount(view.remainingCents)} 元`, 'left', '初始生活费 − 本期消费'));
  list.appendChild(detailCell('当前可支配余额', `${formatAmount(view.balanceCents)} 元`, 'balance', settings.carryOver === false ? '关闭结转时等于本期剩余预算' : '本期剩余 + 往期滚存的结余'));
  list.appendChild(detailCell('上一期结转', carryText(view.carryInCents), 'carry', settings.carryOver === false ? '结转已关闭，本期不受往期影响' : '往期剩下的钱会带进本期'));
  nowCard.body.appendChild(list);

  const budgetMeter = meter(view.usedRatio, {
    label: '本月预算使用',
    detail: `${percentText(toPercent(view.monthSpentCents, view.monthlyFeeCents))}%`,
    note: view.monthlyFeeCents > 0
      ? `已消费 ${formatAmount(view.monthSpentCents)} 元 / 初始生活费 ${formatAmount(view.monthlyFeeCents)} 元`
      : '还没设过生活费，设好之后这里才有比例。',
  });
  budgetMeter.wrap.style.marginTop = '16px';
  nowCard.body.appendChild(budgetMeter.wrap);
  nowCard.body.appendChild(el('p', 'detail-note',
    `当前预算周期：${humanPeriod(view.periodStart, view.cycleDay)} · 周期起始日：每月 ${view.cycleDay} 日`
    + (view.carryOver ? ' · 开启结余结转' : ' · 关闭结余结转')
    + ' · 日期按本地时区计算，不用 UTC。'));
  left.appendChild(nowCard.section);

  /* ---------------- 各周期明细 ---------------- */
  const periodsCard = card({ title: '各周期明细', sub: '最近 12 个周期。跨月之后，往期数据留在这里，不会被抹掉。' });
  const startKey = earliestPeriodKey(settings, state.records);
  const keys = periodRange(startKey, view.periodKey).slice(-12);
  if (!keys.length) {
    periodsCard.body.appendChild(emptyState('还没有任何周期数据。设好生活费、记第一笔之后，这里就会列出每一期的收支。', null, 'chart'));
  } else {
    const table = el('table', 'period-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const label of ['周期', '初始生活费', '本期消费', '本期结余']) {
      const th = el('th');
      th.scope = 'col';
      th.textContent = label;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const key of keys) {
      const tr = el('tr', key === view.periodKey ? 'is-current' : '');
      const fee = feeForPeriod(settings, key);
      const spent = view.spentByPeriod.get(key) || 0;
      const rest = fee - spent;
      const rowHead = el('th');
      rowHead.scope = 'row';
      rowHead.textContent = key === view.periodKey ? `${formatPeriodKey(key)}（本期）` : formatPeriodKey(key);
      tr.appendChild(rowHead);
      const cells = [`¥${formatAmount(fee)} 元`, `¥${formatAmount(spent)} 元`, `¥${formatAmount(rest)} 元`];
      cells.forEach((text, i) => {
        const td = el('td', i === 2 && rest < 0 ? 'is-negative' : '');
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // 表格比卡片宽时让它在自己内部滑动，不把整页撑宽；tabindex + role 让键盘也能滚。
    const scroller = el('div', 'table-wrap');
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', '各周期明细（表格较宽时可左右滑动）');
    scroller.appendChild(table);
    periodsCard.body.appendChild(scroller);
    periodsCard.body.appendChild(el('p', 'muted-note',
      '「本期结余」= 该期初始生活费 − 该期消费。开启结转时，这些结余会一路滚进当前可支配余额；关闭结转时，余额只由本期决定。'));
  }
  left.appendChild(periodsCard.section);

  /* ---------------- 修改本月初始生活费 ---------------- */
  const feeCard = card({
    title: '修改本月初始生活费',
    sub: '只改本周期。往期各期的生活费与所有消费记录都保留，余额按差额同步调整。',
  });
  const feeField = moneyField({
    label: '本月初始生活费（元）',
    value: (view.monthlyFeeCents / 100).toFixed(2),
    hint: '例如 2000 或 1850.50。设成 0 表示这个周期没有固定生活费，只跟着消费走。',
  });
  feeCard.body.appendChild(feeField.wrap);

  const previewBox = el('div', 'live-preview');
  const previewText = el('p');
  previewBox.appendChild(previewText);
  feeCard.body.appendChild(previewBox);

  const feeErr = formErrorBox();
  feeCard.body.appendChild(feeErr.el);

  const saveFee = button('保存新的生活费', { kind: 'primary', icon: 'check', block: true });
  feeCard.body.appendChild(saveFee);

  /** 边输入边算：余额会从多少变到多少，差额是多少 */
  function renderFeePreview() {
    const parsed = parseAmountToCents(feeField.getValue());
    if (!parsed.ok) {
      previewText.textContent = `当前余额 ¥${formatAmount(view.balanceCents)} 元 · 输入新的生活费后，这里会显示余额怎么变。`;
      previewBox.classList.remove('is-warn', 'is-danger');
      return null;
    }
    const preview = ctx.actions.getFeePreview(parsed.cents);
    const sign = preview.delta > 0 ? '+' : preview.delta < 0 ? '-' : '';
    previewText.textContent =
      `当前可支配余额：¥${formatAmount(preview.before)} 元 → ¥${formatAmount(preview.after)} 元`
      + `（${sign}¥${formatAmount(Math.abs(preview.delta))} 元）`
      + ` · 本月初始生活费 ¥${formatAmount(view.monthlyFeeCents)} 元 → ¥${formatAmount(parsed.cents)} 元`;
    previewBox.classList.toggle('is-danger', preview.after < 0);
    previewBox.classList.toggle('is-warn', preview.after >= 0 && parsed.cents < view.monthSpentCents);
    return { parsed, preview };
  }
  feeField.input.addEventListener('input', renderFeePreview);
  renderFeePreview();

  saveFee.addEventListener('click', async () => {
    feeField.clearError();
    feeErr.hide();
    const result = renderFeePreview();
    if (!result) {
      feeField.setError('请输入有效的金额');
      feeField.input.focus();
      return;
    }
    const { parsed, preview } = result;
    if (parsed.cents === view.monthlyFeeCents) {
      ctx.toastWarn('生活费没有变化');
      return;
    }
    const ok = await confirmDialog({
      title: '调整本月初始生活费？',
      message: `本月初始生活费：¥${formatAmount(view.monthlyFeeCents)} 元 → ¥${formatAmount(parsed.cents)} 元`,
      detail:
        `当前可支配余额会同步从 ¥${formatAmount(preview.before)} 元变为 ¥${formatAmount(preview.after)} 元`
        + `（${preview.delta >= 0 ? '增加' : '减少'} ¥${formatAmount(Math.abs(preview.delta))} 元）。`
        + '所有消费记录都会保留，往期的生活费与统计不受影响。',
      confirmText: '确认调整',
      cancelText: '取消',
    });
    if (!ok) return;

    const res = ctx.actions.setMonthlyFee(parsed.cents);
    if (!res || !res.ok) {
      feeErr.show((res && res.error) || '保存失败。');
      return;
    }
    const afterCents = ctx.getBudgetView().balanceCents;
    ctx.toastSuccess(`本月初始生活费已设为 ¥${formatAmount(parsed.cents)} 元 · 余额 ¥${formatAmount(afterCents)} 元`);
    // 让这笔调整「看得见」：调高生活费钞票逐张落进钱包，调低则逐张抽出。
    await playCashAnimation({
      amountCents: Math.abs(preview.delta),
      beforeCents: preview.before,
      afterCents,
      title: '本月初始生活费',
      direction: preview.delta > 0 ? 'in' : 'out',
      resultNote: `初始生活费：¥${formatAmount(view.monthlyFeeCents)} 元 → ¥${formatAmount(parsed.cents)} 元 · 所有消费记录都保留，往期各期不受影响。`,
    });
  });
  right.appendChild(feeCard.section);

  /* ---------------- 周期与结转 ---------------- */
  const cycleCard = card({ title: '预算周期与结余' });
  const dayOptions = [];
  for (let d = 1; d <= 28; d += 1) dayOptions.push({ value: String(d), label: `每月 ${d} 日` });
  const cycleSelect = selectField({
    label: '周期起始日',
    value: String(normalizeCycleDay(settings.cycleDay)),
    options: dayOptions,
    hint: '选 1 日就是自然月。生活费每月 10 号到账，就把起始日设为 10 日，统计跟着你的实际节奏走。',
  });
  cycleSelect.select.addEventListener('change', () => {
    const res = ctx.actions.setCycleDay(Number(cycleSelect.select.value));
    if (!res || !res.ok) { ctx.toastError((res && res.error) || '设置失败。'); return; }
    ctx.toastSuccess(`预算周期已改为每月 ${res.cycleDay} 日起`);
  });
  cycleCard.body.appendChild(cycleSelect.wrap);

  const carryToggle = toggleField({
    label: '把上一期的结余（或透支）带到本期',
    hint: '开启后：当前可支配余额 = 各期初始生活费之和 − 全部历史消费。关闭后：余额只由本期决定。两种模式下「本月剩余预算」都只看本期。',
    checked: settings.carryOver !== false,
    onChange: (on) => {
      ctx.actions.setCarryOver(on);
      ctx.toastSuccess(on ? '已开启结余结转' : '已关闭结余结转');
    },
  });
  cycleCard.body.appendChild(carryToggle.wrap);
  right.appendChild(cycleCard.section);

  /* ---------------- 预算提醒 ---------------- */
  const remindCard = card({ title: '预算提醒' });
  remindCard.body.appendChild(el('p', 'field-hint', '本周期消费比例跨过阈值时，页面顶部会温和地提示一次，之后同一阈值不再重复打扰。触钱不会因此阻止你记账。'));
  const remindField = field({
    label: '提醒阈值（%）',
    type: 'text',
    inputmode: 'numeric',
    value: String(settings.reminderPercent || 0),
    hint: '填 0 表示不提醒；填 80 就是消费达到本周期生活费的 80% 时提示。',
  });
  remindCard.body.appendChild(remindField.wrap);
  const saveRemind = button('保存提醒阈值', { kind: 'ghost', icon: 'bell' });
  remindCard.body.appendChild(saveRemind);

  saveRemind.addEventListener('click', () => {
    const n = Math.round(Number(remindField.input.value));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      remindField.setError('请输入 0–100 之间的整数');
      remindField.input.focus();
      return;
    }
    const res = ctx.actions.setReminderPercent(n);
    if (!res || !res.ok) {
      remindField.setError((res && res.error) || '设置失败。');
      return;
    }
    ctx.toastSuccess(n === 0 ? '已关闭预算提醒' : `将在本周期消费达到 ${n}% 时提醒你`);
  });
  right.appendChild(remindCard.section);
}
