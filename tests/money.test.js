/**
 * money.test.js —— 金额工具单测（node --test）。
 */

import './browser-mock.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const money = await import('../js/core/money.js');

test('parseAmountToCents：正常输入按「分」精确解析', () => {
  const cases = [
    ['18', 1800],
    ['18.5', 1850],
    ['18.00', 1800],
    ['0.05', 5],
    ['¥1,234.56', 123456],
    ['￥89', 8900],
    [' 26.8 ', 2680],
    ['999999.99', 99999999],
  ];
  for (const [input, cents] of cases) {
    const res = money.parseAmountToCents(input);
    assert.equal(res.ok, true, `应接受 ${input}`);
    assert.equal(res.cents, cents, `${input} 应解析为 ${cents} 分`);
  }
});

test('parseAmountToCents：非法输入一律拒绝并给出可读原因', () => {
  const bad = ['', '   ', '0', '0.00', '-5', 'abc', '18.999', '1.2.3', '1e3', '18元', '12,34.5', null, undefined];
  for (const input of bad) {
    const res = money.parseAmountToCents(input);
    assert.equal(res.ok, false, `应拒绝 ${String(input)}`);
    assert.equal(typeof res.error, 'string');
    assert.ok(res.error.length > 0, `应给出错误说明：${String(input)}`);
  }
});

test('parseAmountToCents：单笔上限 1000000 元', () => {
  assert.equal(money.parseAmountToCents('1000000').ok, true);
  const over = money.parseAmountToCents('1000000.01');
  assert.equal(over.ok, false);
  assert.match(over.error, /上限/);
});

test('formatAmount：分转元固定两位小数，负号在最前', () => {
  assert.equal(money.formatAmount(0), '0.00');
  assert.equal(money.formatAmount(5), '0.05');
  assert.equal(money.formatAmount(1800), '18.00');
  assert.equal(money.formatAmount(123456), '1,234.56');
  assert.equal(money.formatAmount(-123456), '-1,234.56');
  assert.equal(money.formatAmount(-5), '-0.05');
});

test('formatCents / formatCentsWhole：展示形态', () => {
  assert.equal(money.formatCents(118200), '¥1,182.00');
  assert.equal(money.formatCentsWhole(118200), '1,182');
  assert.equal(money.formatCentsWhole(-118200), '-1,182');
  assert.equal(money.formatCentsWhole(99), '1');
  assert.equal(money.formatCentsWhole(49), '0');
  assert.equal(money.formatCentsWhole(-99), '-1');
});

test('浮点陷阱：0.1+0.2 类输入不会污染存储', () => {
  const a = money.parseAmountToCents('0.1');
  const b = money.parseAmountToCents('0.2');
  assert.equal(a.cents + b.cents, 30);
  assert.equal(money.formatAmount(a.cents + b.cents), '0.30');
});

test('ratio / toPercent / clampRatio：whole<=0 时安全返回 0', () => {
  assert.equal(money.ratio(50, 200), 0.25);
  assert.equal(money.toPercent(50, 200), 25);
  assert.equal(money.toPercent(300, 200), 150);
  assert.equal(money.toPercent(50, 0), 0);
  assert.equal(money.ratio(50, -10), 0);
  assert.equal(money.clampRatio(300, 200), 1);
  assert.equal(money.clampRatio(-10, 200), 0);
});

test('yuanToCents / centsToYuan 往返一致', () => {
  for (const cents of [0, 1, 5, 99, 100, 12345, 999999]) {
    assert.equal(money.yuanToCents(money.centsToYuan(cents)), cents);
  }
});
