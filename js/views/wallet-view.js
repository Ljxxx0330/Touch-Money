/**
 * wallet-view.js —— 手机页的第一屏「我的钱包」。
 *
 * 一屏里从上到下：本月初始生活费（可以直接改）→ 已消费 / 剩余预算 →
 * 装着真实面额纸币的钱包（余额写在钱包自己的金属牌上）→ 预算使用进度 →
 * 「记一笔」大按钮 → 今日消费 → 最近消费 → 想买的东西。
 *
 * 四个数字各归其位，不混用：初始生活费 / 已消费 / 剩余预算 / 可支配余额。
 * 没有设定生活费时先走初始化引导，不显示任何猜出来的余额。
 */

import { buildWallet } from '../ui/wallet.js';
import { card, moneyNode, recordRow, emptyState, meter } from '../ui/common.js';
import { button, moneyField, submitGuard } from '../ui/form.js';
import { icon } from '../ui/icons.js';
import { formatAmount, formatCents, percentText, toPercent, parseAmountToCents } from '../core/money.js';

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** 卡片头右侧那种小链接按钮（card() 的 action 需要一个现成节点） */
function linkButtonSafe(text, onClick) {
  const node = el('button', 'link-btn', text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** 引导页的原创图形：三张扇开的纸币，不暗示任何真实余额 */
function onboardArt() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 210');
  svg.setAttribute('class', 'onboard-art');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '三张扇开的纸币图形');
  const notes = [
    { rot: -16, fill: 'var(--note-teal)', light: '#94c3c9' },
    { rot: -4, fill: 'var(--note-gold)', light: '#e6c68f' },
    { rot: 9, fill: 'var(--note-red)', light: '#e59384' },
  ];
  notes.forEach((note, index) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `rotate(${note.rot} 160 118)`);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(58 + index * 6));
    rect.setAttribute('y', String(64 + index * 12));
    rect.setAttribute('width', '204');
    rect.setAttribute('height', '96');
    rect.setAttribute('rx', '10');
    rect.setAttribute('fill', note.fill);
    rect.setAttribute('stroke', 'rgba(13, 32, 19, 0.28)');
    rect.setAttribute('stroke-width', '1.5');
    g.appendChild(rect);
    const inner = document.createElementNS(SVG_NS, 'rect');
    inner.setAttribute('x', String(66 + index * 6));
    inner.setAttribute('y', String(72 + index * 12));
    inner.setAttribute('width', '188');
    inner.setAttribute('height', '80');
    inner.setAttribute('rx', '6');
    inner.setAttribute('fill', 'none');
    inner.setAttribute('stroke', note.light);
    inner.setAttribute('stroke-width', '1.4');
    inner.setAttribute('stroke-dasharray', '5 4');
    g.appendChild(inner);
    const face = document.createElementNS(SVG_NS, 'circle');
    face.setAttribute('cx', String(96 + index * 6));
    face.setAttribute('cy', String(112 + index * 12));
    face.setAttribute('r', '20');
    face.setAttribute('fill', note.light);
    face.setAttribute('opacity', '0.75');
    g.appendChild(face);
    svg.appendChild(g);
  });
  return svg;
}

/** 首次打开：只问一件事——这个月的生活费 */
function renderOnboard(content, ctx) {
  const wrap = el('div', 'onboard');
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', '初始化引导');

  const left = el('div');
  left.appendChild(el('p', 'hero-kicker', 'TOUCHMONEY · 触钱'));
  left.appendChild(el('h2', null, '先设定这个月的生活费'));
  left.appendChild(el('p', 'onboard-lead', '触钱不会猜测你的真实余额。写下这个月你打算用多少钱生活，之后每一笔消费都会从里面离开，你能看见它离开的样子。'));

  const amount = moneyField({
    label: '本月初始生活费（元）',
    placeholder: '2000.00',
    hint: '按你实际拿到的钱填，可以带零头。之后每个月都可以改。',
  });

  const form = el('form', 'form');
  form.noValidate = true;
  form.appendChild(amount.wrap);

  const error = el('p', 'form-error');
  error.hidden = true;
  form.appendChild(error);

  const actions = el('div', 'hero-actions');
  const submit = button('开始管理我的生活费', { kind: 'primary', icon: 'arrowRight', type: 'submit', block: true });
  actions.appendChild(submit);
  actions.appendChild(button('载入示例数据看看效果', { kind: 'ghost', icon: 'note', onClick: () => ctx.actions.loadDemoData(), block: true }));
  form.appendChild(actions);

  const steps = el('ul', 'onboard-steps');
  for (const step of [
    ['记一笔', '填下金额与名称，确认之后这笔钱才从钱包里离开。'],
    ['看见重量', '钱包会抽出纸币、找回零钱，余额跟着滚动。'],
    ['随时调整', '生活费、预算周期、结余结转都可以在生活费页改。'],
  ]) {
    const li = el('li');
    li.appendChild(icon('check', { size: 17 }));
    const box = el('span');
    box.appendChild(el('b', null, `${step[0]}：`));
    box.appendChild(el('span', null, step[1]));
    li.appendChild(box);
    steps.appendChild(li);
  }
  form.appendChild(steps);

  const submitOnce = submitGuard((event) => {
    event.preventDefault();
    const parsed = parseAmountToCents(amount.getValue());
    if (!parsed.ok) {
      amount.setError(parsed.error);
      error.hidden = false;
      error.textContent = '这个金额我还不能读成钱，请先改一下。';
      amount.input.focus();
      return;
    }
    const result = ctx.actions.setMonthlyFee(parsed.cents);
    if (!result || !result.ok) {
      error.hidden = false;
      error.textContent = (result && result.error) || '保存失败，再试一次。';
      return;
    }
    // 视图已经因为写入而重渲染，这里读的是新余额
    const after = ctx.getBudgetView();
    ctx.toastSuccess(`本月初始生活费已设为 ${formatCents(parsed.cents)} 元 · 余额 ${formatCents(after.balanceCents)} 元`);
  });
  form.addEventListener('submit', submitOnce);
  amount.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit.click();
    }
  });

  left.appendChild(form);
  wrap.appendChild(left);

  const art = el('div');
  art.appendChild(onboardArt());
  art.appendChild(el('p', 'muted-note', '设定生活费之后，钱包会按真实面额摆出你剩下的钱；现在它还不存在。'));
  wrap.appendChild(art);

  content.appendChild(wrap);
  amount.input.focus();
}

/** 首屏那张卡：生活费、两个数字、钱包（余额在钱包牌上）、预算进度 */
function heroCard(view, ctx) {
  const c = card({ className: 'hero-card', headingLevel: 2 });
  c.section.setAttribute('aria-label', '钱包与预算概览');

  // 本月初始生活费：设计稿里这一行右边就是「编辑」，这里直接放进生活费页
  const feeRow = el('div', 'fee-row');
  const feeBox = el('div');
  feeBox.appendChild(el('p', 'fee-label', '本月初始生活费'));
  const feeValue = el('p', 'fee-value');
  feeValue.appendChild(moneyNode(view.monthlyFeeCents));
  feeBox.appendChild(feeValue);
  feeRow.appendChild(feeBox);
  const edit = el('button', 'fee-edit', '调整');
  edit.type = 'button';
  edit.setAttribute('aria-label', '调整本月初始生活费与预算周期');
  edit.addEventListener('click', () => ctx.navigate('budget'));
  feeRow.appendChild(edit);
  c.body.appendChild(feeRow);

  const pair = el('div', 'pair-row');
  for (const cell of [
    { label: '本月已消费', cents: view.monthSpentCents, kind: 'pair-spent' },
    { label: '本月剩余预算', cents: view.remainingCents, kind: 'pair-left' },
  ]) {
    const box = el('div', `pair-cell ${cell.kind}`);
    box.appendChild(el('span', null, cell.label));
    const b = el('b');
    b.appendChild(moneyNode(cell.cents));
    box.appendChild(b);
    pair.appendChild(box);
  }
  c.body.appendChild(pair);

  // 视觉中心：cash-stage 自带展台底纹与透视，钱包站在上面
  const host = el('div', 'hero-wallet');
  const stage = el('div', 'cash-stage');
  const wallet = buildWallet({
    balanceCents: view.balanceCents,
    periodLabel: ctx.humanPeriod(view.periodStart, view.cycleDay),
    showComposition: true,
  });
  stage.appendChild(wallet.wrap);
  host.appendChild(stage);
  c.body.appendChild(host);

  const percent = percentText(toPercent(view.usedRatio, 1));
  const carryNote = view.carryInCents > 0
    ? `本期预算里还带着上一期结转的 ${formatCents(view.carryInCents)} 元，所以本月剩余预算与当前可支配余额不一样。`
    : (view.carryOver
      ? '结余结转开着：上一期没花完的会带进这一期。'
      : '结余结转已关闭：本期剩余预算不会累加往期结余。');
  c.body.appendChild(meter(view.usedRatio, {
    label: '本月预算使用',
    detail: `已用 ${percent}% · 剩余 ${formatCents(view.remainingCents)} 元`,
    note: carryNote,
  }).wrap);

  c.body.appendChild(el('p', 'muted-note', `${ctx.humanPeriod(view.periodStart, view.cycleDay)} · 周期起始日每月 ${view.cycleDay} 日 · 钱包里的纸币是虚拟视觉表现，不代表真实货币。`));
  return c.section;
}

/** 显眼的主按钮 */
function homeAdd(ctx) {
  const wrap = el('div', 'home-add');
  const btn = button('记一笔', { kind: 'primary', icon: 'plus', block: true, onClick: () => ctx.navigate('add') });
  btn.classList.add('btn-lg');
  wrap.appendChild(btn);
  return wrap;
}

/** 今日消费：设计稿里卡片头右边就是今天的合计 */
function todayCard(ctx) {
  const state = ctx.getState();
  const stats = ctx.getStatsView();
  const today = ctx.sortedRecords(state.records).filter((r) => r.date === stats.todayKey);
  const total = el('span', 'head-total', formatCents(stats.todayTotalCents));
  const c = card({
    title: '今日消费',
    headingLevel: 3,
    action: total,
    sub: today.length
      ? `${today.length} 笔 · ${today.filter((r) => r.isNonEssential).length} 笔标了非必需`
      : `${ctx.humanDate(stats.todayKey)} · 还没有记录`,
  });
  if (!today.length) {
    c.body.appendChild(emptyState(
      '今天还没有消费记录。花掉的钱记下来之后，钱包里的纸币才会动起来。',
      button('记一笔', { kind: 'primary', icon: 'plus', onClick: () => ctx.navigate('add') }),
      'note',
    ));
    return c.section;
  }
  const list = el('div', 'row-list');
  for (const record of today.slice(0, 8)) list.appendChild(recordRow(record, (id) => ctx.openRecordDetail(id)));
  c.body.appendChild(list);
  if (today.length > 8) c.body.appendChild(el('p', 'muted-note', `今天还有 ${today.length - 8} 笔没显示，去消费记录页看全部。`));
  return c.section;
}

/** 最近消费（5 条） */
function recentCard(ctx) {
  const state = ctx.getState();
  const all = ctx.sortedRecords(state.records);
  const c = card({
    title: '最近消费',
    headingLevel: 3,
    action: all.length ? linkButtonSafe('查看全部', () => ctx.navigate('records')) : null,
    sub: all.length ? `共 ${all.length} 笔记录 · 这里显示最近 ${Math.min(5, all.length)} 笔` : null,
  });
  if (!all.length) {
    c.body.appendChild(emptyState(
      '还没有消费记录。第一笔记下来之后，钱包里的纸币才会动起来。',
      button('记第一笔', { kind: 'primary', icon: 'plus', onClick: () => ctx.navigate('add') }),
      'note',
    ));
    return c.section;
  }
  const list = el('div', 'row-list');
  for (const record of all.slice(0, 5)) list.appendChild(recordRow(record, (id) => ctx.openRecordDetail(id)));
  c.body.appendChild(list);
  return c.section;
}

/** 想买的东西：这些钱都还没有扣款 */
function wishSummaryCard(ctx) {
  const state = ctx.getState();
  const pending = ctx.sortedWishlist(state.wishlist).filter((w) => w.status !== 'purchased');
  const totalCents = pending.reduce((sum, w) => sum + (w.priceCents || 0), 0);
  const c = card({
    title: '想买的东西',
    headingLevel: 3,
    action: linkButtonSafe('管理清单', () => ctx.navigate('wishlist')),
    sub: pending.length
      ? `${pending.length} 件想买 · 合计 ${formatAmount(totalCents)} 元 · 这些金额都还没有扣款`
      : null,
  });
  if (!pending.length) {
    c.body.appendChild(emptyState(
      '清单是空的。想买的东西先写进来，等一天再决定要不要买。',
      button('添加想买的', { kind: 'ghost', icon: 'plus', onClick: () => ctx.navigate('wishlist') }),
      'heart',
    ));
    return c.section;
  }
  const list = el('div', 'row-list');
  for (const wish of pending.slice(0, 3)) {
    const row = el('button', 'row-item');
    row.type = 'button';
    row.dataset.wish = wish.id;
    row.setAttribute('aria-label', `${wish.name} 预计 ${formatAmount(wish.priceCents || 0)} 元，去愿望清单查看`);
    const tile = el('span', 'row-tile');
    tile.appendChild(icon('heart', { size: 20 }));
    row.appendChild(tile);
    const main = el('span', 'row-main');
    main.appendChild(el('span', 'row-title', wish.name));
    main.appendChild(el('span', 'row-meta', `加入于 ${ctx.humanDate(wish.addedAt)}${wish.plannedDate ? ` · 计划 ${wish.plannedDate}` : ''}${wish.status === 'hold' ? ' · 暂不购买' : ''}`));
    row.appendChild(main);
    const amtWrap = el('span');
    amtWrap.appendChild(el('span', 'row-amt', formatAmount(wish.priceCents || 0)));
    amtWrap.appendChild(el('span', 'row-amt-sub', '预计 · 未扣款'));
    row.appendChild(amtWrap);
    row.addEventListener('click', () => ctx.navigate('wishlist'));
    list.appendChild(row);
  }
  c.body.appendChild(list);
  return c.section;
}

export function renderWalletView(content, ctx) {
  const state = ctx.getState();
  if (!ctx.isConfigured(state)) {
    renderOnboard(content, ctx);
    return;
  }
  const view = ctx.getBudgetView();

  content.appendChild(heroCard(view, ctx));
  content.appendChild(homeAdd(ctx));
  content.appendChild(todayCard(ctx));
  content.appendChild(recentCard(ctx));
  content.appendChild(wishSummaryCard(ctx));
}
