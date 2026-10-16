/**
 * add-view.js —— 「记一笔」表单 + 「消费感知」确认 + 现金动画。
 *
 * 流程：填写 → 校验 → 确认面板（消费前/后余额、本月已消费、剩余预算、占生活费比例）
 *      → 只有点「确认并记录」才写数据 → 动画只是表现层。
 */

import { todayKey } from '../core/dates.js';
import { formatAmount, parseAmountToCents, percentText } from '../core/money.js';
import { shareOfFee } from '../core/budget.js';
import { field, categoryChips, toggleField, button, formErrorBox, submitGuard } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { playCashAnimation } from '../ui/overlay.js';
import { card, moneyNode } from '../ui/common.js';

export function renderAddView(container, ctx) {
  const state = ctx.getState();
  const view = ctx.getBudgetView();
  const configured = ctx.isConfigured();

  const frag = document.createDocumentFragment();

  if (!configured) {
    const notice = document.createElement('p');
    notice.className = 'notice-inline';
    notice.textContent = '还没有设置本月生活费。你可以先记账（余额会变成负数，代表超出计划），也可以先去设定生活费。';
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.appendChild(button('去设置生活费', { kind: 'primary', onClick: () => ctx.navigate('budget') }));
    frag.appendChild(notice);
    frag.appendChild(row);
  }

  const { section, body } = card({ title: '这一笔花在了哪里' });

  const amountField = field({
    label: '金额（元）',
    type: 'text',
    inputmode: 'decimal',
    placeholder: '例如 18.00',
    required: true,
    hint: '最多两位小数，金额一律以「分」为单位保存，不会有浮点误差。',
  });
  amountField.input.setAttribute('data-autofocus', '');
  amountField.input.setAttribute('autocomplete', 'off');
  body.appendChild(amountField.wrap);

  const titleField = field({
    label: '消费名称',
    type: 'text',
    maxlength: 60,
    placeholder: '例如 食堂午饭',
    required: true,
  });
  body.appendChild(titleField.wrap);

  const chips = categoryChips({ label: '分类', value: 'food' });
  body.appendChild(chips.wrap);

  const dateField = field({
    label: '日期',
    type: 'date',
    value: todayKey(),
    required: true,
    hint: '默认今天。日期按本地时区统计，不会因为时区换算跑错月份。',
  });
  dateField.input.max = todayKey();
  body.appendChild(dateField.wrap);

  const noteField = field({
    label: '备注（可选）',
    type: 'text',
    maxlength: 200,
    placeholder: '一句话记下当时的情形',
  });
  body.appendChild(noteField.wrap);

  const nonEssential = toggleField({
    label: '这笔不是必需的吗？',
    hint: '只是给自己一个提示，统计里会单独看它，不会阻止你记录。',
    checked: false,
    onChange: () => {},
    onText: '标记为非必需',
    offText: '视为必需',
  });
  body.appendChild(nonEssential.wrap);

  const preview = document.createElement('div');
  preview.className = 'live-preview';
  const previewText = document.createElement('p');
  previewText.className = 'live-preview-text';
  preview.appendChild(previewText);
  body.appendChild(preview);

  const formErr = formErrorBox();
  body.appendChild(formErr.el);

  const actions = document.createElement('div');
  actions.className = 'btn-row';
  const submit = button('确认这笔消费', { kind: 'primary', type: 'submit' });
  actions.appendChild(submit);
  const reset = button('清空', {
    kind: 'ghost',
    onClick: () => {
      amountField.input.value = '';
      titleField.input.value = '';
      noteField.input.value = '';
      dateField.input.value = todayKey();
      chips.setValue('food');
      nonEssential.input.checked = false;
      nonEssential.renderState();
      amountField.clearError();
      titleField.clearError();
      formErr.show('');
      renderPreview();
      amountField.input.focus();
    },
  });
  actions.appendChild(reset);
  body.appendChild(actions);

  const form = document.createElement('form');
  form.className = 'stack';
  while (body.firstChild) form.appendChild(body.firstChild);
  form.appendChild(actions);
  body.appendChild(form);

  function renderPreview() {
    const parsed = parseAmountToCents(amountField.input.value);
    if (!parsed.ok) {
      previewText.textContent = `当前可支配余额 ¥${formatAmount(view.balanceCents)} · 输入金额后这里会显示消费后的余额`;
      preview.classList.remove('is-negative');
      return;
    }
    const after = view.balanceCents - parsed.cents;
    previewText.textContent =
      `消费后余额：¥${formatAmount(view.balanceCents)} → ¥${formatAmount(after)}` +
      (after < 0 ? ' · 会透支' : '');
    preview.classList.toggle('is-negative', after < 0);
  }

  amountField.input.addEventListener('input', renderPreview);
  renderPreview();

  let submitting = false;

  const onSubmit = submitGuard(async (event) => {
    event.preventDefault();
    if (submitting) return;

    amountField.clearError();
    titleField.clearError();
    formErr.show('');

    const parsed = parseAmountToCents(amountField.input.value);
    if (!parsed.ok) {
      amountField.setError(parsed.error);
      amountField.input.focus();
      return;
    }
    const title = titleField.input.value.trim();
    if (!title) {
      titleField.setError('请填写消费名称');
      titleField.input.focus();
      return;
    }
    const date = dateField.input.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dateField.setError('请选择有效日期');
      return;
    }

    submitting = true;
    submit.disabled = true;
    submit.textContent = '正在确认…';

    const category = chips.getValue();
    const note = noteField.input.value.trim();
    const isNonEssential = nonEssential.input.checked;

    try {
      await openConfirm({
        amountCents: parsed.cents,
        title,
        category,
        date,
        note,
        isNonEssential,
      });
    } finally {
      submitting = false;
      submit.disabled = false;
      submit.textContent = '确认这笔消费';
    }
  });

  form.addEventListener('submit', onSubmit);

  /** 消费感知确认面板。返回 true 表示已保存。 */
  function openConfirm(payload) {
    const before = ctx.getBudgetView();
    const afterBalance = before.balanceCents - payload.amountCents;
    const afterSpent = before.monthSpentCents + payload.amountCents;
    const afterRemaining = before.remainingCents - payload.amountCents;
    const share = shareOfFee(payload.amountCents, before.monthlyFeeCents);
    const sharePercent = percentText(share * 100);

    return new Promise((resolve) => {
      let saved = false;
      const wrap = document.createElement('div');
      wrap.className = 'confirm-panel';

      const lead = document.createElement('p');
      lead.className = 'confirm-lead';
      lead.textContent = '先看清楚这笔钱离开钱包之后的样子，再决定要不要记下来。';
      wrap.appendChild(lead);

      const hero = document.createElement('div');
      hero.className = 'confirm-hero';
      const heroTitle = document.createElement('p');
      heroTitle.className = 'confirm-hero-title';
      heroTitle.textContent = payload.title;
      hero.appendChild(heroTitle);
      hero.appendChild(moneyNode(payload.amountCents, { sign: '-', className: 'confirm-hero-amount' }));
      const heroMeta = document.createElement('p');
      heroMeta.className = 'record-meta';
      heroMeta.textContent = `${ctx.categoryLabel(payload.category)} · ${payload.date}${payload.isNonEssential ? ' · 非必需' : ''}`;
      hero.appendChild(heroMeta);
      wrap.appendChild(hero);

      const grid = document.createElement('dl');
      grid.className = 'confirm-grid';
      grid.appendChild(gridItem('消费前余额', `¥${formatAmount(before.balanceCents)}`));
      grid.appendChild(gridItem('消费后余额', `¥${formatAmount(afterBalance)}`, afterBalance < 0));
      grid.appendChild(gridItem('本月已消费', `¥${formatAmount(afterSpent)}`));
      grid.appendChild(gridItem('本月剩余预算', `¥${formatAmount(afterRemaining)}`, afterRemaining < 0));
      wrap.appendChild(grid);

      const shareBox = document.createElement('div');
      shareBox.className = 'confirm-share';
      const shareLabel = document.createElement('p');
      shareLabel.className = 'confirm-share-label';
      shareLabel.textContent = before.monthlyFeeCents > 0
        ? `本笔占本月初始生活费（¥${formatAmount(before.monthlyFeeCents)}）的 ${sharePercent}%`
        : '尚未设置本月初始生活费，暂时无法计算占比';
      shareBox.appendChild(shareLabel);
      if (before.monthlyFeeCents > 0) {
        const bar = document.createElement('div');
        bar.className = 'confirm-share-bar';
        const fill = document.createElement('div');
        fill.className = 'confirm-share-fill';
        fill.style.width = `${Math.max(1, Math.min(100, sharePercent))}%`;
        bar.appendChild(fill);
        shareBox.appendChild(bar);
      }
      wrap.appendChild(shareBox);

      if (afterBalance < 0) {
        const warn = document.createElement('p');
        warn.className = 'notice-inline notice-warn';
        warn.textContent = '余额会不足，但这笔消费是真实发生的，触钱不会阻止你记录它。';
        wrap.appendChild(warn);
      }

      const handle = openModal({
        title: '确认这笔消费',
        body: wrap,
        closeOnEsc: true,
        buttons: [
          {
            text: '返回修改',
            kind: 'ghost',
            onClick: (h) => h.close('back'),
          },
          {
            text: '确认并记录',
            kind: 'primary',
            onClick: async (h) => {
              h.close('confirm');
              const res = ctx.actions.addRecord({
                amount: payload.amountCents,
                title: payload.title,
                category: payload.category,
                date: payload.date,
                note: payload.note,
                isNonEssential: payload.isNonEssential,
              });
              if (!res.ok) {
                ctx.toastError(res.error || '保存失败');
                resolve(false);
                return;
              }
              saved = true;
              // 数据已经保存，下面只是把它「演」出来；动画失败也不影响结果。
              try {
                await playCashAnimation({
                  amountCents: payload.amountCents,
                  beforeCents: before.balanceCents,
                  afterCents: afterBalance,
                  title: payload.title,
                  categoryLabel: ctx.categoryLabel(payload.category),
                });
              } catch (err) {
                console.warn('现金动画异常：', err);
              }
              ctx.toastSuccess(`已记录：${payload.title} ¥${formatAmount(payload.amountCents)} · 余额 ¥${formatAmount(afterBalance)}`);
              ctx.navigate('wallet');
              resolve(true);
            },
          },
        ],
        onClose: (reason) => {
          if (!saved) resolve(false);
        },
      });
      void handle;
    });
  }

  frag.appendChild(section);

  const hint = document.createElement('p');
  hint.className = 'muted-note';
  hint.textContent = '触钱不收集支付密码、银行卡密码或微信支付凭证，也不连接任何支付系统。';
  frag.appendChild(hint);

  container.appendChild(frag);
  return { focus: () => amountField.input.focus() };
}

function gridItem(label, value, negative = false) {
  const item = document.createElement('div');
  item.className = 'confirm-item';
  const dt = document.createElement('dt');
  dt.className = 'confirm-label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = `confirm-value${negative ? ' is-negative' : ''}`;
  dd.textContent = value;
  item.appendChild(dt);
  item.appendChild(dd);
  return item;
}
