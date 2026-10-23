/**
 * stats-view.js —— 手机页的「消费统计」。
 * 数字全部来自你真实记下的本地记录；没有数据时给空状态，不编造。
 * 日期一律按本地时区算，避免 UTC 把消费挪到前一天。
 * 整页跟着「今天 / 本周 / 本月 / 今年」这一档走：大数字、环形图、图例都按那一档的
 * 真实记录重新汇总，不是只改标题的摆设。
 */

import { card, statCard, meter, emptyState, detailCell, segControl } from '../ui/common.js';
import { button } from '../ui/form.js';
import { formatAmount, formatCents, percentText, toPercent } from '../core/money.js';
import {
  timeZoneLabel, today, todayKey, weekKeys, lastNDays, fromDateKey, toDateKey, MS_PER_DAY,
} from '../core/dates.js';

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** link-btn 节点（card 的 action 参数要现成节点） */
function linkBtn(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

/** 分类占比的时间范围：每一档都是一个真实的日期区间。 */
const RANGE_OPTIONS = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

function rangeLabel(range) {
  const hit = RANGE_OPTIONS.find((opt) => opt.value === range);
  return ({ day: '今天', week: '本周', month: '本月', year: '今年' })[range] || '本月';
}

/** 日均那一行的口径说明：跟着档位走，别一律写「本月」。 */
function statsHint(range, days) {
  if (range === 'day') return '今天只算这一天的支出';
  if (range === 'week') return `本周已过 ${days} 天（从周一算起）`;
  if (range === 'year') return `今年已过 ${days} 天`;
  return `本月已过 ${days} 天（按预算周期）`;
}

/**
 * 这一档覆盖哪些本地日期（含今天）。
 * 「本月」用的是预算周期口径（跟着 settings.cycleDay 走），和全站其它地方一致；
 * 「今年」用自然年，因为「今年」平时就是指自然年。
 */
function rangeKeys(range, view) {
  const now = today();
  if (range === 'day') return [todayKey()];
  if (range === 'week') return weekKeys(now);
  if (range === 'year') {
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return lastNDays(Math.round((now.getTime() - jan1.getTime()) / MS_PER_DAY) + 1, now);
  }
  // view.periodStart 是 Date，而 fromDateKey 只认「YYYY-MM-DD」字符串：
  // 直接把 Date 丢给它会得到 null，然后退化成「本月只剩今天」，所以先转成 key 再读回来。
  const startKey = view.periodStart instanceof Date ? toDateKey(view.periodStart) : view.periodStart;
  const start = fromDateKey(startKey) || now;
  return lastNDays(Math.round((now.getTime() - start.getTime()) / MS_PER_DAY) + 1, now);
}

/** 按日期集合汇总分类占比：只留有钱的分类，按金额降序。 */
function sumByKeys(records, keys, categoryLabel) {
  const set = new Set(keys);
  const map = new Map();
  let total = 0;
  let count = 0;
  for (const record of records) {
    if (!set.has(record.date)) continue;
    total += record.amount;
    count += 1;
    map.set(record.category, (map.get(record.category) || 0) + record.amount);
  }
  const categories = [...map.entries()]
    .filter((entry) => entry[1] > 0)
    .map(([id, cents]) => ({ id, label: categoryLabel(id), cents }))
    .sort((a, b) => b.cents - a.cents);
  return { total, count, categories };
}

/** 分类占比的环形图：每段用分类自己的颜色 */
function donut(categories, totalCents, label) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const wrap = el('div', 'donut-wrap');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 180 180');
  svg.setAttribute('class', 'donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}，合计 ${formatCents(totalCents)} 元`);

  const r = 62;
  const circumference = 2 * Math.PI * r;

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('class', 'donut-track');
  track.setAttribute('cx', '90');
  track.setAttribute('cy', '90');
  track.setAttribute('r', String(r));
  svg.appendChild(track);

  let offset = 0;
  for (const cat of categories) {
    const ratio = totalCents > 0 ? cat.cents / totalCents : 0;
    const len = ratio * circumference;
    const seg = document.createElementNS(SVG_NS, 'circle');
    seg.setAttribute('class', 'donut-seg');
    seg.setAttribute('data-cat', cat.id);
    seg.setAttribute('cx', '90');
    seg.setAttribute('cy', '90');
    seg.setAttribute('r', String(r));
    seg.setAttribute('stroke', 'var(--cat-color, var(--muted))');
    seg.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`);
    seg.setAttribute('stroke-dashoffset', String(-offset.toFixed(2)));
    seg.setAttribute('transform', 'rotate(-90 90 90)');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${cat.label} ${formatCents(cat.cents)} 元 · ${percentText(toPercent(cat.cents, totalCents))}%`;
    seg.appendChild(title);
    svg.appendChild(seg);
    offset += len;
  }

  wrap.appendChild(svg);
  const center = el('div', 'donut-center');
  center.appendChild(el('span', null, label));
  center.appendChild(el('b', null, formatAmount(totalCents)));
  wrap.appendChild(center);
  return wrap;
}

/** 纵轴上界取一个好看的整数（元）：1 / 2 / 2.5 / 5 / 10 乘 10 的幂 */
function niceMaxYuan(cents) {
  const yuan = Math.max(1, Math.ceil(cents / 100));
  const pow = 10 ** Math.floor(Math.log10(yuan));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * pow >= yuan) return step * pow;
  }
  return 10 * pow;
}

/** 轴标签：整数就不带小数，省得在窄屏上挤成一团 */
function axisText(yuan) {
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(1);
}

/**
 * 最近七天趋势：改成设计稿里的折线（带面积填充与每日圆点，今天那个点是金色）。
 * 折线在窄屏里比柱子好读：柱子只有七根、每根不到 40px，高度差几乎看不出来。
 */
function trendCard(stats, ctx) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const days = stats.trend;
  const result = card({
    title: '最近七天',
    headingLevel: 3,
    sub: `${days[0].date} 至 ${days[days.length - 1].date} · 每天的花费`,
  });

  const axisMax = niceMaxYuan(Math.max(1, stats.trendMaxCents));
  const W = 320;
  const H = 138;
  const PADL = 30;
  const PADR = 10;
  const PADT = 12;
  const PADB = 26;
  const baseY = H - PADB;
  const x = (i) => PADL + (i * (W - PADL - PADR)) / (days.length - 1);
  const y = (cents) => PADT + (1 - (cents / 100) / axisMax) * (H - PADT - PADB);

  const chart = el('div', 'line-chart');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'line-svg');
  svg.setAttribute('role', 'img');
  const total = days.reduce((sum, day) => sum + day.cents, 0);
  svg.setAttribute('aria-label',
    `最近七天每天的花费折线，最高 ${axisText(axisMax)} 元，七天合计 ${formatCents(total)} 元`);

  // 横网格线 + 左侧刻度（元）
  for (let i = 0; i <= 4; i += 1) {
    const frac = i / 4;
    const gy = (PADT + (1 - frac) * (H - PADT - PADB)).toFixed(1);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'line-grid');
    line.setAttribute('x1', String(PADL));
    line.setAttribute('x2', String(W - PADR));
    line.setAttribute('y1', gy);
    line.setAttribute('y2', gy);
    svg.appendChild(line);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'line-axis');
    text.setAttribute('x', String(PADL - 6));
    text.setAttribute('y', String(Number(gy) + 3));
    text.setAttribute('text-anchor', 'end');
    text.textContent = axisText(axisMax * frac);
    svg.appendChild(text);
  }

  const linePoints = days.map((day, i) => `${x(i).toFixed(1)},${y(day.cents).toFixed(1)}`);
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('class', 'line-area');
  area.setAttribute('d', `M ${linePoints[0]} L ${linePoints.join(' L ')} L ${x(days.length - 1).toFixed(1)},${baseY} L ${x(0).toFixed(1)},${baseY} Z`);
  svg.appendChild(area);

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', 'line-path');
  path.setAttribute('d', `M ${linePoints.join(' L ')}`);
  svg.appendChild(path);

  days.forEach((day, i) => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', `line-dot${day.date === stats.todayKey ? ' is-today' : ''}`);
    dot.setAttribute('cx', x(i).toFixed(1));
    dot.setAttribute('cy', y(day.cents).toFixed(1));
    dot.setAttribute('r', '3.4');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${day.date} 花费 ${formatCents(day.cents)} 元`;
    dot.appendChild(title);
    svg.appendChild(dot);
  });

  chart.appendChild(svg);

  const labels = el('div', 'line-labels');
  for (const day of days) {
    const label = day.date === stats.todayKey
      ? '今天'
      : `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`;
    labels.appendChild(el('span', day.date === stats.todayKey ? 'is-today' : null, label));
  }
  chart.appendChild(labels);

  result.body.appendChild(chart);
  const best = days.reduce((a, b) => (b.cents > a.cents ? b : a), days[0]);
  result.body.appendChild(el('p', 'muted-note',
    `这七天合计 ${formatCents(total)} 元；最多的一天是 ${best.date}（${formatCents(best.cents)} 元）。`
    + '纵轴上界按这七天里最多的一天取整，折线只画已经过去的日子。'));
  return result.section;
}

/** 预算使用：一条进度 + 五个数字 */
function budgetCard(view, ctx) {
  const percent = percentText(toPercent(view.usedRatio, 1));
  const result = card({
    title: '预算使用',
    headingLevel: 3,
    action: linkBtn('去调整', () => ctx.navigate('budget')),
  });
  const block = meter(view.usedRatio, {
    label: `${ctx.humanPeriod(view.periodStart, view.cycleDay)}`,
    detail: `已用 ${percent}% · 剩余 ${formatCents(view.remainingCents)} 元`,
    note: view.carryInCents > 0
      ? `本期预算里带着上一期结转的 ${formatCents(view.carryInCents)} 元。`
      : (view.carryOver ? '结余结转开着：上一期没花完的会带进这一期。' : '结余结转已关闭。'),
  });
  result.body.appendChild(block.wrap);

  const list = el('div', 'detail-list');
  list.appendChild(detailCell('本月初始生活费', formatCents(view.monthlyFeeCents), 'fee'));
  list.appendChild(detailCell('本月累计消费', formatCents(view.monthSpentCents), 'spent'));
  list.appendChild(detailCell('本月剩余预算', formatCents(view.remainingCents), 'left'));
  list.appendChild(detailCell('当前可支配余额', formatCents(view.balanceCents), 'balance'));
  list.appendChild(detailCell('上一期结转', formatCents(view.carryInCents), 'carry'));
  result.body.appendChild(list);
  result.body.appendChild(el('p', 'detail-note', '这四个数字口径不一样：剩余预算只看本周期，可支配余额还会带上往期结余与透支。'));
  return result.section;
}

/**
 * 这一档的支出大数字（设计稿统计页顶部就是「本月支出 ¥860.00」+ 右边「日均 ¥27.74」）。
 * 返回 { section, draw(range) }：切档时只重画这一块，口径跟着档位走。
 */
function spendCard(state, ctx, view) {
  const labelNode = el('span', 'spend-main-label', '');
  const valueNode = el('b', 'spend-main-value', '');
  const sideLabel = el('span', null, '日均支出');
  const sideValue = el('b', null, '');
  const main = el('div');
  main.append(labelNode, valueNode);
  const side = el('div', 'spend-side');
  side.append(sideLabel, sideValue);

  const result = card({ headingLevel: 2 });
  result.section.setAttribute('aria-label', '区间支出与日均');
  const row = el('div', 'spend-row');
  row.append(main, side);
  result.body.appendChild(row);
  const note = el('p', 'muted-note', '');
  result.body.appendChild(note);

  function draw(range) {
    const keys = rangeKeys(range, view);
    const set = new Set(keys);
    const inRange = state.records.filter((r) => set.has(r.date));
    const total = inRange.reduce((sum, r) => sum + r.amount, 0);
    const nonEss = inRange.filter((r) => r.isNonEssential).reduce((sum, r) => sum + r.amount, 0);
    const tKey = todayKey();
    const days = Math.max(1, keys.filter((k) => k <= tKey).length);
    labelNode.textContent = `${rangeLabel(range)}支出`;
    valueNode.textContent = `¥${formatCents(total)}`;
    valueNode.style.color = total ? '' : 'var(--muted)';
    sideLabel.textContent = `日均支出（${days} 天）`;
    sideValue.textContent = `¥${formatCents(Math.round(total / days))}`;
    note.textContent = `${keys[0]} 至 ${keys[keys.length - 1]} · ${inRange.length} 笔`
      + ` · 非必需 ${formatCents(nonEss)} 元（占 ${percentText(toPercent(nonEss, total))}%）`
      + ` · ${statsHint(range, days)}`;
  }

  return { section: result.section, draw };
}

export function renderStatsView(content, ctx) {
  const state = ctx.getState();
  if (!ctx.isConfigured(state)) {
    const intro = card({ title: '消费统计', sub: '统计只从你真实记下的消费里算出来。' });
    intro.body.appendChild(emptyState('还没有设定生活费，也还没有消费记录。先去把本月生活费写下来，统计才有对照的基准。', button('去设定生活费', { kind: 'primary', icon: 'arrowRight', onClick: () => ctx.navigate('wallet') }), 'chart'));
    content.appendChild(intro.section);
    return;
  }

  const stats = ctx.getStatsView();
  const view = stats.budget;

  /* 时间范围：切到哪一档，大数字、环形图、图例就按那一档的真实记录重算 */
  const segRow = el('div', 'filter-state');
  segRow.appendChild(el('span', 'muted-note', '时间范围'));

  const spend = spendCard(state, ctx, view);
  const grid = el('div', 'stat-grid');
  const split = el('div', 'split');
  let catSection = null;

  const drawCards = (range) => {
    const keys = rangeKeys(range, view);
    const set = new Set(keys);
    const inRange = state.records.filter((r) => set.has(r.date));
    const total = inRange.reduce((sum, r) => sum + r.amount, 0);
    const nonEss = inRange.filter((r) => r.isNonEssential).reduce((sum, r) => sum + r.amount, 0);
    // 天数只数已经过去的那些：weekKeys 给的是整周七天，今天之后那几天还没到。
    const tKey = todayKey();
    const days = Math.max(1, keys.filter((k) => k <= tKey).length);
    const avgPer = inRange.length ? Math.round(total / inRange.length) : 0;

    grid.textContent = '';
    grid.appendChild(statCard('区间笔数', `${inRange.length} 笔`, `${keys[0]} 至 ${keys[keys.length - 1]}`));
    grid.appendChild(statCard('平均每笔', formatCents(avgPer), `${inRange.length} 笔的均值`));
    grid.appendChild(statCard('非必需支出', formatCents(nonEss), `占区间 ${percentText(toPercent(nonEss, total))}%`));
    grid.appendChild(statCard('本月剩余预算', formatCents(view.remainingCents), '预算周期口径，不含往期结转'));
  };

  const drawCategory = (range) => {
    const keys = rangeKeys(range, view);
    const sum = sumByKeys(state.records, keys, ctx.categoryLabel);
    const label = rangeLabel(range);
    const result = card({
      title: `分类占比 · ${label}`,
      headingLevel: 3,
      sub: `合计 ${formatCents(sum.total)} 元 · ${sum.count} 笔 · ${sum.categories.length} 个分类有花费`,
    });

    if (sum.categories.length) {
      const chartRow = el('div', 'chart-row');
      chartRow.appendChild(donut(sum.categories, sum.total, `${label}合计`));
      const legend = el('div', 'legend');
      for (const cat of sum.categories) {
        const row = el('div', 'legend-row');
        row.setAttribute('data-cat', cat.id);
        row.appendChild(el('span', 'legend-swatch'));
        row.appendChild(el('span', 'legend-name', cat.label));
        row.appendChild(el('span', 'legend-amt', formatAmount(cat.cents)));
        row.appendChild(el('span', 'legend-pct', `${percentText(toPercent(cat.cents, sum.total))}%`));
        legend.appendChild(row);
      }
      chartRow.appendChild(legend);
      result.body.appendChild(chartRow);
      result.body.appendChild(el('p', 'muted-note', `这里的占比按「${label}」区间里的 ${sum.count} 笔消费算；环形图每段的颜色就是下面图例的颜色。`));
    } else {
      result.body.appendChild(emptyState(
        `「${label}」这个区间里还没有消费记录。换个时间范围看看，或者先去记一笔。`,
        button('去记一笔', { kind: 'primary', icon: 'plus', onClick: () => ctx.navigate('add') }),
        'chart',
      ));
    }

    if (catSection) split.replaceChild(result.section, catSection);
    else split.insertBefore(result.section, split.firstChild);
    catSection = result.section;
  };

  const seg = segControl(RANGE_OPTIONS, 'month', (value) => draw(value));
  segRow.appendChild(seg.wrap);
  content.appendChild(segRow);
  content.appendChild(spend.section);
  content.appendChild(grid);

  /** 切档：大数字、卡片、环形图、图例一起按新的真实区间重算。 */
  function draw(range) {
    spend.draw(range);
    drawCards(range);
    drawCategory(range);
  }

  draw('month');
  split.appendChild(budgetCard(view, ctx));
  content.appendChild(split);

  content.appendChild(trendCard(stats, ctx));
  content.appendChild(el('p', 'muted-note', `日期与统计都按本机时区（${timeZoneLabel()}）计算，不用 UTC，所以不会出现「昨天花的钱算到今天」那种偏差。`));
}
