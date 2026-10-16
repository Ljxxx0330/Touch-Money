/**
 * budget-view.js —— 生活费管理：初始生活费、预算周期、结余结转、提醒阈值。
 * 改生活费时先预览余额怎么变，确认后才写入，绝不静默覆盖。
 */

import { humanPeriod, periodRange, normalizeCycleDay } from '../core/dates.js';
import { formatAmount, parseAmountToCents } from '../core/money.js';
import { earliestPeriodKey, feeForPeriod } from '../core/budget.js';
import { card, emptyState, linkButton } from '../ui/common.js';
import { field, selectField, toggleField, button, formErrorBox } from '../ui/form.js';
import { confirmDialog } from '../ui/modal.js';

export function renderBudgetView(container, ctx) {
  const state = ctx.getState();
  const settings = state.settings;
  const view = ctx.getBudgetView();
  const frag = document.createDocumentFragment();

  /* ---------- 四个概念的现值 ---------- */
  const nowCard = card({
    title: '现在的情况',
    action: linkButton('看统计', () => ctx.navigate('stats')),
  });
  const grid = document.createElement('dl');
  grid.className = 'detail-grid';
  grid.appendChild(detailItem('本月初始生活费', `¥${formatAmount(view.monthlyFeeCents)}`));
  grid.appendChild(detailItem('本月累计消费', `¥${formatAmount(view.monthSpentCents)}`));
  grid.appendChild(detailItem('本月剩余预算', `¥${formatAmount(view.remainingCents)}`, view.remainingCents < 0));
  grid.appendChild(detailItem('当前可支配余额', `¥${formatAmount(view.balanceCents)}`, view.balanceCents < 0));
  grid.appendChild(
    detailItem(
      '上一期结转',
      `${view.carryInCents < 0 ? '-' : ''}¥${formatAmount(Math.abs(view.carryInCents))}`,
      view.carryInCents < 0,
    ),
  );
  nowCard.body.appendChild(grid);
  const periodNote = document.createElement('p');
  periodNote.className = 'muted-note';
  periodNote.textContent =
    `当前预算周期：${humanPeriod(view.periodStart, view.cycleDay)} · 周期起始日：每月 ${view.cycleDay} 日` +
    (view.carryOver ? ' · 开启结余结转' : ' · 关闭结余结转');
  nowCard.body.appendChild(periodNote);
  frag.appendChild(nowCard.section);

  /* ---------- 修改本月初始生活费 ---------- */
  const feeCard = card({ title: '修改本月初始生活费' });
  const feeIntro = document.createElement('p');
  feeIntro.className = 'field-hint';
  feeIntro.textContent =
    '这里改的只是「本周期」的初始生活费。往期各期的生活费与消费记录都会保留，余额按差额同步调整。';
  feeCard.body.appendChild(feeIntro);

  const feeField = field({
    label: '本月初始生活费（元）',
    type: 'text',
    inputmode: 'decimal',
    value: formatAmount(view.monthlyFeeCents),
    required: true,
  });
  feeCard.body.appendChild(feeField.wrap);

  const previewBox = document.createElement('div');
  previewBox.className = 'live-preview';
  const previewText = document.createElement('p');
  previewText.className = 'live-preview-text';
  previewBox.appendChild(previewText);
  feeCard.body.appendChild(previewBox);

  const feeErr = formErrorBox();
  feeCard.body.appendChild(feeErr.el);

  const feeRow = document.createElement('div');
  feeRow.className = 'btn-row';
  const saveFee = button('保存新的生活费', { kind: 'primary' });
  feeRow.appendChild(saveFee);
  feeCard.body.appendChild(feeRow);

  function renderFeePreview() {
    const parsed = parseAmountToCents(feeField.input.value);
    if (!parsed.ok) {
      previewText.textContent = `当前余额 ¥${formatAmount(view.balanceCents)} · 输入新的生活费后这里会显示余额怎么变`;
      return null;
    }
    const preview = ctx.actions.getFeePreview(parsed.cents);
    const sign = preview.delta > 0 ? '+' : preview.delta < 0 ? '-' : '';
    previewText.textContent =
      `余额：¥${formatAmount(preview.before)} → ¥${formatAmount(preview.after)}` +
      ` （${sign}¥${formatAmount(Math.abs(preview.delta))}）`;
    previewBox.classList.toggle('is-negative', preview.after < 0);
    return { parsed, preview };
  }

  feeField.input.addEventListener('input', renderFeePreview);
  renderFeePreview();

  saveFee.addEventListener('click', async () => {
    feeField.clearError();
    feeErr.show('');
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
      message: `本月初始生活费：¥${formatAmount(view.monthlyFeeCents)} → ¥${formatAmount(parsed.cents)}`,
      detail:
        `当前可支配余额会同步从 ¥${formatAmount(preview.before)} 变为 ¥${formatAmount(preview.after)}` +
        `（${preview.delta >= 0 ? '增加' : '减少'} ¥${formatAmount(Math.abs(preview.delta))}）。` +
        '所有消费记录都会保留，往期的生活费与统计不受影响。',
      confirmText: '确认调整',
      cancelText: '取消',
    });
    if (!ok) return;
    const res = ctx.actions.setMonthlyFee(parsed.cents);
    if (!res.ok) {
      feeErr.show(res.error);
      return;
    }
    ctx.toastSuccess(
      `本月初始生活费已设为 ¥${formatAmount(parsed.cents)} · 余额 ¥${formatAmount(ctx.getBudgetView().balanceCents)}`,
    );
  });

  frag.appendChild(feeCard.section);

  /* ---------- 周期与结转 ---------- */
  const cycleCard = card({ title: '预算周期与结余' });

  const dayOptions = [];
  for (let d = 1; d <= 28; d += 1) dayOptions.push({ value: String(d), label: `每月 ${d} 日` });
  const cycleSelect = selectField({
    label: '周期起始日',
    value: String(normalizeCycleDay(settings.cycleDay)),
    options: dayOptions,
    hint: '选 1 日就是自然月。如果生活费每月 10 号到账，就把周期起始日设为 10 日，统计会跟着你的实际节奏走。',
  });
  cycleSelect.select.addEventListener('change', () => {
    const res = ctx.actions.setCycleDay(Number(cycleSelect.select.value));
    if (!res.ok) {
      ctx.toastError(res.error);
      return;
    }
    ctx.toastSuccess(`预算周期已改为每月 ${res.cycleDay} 日起`);
  });
  cycleCard.body.appendChild(cycleSelect.wrap);

  const carryToggle = toggleField({
    label: '把上一期的结余（或透支）带到本期',
    hint: '开启后：当前可支配余额 = 各期初始生活费之和 − 全部历史消费。关闭后：余额只由本期决定。两种模式下「本月剩余预算」的定义不变，都只看本期。',
    checked: settings.carryOver !== false,
    onChange: (on) => {
      ctx.actions.setCarryOver(on);
      ctx.toastSuccess(on ? '已开启结余结转' : '已关闭结余结转');
    },
    onText: '已开启',
    offText: '已关闭',
  });
  cycleCard.body.appendChild(carryToggle.wrap);
  frag.appendChild(cycleCard.section);

  /* ---------- 预算提醒 ---------- */
  const remindCard = card({ title: '预算提醒' });
  const remindIntro = document.createElement('p');
  remindIntro.className = 'field-hint';
  remindIntro.textContent = '本周期消费比例跨过阈值时，页面顶部会温和地提示一次。触钱不会因此阻止你记账。';
  remindCard.body.appendChild(remindIntro);

  const remindField = field({
    label: '提醒阈值（%）',
    type: 'text',
    inputmode: 'numeric',
    value: String(settings.reminderPercent || 0),
    hint: '填 0 表示不提醒；例如填 80，消费达到本周期生活费的 80% 时提示。',
  });
  remindCard.body.appendChild(remindField.wrap);

  const remindRow = document.createElement('div');
  remindRow.className = 'btn-row';
  const saveRemind = button('保存提醒阈值', { kind: 'ghost' });
  remindRow.appendChild(saveRemind);
  remindCard.body.appendChild(remindRow);

  saveRemind.addEventListener('click', () => {
    const n = Math.round(Number(remindField.input.value));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      remindField.setError('请输入 0–100 之间的整数');
      remindField.input.focus();
      return;
    }
    const res = ctx.actions.setReminderPercent(n);
    if (!res.ok) {
      remindField.setError(res.error);
      return;
    }
    ctx.toastSuccess(n === 0 ? '已关闭预算提醒' : `将在本周期消费达到 ${n}% 时提醒你`);
  });
  frag.appendChild(remindCard.section);

  /* ---------- 各周期一览 ---------- */
  const periodsCard = card({ title: '各周期明细' });
  const startKey = earliestPeriodKey(settings, state.records);
  const keys = periodRange(startKey, view.periodKey).slice(-12);
  if (keys.length === 0) {
    periodsCard.body.appendChild(emptyState('还没有任何周期数据。'));
  } else {
    const table = document.createElement('table');
    table.className = 'period-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const label of ['周期', '初始生活费', '本期消费', '本期结余']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const key of keys) {
      const tr = document.createElement('tr');
      const fee = feeForPeriod(settings, key);
      const spent = view.spentByPeriod.get(key) || 0;
      const cells = [
        key === view.periodKey ? `${formatPeriodKey(key)}（本期）` : formatPeriodKey(key),
        `¥${formatAmount(fee)}`,
        `¥${formatAmount(spent)}`,
        `¥${formatAmount(fee - spent)}`,
      ];
      cells.forEach((text, i) => {
        const cell = i === 0 ? document.createElement('th') : document.createElement('td');
        if (i === 0) cell.scope = 'row';
        cell.textContent = text;
        if (i === 3 && fee - spent < 0) cell.className = 'is-negative';
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    periodsCard.body.appendChild(table);

    const note = document.createElement('p');
    note.className = 'muted-note';
    note.textContent = '「本期结余」= 该期初始生活费 − 该期消费。开启结转时，这些结余会一路滚入当前余额。';
    periodsCard.body.appendChild(note);
  }
  frag.appendChild(periodsCard.section);

  container.appendChild(frag);
  return { focus: () => {} };
}

function detailItem(label, value, negative = false) {
  const item = document.createElement('div');
  item.className = 'detail-item';
  const dt = document.createElement('dt');
  dt.className = 'detail-label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = `detail-value${negative ? ' is-negative' : ''}`;
  dd.textContent = value;
  item.appendChild(dt);
  item.appendChild(dd);
  return item;
}

function formatPeriodKey(key) {
  const [y, m] = key.split('-');
  return `${y} 年 ${Number(m)} 月`;
}
