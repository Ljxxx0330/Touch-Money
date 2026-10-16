/**
 * dates.test.js —— 本地日期与预算周期单测。
 * 重点：绝不使用 UTC 解析（'2026-10-15' 必须落在本地 10 月 15 日）。
 */

import './browser-mock.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const dates = await import('../js/core/dates.js');

test('toDateKey / fromDateKey：本地日期往返，不走 UTC', () => {
  const key = '2026-10-15';
  const d = dates.fromDateKey(key);
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9, '10 月的 month 索引应为 9');
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 0, '应为本地零点');
  assert.equal(dates.toDateKey(d), key);

  // 本地 23:30 仍属于当天，不会被 UTC 换算推到次日
  const late = new Date(2026, 9, 15, 23, 30, 0);
  assert.equal(dates.toDateKey(late), '2026-10-15');
});

test('fromDateKey：非法日期返回 null（含 2 月 29 日的溢出）', () => {
  assert.equal(dates.fromDateKey('2025-02-29'), null, '2025 非闰年');
  assert.ok(dates.fromDateKey('2024-02-29'), '2024 闰年应合法');
  assert.equal(dates.fromDateKey('2026-13-01'), null);
  assert.equal(dates.fromDateKey('2026-00-10'), null);
  assert.equal(dates.fromDateKey('2026-10-32'), null);
  assert.equal(dates.fromDateKey('abc'), null);
  assert.equal(dates.fromDateKey(''), null);
  assert.equal(dates.fromDateKey(null), null);
  assert.equal(dates.fromDateKey('2026/10/15'), null);
});

test('daysInMonth：含闰年', () => {
  assert.equal(dates.daysInMonth(2026, 1), 28);
  assert.equal(dates.daysInMonth(2024, 1), 29);
  assert.equal(dates.daysInMonth(2026, 3), 30);
  assert.equal(dates.daysInMonth(2026, 0), 31);
  assert.equal(dates.daysInMonth(2100, 1), 28, '2100 非闰年');
});

test('addMonths：月末钳制且跨年正确', () => {
  assert.equal(dates.toDateKey(dates.addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
  assert.equal(dates.toDateKey(dates.addMonths(new Date(2024, 0, 31), 1)), '2024-02-29');
  assert.equal(dates.toDateKey(dates.addMonths(new Date(2026, 11, 15), 1)), '2027-01-15');
  assert.equal(dates.toDateKey(dates.addMonths(new Date(2026, 0, 15), -1)), '2025-12-15');
});

test('normalizeCycleDay：只接受 1..28', () => {
  assert.equal(dates.normalizeCycleDay(1), 1);
  assert.equal(dates.normalizeCycleDay(28), 28);
  assert.equal(dates.normalizeCycleDay(29), 1);
  assert.equal(dates.normalizeCycleDay(0), 1);
  assert.equal(dates.normalizeCycleDay('abc'), 1);
  assert.equal(dates.normalizeCycleDay(undefined), 1);
  assert.equal(dates.normalizeCycleDay(15.9), 15);
});

test('periodKeyOf：自然月与「每月 10 日起」两种周期', () => {
  assert.equal(dates.periodKeyOf('2026-10-15', 1), '2026-10');
  assert.equal(dates.periodKeyOf('2026-10-01', 1), '2026-10');
  assert.equal(dates.periodKeyOf('2026-10-31', 1), '2026-10');

  // 周期起始日为 10 日：10/1–10/9 属于上一期（9/10 起的周期）
  assert.equal(dates.periodKeyOf('2026-10-09', 10), '2026-09');
  assert.equal(dates.periodKeyOf('2026-10-10', 10), '2026-10');
  assert.equal(dates.periodKeyOf('2026-11-09', 10), '2026-10');
  assert.equal(dates.periodKeyOf('2026-11-10', 10), '2026-11');

  assert.equal(dates.periodKeyOf('2026-01-05', 10), '2025-12', '跨年应回退到上一年 12 月');
  assert.equal(dates.periodKeyOf('bad-date', 1), null);
});

test('periodStartFor：周期起始日计算', () => {
  assert.equal(dates.toDateKey(dates.periodStartFor('2026-10-15', 1)), '2026-10-01');
  assert.equal(dates.toDateKey(dates.periodStartFor('2026-10-15', 10)), '2026-10-10');
  assert.equal(dates.toDateKey(dates.periodStartFor('2026-10-05', 10)), '2026-09-10');
  assert.equal(dates.toDateKey(dates.periodStartFor('2026-02-15', 28)), '2026-01-28', '2 月无 28 日之前的锚点时回退');
});

test('periodRange：含首含尾，跨年连续', () => {
  assert.deepEqual(dates.periodRange('2026-08', '2026-10'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(dates.periodRange('2025-12', '2026-02'), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(dates.periodRange('2026-10', '2026-10'), ['2026-10']);
  assert.deepEqual(dates.periodRange('2026-11', '2026-10'), ['2026-11']);
  assert.deepEqual(dates.periodRange('', '2026-10'), []);
  assert.deepEqual(dates.periodRange('2026-10', null), []);
});

test('nextPeriodKey / prevPeriodKey：跨年', () => {
  assert.equal(dates.nextPeriodKey('2026-12'), '2027-01');
  assert.equal(dates.prevPeriodKey('2027-01'), '2026-12');
  assert.equal(dates.nextPeriodKey('2026-01'), '2026-02');
});

test('lastNDays / weekKeys：数量与顺序', () => {
  const now = new Date(2026, 9, 15); // 2026-10-15 周四
  const last7 = dates.lastNDays(7, now);
  assert.equal(last7.length, 7);
  assert.equal(last7[6], '2026-10-15');
  assert.equal(last7[0], '2026-10-09');

  const week = dates.weekKeys(now);
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-10-12', '周一为一周起点');
  assert.equal(week[6], '2026-10-18');

  // 周一当天：起点就是自己
  const monday = new Date(2026, 9, 12);
  assert.equal(dates.weekKeys(monday)[0], '2026-10-12');
  // 周日：起点是本周一
  const sunday = new Date(2026, 9, 18);
  assert.equal(dates.weekKeys(sunday)[0], '2026-10-12');
  assert.equal(dates.weekKeys(sunday)[6], '2026-10-18');
});

test('humanDate：今天/昨天/前天/同年/跨年四种写法', () => {
  const now = new Date(2026, 9, 15);
  assert.equal(dates.humanDate('2026-10-15', now), '今天');
  assert.equal(dates.humanDate('2026-10-14', now), '昨天');
  assert.equal(dates.humanDate('2026-10-13', now), '前天');
  assert.equal(dates.humanDate('2026-09-05', now), '09-05');
  assert.equal(dates.humanDate('2025-12-31', now), '2025-12-31');
  assert.equal(dates.humanDate('garbage', now), 'garbage');
});

test('humanPeriod：自然月与自定义周期起始日的标题', () => {
  assert.equal(dates.humanPeriod(new Date(2026, 9, 1), 1), '2026 年 10 月');
  assert.equal(dates.humanPeriod(new Date(2026, 9, 10), 10), '2026 年 10 月 · 10月10日起');
});

test('currentPeriodKey：跟随 cycleDay', () => {
  const now = new Date(2026, 9, 5);
  assert.equal(dates.currentPeriodKey(1, now), '2026-10');
  assert.equal(dates.currentPeriodKey(10, now), '2026-09');
});

test('timeZoneLabel / stampForFilename：返回可用文本', () => {
  assert.equal(typeof dates.timeZoneLabel(), 'string');
  assert.ok(dates.timeZoneLabel().length > 0);
  const stamp = dates.stampForFilename(new Date(2026, 9, 15, 9, 7));
  assert.equal(stamp, '20261015-0907');
});
