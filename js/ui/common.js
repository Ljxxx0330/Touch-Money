/**
 * common.js —— 视图层共用的构建块（卡片、金额、记录行、图表单元）。
 * 只负责「造 DOM」，业务判断留给各视图。
 */

import { icon } from './icons.js';
import { categoryLabel } from '../core/budget.js';
import { formatAmount, formatCents, percentText, toPercent } from '../core/money.js';

/** 分类 → 图标名（原创 SVG，不用 emoji） */
export const CAT_ICONS = {
  food: 'food',
  transport: 'transport',
  study: 'study',
  shopping: 'shopping',
  fun: 'fun',
  daily: 'daily',
  other: 'other',
};

export { categoryLabel };

/** @param {string} category @param {number} [size] */
export function catIcon(category, size) {
  return icon(CAT_ICONS[category] || 'other', { size: size || 20 });
}

/** 分类色点（同时通过 data-cat 拿到配色） */
export function catDot(category) {
  const span = document.createElement('span');
  span.className = 'cat-dot';
  span.dataset.cat = category || 'other';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/** @param {number} cents @returns {string} */
export function moneyText(cents) {
  return formatAmount(cents);
}

/**
 * 金额节点：¥ 符号与数字分开，便于分别控制字号。
 * @param {number} cents
 * @param {{sign?: ''|'-'|'+', className?: string, hideSymbol?: boolean}} [opts]
 */
export function moneyNode(cents, opts = {}) {
  const wrap = document.createElement('span');
  wrap.className = `money${opts.className ? ' ' + opts.className : ''}`;
  const abs = Math.abs(Math.round(cents || 0));
  if (opts.sign === '-') {
    const sym = document.createElement('span');
    sym.className = 'money-sym';
    sym.textContent = '−';
    wrap.appendChild(sym);
  } else if (opts.sign === '+') {
    const sym = document.createElement('span');
    sym.className = 'money-sym';
    sym.textContent = '+';
    wrap.appendChild(sym);
  }
  if (!opts.hideSymbol) {
    const yuan = document.createElement('span');
    yuan.className = 'money-sym';
    yuan.textContent = '¥';
    wrap.appendChild(yuan);
  }
  const num = document.createElement('span');
  num.className = 'money-num';
  num.textContent = formatAmount(abs);
  wrap.appendChild(num);
  // 语义文本给读屏用（避免符号被逐字朗读）
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = `${opts.sign === '-' ? '支出 ' : opts.sign === '+' ? '收入 ' : ''}${formatCents(abs)} 元`;
  wrap.appendChild(sr);
  return wrap;
}

/**
 * 卡片外壳。
 * @param {{title?: string, sub?: string, action?: Node, actions?: Node[], className?: string, level?: 'info'|'warn'|'danger', headingLevel?: 2|3}} [opts]
 * @returns {{section: HTMLElement, body: HTMLElement, heading: HTMLElement, actions: HTMLElement}}
 */
export function card(opts = {}) {
  const section = document.createElement('section');
  section.className = `card${opts.className ? ' ' + opts.className : ''}`;
  if (opts.level === 'warn') section.classList.add('card-level-warn');
  if (opts.level === 'danger') section.classList.add('card-level-danger');

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  let heading;
  if (opts.title || opts.actions || opts.action) {
    const head = document.createElement('div');
    head.className = 'card-head';
    const Tag = `h${opts.headingLevel === 3 ? 3 : 2}`;
    heading = document.createElement(Tag);
    heading.className = 'card-title';
    heading.textContent = opts.title || '';
    head.appendChild(heading);
    if (opts.sub) {
      const sub = document.createElement('p');
      sub.className = 'muted-note';
      sub.textContent = opts.sub;
      head.appendChild(sub);
    }
    if (opts.action) actions.appendChild(opts.action);
    if (Array.isArray(opts.actions)) {
      for (const node of opts.actions) actions.appendChild(node);
    }
    head.appendChild(actions);
    section.appendChild(head);
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  section.appendChild(body);
  return { section, body, heading, actions };
}

/**
 * 空状态。
 * @param {string} text @param {Node} [actionNode] @param {string} [artName]
 */
export function emptyState(text, actionNode, artName) {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const art = icon(artName || 'note', { size: 46, className: 'empty-art', strokeWidth: 1.2 });
  wrap.appendChild(art);
  const p = document.createElement('p');
  p.className = 'empty-text';
  p.textContent = text;
  wrap.appendChild(p);
  if (actionNode) wrap.appendChild(actionNode);
  return wrap;
}

/** @param {string} text @param {() => void} onClick */
export function linkButton(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * 一行消费记录（按钮，点开详情）。
 * @param {{id:string,title:string,amount:number,category:string,date:string,note?:string,isNonEssential?:boolean}} record
 * @param {(id: string) => void} onClick
 */
export function recordRow(record, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row-item';
  btn.dataset.record = record.id;
  btn.dataset.cat = record.category || 'other';
  btn.setAttribute('aria-label', `${record.title} ${formatCents(record.amount)}，查看这条消费`);

  const tile = document.createElement('span');
  tile.className = 'row-tile';
  tile.appendChild(catIcon(record.category, 20));
  btn.appendChild(tile);

  const main = document.createElement('span');
  main.className = 'row-main';
  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = record.title;
  main.appendChild(title);
  if (record.isNonEssential) {
    const flag = document.createElement('span');
    flag.className = 'row-flag';
    flag.textContent = '非必需';
    title.appendChild(flag);
  }
  const meta = document.createElement('span');
  meta.className = 'row-meta';
  meta.textContent = `${categoryLabel(record.category)} · ${record.date}${record.note ? ' · ' + record.note : ''}`;
  main.appendChild(meta);
  btn.appendChild(main);

  const amt = document.createElement('span');
  amt.className = 'row-amt is-minus';
  amt.textContent = `−${formatAmount(record.amount)}`;
  const sub = document.createElement('span');
  sub.className = 'row-amt-sub';
  sub.textContent = '已支出';
  const amtWrap = document.createElement('span');
  amtWrap.appendChild(amt);
  amtWrap.appendChild(sub);
  btn.appendChild(amtWrap);

  btn.addEventListener('click', () => onClick(record.id));
  return btn;
}

/**
 * 单个数据格（带左侧色条，用于区分不同口径的数字）。
 * @param {string} label @param {Node|string} value @param {'fee'|'spent'|'left'|'balance'|'carry'|''} [kind] @param {string} [hint]
 */
export function detailCell(label, value, kind, hint) {
  const cell = document.createElement('div');
  cell.className = `detail-cell${kind ? ' is-' + kind : ''}`;
  const span = document.createElement('span');
  span.textContent = label;
  cell.appendChild(span);
  const b = document.createElement('b');
  if (typeof value === 'string') b.textContent = value;
  else b.appendChild(value);
  cell.appendChild(b);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'stat-hint';
    h.textContent = hint;
    cell.appendChild(h);
  }
  return cell;
}

/**
 * 统计卡。
 * @param {string} label @param {Node|string} value @param {string} [hint] @param {string} [className]
 */
export function statCard(label, value, hint, className) {
  const cell = document.createElement('div');
  cell.className = 'stat-card';
  const span = document.createElement('span');
  span.textContent = label;
  cell.appendChild(span);
  const b = document.createElement('b');
  b.className = `stat-value${className ? ' ' + className : ''}`;
  if (typeof value === 'string') b.textContent = value;
  else b.appendChild(value);
  cell.appendChild(b);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'stat-hint';
    h.textContent = hint;
    cell.appendChild(h);
  }
  return cell;
}

/**
 * 预算进度条。
 * @param {number} ratio 0..1+
 * @param {{label?: string, detail?: string, note?: string}} [opts]
 * @returns {{wrap: HTMLElement, fill: HTMLElement, setRatio: (r: number) => void}}
 */
export function meter(ratio, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'meter-block';

  if (opts.label || opts.detail) {
    const label = document.createElement('div');
    label.className = 'meter-label';
    const left = document.createElement('span');
    left.textContent = opts.label || '';
    label.appendChild(left);
    if (opts.detail) {
      const strong = document.createElement('strong');
      strong.textContent = opts.detail;
      label.appendChild(strong);
    }
    wrap.appendChild(label);
  }

  const track = document.createElement('div');
  track.className = 'meter';
  track.setAttribute('role', 'progressbar');
  const fill = document.createElement('div');
  fill.className = 'meter-fill';
  track.appendChild(fill);
  wrap.appendChild(track);

  if (opts.note) {
    const n = document.createElement('p');
    n.className = 'meter-note';
    n.textContent = opts.note;
    wrap.appendChild(n);
  }

  const setRatio = (r) => {
    const pct = Math.max(0, Math.min(1, r)) * 100;
    fill.style.width = `${pct.toFixed(2)}%`;
    fill.classList.toggle('is-warn', r >= 0.8 && r < 1);
    fill.classList.toggle('is-over', r >= 1);
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuetext', `${percentText(toPercent(Math.min(r, 1), 1))}%`);
  };
  setRatio(ratio);
  return { wrap, fill, setRatio };
}

/**
 * 分段切换（日/周/月/年 之类）。
 * @param {Array<{value: string, label: string}>} options
 * @param {string} value
 * @param {(value: string) => void} onChange
 */
export function segControl(options, value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  wrap.setAttribute('role', 'group');
  const buttons = new Map();
  const render = () => {
    for (const [v, btn] of buttons) {
      const active = v === value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.textContent = opt.label;
    btn.dataset.value = opt.value;
    btn.addEventListener('click', () => {
      value = opt.value;
      render();
      onChange(opt.value);
    });
    buttons.set(opt.value, btn);
    wrap.appendChild(btn);
  }
  render();
  return { wrap, setValue: (v) => { value = v; render(); } };
}

/**
 * 愿望清单的原创「商品图」：按名称哈希生成的抽象图形，
 * 不引入外部图片、不用 emoji、也不伪造真实商品照片。
 * @param {string} name
 * @param {{size?: number}} [opts]
 */
export function wishArt(name) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 180');
  svg.setAttribute('class', 'wish-art');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${name} 的示意图形`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  let h = 0;
  const text = String(name || '');
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 997;
  const palette = [
    ['#d96b5d', '#b0483d'],
    ['#80a98b', '#5d8a6a'],
    ['#79aeb5', '#4f888f'],
    ['#d7ae65', '#a8813f'],
    ['#9c82ab', '#71597f'],
    ['#93a06d', '#6b7748'],
  ];
  const [c1, c2] = palette[h % palette.length];
  const gid = `wishg${h}`;

  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'linearGradient');
  grad.setAttribute('id', gid);
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '1');
  grad.setAttribute('y2', '1');
  const s1 = document.createElementNS(SVG_NS, 'stop');
  s1.setAttribute('offset', '0');
  s1.setAttribute('stop-color', c1);
  const s2 = document.createElementNS(SVG_NS, 'stop');
  s2.setAttribute('offset', '1');
  s2.setAttribute('stop-color', c2);
  grad.appendChild(s1);
  grad.appendChild(s2);
  defs.appendChild(grad);
  svg.appendChild(defs);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '320');
  bg.setAttribute('height', '180');
  bg.setAttribute('fill', `url(#${gid})`);
  bg.setAttribute('opacity', '0.16');
  svg.appendChild(bg);

  const shapes = (h % 3);
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('fill', `url(#${gid})`);
  if (shapes === 0) {
    // 卡片 + 圆形：像一件盒装商品
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', '96');
    r.setAttribute('y', '44');
    r.setAttribute('width', '128');
    r.setAttribute('height', '92');
    r.setAttribute('rx', '14');
    g.appendChild(r);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '236');
    c.setAttribute('cy', '118');
    c.setAttribute('r', '34');
    c.setAttribute('opacity', '0.7');
    g.appendChild(c);
  } else if (shapes === 1) {
    // 叠层：像一摞东西
    for (let i = 0; i < 3; i += 1) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(84 + i * 12));
      r.setAttribute('y', String(112 - i * 26));
      r.setAttribute('width', '152');
      r.setAttribute('height', '30');
      r.setAttribute('rx', '9');
      r.setAttribute('opacity', String(0.55 + i * 0.2));
      g.appendChild(r);
    }
  } else {
    // 圆环 + 斜线：像一件圆形/带状物品
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', '160');
    ring.setAttribute('cy', '90');
    ring.setAttribute('r', '46');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', `url(#${gid})`);
    ring.setAttribute('stroke-width', '16');
    g.appendChild(ring);
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('x', '60');
    bar.setAttribute('y', '132');
    bar.setAttribute('width', '200');
    bar.setAttribute('height', '14');
    bar.setAttribute('rx', '7');
    bar.setAttribute('opacity', '0.6');
    g.appendChild(bar);
  }
  svg.appendChild(g);
  return svg;
}
