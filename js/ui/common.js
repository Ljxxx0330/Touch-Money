/**
 * common.js —— 视图层通用小工具：卡片骨架、行内金额、分类色、空状态。
 */

import { categoryLabel } from '../core/budget.js';
import { formatAmount } from '../core/money.js';

/** 分类色（CSS 变量驱动，data-cat 决定实际颜色）。 */
export function catDot(category) {
  const dot = document.createElement('span');
  dot.className = 'cat-dot';
  dot.dataset.cat = category;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

export function catLabel(category) {
  return categoryLabel(category);
}

/** 行内金额文本（负数余额用括号外的负号）。 */
export function moneyText(cents) {
  return formatAmount(cents);
}

/** 金额节点：¥ 符号小、数字大，便于扫读。 */
export function moneyNode(cents, { sign = '', className = '' } = {}) {
  const span = document.createElement('span');
  span.className = `money ${className}`.trim();
  const sym = document.createElement('span');
  sym.className = 'money-sym';
  sym.textContent = sign + '¥';
  const num = document.createElement('span');
  num.className = 'money-num';
  const text = formatAmount(cents);
  const negative = text.startsWith('-');
  if (negative) {
    sym.textContent = '-¥';
    num.textContent = text.slice(1);
  } else {
    num.textContent = text;
  }
  span.appendChild(sym);
  span.appendChild(num);
  return span;
}

/**
 * 卡片骨架。
 * @param {{title?:string, action?:Node, className?:string, level?:number}} opts
 * @returns {{section:HTMLElement, body:HTMLElement, heading:HTMLElement}}
 */
export function card(opts = {}) {
  const section = document.createElement('section');
  section.className = `card${opts.className ? ' ' + opts.className : ''}`;
  const heading = document.createElement('div');
  heading.className = 'card-head';
  if (opts.title) {
    const h = document.createElement(opts.level === 3 ? 'h3' : 'h2');
    h.className = opts.level === 3 ? 'card-title-3' : 'card-title';
    h.textContent = opts.title;
    heading.appendChild(h);
  }
  if (opts.action) heading.appendChild(opts.action);
  if (opts.title || opts.action) section.appendChild(heading);
  const body = document.createElement('div');
  body.className = 'card-body';
  section.appendChild(body);
  return { section, body, heading };
}

/** 空状态。 */
export function emptyState(text, actionNode) {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const icon = document.createElement('div');
  icon.className = 'empty-mark';
  icon.setAttribute('aria-hidden', 'true');
  wrap.appendChild(icon);
  const p = document.createElement('p');
  p.className = 'empty-text';
  p.textContent = text;
  wrap.appendChild(p);
  if (actionNode) wrap.appendChild(actionNode);
  return wrap;
}

/** 链接式按钮。 */
export function linkButton(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

/** 消费记录行（点击打开详情）。 */
export function recordRow(record, onClick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'record-row';
  row.dataset.cat = record.category;
  row.addEventListener('click', () => onClick(record));

  row.appendChild(catDot(record.category));

  const info = document.createElement('span');
  info.className = 'record-info';
  const title = document.createElement('span');
  title.className = 'record-title';
  title.textContent = record.title;
  info.appendChild(title);
  const meta = document.createElement('span');
  meta.className = 'record-meta';
  const bits = [catLabel(record.category)];
  if (record.isNonEssential) bits.push('非必需');
  if (record.note) bits.push(record.note);
  meta.textContent = bits.join(' · ');
  info.appendChild(meta);
  row.appendChild(info);

  const amount = moneyNode(record.amount, { sign: '-', className: 'record-amount' });
  row.appendChild(amount);

  return row;
}

/** 进度条。ratio 会被限制到 0..1，超支时加 is-over 类。 */
export function progressBar(ratio, { over = false, label = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `progress${over ? ' is-over' : ''}`;
  const track = document.createElement('div');
  track.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
  fill.style.width = `${(clamped * 100).toFixed(1)}%`;
  track.appendChild(fill);
  wrap.appendChild(track);
  if (label) {
    const text = document.createElement('p');
    text.className = 'progress-label';
    text.textContent = label;
    wrap.appendChild(text);
  }
  return wrap;
}

/** 一行「标签：值」的统计项。 */
export function statLine(label, valueNode, { hint = '' } = {}) {
  const row = document.createElement('div');
  row.className = 'stat-line';
  const l = document.createElement('span');
  l.className = 'stat-label';
  l.textContent = label;
  row.appendChild(l);
  const v = document.createElement('span');
  v.className = 'stat-value';
  if (typeof valueNode === 'string') v.textContent = valueNode;
  else v.appendChild(valueNode);
  row.appendChild(v);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'stat-hint';
    h.textContent = hint;
    row.appendChild(h);
  }
  return row;
}