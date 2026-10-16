/**
 * records-view.js —— 消费记录：按日期分组查看、分类筛选、搜索、查看详情、编辑、删除。
 * 编辑/删除后余额与统计由 state 层统一重算，这里只负责展示与交互。
 */

import { humanDate } from '../core/dates.js';
import { formatAmount, parseAmountToCents } from '../core/money.js';
import { CATEGORIES } from '../core/budget.js';
import { card, emptyState, moneyNode } from '../ui/common.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { field, categoryChips, toggleField, button, formErrorBox } from '../ui/form.js';

export function renderRecordsView(container, ctx) {
  const state = ctx.getState();

  const filters = document.createElement('div');
  filters.className = 'filter-bar';

  const catSelect = document.createElement('label');
  catSelect.className = 'filter-item';
  const catLabel = document.createElement('span');
  catLabel.className = 'filter-label';
  catLabel.textContent = '分类';
  const cat = document.createElement('select');
  cat.className = 'input select';
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = '全部分类';
  cat.appendChild(allOption);
  for (const c of CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    cat.appendChild(opt);
  }
  catSelect.appendChild(catLabel);
  catSelect.appendChild(cat);
  filters.appendChild(catSelect);

  const searchWrap = document.createElement('label');
  searchWrap.className = 'filter-item filter-item-grow';
  const searchLabel = document.createElement('span');
  searchLabel.className = 'filter-label';
  searchLabel.textContent = '搜索';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input';
  search.placeholder = '名称或备注';
  search.setAttribute('aria-label', '按名称或备注搜索');
  searchWrap.appendChild(searchLabel);
  searchWrap.appendChild(search);
  filters.appendChild(searchWrap);

  const listHost = document.createElement('div');

  function applyFilters() {
    const catValue = cat.value;
    const term = search.value.trim().toLowerCase();
    const filtered = ctx.sortedRecords(state.records).filter((r) => {
      if (catValue && r.category !== catValue) return false;
      if (!term) return true;
      return (
        r.title.toLowerCase().includes(term) ||
        (r.note || '').toLowerCase().includes(term)
      );
    });
    renderList(filtered, { catValue, term });
  }

  function renderList(records, meta) {
    listHost.textContent = '';
    if (records.length === 0) {
      const hasAny = state.records.length > 0;
      listHost.appendChild(
        emptyState(
          hasAny
            ? '没有符合当前筛选条件的记录。'
            : '还没有任何消费记录。记一笔之后，这里会按日期列出你的每一笔消费。',
          hasAny
            ? button('清除筛选', {
                kind: 'ghost',
                onClick: () => {
                  cat.value = '';
                  search.value = '';
                  applyFilters();
                },
              })
            : button('记一笔', { kind: 'primary', onClick: () => ctx.navigate('add') }),
        ),
      );
      return;
    }

    const summary = document.createElement('p');
    summary.className = 'list-summary';
    const total = records.reduce((s, r) => s + r.amount, 0);
    summary.textContent = `共 ${records.length} 笔 · 合计 ¥${formatAmount(total)}` +
      (meta.catValue ? ` · 分类：${ctx.categoryLabel(meta.catValue)}` : '') +
      (meta.term ? ` · 搜索「${search.value.trim()}」` : '');
    listHost.appendChild(summary);

    const groups = new Map();
    for (const r of records) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }

    for (const [dateKey, items] of groups) {
      const group = document.createElement('section');
      group.className = 'day-group';
      const head = document.createElement('div');
      head.className = 'day-head';
      const label = document.createElement('h3');
      label.className = 'day-title';
      label.textContent = humanDate(dateKey);
      const sub = document.createElement('span');
      sub.className = 'day-sub';
      sub.textContent = dateKey;
      head.appendChild(label);
      head.appendChild(sub);
      const dayTotal = document.createElement('span');
      dayTotal.className = 'day-total';
      dayTotal.textContent = `¥${formatAmount(items.reduce((s, r) => s + r.amount, 0))}`;
      head.appendChild(dayTotal);
      group.appendChild(head);

      const ul = document.createElement('ul');
      ul.className = 'record-list';
      for (const r of items) {
        const li = document.createElement('li');
        li.appendChild(recordButton(r, ctx));
        ul.appendChild(li);
      }
      group.appendChild(ul);
      listHost.appendChild(group);
    }
  }

  cat.addEventListener('change', applyFilters);
  search.addEventListener('input', applyFilters);

  const { section, body } = card({ title: '全部消费记录' });
  body.appendChild(filters);
  body.appendChild(listHost);
  container.appendChild(section);

  applyFilters();
  return { focus: () => {} };
}

function recordButton(record, ctx) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'record-row';
  btn.dataset.cat = record.category;
  btn.addEventListener('click', () => openRecordDetail(record.id, ctx));

  const dot = document.createElement('span');
  dot.className = 'cat-dot';
  dot.dataset.cat = record.category;
  dot.setAttribute('aria-hidden', 'true');
  btn.appendChild(dot);

  const info = document.createElement('span');
  info.className = 'record-info';
  const title = document.createElement('span');
  title.className = 'record-title';
  title.textContent = record.title;
  info.appendChild(title);
  const meta = document.createElement('span');
  meta.className = 'record-meta';
  const bits = [ctx.categoryLabel(record.category)];
  if (record.isNonEssential) bits.push('非必需');
  if (record.note) bits.push(record.note);
  meta.textContent = bits.join(' · ');
  info.appendChild(meta);
  btn.appendChild(info);

  btn.appendChild(moneyNode(record.amount, { sign: '-', className: 'record-amount' }));
  return btn;
}

/**
 * 记录详情模态框（查看 / 编辑 / 删除）。
 * 首页「最近消费」也复用这里，所以从本模块导出。
 */
export function openRecordDetail(recordId, ctx) {
  const record = ctx.getRecordById(recordId);
  if (!record) {
    ctx.toastError('这条记录已经不存在了，可能刚被删除。');
    return;
  }

  const viewWrap = viewBody(record, ctx);
  const handle = openModal({
    title: '消费详情',
    body: viewWrap,
    buttons: [
      {
        text: '编辑',
        kind: 'ghost',
        onClick: (h) => {
          h.close('edit');
          openEdit(record.id, ctx);
        },
      },
      {
        text: '删除',
        kind: 'danger',
        onClick: async (h) => {
          const ok = await confirmDialog({
            title: '删除这笔消费？',
            message: `将删除「${record.title}」¥${formatAmount(record.amount)}。`,
            detail: '删除后余额与本月统计会同步恢复，此操作不可撤销。',
            confirmText: '删除',
            cancelText: '先不删',
            danger: true,
          });
          if (!ok) return;
          const res = ctx.actions.deleteRecord(record.id);
          if (!res.ok) {
            ctx.toastError(res.error);
            return;
          }
          ctx.toastSuccess('已删除，余额与统计已同步更新');
          h.close('deleted');
        },
      },
    ],
  });
}

function viewBody(record, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-panel';

  const hero = document.createElement('div');
  hero.className = 'confirm-hero';
  const t = document.createElement('p');
  t.className = 'confirm-hero-title';
  t.textContent = record.title;
  hero.appendChild(t);
  hero.appendChild(moneyNode(record.amount, { sign: '-', className: 'confirm-hero-amount' }));
  wrap.appendChild(hero);

  const grid = document.createElement('dl');
  grid.className = 'confirm-grid';
  grid.appendChild(gridItem('分类', ctx.categoryLabel(record.category)));
  grid.appendChild(gridItem('日期', record.date));
  grid.appendChild(gridItem('是否必需', record.isNonEssential ? '标记为非必需' : '视为必需'));
  grid.appendChild(gridItem('备注', record.note || '（无）'));
  wrap.appendChild(grid);

  const stamp = document.createElement('p');
  stamp.className = 'muted-note';
  stamp.textContent = `记录于 ${formatStamp(record.createdAt)} · 修改于 ${formatStamp(record.updatedAt)}`;
  wrap.appendChild(stamp);

  return wrap;
}

function gridItem(label, value) {
  const item = document.createElement('div');
  item.className = 'confirm-item';
  const dt = document.createElement('dt');
  dt.className = 'confirm-label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = 'confirm-value';
  dd.textContent = value;
  item.appendChild(dt);
  item.appendChild(dd);
  return item;
}

function formatStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 编辑模态框。 */
function openEdit(recordId, ctx) {
  const record = ctx.getRecordById(recordId);
  if (!record) {
    ctx.toastError('这条记录已经不存在了。');
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'stack';

  const amountField = field({
    label: '金额（元）',
    type: 'text',
    inputmode: 'decimal',
    value: formatAmount(record.amount),
    required: true,
  });
  amountField.input.setAttribute('data-autofocus', '');
  wrap.appendChild(amountField.wrap);

  const titleField = field({
    label: '消费名称',
    type: 'text',
    maxlength: 60,
    value: record.title,
    required: true,
  });
  wrap.appendChild(titleField.wrap);

  const chips = categoryChips({ label: '分类', value: record.category });
  wrap.appendChild(chips.wrap);

  const dateField = field({ label: '日期', type: 'date', value: record.date, required: true });
  wrap.appendChild(dateField.wrap);

  const noteField = field({ label: '备注（可选）', type: 'text', maxlength: 200, value: record.note || '' });
  wrap.appendChild(noteField.wrap);

  const nonEssential = toggleField({
    label: '这笔不是必需的吗？',
    checked: record.isNonEssential,
    onChange: () => {},
    onText: '标记为非必需',
    offText: '视为必需',
  });
  wrap.appendChild(nonEssential.wrap);

  const err = formErrorBox();
  wrap.appendChild(err.el);

  openModal({
    title: '编辑这笔消费',
    body: wrap,
    focusPrimary: true,
    buttons: [
      { text: '取消', kind: 'ghost', onClick: (h) => h.close('cancel') },
      {
        text: '保存修改',
        kind: 'primary',
        onClick: (h) => {
          amountField.clearError();
          titleField.clearError();
          err.show('');

          const parsed = parseAmountToCents(amountField.input.value);
          if (!parsed.ok) {
            amountField.setError(parsed.error);
            amountField.input.focus();
            return;
          }
          if (!titleField.input.value.trim()) {
            titleField.setError('请填写消费名称');
            titleField.input.focus();
            return;
          }

          const res = ctx.actions.updateRecord(record.id, {
            amount: parsed.cents,
            title: titleField.input.value.trim(),
            category: chips.getValue(),
            date: dateField.input.value,
            note: noteField.input.value.trim(),
            isNonEssential: nonEssential.input.checked,
          });
          if (!res.ok) {
            if (res.error.includes('金额')) amountField.setError(res.error);
            else if (res.error.includes('名称')) titleField.setError(res.error);
            else err.show(res.error);
            return;
          }
          ctx.toastSuccess('已保存，余额与统计同步更新');
          h.close('saved');
        },
      },
    ],
  });
}
