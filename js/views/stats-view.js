/**
 * stats-view.js —— 消费统计：今日 / 本周 / 本月、预算使用、分类占比、最近七天趋势。
 * 全部数字来自真实本地记录；没有数据时显示空状态，绝不编造。
 */

import { humanDate, humanPeriod, timeZoneLabel } from '../core/dates.js';
import { formatAmount, toPercent, percentText } from '../core/money.js';
import { card, emptyState, linkButton, progressBar } from '../ui/common.js';
import { button } from '../ui/form.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderStatsView(container, ctx) {
  const stats = ctx.getStatsView();
  const view = stats.budget;
  const frag = document.createDocumentFragment();

  /* ---------- 三段汇总 ---------- */
  const sumCard = card({ title: '消费概览' });
  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  grid.appendChild(summaryTile('今日', stats.todayTotalCents, stats.todayKey));
  grid.appendChild(summaryTile('本周', stats.weekTotalCents, '本地周一为一周起点'));
  grid.appendChild(summaryTile('本月', stats.monthTotalCents, humanPeriod(view.periodStart, view.cycleDay)));
  sumCard.body.appendChild(grid);

  if (stats.nonEssentialCents > 0) {
    const note = document.createElement('p');
    note.className = 'muted-note';
    note.textContent = `本月标记为「非必需」的消费 ¥${formatAmount(stats.nonEssentialCents)}，占本月消费的 ${percentText(toPercent(stats.nonEssentialCents, stats.monthTotalCents))}%。`;
    sumCard.body.appendChild(note);
  }
  frag.appendChild(sumCard.section);

  /* ---------- 预算使用 ---------- */
  const budgetCard = card({
    title: '预算使用',
    action: linkButton('调整生活费', () => ctx.navigate('budget')),
  });
  if (view.monthlyFeeCents <= 0) {
    budgetCard.body.appendChild(
      emptyState(
        '还没有设置本月生活费，无法计算预算使用比例。',
        button('去设置', { kind: 'primary', onClick: () => ctx.navigate('budget') }),
      ),
    );
  } else {
    const percent = percentText(toPercent(view.monthSpentCents, view.monthlyFeeCents));
    budgetCard.body.appendChild(
      progressBar(view.usedRatio, {
        over: view.remainingCents < 0,
        label:
          view.remainingCents < 0
            ? `已用 ${percent}% · 超出预算 ¥${formatAmount(Math.abs(view.remainingCents))}`
            : `已用 ${percent}% · 剩余 ¥${formatAmount(view.remainingCents)}`,
      }),
    );
    const detail = document.createElement('dl');
    detail.className = 'detail-grid';
    detail.appendChild(detailItem('本月初始生活费', `¥${formatAmount(view.monthlyFeeCents)}`));
    detail.appendChild(detailItem('本月累计消费', `¥${formatAmount(view.monthSpentCents)}`));
    detail.appendChild(
      detailItem('本月剩余预算', `¥${formatAmount(view.remainingCents)}`, view.remainingCents < 0),
    );
    detail.appendChild(detailItem('当前可支配余额', `¥${formatAmount(view.balanceCents)}`, view.balanceCents < 0));
    if (view.carryOver) {
      detail.appendChild(
        detailItem(
          '上一期结转',
          `${view.carryInCents < 0 ? '-' : ''}¥${formatAmount(Math.abs(view.carryInCents))}`,
          view.carryInCents < 0,
        ),
      );
    }
    budgetCard.body.appendChild(detail);
    const explain = document.createElement('p');
    explain.className = 'muted-note';
    explain.textContent = view.carryOver
      ? '「本月剩余预算」只看本周期；「当前可支配余额」还会带上往期的结余或透支，两者定义不同，数值也可能不同。'
      : '当前关闭了结余结转，余额只由本周期决定。';
    budgetCard.body.appendChild(explain);
  }
  frag.appendChild(budgetCard.section);

  /* ---------- 分类占比 ---------- */
  const catCard = card({ title: '本月分类占比' });
  if (!stats.hasMonthData) {
    catCard.body.appendChild(emptyState('本月还没有消费记录。', button('去记一笔', { kind: 'primary', onClick: () => ctx.navigate('add') })));
  } else {
    const total = stats.monthTotalCents || 1;
    const bar = document.createElement('div');
    bar.className = 'stack-bar';
    for (const c of stats.categories) {
      const seg = document.createElement('span');
      seg.className = 'stack-seg';
      seg.dataset.cat = c.id;
      seg.style.width = `${((c.cents / total) * 100).toFixed(2)}%`;
      seg.title = `${c.label} ¥${formatAmount(c.cents)}`;
      bar.appendChild(seg);
    }
    catCard.body.appendChild(bar);

    const legend = document.createElement('ul');
    legend.className = 'legend';
    for (const c of stats.categories) {
      const li = document.createElement('li');
      li.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'cat-dot';
      dot.dataset.cat = c.id;
      dot.setAttribute('aria-hidden', 'true');
      li.appendChild(dot);
      const name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = c.label;
      li.appendChild(name);
      const pct = document.createElement('span');
      pct.className = 'legend-pct';
      pct.textContent = `${percentText(toPercent(c.cents, total))}%`;
      li.appendChild(pct);
      const amt = document.createElement('span');
      amt.className = 'legend-amount';
      amt.textContent = `¥${formatAmount(c.cents)}`;
      li.appendChild(amt);
      legend.appendChild(li);
    }
    catCard.body.appendChild(legend);
  }
  frag.appendChild(catCard.section);

  /* ---------- 最近七天趋势 ---------- */
  const trendCard = card({ title: '最近七天趋势' });
  const hasTrend = stats.trend.some((d) => d.cents > 0);
  if (!hasTrend) {
    trendCard.body.appendChild(emptyState('最近七天没有消费记录。'));
  } else {
    trendCard.body.appendChild(trendChart(stats.trend, stats.trendMaxCents));
    const labels = document.createElement('div');
    labels.className = 'trend-labels';
    for (const d of stats.trend) {
      const span = document.createElement('span');
      span.textContent = humanDate(d.date);
      labels.appendChild(span);
    }
    trendCard.body.appendChild(labels);
    const values = document.createElement('div');
    values.className = 'trend-labels trend-values';
    for (const d of stats.trend) {
      const span = document.createElement('span');
      span.textContent = d.cents > 0 ? formatAmount(d.cents) : '—';
      values.appendChild(span);
    }
    trendCard.body.appendChild(values);
  }
  frag.appendChild(trendCard.section);

  const foot = document.createElement('p');
  foot.className = 'muted-note';
  foot.textContent = `统计基于本地记录与本地日期（时区：${timeZoneLabel()}），不会把不同月份的消费混在一起。`;
  frag.appendChild(foot);

  container.appendChild(frag);
  return { focus: () => {} };
}

function summaryTile(label, cents, hint) {
  const tile = document.createElement('div');
  tile.className = 'summary-tile';
  const l = document.createElement('p');
  l.className = 'summary-label';
  l.textContent = label;
  const v = document.createElement('p');
  v.className = 'summary-value';
  v.textContent = `¥${formatAmount(cents)}`;
  const h = document.createElement('p');
  h.className = 'summary-hint';
  h.textContent = hint;
  tile.appendChild(l);
  tile.appendChild(v);
  tile.appendChild(h);
  return tile;
}

function detailItem(label, value, negative = false) {
  const item = document.createElement('div');
  item.className = 'detail-item';
  const dt = document.createElement('dt');
  dt.className = 'detail-label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = `detail-value${negative ? ' is-negative' : ''}`;
  dd.textContent = value;
  item.appendChild(dt);
  item.appendChild(dd);
  return item;
}

/** 七天柱状图（纯 SVG，无依赖）。 */
function trendChart(trend, maxCents) {
  const wrap = document.createElement('div');
  wrap.className = 'trend-chart';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 42');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    '最近七天每日消费柱状图：' + trend.map((d) => `${humanDate(d.date)} ${formatAmount(d.cents)} 元`).join('，'),
  );

  const max = Math.max(1, maxCents);
  const n = trend.length;
  const gap = 1.2;
  const barWidth = (100 - gap * (n - 1)) / n;

  trend.forEach((d, i) => {
    const h = (d.cents / max) * 34;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(i * (barWidth + gap)));
    rect.setAttribute('y', String(38 - Math.max(h, d.cents > 0 ? 1.2 : 0)));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(Math.max(h, d.cents > 0 ? 1.2 : 0)));
    rect.setAttribute('rx', '0.8');
    rect.setAttribute('class', d.cents > 0 ? 'trend-bar' : 'trend-bar-empty');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${humanDate(d.date)}：¥${formatAmount(d.cents)}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('x1', '0');
  baseline.setAttribute('x2', '100');
  baseline.setAttribute('y1', '38');
  baseline.setAttribute('y2', '38');
  baseline.setAttribute('class', 'trend-axis');
  svg.appendChild(baseline);

  wrap.appendChild(svg);
  return wrap;
}
