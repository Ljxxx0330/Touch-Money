/**
 * budget.test.js —— 预算与统计单测。
 * 核心要求：区分「初始生活费 / 当前余额 / 本月累计消费 / 本月剩余预算」，
 * 且不得把往期的消费从本期预算里扣掉。
 */

import './browser-mock.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const dates = await import('../js/core/dates.js');
const storage = await import('../js/core/storage.js');
const budget = await import('../js/core/budget.js');

const TODAY = dates.today();

/** 构造一条记录（offset = 距今天的天数，负数为过去）。 */
function rec(amount, title, category, offset, extra = {}) {
  return {
    id: `r_${offset}_${amount}_${title}`,
    amount,
    title,
    category,
    date: dates.toDateKey(dates.addDays(TODAY, offset)),
    note: '',
    isNonEssential: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function mkState({ fee = 0, cycleDay = 1, carryOver = true, months = {}, records = [], wishlist = [] } = {}) {
  const st = storage.emptyState();
  st.settings = { ...budget.defaultSettings(), monthlyFeeCents: fee, cycleDay, carryOver, months };
  st.records = records;
  st.wishlist = wishlist;
  return st;
}

test('分类：七个默认分类与未知分类的兜底', () => {
  assert.deepEqual(
    budget.CATEGORIES.map((c) => c.id),
    ['food', 'transport', 'study', 'shopping', 'fun', 'daily', 'other'],
  );
  assert.deepEqual(
    budget.CATEGORIES.map((c) => c.label),
    ['餐饮', '交通', '学习', '购物', '娱乐', '日用品', '其他'],
  );
  assert.equal(budget.categoryLabel('food'), '餐饮');
  assert.equal(budget.categoryLabel('nope'), '其他');
  assert.equal(budget.categoryLabel(undefined), '其他');
});

test('未设置生活费时：不显示不合理的余额，比例为 0', () => {
  const st = mkState({ records: [rec(1800, '午饭', 'food', 0)] });
  assert.equal(budget.isConfigured(st.settings), false);
  const view = budget.computeCurrentBudget(st);
  assert.equal(view.monthlyFeeCents, 0);
  assert.equal(view.monthSpentCents, 1800);
    assert.equal(view.periodKey, dates.currentPeriodKey(1));
  assert.equal(view.monthSpentCents, 1800);
  assert.equal(view.usedRatio, 0, '未配置时比例为 0');
  // 未配置生活费时钱包视图显示初始化引导，不会把这个派生数字当成「真实余额」展示
  assert.equal(view.balanceCents, -1800);
  assert.equal(view.usedRatio, 0);
});

test('四个数字必须各归其位：初始生活费 / 已消费 / 剩余预算 / 当前余额', () => {
  const st = mkState({
    fee: 200000,
    records: [rec(30000, '午饭', 'food', 0), rec(20000, '地铁', 'transport', -1)],
  });
  const view = budget.computeCurrentBudget(st);
  assert.equal(view.monthlyFeeCents, 200000, '本月初始生活费');
  assert.equal(view.monthSpentCents, 50000, '本月累计消费');
  assert.equal(view.remainingCents, 150000, '本月剩余预算');
  assert.equal(view.balanceCents, 150000, '当前可支配余额');
  assert.equal(Math.round(view.usedRatio * 100), 25);
    assert.equal(Math.round(budget.shareOfFee(30000, 200000) * 100), 15, '本笔占初始生活费 15%');
});

test('往期消费不从本期预算扣除，但计入往期结转', () => {
  const st = mkState({
    fee: 100000,
    carryOver: true,
    records: [rec(50000, '往期消费', 'food', -40), rec(10000, '本期消费', 'food', 0)],
  });
  const cur = budget.computeCurrentBudget(st);
  assert.equal(cur.monthSpentCents, 10000, '本期只统计本期记录');
  assert.equal(cur.remainingCents, 90000, '剩余预算 = 本期生活费 - 本期消费');

  const prevKey = dates.prevPeriodKey(cur.periodKey);
  const prev = budget.computeBudget(st, prevKey);
  assert.equal(prev.monthSpentCents, 50000, '往期记录归入往期');
  assert.equal(cur.carryInCents, prev.remainingCents, '结转来自上一期结余');
  assert.equal(cur.balanceCents, 90000 + prev.remainingCents, '余额 = 本期剩余 + 结转');

  // 往期消费不会凭空消失：spentByPeriod 里能看到两期的数字
  assert.equal(cur.spentByPeriod.get(prevKey), 50000);
  assert.equal(cur.spentByPeriod.get(cur.periodKey), 10000);
});

test('关闭结转时：余额等于本期剩余预算，不带入往期', () => {
  const st = mkState({
    fee: 100000,
    carryOver: false,
    records: [rec(50000, '往期消费', 'food', -40), rec(10000, '本期消费', 'food', 0)],
  });
  const cur = budget.computeCurrentBudget(st);
  assert.equal(cur.carryInCents, 0);
  assert.equal(cur.balanceCents, cur.remainingCents);
  assert.equal(cur.balanceCents, 90000);
});

test('自定义周期起始日：边界日归属正确的周期', () => {
  const cycleDay = 15;
  const pStart = dates.periodStartFor(TODAY, cycleDay);
  assert.equal(dates.toDateKey(pStart).slice(8), '15', '周期起始日应为 15 日');
  const inKey = dates.toDateKey(pStart);
  const outKey = dates.toDateKey(dates.addDays(pStart, -1));
  const st = mkState({
    fee: 100000,
    cycleDay,
    records: [rec(10000, '周期内', 'food', 0, { date: inKey }), rec(20000, '周期外', 'food', 0, { date: outKey })],
  });
  const cur = budget.computeCurrentBudget(st);
  assert.equal(cur.cycleDay, 15);
  assert.equal(cur.monthSpentCents, 10000, '只有本期内的记录计入');

  const stNat = mkState({ fee: 100000, cycleDay: 1, records: st.records });
  const curNat = budget.computeCurrentBudget(stNat);
  assert.equal(curNat.monthSpentCents, 30000, '自然月周期下两条都算本月');
});

test('往期单独设置过生活费时按各自金额计算', () => {
  const st = mkState({ fee: 100000, carryOver: true, records: [rec(10000, '本期', 'food', 0)] });
  const cur = budget.computeCurrentBudget(st);
  const prevKey = dates.prevPeriodKey(cur.periodKey);
  st.settings.months[prevKey] = 300000;
  const prev = budget.computeBudget(st, prevKey);
  assert.equal(prev.monthlyFeeCents, 300000, '往期用它自己设定过的生活费');
  assert.equal(prev.monthSpentCents, 0);
  assert.equal(prev.remainingCents, 300000);
  const cur2 = budget.computeCurrentBudget(st);
  assert.equal(cur2.carryInCents, 300000, '结转 = 往期结余');
  assert.equal(cur2.balanceCents, 90000 + 300000);
  assert.equal(cur2.monthSpentCents, 10000, '本期消费不受往期设定影响');
});

test('修改生活费只影响本期余额，消费记录一条不少', () => {
  const records = [rec(30000, '午饭', 'food', 0), rec(20000, '地铁', 'transport', -1)];
  const st = mkState({ fee: 200000, records });
  const preview = budget.previewFeeChange(st, 150000);
  assert.equal(preview.before, 150000, 'before/after 是余额（分）');
  assert.equal(preview.after, 100000);
  assert.equal(preview.delta, -50000, '差额 = 新 - 旧');
  assert.equal(preview.viewAfter.monthlyFeeCents, 150000);
  assert.equal(preview.viewAfter.monthSpentCents, 50000, '已消费金额不因改生活费而改变');
  assert.equal(preview.viewAfter.remainingCents, 100000);
  assert.equal(st.records.length, 2, '预览不改动记录');
});

test('统计：今日 / 本周 / 本月 / 分类占比 / 七天趋势', () => {
  const now = dates.today();
  const MONTH_START = dates.toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const MONTH_END = dates.toDateKey(new Date(now.getFullYear(), now.getMonth(), dates.daysInMonth(now.getFullYear(), now.getMonth())));
  const records = [
    rec(1800, '食堂午饭', 'food', 0),
    rec(2600, '奶茶', 'food', -1, { isNonEssential: true }),
    rec(6800, '专业书', 'study', -2),
    rec(1200, '早餐', 'food', -8),
    rec(4500, '上月聚餐', 'food', -40),
    rec(3000, '非必需标记测试', 'fun', -1, { isNonEssential: true }),
  ];
  const st = mkState({ fee: 200000, cycleDay: 1, records });
  const stats = budget.computeStats(st);

  assert.equal(stats.todayTotalCents, 1800);
  const week = dates.weekKeys();
  assert.equal(week.length, 7);
  const weekTotal = records
    .filter((r) => week.includes(r.date))
    .reduce((s, r) => s + r.amount, 0);
  assert.equal(stats.weekTotalCents, weekTotal, '本周合计必须来自本地周一起点的同一周');
  const monthTotal = records
    .filter((r) => r.date >= MONTH_START && r.date <= MONTH_END)
    .reduce((s, r) => s + r.amount, 0);
  assert.equal(stats.monthTotalCents, monthTotal, '本月合计只包含本自然月的记录');
  assert.ok(monthTotal >= 10400, '测试数据本身应落在本月内');
  const nonEss = records
    .filter((r) => r.isNonEssential && r.date >= MONTH_START && r.date <= MONTH_END)
    .reduce((s, r) => s + r.amount, 0);
  assert.equal(stats.nonEssentialCents, nonEss, '非必需支出只统计本月的非必需记录');
  assert.ok(nonEss >= 2600);

  const sumCat = (id) => records
    .filter((r) => r.category === id && r.date >= MONTH_START && r.date <= MONTH_END)
    .reduce((s, r) => s + r.amount, 0);
  const food = stats.categories.find((c) => c.id === 'food');
  assert.equal(food.cents, sumCat('food'), '本月餐饮合计');
  assert.equal(food.label, '餐饮');
  assert.equal(stats.categories.find((c) => c.id === 'study').cents, sumCat('study'));
  assert.equal(stats.categories.find((c) => c.id === 'transport'), undefined, '本月没有交通支出');
  const totalCats = stats.categories.reduce((s, c) => s + c.cents, 0);
  assert.equal(totalCats, stats.monthTotalCents, '分类占比之和等于本月合计');

  assert.equal(stats.trend.length, 7);
  assert.equal(stats.trend[6].date, dates.todayKey());
  const sumOn = (key) => records.filter((r) => r.date === key).reduce((s, r) => s + r.amount, 0);
  assert.equal(stats.trend[6].cents, sumOn(dates.todayKey()), '今天的趋势值');
  assert.equal(stats.trend[5].cents, sumOn(dates.toDateKey(dates.addDays(TODAY, -1))), '昨天的趋势值（同日两笔相加）');
  assert.equal(stats.trend[0].cents, sumOn(stats.trend[0].date), '最早一天的趋势值');
  assert.ok(stats.trend.every((d) => d.cents === sumOn(d.date)), '七天趋势逐日都来自真实记录');
  assert.equal(stats.trendMaxCents, 6800, '趋势最大值取七天内最高');
  assert.equal(stats.hasAnyRecord, true);
  assert.equal(stats.hasMonthData, true);
});

test('统计：无数据时给出空状态而不是 0 元假数据', () => {
  const stats = budget.computeStats(mkState());
  assert.equal(stats.hasAnyRecord, false);
  assert.equal(stats.hasMonthData, false);
  assert.equal(stats.todayTotalCents, 0);
  assert.equal(stats.weekTotalCents, 0);
  assert.equal(stats.monthTotalCents, 0);
  assert.deepEqual(stats.categories, []);
  assert.equal(stats.trend.length, 7);
  assert.ok(stats.trend.every((d) => d.cents === 0));
  assert.equal(stats.trendMaxCents, 0);
});

test('earliestPeriodKey：从最早记录开始滚存', () => {
  const st = mkState({ fee: 100000, records: [rec(1000, '今天', 'food', 0), rec(1000, '很久以前', 'food', -70)] });
  const cur = budget.computeCurrentBudget(st);
  const earliest = budget.earliestPeriodKey(st.settings, st.records);
  assert.ok(earliest, '应能找到最早周期');
  assert.ok(earliest <= cur.periodKey);
  assert.equal(st.records.length, 2);
  assert.equal(cur.monthSpentCents, 1000);
});
