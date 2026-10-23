/**
 * wishlist-view.js —— 愿望清单。
 * 清单里的价格只是参考，永远不会自己从余额里扣钱；
 * 只有你按「记实际消费」时才会真的记一笔，而且一条愿望只能记一次。
 */

import { card, emptyState, wishArt, segControl, detailCell } from '../ui/common.js';
import { field, moneyField, selectField, toggleField, button } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { icon } from '../ui/icons.js';
import { formatAmount, formatCents, parseAmountToCents } from '../core/money.js';
import { playCashAnimation } from '../ui/overlay.js';

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** 冷静期剩余时间写成「5 小时 12 分」这种能读的话 */
function coolingText(ms) {
  if (ms <= 0) return '';
  const minutes = Math.ceil(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) return '冷静期还剩两天以上';
  if (hours > 0) return `冷静期还剩 ${hours} 小时${rest ? ` ${rest} 分` : ''}`;
  return `冷静期还剩 ${Math.max(1, rest)} 分钟`;
}

const STATUS_LABEL = { pending: '想买', hold: '暂不购买', purchased: '已购买' };

/** 清单筛选：状态与冷静期。记住上一次选的是什么，编辑或删除后刷新不会跳回「全部」。 */
const FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '想买' },
  { value: 'cooling', label: '冷静期中' },
  { value: 'purchased', label: '已购买' },
  { value: 'hold', label: '暂不购买' },
];
const FILTER_LABEL = { all: '全部', pending: '想买', cooling: '冷静期中', purchased: '已购买', hold: '暂不购买' };
const remembered = { status: 'all' };

/** @param {{ coolingEnabled?: boolean }} wish */
function matchFilter(wish, value, ctx) {
  switch (value) {
    case 'pending': return wish.status === 'pending';
    case 'hold': return wish.status === 'hold';
    case 'purchased': return wish.status === 'purchased';
    case 'cooling': return !!wish.coolingEnabled && ctx.coolingRemainingMs(wish) > 0;
    default: return true;
  }
}

/** 标记已购买：只改状态，或者顺手记一笔真实花费 */
function openPurchase(wish, ctx) {
  const amount = moneyField({
    label: '实际花了多少（元）',
    placeholder: (wish.priceCents / 100).toFixed(2),
    hint: '按真实花费填，可以和预计价格不一样。',
  });
  const body = el('div', 'form');
  body.appendChild(el('p', 'muted-note', `「${wish.name}」预计 ${formatAmount(wish.priceCents || 0)} 元。标记已购买本身不会扣钱——只有你选「记实际消费」时才会真的从余额里减。`));
  body.appendChild(amount.wrap);

  openModal({
    title: '标记已购买',
    body,
    focusPrimary: false,
    buttons: [
      {
        text: '只标记，不扣款',
        kind: 'ghost',
        onClick: (handle) => {
          const result = ctx.actions.markWishPurchased(wish.id);
          if (!result || !result.ok) { ctx.toastError((result && result.error) || '操作失败。'); return; }
          handle.close('mark');
          ctx.toast('已标记为购买 · 没有扣款，也没有记账', { level: 'success' });
        },
      },
      {
        text: '记实际消费',
        kind: 'primary',
        onClick: async (handle) => {
          const parsed = parseAmountToCents(amount.getValue());
          if (!parsed.ok) { amount.setError(parsed.error); amount.input.focus(); return; }
          const result = ctx.actions.recordWishPurchase(wish.id, parsed.cents);
          if (!result || !result.ok) {
            amount.setError((result && result.error) || '记账失败。');
            return;
          }
          const afterCents = result.balanceCents ?? 0;
          handle.close('record');
          ctx.toastSuccess(`已记账 ${formatCents(parsed.cents)} 元 · 余额 ${formatCents(afterCents)} 元`);
          // 这笔钱真的从钱包里离开了，就该看得见：钞票逐张抽出。
          await playCashAnimation({
            amountCents: parsed.cents,
            beforeCents: afterCents + parsed.cents,
            afterCents,
            title: wish.name,
            direction: 'out',
            resultNote: `「${wish.name}」按真实花费记账 ¥${formatCents(parsed.cents)} 元 · 这条愿望已经记过账，不会再重复扣款。`,
          });
        },
      },
    ],
  });
  amount.input.focus();
}

/** 新增 / 编辑一条愿望 */
function openWishEditor(wish, ctx) {
  const name = field({ label: '想买什么', value: wish ? wish.name : '', maxlength: 40, placeholder: '降噪耳机' });
  const price = moneyField({ label: '预计价格（元）', value: wish && wish.priceCents ? (wish.priceCents / 100).toFixed(2) : '', hint: '填你估计的数，它不会从余额里扣。' });
  const reason = field({ label: '为什么想要', type: 'textarea', value: wish ? wish.reason : '', maxlength: 120, optionalLabel: '可留空', placeholder: '自习室太吵，想安静地学一会儿。' });
  const planned = field({ label: '计划什么时候买', type: 'date', value: wish ? wish.plannedDate || '' : '', optionalLabel: '可留空' });
  const status = selectField({
    label: '现在的状态',
    value: wish ? wish.status : 'pending',
    options: [{ value: 'pending', label: '想买' }, { value: 'hold', label: '暂不购买' }, { value: 'purchased', label: '已购买' }],
    hint: wish ? '' : '新加的愿望默认是「想买」。',
  });
  const cooling = toggleField({
    label: '开启 24 小时冷静期',
    checked: wish ? !!wish.coolingEnabled : !!(ctx.getState().settings.wishCoolingDefault),
    hint: '开启后，加入的一天之内这条会提醒你「再想想是否真的需要」。它不阻止你买，也不扣钱。',
  });

  const form = el('form', 'form');
  form.noValidate = true;
  form.append(name.wrap, price.wrap, reason.wrap, planned.wrap, status.wrap, cooling.wrap);

  const error = el('p', 'form-error');
  error.hidden = true;
  form.appendChild(error);

  const handle = openModal({
    title: wish ? '编辑这条愿望' : '添加想买的',
    sub: '清单只是给自己一个缓冲，它不动你的余额。',
    body: form,
    wide: true,
    focusPrimary: true,
    buttons: [
      { text: '取消', kind: 'ghost', onClick: (h) => h.close('cancel') },
      {
        text: wish ? '保存' : '加入清单',
        kind: 'primary',
        type: 'submit',
        onClick: () => {
          if (!name.input.value.trim()) { name.setError('给它起个名字'); name.input.focus(); return; }
          const parsed = parseAmountToCents(price.getValue() || '0');
          if (!price.getValue().trim()) {
            price.setError('给个预计价格，哪怕是估的。');
            price.input.focus();
            return;
          }
          if (!parsed.ok) { price.setError(parsed.error); price.input.focus(); return; }
          const payload = {
            name: name.input.value.trim(),
            priceCents: parsed.cents,
            reason: reason.input.value.trim(),
            plannedDate: planned.input.value || '',
            status: status.select.value,
            coolingEnabled: cooling.input.checked,
          };
          const result = wish ? ctx.actions.updateWishItem(wish.id, payload) : ctx.actions.addWishItem(payload);
          if (!result || !result.ok) {
            error.hidden = false;
            error.textContent = (result && result.error) || '保存失败。';
            return;
          }
          handle.close('saved');
          ctx.toastSuccess(wish ? '已更新这条愿望' : `已加入清单：${payload.name}`);
        },
      },
    ],
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submitBtn = handle.footer.querySelector('.btn-primary');
    if (submitBtn) submitBtn.click();
  });
}

/** 一条愿望的状态药丸：想买 / 暂不购买 / 已购买 */
function statusPill(wish) {
  const MAP = {
    pending: ['pill pill-status', 'heart', '想买'],
    hold: ['pill pill-hold', 'heart', '暂不购买'],
    purchased: ['pill pill-bought', 'check', '已购买'],
  };
  const hit = MAP[wish.status] || MAP.pending;
  const pill = el('span', hit[0]);
  pill.appendChild(icon(hit[1], { size: 14 }));
  pill.appendChild(el('span', null, hit[2]));
  return pill;
}

/** 冷静期药丸：还在期内是暖色，过了转绿 */
function coolingPill(wish, ctx) {
  if (!wish.coolingEnabled) return null;
  const left = ctx.coolingRemainingMs(wish);
  const pill = el('span', left > 0 ? 'pill pill-cooling' : 'pill pill-done');
  pill.appendChild(icon(left > 0 ? 'info' : 'check', { size: 14 }));
  pill.appendChild(el('span', null, left > 0 ? coolingText(left) : '冷静期已过'));
  return pill;
}

/**
 * 点开一条愿望。手机页的一行放不下四个按钮，所以操作都收在这块整屏详情里：
 * 底部留「关闭」+ 最主要的那一个，其余（暂不购买 / 编辑 / 删除）排在正文末尾。
 */
function openWishDetail(wish, ctx) {
  let handle = null;
  const close = () => { if (handle) handle.close('detail'); };

  const body = el('div');
  const art = el('div', 'wish-detail-art');
  art.appendChild(wishArt(wish.name));
  body.appendChild(art);

  const list = el('div', 'detail-list');
  list.appendChild(detailCell('现在的状态', STATUS_LABEL[wish.status] || '想买', ''));
  list.appendChild(detailCell('预计价格', `${formatAmount(wish.priceCents || 0)} 元`, ''));
  list.appendChild(detailCell('加入清单', ctx.humanDate(wish.addedAt), ''));
  if (wish.plannedDate) list.appendChild(detailCell('计划购买', wish.plannedDate, ''));
  if (wish.status === 'purchased' && wish.purchasedAt) {
    list.appendChild(detailCell('标记已购买', wish.purchasedAt.replace('T', ' ').slice(0, 16), ''));
  }
  const linked = wish.recordedRecordId ? ctx.getRecordById(wish.recordedRecordId) : null;
  if (wish.status === 'purchased') {
    list.appendChild(detailCell(
      '有没有记账',
      linked ? `已记一笔 ${formatCents(linked.amount)} 元` : '还没记账',
      '',
      linked ? '那笔消费在记录里，不会重复扣款' : '余额里还没有这笔钱的痕迹',
    ));
  }
  body.appendChild(list);

  if (wish.reason) body.appendChild(el('p', 'wish-reason', `为什么想要：${wish.reason}`));

  if (wish.coolingEnabled) {
    const left = ctx.coolingRemainingMs(wish);
    const bar = el('div', left > 0 ? 'cooling-bar' : 'cooling-bar cooling-done');
    bar.appendChild(icon(left > 0 ? 'info' : 'check', { size: 16 }));
    bar.appendChild(el('span', null, left > 0
      ? `${coolingText(left)} · 这一天之内可以再想想是否真的需要`
      : '24 小时冷静期已过 · 现在可以再想想是否真的需要'));
    body.appendChild(bar);
  } else {
    body.appendChild(el('p', 'muted-note', '这条没开冷静期。要开的话进「编辑这条愿望」单独打开。'));
  }

  const foot = el('div', 'wish-foot');
  foot.appendChild(button(wish.status === 'hold' ? '回到想买' : '暂不购买', {
    kind: 'ghost',
    icon: 'heart',
    onClick: () => {
      const next = wish.status === 'hold' ? 'pending' : 'hold';
      const result = ctx.actions.updateWishItem(wish.id, { status: next });
      if (!result || !result.ok) { ctx.toastError((result && result.error) || '操作失败。'); return; }
      close();
      ctx.toast(next === 'hold' ? '已放入「暂不购买」· 没有扣款' : '已回到「想买」', { level: 'success' });
    },
  }));
  foot.appendChild(button('编辑这条愿望', {
    kind: 'plain',
    icon: 'pencil',
    onClick: () => { close(); openWishEditor(wish, ctx); },
  }));
  foot.appendChild(button('删除', {
    kind: 'plain',
    icon: 'trash',
    onClick: async () => {
      const yes = await confirmDialog({
        title: '删除这条愿望？',
        message: `将删除「${wish.name}」${formatAmount(wish.priceCents || 0)} 元。`,
        detail: wish.recordedRecordId
          ? '它已经记过一笔账，那笔消费记录会保留，只是不再关联这条愿望。'
          : '愿望清单里的价格本来就没有扣过钱。',
        confirmText: '删除',
        cancelText: '先留着',
        danger: true,
      });
      if (!yes) return;
      const result = ctx.actions.deleteWishItem(wish.id);
      if (!result || !result.ok) { ctx.toastError((result && result.error) || '删除失败。'); return; }
      close();
      ctx.toast('已删除这条愿望', { level: 'success' });
    },
  }));
  body.appendChild(foot);

  const buttons = [{ text: '关闭', kind: 'ghost', onClick: (h) => h.close('close') }];
  if (wish.status !== 'purchased') {
    buttons.push({
      text: '标记已购买', kind: 'primary',
      onClick: () => { close(); openPurchase(wish, ctx); },
    });
  } else if (!wish.recordedRecordId) {
    buttons.push({
      text: '记实际消费', kind: 'primary', icon: 'pencil',
      onClick: () => { close(); openPurchase(wish, ctx); },
    });
  } else {
    buttons.push({
      text: '回到想买', kind: 'primary', icon: 'heart',
      onClick: () => {
        const result = ctx.actions.updateWishItem(wish.id, {
          status: 'pending', purchasedAt: '', recordedRecordId: wish.recordedRecordId || '',
        });
        if (!result || !result.ok) { ctx.toastError((result && result.error) || '操作失败。'); return; }
        close();
        ctx.toast('已回到「想买」· 之前记的账还在记录里', { level: 'success' });
      },
    });
  }

  handle = openModal({
    title: wish.name,
    sub: `${STATUS_LABEL[wish.status] || '想买'} · 参考 ${formatAmount(wish.priceCents || 0)} 元 · 清单不动余额`,
    body,
    buttons,
  });
}

/** 一条愿望：手机页里的行（缩略图 + 名字 + 状态与冷静期药丸 + 价格），整行可点开详情 */
function wishRow(wish, ctx) {
  const row = el('button', 'wish-row');
  row.type = 'button';
  row.setAttribute('aria-label',
    `${wish.name}，参考 ${formatAmount(wish.priceCents || 0)} 元，${STATUS_LABEL[wish.status] || '想买'}。点开看详情和操作`);

  const thumb = el('div', 'wish-thumb');
  thumb.appendChild(wishArt(wish.name));
  row.appendChild(thumb);

  // <button> 里只能放短语内容，所以标题和说明都用 div（样式照旧走 .wish-row-*）
  const body = el('div');
  body.style.minWidth = '0';
  body.appendChild(el('div', 'wish-row-name', wish.name));

  const meta = [`加入于 ${ctx.humanDate(wish.addedAt)}`];
  if (wish.plannedDate) meta.push(`计划 ${wish.plannedDate}`);
  if (wish.status === 'purchased' && wish.purchasedAt) meta.push(`已购买 ${wish.purchasedAt.replace('T', ' ').slice(0, 16)}`);
  if (wish.status === 'purchased' && wish.recordedRecordId) meta.push('已记账');
  body.appendChild(el('div', 'wish-row-meta', meta.join(' · ')));

  const note = el('div', 'wish-row-note');
  note.appendChild(statusPill(wish));
  const cool = coolingPill(wish, ctx);
  if (cool) note.appendChild(cool);
  if (wish.status === 'purchased' && !wish.recordedRecordId) {
    const remind = el('span', 'pill pill-cooling');
    remind.appendChild(icon('note', { size: 14 }));
    remind.appendChild(el('span', null, '已买但没记账'));
    note.appendChild(remind);
  }
  body.appendChild(note);
  if (wish.reason) body.appendChild(el('div', 'wish-row-meta', `为什么想要：${wish.reason}`));
  row.appendChild(body);

  const price = el('div', 'wish-row-price');
  price.appendChild(el('span', null, formatAmount(wish.priceCents || 0)));
  price.appendChild(el('small', null, '参考 · 不扣款'));
  row.appendChild(price);

  row.addEventListener('click', () => openWishDetail(wish, ctx));
  return row;
}

export function renderWishlistView(content, ctx) {
  const state = ctx.getState();
  const wishes = ctx.sortedWishlist(state.wishlist);
  const pending = wishes.filter((w) => w.status !== 'purchased');
  const pendingTotal = pending.reduce((sum, w) => sum + (w.priceCents || 0), 0);

  const coolingDefault = toggleField({
    label: '新愿望默认开启 24 小时冷静期',
    checked: !!state.settings.wishCoolingDefault,
    hint: '开启后，新加入的想买的会默认带上冷静期；你也可以逐条调整。',
    onChange: (on) => {
      const result = ctx.actions.setWishCoolingDefault(on);
      if (!result || result.ok === false) { ctx.toastError((result && result.error) || '设置失败。'); return; }
      ctx.toast(on ? '新加入的想买的会默认带上冷静期' : '新加入的想买的默认不带冷静期', { level: 'success' });
    },
  });

  // 标题栏右侧的「添加」与列表末尾的「添加想买的」是同一件事，两个入口都真的能点。
  const openEditor = () => openWishEditor(null, ctx);
  ctx.setHeaderAction({ icon: 'plus', label: '添加想买的', pill: true, onClick: openEditor });

  const head = card({
    title: '想买的东西',
    sub: '把想买的先写进清单，等一等再决定。清单里的价格只是参考，不会从余额里扣钱。',
  });
  head.body.appendChild(coolingDefault.wrap);
  const summary = el('p', 'list-summary', '');
  summary.appendChild(el('b', null, `${wishes.length} 条`));
  summary.appendChild(el('span', null, wishes.length
    ? ` · 想买 ${pending.length} 件 · 合计 ${formatAmount(pendingTotal)} 元 · 这些金额都还没有扣款`
    : ' · 清单是空的'));
  head.body.appendChild(summary);
  const filterState = el('p', 'filter-state');
  filterState.hidden = true;
  head.body.appendChild(filterState);
  content.appendChild(head.section);

  // 重画函数在下面才定义，这里先留个口子给分段控件回调。
  let drawList = null;
  const seg = segControl(FILTER_OPTIONS, remembered.status, (value) => {
    remembered.status = value;
    if (drawList) drawList(value);
  });
  content.appendChild(seg.wrap);

  const listCard = card({ headingLevel: 3 });
  content.appendChild(listCard.section);

  const addBtn = button('添加想买的', { kind: 'primary', icon: 'plus', onClick: openEditor });
  addBtn.classList.add('wish-add');

  /** 按当前筛选重画列表；编辑、删除、改状态之后也走它，所以筛选不会丢。 */
  const draw = (value) => {
    remembered.status = value;
    const list = wishes.filter((wish) => matchFilter(wish, value, ctx));
    listCard.body.textContent = '';
    if (!list.length) {
      listCard.body.appendChild(emptyState(
        wishes.length
          ? '换个筛选看看。清单里的东西不会自己消失，也没有扣过你的钱。'
          : '写下你最近想要的东西，给它一个价格和一条理由。24 小时之后再看它，往往就没那么想要了。',
        button('添加想买的', { kind: 'primary', icon: 'plus', onClick: openEditor }),
        'heart',
      ));
    } else {
      for (const wish of list) listCard.body.appendChild(wishRow(wish, ctx));
      listCard.body.appendChild(addBtn);
    }
    filterState.hidden = value === 'all';
    filterState.textContent = value === 'all'
      ? ''
      : `正在筛选：${FILTER_LABEL[value]} · 显示 ${list.length} 条 / 共 ${wishes.length} 条`;
  };

  drawList = draw;
  draw(remembered.status);
}
