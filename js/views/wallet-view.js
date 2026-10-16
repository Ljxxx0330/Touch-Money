/**
 * wallet-view.js —— 首页「我的钱包」：以虚拟钱包为视觉中心。
 * 未设置生活费时显示初始化引导，不展示会被误读为真实余额的数字。
 */

import { humanDate, humanPeriod, todayKey } from '../core/dates.js';
import { formatAmount, toPercent, parseAmountToCents, percentText } from '../core/money.js';
import { buildWallet } from '../ui/wallet.js';
import { card, emptyState, linkButton, moneyNode, recordRow } from '../ui/common.js';
import { field, button } from '../ui/form.js';


export function renderWalletView(container, ctx) {
  const state = ctx.getState();
  const view = ctx.getBudgetView();
  const configured = ctx.isConfigured();
  const frag = document.createDocumentFragment();
  const walletHost = document.createElement('div');
  walletHost.className = 'wallet-host';

  /* ---------- 初始化引导 ---------- */
  if (!configured) {
    frag.appendChild(onboardingCard(ctx));
    const hint = document.createElement('p');
    hint.className = 'muted-note';
    hint.textContent = '设置本月生活费后，这里才会显示余额与预算。触钱不会猜测你的真实余额。';
    frag.appendChild(hint);
    container.appendChild(frag);
    return { focus: () => {} };
  }

  /* ---------- 钱包主视觉 ---------- */
  const walletCard = document.createElement('section');
  walletCard.className = 'card wallet-card';

  const wallet = buildWallet({
    balanceCents: view.balanceCents,
    periodLabel: humanPeriod(view.periodStart, view.cycleDay),
  });
  walletHost.appendChild(wallet.root);
  walletCard.appendChild(walletHost);

  if (view.carryOver && view.carryInCents !== 0) {
    const carry = document.createElement('p');
    carry.className = view.carryInCents >= 0 ? 'carry-note' : 'carry-note carry-note-negative';
    carry.textContent =
      view.carryInCents >= 0
        ? `上一期结余结转 ¥${moneyTextAbs(view.carryInCents)}`
        : `上一期透支 ¥${moneyTextAbs(view.carryInCents)}`;
    walletCard.appendChild(carry);
  }

  const trio = document.createElement('dl');
  trio.className = 'trio';
  trio.appendChild(trioItem('本月初始生活费', view.monthlyFeeCents));
  trio.appendChild(trioItem('本月已消费', view.monthSpentCents));
  trio.appendChild(trioItem('本月剩余预算', view.remainingCents, view.remainingCents < 0));
  walletCard.appendChild(trio);

  const overBudget = view.remainingCents < 0;
  const percent = percentText(toPercent(view.monthSpentCents, view.monthlyFeeCents));
  walletCard.appendChild(
    budgetProgress(view, percent, overBudget),
  );

  frag.appendChild(walletCard);

  /* ---------- 快捷操作 ---------- */
  const actions = document.createElement('div');
  actions.className = 'quick-actions';
  actions.appendChild(button('记一笔', { kind: 'primary', onClick: () => ctx.navigate('add') }));
  actions.appendChild(button('生活费设置', { kind: 'ghost', onClick: () => ctx.navigate('budget') }));
  actions.appendChild(button('愿望清单', { kind: 'ghost', onClick: () => ctx.navigate('wishlist') }));
  frag.appendChild(actions);

  /* ---------- 今日消费 ---------- */
  const tKey = todayKey();
  const todayRecords = state.records.filter((r) => r.date === tKey);
  const todayTotal = todayRecords.reduce((sum, r) => sum + r.amount, 0);

  const todayCard = card({ title: '今日消费' });
  const todayRow = document.createElement('div');
  todayRow.className = 'today-row';
  todayRow.appendChild(moneyNode(todayTotal, { sign: '-', className: todayTotal > 0 ? 'today-amount' : 'today-amount today-amount-zero' }));
  const todayMeta = document.createElement('span');
  todayMeta.className = 'record-meta';
  todayMeta.textContent = todayRecords.length
    ? `${todayRecords.length} 笔 · ${todayRecords.filter((r) => r.isNonEssential).length} 笔标记为非必需`
    : '今天还没有记账';
  todayRow.appendChild(todayMeta);
  todayCard.body.appendChild(todayRow);
  frag.appendChild(todayCard.section);

  /* ---------- 最近消费 ---------- */
  const recent = ctx.sortedRecords(state.records).slice(0, 6);
  const recentCard = card({
    title: '最近消费',
    action: linkButton('查看全部', () => ctx.navigate('records')),
  });
  if (recent.length === 0) {
    recentCard.body.appendChild(
      emptyState('还没有消费记录', button('记第一笔', { kind: 'primary', onClick: () => ctx.navigate('add') })),
    );
  } else {
    const list = document.createElement('ul');
    list.className = 'record-list';
    for (const r of recent) {
      const li = document.createElement('li');
      const row = recordRow(r, (rec) => ctx.openRecordDetail(rec));
      const time = document.createElement('span');
      time.className = 'record-date';
      time.textContent = humanDate(r.date);
      row.insertBefore(time, row.lastChild);
      li.appendChild(row);
      list.appendChild(li);
    }
    recentCard.body.appendChild(list);
  }
  frag.appendChild(recentCard.section);

  /* ---------- 愿望清单摘要 ---------- */
  const pending = state.wishlist.filter((w) => w.status === 'pending');
  const wishCard = card({
    title: '愿望清单',
    action: linkButton('管理', () => ctx.navigate('wishlist')),
  });
  if (pending.length === 0) {
    wishCard.body.appendChild(
      emptyState('还没有想买的东西，先去清单里记下来，冷静一天再决定。', button('添加愿望', { kind: 'ghost', onClick: () => ctx.navigate('wishlist') })),
    );
  } else {
    const ul = document.createElement('ul');
    ul.className = 'wish-mini';
    for (const w of pending.slice(0, 3)) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'wish-mini-name';
      name.textContent = w.name;
      li.appendChild(name);
      li.appendChild(moneyNode(w.priceCents, { className: 'wish-mini-price' }));
      ul.appendChild(li);
    }
    wishCard.body.appendChild(ul);
    const total = pending.reduce((s, w) => s + w.priceCents, 0);
    const sum = document.createElement('p');
    sum.className = 'wish-mini-total';
    sum.textContent = `${pending.length} 件想买 · 合计 ¥${moneyTextAbs(total)} · 尚未扣款`;
    wishCard.body.appendChild(sum);
  }
  frag.appendChild(wishCard.section);

  container.appendChild(frag);
  return { focus: () => {}, wallet };
}

function trioItem(label, cents, negative = false) {
  const item = document.createElement('div');
  item.className = 'trio-item';
  const dt = document.createElement('dt');
  dt.className = 'trio-label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = `trio-value${negative ? ' is-negative' : ''}`;
  dd.textContent = `¥${moneyTextAbs(cents)}`;
  item.appendChild(dt);
  item.appendChild(dd);
  return item;
}

function budgetProgress(view, percent, overBudget) {
  const wrap = document.createElement('div');
  wrap.className = 'budget-meter';
  const bar = document.createElement('div');
  bar.className = `budget-bar${overBudget ? ' is-over' : ''}`;
  const fill = document.createElement('div');
  fill.className = 'budget-fill';
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  const label = document.createElement('p');
  label.className = 'budget-label';
  if (view.monthlyFeeCents <= 0) {
    label.textContent = '尚未设置本月生活费，无法计算预算使用比例。';
  } else if (overBudget) {
    label.textContent = `已超出预算 ${percent}% · 超支 ¥${moneyTextAbs(view.remainingCents)}`;
  } else {
    label.textContent = `预算已用 ${percent}% · 剩余 ¥${moneyTextAbs(view.remainingCents)}`;
  }
  wrap.appendChild(label);
  return wrap;
}

function moneyTextAbs(cents) {
  return formatAmount(Math.abs(Math.round(cents)));
}

/** 首次打开时的生活费初始化引导。 */
function onboardingCard(ctx) {
  const { section, body } = card({ className: 'onboarding-card' });

  const h = document.createElement('h2');
  h.className = 'onboarding-title';
  h.textContent = '先设定这个月的生活费';
  body.appendChild(h);

  const p = document.createElement('p');
  p.className = 'onboarding-text';
  p.textContent =
    '触钱用「虚拟现金」帮你感知资金流动。这里填的是你这个月计划用来消费的金额，不是银行卡里的真实余额，也不需要连接任何支付软件。';
  body.appendChild(p);

  const amountField = field({
    label: '本月生活费（元）',
    type: 'text',
    inputmode: 'decimal',
    placeholder: '例如 1500',
    required: true,
    hint: '之后可以随时修改，修改时触钱会先告诉你余额会怎么变。',
  });
  amountField.input.setAttribute('data-autofocus', '');
  body.appendChild(amountField.wrap);

  const err = document.createElement('p');
  err.className = 'form-error';
  err.setAttribute('role', 'alert');
  err.hidden = true;
  body.appendChild(err);

  const row = document.createElement('div');
  row.className = 'btn-row';

  const submit = button('开始管理我的生活费', {
    kind: 'primary',
    type: 'submit',
    onClick: () => {
      const parsed = parseAmountToCents(amountField.input.value);
      if (!parsed.ok) {
        amountField.setError(parsed.error);
        amountField.input.focus();
        return;
      }
      const res = ctx.actions.setMonthlyFee(parsed.cents);
      if (!res.ok) {
        err.textContent = res.error;
        err.hidden = false;
        return;
      }
      ctx.toastSuccess(`本月初始生活费已设为 ¥${formatAmount(parsed.cents)}`);
      ctx.refresh();
    },
  });
  row.appendChild(submit);

  const demo = button('载入示例数据看看效果', {
    kind: 'ghost',
    onClick: () => {
      ctx.actions.loadDemoData();
      ctx.refresh();
    },
  });
  row.appendChild(demo);
  body.appendChild(row);

  amountField.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit.click();
    }
  });

  const foot = document.createElement('p');
  foot.className = 'onboarding-foot';
  foot.textContent = '所有数据只保存在这台设备的浏览器本地存储里，不会上传，也不连接微信支付或支付宝。';
  body.appendChild(foot);

  return section;
}
