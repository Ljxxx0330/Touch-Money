/**
 * wishlist-view.js —— 愿望清单：想买但不立刻买。
 *
 * 关键约束：标记「已购买」绝不自动扣款。真正的扣款只发生在
 * 「记实际消费」这一步（recordWishPurchase），且同一条愿望不会扣两次。
 */

import { humanDate, todayKey } from '../core/dates.js';
import { formatAmount, parseAmountToCents } from '../core/money.js';
import { card, emptyState, moneyNode } from '../ui/common.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { field, selectField, toggleField, button, formErrorBox } from '../ui/form.js';

const STATUS_LABEL = {
  pending: '想买',
  hold: '暂不购买',
  purchased: '已购买',
};

export function renderWishlistView(container, ctx) {
  const state = ctx.getState();
  const items = ctx.sortedWishlist(state.wishlist);

  const frag = document.createDocumentFragment();

  const intro = document.createElement('p');
  intro.className = 'muted-note';
  intro.textContent = '把想买的先写进清单，等一等再决定。清单里的价格只是参考，不会从余额里扣钱。';
  frag.appendChild(intro);

  const toolbar = document.createElement('div');
  toolbar.className = 'wish-toolbar';
  toolbar.appendChild(
    button('添加想买的', { kind: 'primary', onClick: () => openWishEditor(null, ctx) }),
  );
  const coolingDefault = toggleField({
    label: '新愿望默认开启 24 小时冷静期',
    hint: '开启后，新加入的想买的会默认带上冷静期；你也可以逐条调整。',
    checked: !!state.settings.wishCoolingDefault,
    onChange: (on) => ctx.actions.setWishCoolingDefault(on),
    onText: '默认开启',
    offText: '默认关闭',
  });
  toolbar.appendChild(coolingDefault.wrap);
  frag.appendChild(toolbar);

  if (items.length === 0) {
    frag.appendChild(
      emptyState(
        '愿望清单还是空的。想到想买什么，先写下来，给它一天的时间。',
        button('添加第一件', { kind: 'primary', onClick: () => openWishEditor(null, ctx) }),
      ),
    );
  } else {
    const pending = items.filter((w) => w.status === 'pending');
    const summary = document.createElement('p');
    summary.className = 'list-summary';
    summary.textContent =
      `${items.length} 件 · 想买 ${pending.length} 件 · 合计 ¥${formatAmount(pending.reduce((s, w) => s + w.priceCents, 0))}` +
      ' · 这些金额都还没有扣款';
    frag.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'wish-list';
    for (const item of items) list.appendChild(wishCard(item, ctx));
    frag.appendChild(list);
  }

  container.appendChild(frag);
  return { focus: () => {} };
}

function wishCard(item, ctx) {
  const li = document.createElement('li');
  li.className = `wish-card wish-status-${item.status}`;

  const head = document.createElement('div');
  head.className = 'wish-head';
  const name = document.createElement('h3');
  name.className = 'wish-name';
  name.textContent = item.name;
  head.appendChild(name);
  head.appendChild(moneyNode(item.priceCents, { className: 'wish-price' }));
  li.appendChild(head);

  const meta = document.createElement('p');
  meta.className = 'wish-meta';
  const bits = [`加入于 ${humanDate(item.addedAt)}`, STATUS_LABEL[item.status] || item.status];
  if (item.plannedDate) bits.push(`计划 ${humanDate(item.plannedDate)}`);
  meta.textContent = bits.join(' · ');
  li.appendChild(meta);

  if (item.reason) {
    const reason = document.createElement('p');
    reason.className = 'wish-reason';
    reason.textContent = `为什么想要：${item.reason}`;
    li.appendChild(reason);
  }

  if (item.status === 'purchased' && item.purchasedAt) {
    const bought = document.createElement('p');
    bought.className = 'wish-meta';
    bought.textContent = `标记已购买：${formatStamp(item.purchasedAt)}`;
    li.appendChild(bought);
  }

  if (item.coolingEnabled && item.status === 'pending') {
    const remaining = ctx.coolingRemainingMs(item);
    const cool = document.createElement('p');
    cool.className = remaining > 0 ? 'cooling-note' : 'cooling-note cooling-note-done';
    cool.textContent = remaining > 0
      ? `冷静期还剩 ${formatRemaining(remaining)} · 这段时间里可以先不买`
      : '24 小时冷静期已过 · 现在可以再想想是否真的需要';
    li.appendChild(cool);
  }

  const actions = document.createElement('div');
  actions.className = 'wish-actions';

  if (item.status !== 'purchased') {
    actions.appendChild(
      button('标记已购买', {
        kind: 'primary',
        onClick: () => handleMarkPurchased(item, ctx),
      }),
    );
  } else if (!item.recordedRecordId || !ctx.getRecordById(item.recordedRecordId)) {
    actions.appendChild(
      button('记实际消费', {
        kind: 'primary',
        onClick: () => handleRecordPurchase(item, ctx),
      }),
    );
  } else {
    const done = document.createElement('p');
    done.className = 'wish-recorded';
    const rec = ctx.getRecordById(item.recordedRecordId);
    done.textContent = `已记账 ¥${formatAmount(rec.amount)} · 不会重复扣款`;
    actions.appendChild(done);
  }

  if (item.status === 'pending') {
    actions.appendChild(
      button('暂不购买', {
        kind: 'ghost',
        onClick: () => {
          ctx.actions.updateWishItem(item.id, { status: 'hold' });
          ctx.toastSuccess(`「${item.name}」已归入暂不购买`);
        },
      }),
    );
  } else {
    actions.appendChild(
      button('回到想买', {
        kind: 'ghost',
        onClick: () => {
          ctx.actions.updateWishItem(item.id, { status: 'pending' });
          ctx.refresh();
        },
      }),
    );
  }

  actions.appendChild(
    button('编辑', { kind: 'ghost', onClick: () => openWishEditor(item.id, ctx) }),
  );

  actions.appendChild(
    button('删除', {
      kind: 'ghost',
      onClick: async () => {
        const ok = await confirmDialog({
          title: '删除这条愿望？',
          message: `将删除「${item.name}」，不会影响任何消费记录和余额。`,
          confirmText: '删除',
          cancelText: '先不删',
          danger: true,
        });
        if (!ok) return;
        const res = ctx.actions.deleteWishItem(item.id);
        if (!res.ok) {
          ctx.toastError(res.error);
          return;
        }
        ctx.toastSuccess('已从愿望清单删除');
      },
    }),
  );

  li.appendChild(actions);
  return li;
}

/** 标记已购买：只改状态，并当场问清楚要不要记账（不自动扣款）。 */
async function handleMarkPurchased(item, ctx) {
  const alreadyRecorded = item.recordedRecordId && ctx.getRecordById(item.recordedRecordId);
  if (alreadyRecorded) {
    ctx.actions.updateWishItem(item.id, { status: 'purchased' });
    ctx.toastSuccess(`「${item.name}」已标记为已购买（此前已记过账，不会重复扣款）`);
    return;
  }

  const body = document.createElement('div');
  body.className = 'stack';
  const p = document.createElement('p');
  p.className = 'confirm-lead';
  p.textContent = `「${item.name}」预计 ¥${formatAmount(item.priceCents)}。标记已购买本身不会扣钱——只有你选「记实际消费」时才会真的从余额里减。`;
  body.appendChild(p);

  const amountField = field({
    label: '实际花了多少（元）',
    type: 'text',
    inputmode: 'decimal',
    value: formatAmount(item.priceCents),
    required: true,
    hint: '按真实花费填写，可以和预计价格不同。',
  });
  amountField.input.setAttribute('data-autofocus', '');
  body.appendChild(amountField.wrap);

  const err = formErrorBox();
  body.appendChild(err.el);

  const handle = openModal({
    title: '标记已购买',
    body,
    focusPrimary: false,
    buttons: [
      {
        text: '只标记，不扣款',
        kind: 'ghost',
        onClick: (h) => {
          h.close('mark-only');
          ctx.actions.markWishPurchased(item.id);
          ctx.toastSuccess(`「${item.name}」已标记为已购买，余额未变`);
        },
      },
      {
        text: '记实际消费',
        kind: 'primary',
        onClick: (h) => {
          const parsed = parseAmountToCents(amountField.input.value);
          if (!parsed.ok) {
            amountField.setError(parsed.error);
            amountField.input.focus();
            return;
          }
          const res = ctx.actions.recordWishPurchase(item.id, parsed.cents, 'shopping');
          if (!res.ok) {
            err.show(res.error);
            return;
          }
          h.close('recorded');
          ctx.toastSuccess(
            `已记账 ¥${formatAmount(parsed.cents)} · 余额 ¥${formatAmount(ctx.getBudgetView().balanceCents)}`,
          );
        },
      },
    ],
  });
  void handle;
}

/** 为已购买但还没扣款的愿望补记一笔实际消费。 */
async function handleRecordPurchase(item, ctx) {
  const body = document.createElement('div');
  body.className = 'stack';
  const p = document.createElement('p');
  p.className = 'confirm-lead';
  p.textContent = '这笔扣款只会发生一次。填你实际花的钱，确认后余额会真的减少。';
  body.appendChild(p);

  const amountField = field({
    label: '实际花了多少（元）',
    type: 'text',
    inputmode: 'decimal',
    value: formatAmount(item.priceCents),
    required: true,
  });
  amountField.input.setAttribute('data-autofocus', '');
  body.appendChild(amountField.wrap);

  const err = formErrorBox();
  body.appendChild(err.el);

  openModal({
    title: `为「${item.name}」记一笔`,
    body,
    focusPrimary: true,
    buttons: [
      { text: '取消', kind: 'ghost', onClick: (h) => h.close('cancel') },
      {
        text: '确认扣款',
        kind: 'primary',
        onClick: (h) => {
          const parsed = parseAmountToCents(amountField.input.value);
          if (!parsed.ok) {
            amountField.setError(parsed.error);
            amountField.input.focus();
            return;
          }
          const res = ctx.actions.recordWishPurchase(item.id, parsed.cents, 'shopping');
          if (!res.ok) {
            err.show(res.error);
            return;
          }
          h.close('recorded');
          ctx.toastSuccess(
            `已记账 ¥${formatAmount(parsed.cents)} · 余额 ¥${formatAmount(ctx.getBudgetView().balanceCents)}`,
          );
        },
      },
    ],
  });
}

/** 新增 / 编辑愿望条目。 */
function openWishEditor(itemId, ctx) {
  const state = ctx.getState();
  const item = itemId ? state.wishlist.find((w) => w.id === itemId) : null;
  if (itemId && !item) {
    ctx.toastError('这条愿望不存在了。');
    return;
  }

  const body = document.createElement('div');
  body.className = 'stack';

  const nameField = field({
    label: '商品名称',
    type: 'text',
    maxlength: 60,
    value: item ? item.name : '',
    placeholder: '例如 降噪耳机',
    required: true,
  });
  nameField.input.setAttribute('data-autofocus', '');
  body.appendChild(nameField.wrap);

  const priceField = field({
    label: '预计价格（元）',
    type: 'text',
    inputmode: 'decimal',
    value: item ? formatAmount(item.priceCents) : '',
    placeholder: '例如 899',
    required: true,
    hint: '只是参考金额，保存愿望不会扣钱。',
  });
  body.appendChild(priceField.wrap);

  const reasonField = field({
    label: '为什么想要',
    type: 'text',
    maxlength: 200,
    value: item ? item.reason : '',
    placeholder: '例如 自习室太吵，想专注一点',
  });
  body.appendChild(reasonField.wrap);

  const plannedField = field({
    label: '计划购买日期（可选）',
    type: 'date',
    value: item && item.plannedDate ? item.plannedDate : '',
  });
  body.appendChild(plannedField.wrap);

  const statusSelect = selectField({
    label: '状态',
    value: item ? item.status : 'pending',
    options: [
      { value: 'pending', label: '想买' },
      { value: 'hold', label: '暂不购买' },
      { value: 'purchased', label: '已购买' },
    ],
  });
  body.appendChild(statusSelect.wrap);

  const cooling = toggleField({
    label: '给自己 24 小时冷静期',
    hint: '从加入清单那天起算 24 小时；这段时间里可以先不买，也不扣钱。',
    checked: item ? item.coolingEnabled : !!state.settings.wishCoolingDefault,
    onChange: () => {},
    onText: '已开启冷静期',
    offText: '不开启冷静期',
  });
  body.appendChild(cooling.wrap);

  const err = formErrorBox();
  body.appendChild(err.el);

  openModal({
    title: item ? '编辑这条愿望' : '添加想买的',
    body,
    focusPrimary: true,
    buttons: [
      { text: '取消', kind: 'ghost', onClick: (h) => h.close('cancel') },
      {
        text: item ? '保存' : '加入清单',
        kind: 'primary',
        onClick: (h) => {
          nameField.clearError();
          priceField.clearError();
          err.show('');

          if (!nameField.input.value.trim()) {
            nameField.setError('请填写商品名称');
            nameField.input.focus();
            return;
          }
          const parsed = parseAmountToCents(priceField.input.value);
          if (!parsed.ok) {
            priceField.setError(parsed.error);
            priceField.input.focus();
            return;
          }

          const payload = {
            name: nameField.input.value.trim(),
            priceCents: parsed.cents,
            reason: reasonField.input.value.trim(),
            plannedDate: plannedField.input.value || '',
            status: statusSelect.select.value,
            coolingEnabled: cooling.input.checked,
          };

          const res = item
            ? ctx.actions.updateWishItem(item.id, payload)
            : ctx.actions.addWishItem(payload);
          if (!res.ok) {
            err.show(res.error);
            return;
          }
          ctx.toastSuccess(item ? '已保存' : `「${payload.name}」已加入愿望清单，尚未扣款`);
          h.close('saved');
        },
      },
    ],
  });
}

function formatRemaining(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return '不到 1 天';
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${Math.max(1, minutes)} 分钟`;
}

function formatStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
