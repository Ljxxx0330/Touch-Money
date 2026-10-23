/**
 * records-view.js —— 消费记录：按日期分组、可筛选、可搜索、可排序，点开可改可删。
 * 编辑与删除之后，余额与统计都会同步重算（数据层负责，这里只负责流程与提示）。
 */

import { card, recordRow, emptyState, detailCell, categoryLabel, catIcon } from '../ui/common.js';
import { field, moneyField, categoryChips, toggleField, button } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { formatAmount, formatCents, parseAmountToCents } from '../core/money.js';
import { CATEGORIES } from '../core/budget.js';

/**
 * 筛选条件记在模块级：改一笔或删一笔之后 app.js 会重画整个视图，
 * 记在这里才不会一删记录筛选就被清空（切到别的页面再切回来也还留着）。
 */
const remembered = { category: 'all', q: '', sort: 'newest', from: '', to: '' };

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function linkBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

/** 带 label 的筛选控件（filter-cell 的口径） */
function filterCell(labelText, input) {
  const cell = el('div', 'filter-cell');
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  const label = el('label', 'field-label', labelText);
  label.htmlFor = id;
  input.id = id;
  cell.appendChild(label);
  cell.appendChild(input);
  return cell;
}

/** 把记录按日期分组（保持传入的顺序，组内同序） */
function groupByDate(records) {
  const groups = [];
  const index = new Map();
  for (const record of records) {
    if (!index.has(record.date)) {
      index.set(record.date, groups.length);
      groups.push({ date: record.date, items: [] });
    }
    groups[index.get(record.date)].items.push(record);
  }
  return groups;
}

/** 编辑模态：改金额 / 名称 / 分类 / 日期 / 备注 / 是否必需 */
function openEdit(record, ctx, closeDetail) {
  const amount = moneyField({ label: '金额（元）', value: (record.amount / 100).toFixed(2) });
  const title = field({ label: '名称', value: record.title, maxlength: 40 });
  const chips = categoryChips({ label: '分类', value: record.category, name: `edit-cat-${record.id}` });
  const date = field({ label: '日期', type: 'date', value: record.date });
  date.input.max = ctx.todayKey();
  const note = field({ label: '备注', type: 'textarea', value: record.note || '', maxlength: 120 });
  const nonEssential = toggleField({
    label: '这笔是非必要消费',
    checked: !!record.isNonEssential,
    hint: '标记它不会改变金额，也不评判你——只是让你在统计里能看见钱花在了哪里。',
  });

  const form = el('form', 'form');
  form.noValidate = true;
  form.append(amount.wrap, title.wrap, chips.wrap, date.wrap, note.wrap, nonEssential.wrap);

  const error = el('p', 'form-error');
  error.hidden = true;
  form.appendChild(error);

  const handle = openModal({
    title: '编辑这笔消费',
    sub: '改动会同步进余额、预算与统计。',
    body: form,
    wide: true,
    focusPrimary: true,
    buttons: [
      { text: '取消', kind: 'ghost', onClick: (h) => h.close('cancel') },
      {
        text: '保存修改',
        kind: 'primary',
        type: 'submit',
        onClick: () => {
          const parsed = parseAmountToCents(amount.getValue());
          if (!parsed.ok) { amount.setError(parsed.error); amount.input.focus(); return; }
          if (!title.input.value.trim()) { title.setError('给这笔消费起个名字'); title.input.focus(); return; }
          if (!date.input.value) { date.setError('选一个日期'); return; }
          const result = ctx.actions.updateRecord(record.id, {
            amount: parsed.cents,
            title: title.input.value.trim(),
            category: chips.getValue(),
            date: date.input.value,
            note: note.input.value.trim(),
            isNonEssential: nonEssential.input.checked,
          });
          if (!result.ok) {
            error.hidden = false;
            error.textContent = result.error || '保存失败。';
            return;
          }
          handle.close('saved');
          if (closeDetail) closeDetail();
          ctx.toastSuccess('已保存，余额与统计同步更新');
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

/**
 * 消费详情模态（ctx.openRecordDetail 与钱包页/记录页共用）。
 * @param {string} recordId @param {object} ctx
 */
export function openRecordDetail(recordId, ctx) {
  const record = ctx.getRecordById(recordId);
  if (!record) {
    ctx.toastError('这条记录已经不在了。');
    return;
  }

  const body = el('div');
  const top = el('div', 'confirm-top');
  const nameBox = el('div');
  nameBox.appendChild(el('p', 'confirm-name', record.title));
  nameBox.appendChild(el('p', 'confirm-meta', `${categoryLabel(record.category)} · ${record.date}${record.isNonEssential ? ' · 非必需' : ' · 视为必需'}`));
  top.appendChild(nameBox);
  top.appendChild(el('p', 'confirm-amt', `−${formatAmount(record.amount)}`));
  body.appendChild(top);

  const list = el('div', 'detail-list');
  list.appendChild(detailCell('分类', categoryLabel(record.category)));
  list.appendChild(detailCell('日期', record.date));
  list.appendChild(detailCell('是否必需', record.isNonEssential ? '标记为非必需' : '视为必需'));
  list.appendChild(detailCell('备注', record.note || '（无）'));
  list.appendChild(detailCell('记录于', record.createdAt ? record.createdAt.replace('T', ' ').slice(0, 16) : '—'));
  list.appendChild(detailCell('修改于', record.updatedAt ? record.updatedAt.replace('T', ' ').slice(0, 16) : '—'));
  body.appendChild(list);
  body.appendChild(el('p', 'detail-note', '删除或修改这笔之后，余额、本月统计与七天趋势都会重新计算。'));

  const detailHandle = { close: () => {} };

  detailHandle.close = () => handle.close('detail');

  const handle = openModal({
    title: '消费详情',
    body,
    wide: true,
    buttons: [
      { text: '编辑', kind: 'ghost', onClick: () => openEdit(record, ctx, () => detailHandle.close()) },
      {
        text: '删除',
        kind: 'danger',
        onClick: async () => {
          const yes = await confirmDialog({
            title: '删除这笔消费？',
            message: `将删除「${record.title}」${formatCents(record.amount)} 元。`,
            detail: '删除后余额与本月统计会同步恢复，此操作不可撤销。',
            confirmText: '删除',
            cancelText: '先不删',
            danger: true,
          });
          if (!yes) return;
          const result = ctx.actions.deleteRecord(record.id);
          if (!result.ok) { ctx.toastError(result.error || '删除失败。'); return; }
          handle.close('deleted');
          ctx.toast('已删除，余额与统计已同步更新', { level: 'success' });
        },
      },
    ],
  });
}

export function renderRecordsView(content, ctx) {
  const state = ctx.getState();
  // 从模块级记忆里取上次的筛选条件：删一笔之后整个视图重画，筛选还得在
  const filters = { ...remembered };

  /* ---------- 分类：横向滑动的药丸（设计稿里就是这个样子） ---------- */
  const pillRow = el('div', 'pill-row');
  pillRow.setAttribute('role', 'group');
  pillRow.setAttribute('aria-label', '按分类筛选记录');
  const pills = [];
  function addPill(value, label, withIcon) {
    const btn = el('button', 'pill');
    btn.type = 'button';
    if (withIcon) btn.appendChild(catIcon(value, 15));
    btn.appendChild(el('span', null, label));
    btn.dataset.value = value;
    btn.addEventListener('click', () => {
      filters.category = value;
      syncPills();
      render();
    });
    pills.push({ btn, value });
    pillRow.appendChild(btn);
  }
  addPill('all', '全部分类', false);
  for (const cat of CATEGORIES) addPill(cat.id, cat.label, true);
  function syncPills() {
    for (const pill of pills) {
      const active = pill.value === filters.category;
      pill.btn.classList.toggle('is-active', active);
      pill.btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  /* ---------- 搜索、排序、日期：默认收起，标题栏的搜索按钮展开 ---------- */
  const panel = el('div', 'search-row');
  panel.hidden = true;
  const search = el('input', 'input');
  search.type = 'search';
  search.placeholder = '搜名称或备注';
  search.setAttribute('aria-label', '按名称或备注搜索记录');
  search.style.marginBottom = '10px';
  const sortSelect = el('select', 'select');
  sortSelect.setAttribute('aria-label', '记录排序方式');
  for (const opt of [
    { value: 'newest', label: '最新在前' },
    { value: 'oldest', label: '最早在前' },
    { value: 'amount', label: '金额从大到小' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    sortSelect.appendChild(option);
  }
  const fromInput = el('input', 'input');
  fromInput.type = 'date';
  fromInput.setAttribute('aria-label', '只看这个日期之后的记录');
  const toInput = el('input', 'input');
  toInput.type = 'date';
  toInput.setAttribute('aria-label', '只看这个日期之前的记录');
  const grid = el('div', 'filter-grid');
  grid.appendChild(filterCell('排序', sortSelect));
  grid.appendChild(filterCell('起始日期', fromInput));
  grid.appendChild(filterCell('结束日期', toInput));
  panel.append(search, grid);

  // 回填上次的筛选条件（控件是新建的，值得从记忆里搬过来）
  search.value = filters.q;
  sortSelect.value = filters.sort;
  fromInput.value = filters.from;
  toInput.value = filters.to;
  if (filters.q) panel.hidden = false;

  const stateLine = el('div', 'filter-state');
  const stateText = el('span');
  const clearBtn = linkBtn('清除筛选', () => {
    filters.category = 'all';
    filters.q = '';
    filters.from = '';
    filters.to = '';
    search.value = '';
    fromInput.value = '';
    toInput.value = '';
    render();
  });
  clearBtn.hidden = true;
  stateLine.append(stateText, clearBtn);

  const summary = el('p', 'list-summary');
  const listHost = el('div');

  /** 按当前筛选条件重画列表 */
  function render() {
    // 记回模块级：重画之后筛选条件还在
    Object.assign(remembered, filters);
    syncPills();
    const all = ctx.sortedRecords(state.records);
    const query = filters.q.trim().toLowerCase();
    let rows = all.filter((r) => {
      // 日期 key 是 YYYY-MM-DD，直接按字符串比大小就是按日期比
      if (filters.from && r.date < filters.from) return false;
      if (filters.to && r.date > filters.to) return false;
      if (filters.category !== 'all' && r.category !== filters.category) return false;
      if (query) {
        const hay = `${r.title} ${r.note || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
    if (filters.sort === 'oldest') rows = rows.slice().reverse();
    else if (filters.sort === 'amount') rows = rows.slice().sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : 1));

    const active = [];
    if (filters.category !== 'all') active.push(`分类：${categoryLabel(filters.category)}`);
    if (query) active.push(`搜索「${filters.q.trim()}」`);
    if (filters.sort !== 'newest') active.push(`排序：${sortSelect.selectedOptions[0].label}`);
    if (filters.from || filters.to) active.push(`日期：${filters.from || '最早'} 至 ${filters.to || '不限'}`);

    const hasFilter = filters.category !== 'all' || !!query || !!filters.from || !!filters.to;
    clearBtn.hidden = !hasFilter;
    stateText.textContent = active.length ? `正在筛选：${active.join(' · ')}` : `显示全部 ${all.length} 笔记录`;

    listHost.textContent = '';
    if (!rows.length) {
      listHost.appendChild(emptyState(
        all.length ? '没有符合当前筛选条件的记录。' : '还没有任何消费记录。记一笔之后，这里会按日期把它们排好。',
        all.length ? linkBtn('清除筛选', () => clearBtn.click()) : button('去记一笔', { kind: 'primary', icon: 'plus', onClick: () => ctx.navigate('add') }),
        'list',
      ));
      summary.hidden = true;
      return;
    }
    summary.hidden = false;
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    summary.textContent = '';
    summary.appendChild(el('b', null, `${rows.length} 笔`));
    summary.appendChild(el('span', null, ` · 合计 ${formatCents(total)} 元`));

    for (const group of groupByDate(rows)) {
      const section = el('div', 'day-group');
      const head = el('div', 'day-head');
      head.appendChild(el('span', 'day-title', ctx.humanDate(group.date)));
      head.appendChild(el('span', 'day-sub', group.date));
      head.appendChild(el('span', 'day-total', formatAmount(group.items.reduce((sum, r) => sum + r.amount, 0))));
      section.appendChild(head);
      const list = el('div', 'row-list');
      for (const record of group.items) list.appendChild(recordRow(record, (id) => ctx.openRecordDetail(id)));
      section.appendChild(list);
      listHost.appendChild(section);
    }
  }

  search.addEventListener('input', () => { filters.q = search.value; render(); });
  sortSelect.addEventListener('change', () => { filters.sort = sortSelect.value; render(); });
  fromInput.addEventListener('change', () => { filters.from = fromInput.value; render(); });
  toInput.addEventListener('change', () => { filters.to = toInput.value; render(); });

  // 标题栏右侧的搜索按钮：展开或收起这一排筛选条件
  ctx.setHeaderAction({
    icon: 'search',
    label: '搜索与筛选',
    onClick: () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden) {
        if (filters.q) {
          filters.q = '';
          search.value = '';
          render();
        }
      } else {
        search.focus();
      }
    },
  });

  content.appendChild(pillRow);
  const result = card({ headingLevel: 3 });
  result.body.append(panel, stateLine, summary, listHost);
  content.appendChild(result.section);

  render();
}
