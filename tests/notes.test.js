/**
 * notes.test.js —— 纸币构成与找零的单元测试。
 * 运行：node --test "tests/*.test.js"
 *
 * 面额单位一律是「分」：100 元 = 10000，1 元 = 100，1 角 = 10，1 分 = 1。
 * 写断言前先换算：400 元 = 40000 分；137 分 = 1.37 元。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installBrowserMock } from './browser-mock.js';
installBrowserMock();

const notes = await import('../js/core/notes.js');

const {
  NOTE_DENOMS,
  noteLabel,
  denomLabel,
  composeNotes,
  noteCount,
  noteTotal,
  expandNotes,
  changeFor,
  describeChange,
  describeComposition,
  depositComposition,
} = notes;

/** 把构成数组压成「面额×张数」的字符串，方便断言。 */
function shape(composition) {
  return composition.map((g) => `${g.denom}x${g.count}`).join('+') || '[]';
}

test('面额表：100/50/20/10/5/1 元 + 5角/1角/1分，从大到小', () => {
  assert.deepEqual(NOTE_DENOMS, [10000, 5000, 2000, 1000, 500, 100, 50, 10, 1]);
  assert.equal(noteLabel(10000), '100');
  assert.equal(noteLabel(2000), '20');
  assert.equal(noteLabel(500), '5');
  assert.equal(noteLabel(100), '1');
  assert.equal(noteLabel(50), '5角');
  assert.equal(noteLabel(10), '1角');
  assert.equal(noteLabel(1), '1分');
});

test('denomLabel：元面额带 ¥，角与分不带 ¥（¥1 已经是 1 元，不能再和 1分 混）', () => {
  assert.equal(denomLabel(10000), '¥100');
  assert.equal(denomLabel(2000), '¥20');
  assert.equal(denomLabel(100), '¥1');
  assert.equal(denomLabel(50), '5角');
  assert.equal(denomLabel(10), '1角');
  assert.equal(denomLabel(1), '1分');
});

test('composeNotes：最少张数（面额单位是分）', () => {
  assert.equal(shape(composeNotes(150000)), '10000x15'); // 1500 元
  assert.equal(shape(composeNotes(148000)), '10000x14+5000x1+2000x1+1000x1'); // 1480 元
  // 1613.70 元：16 张 100、1 张 10、3 张 1 元、1 张 5 角、2 张 1 角
  assert.equal(shape(composeNotes(161370)), '10000x16+1000x1+100x3+50x1+10x2');
  assert.equal(shape(composeNotes(20000)), '10000x2'); // 200 元
  assert.equal(shape(composeNotes(40000)), '10000x4'); // 400 元
  assert.equal(shape(composeNotes(60000)), '10000x6'); // 600 元
  assert.equal(shape(composeNotes(80000)), '10000x8'); // 800 元
  assert.equal(shape(composeNotes(3000)), '2000x1+1000x1'); // 30 元
  assert.equal(shape(composeNotes(600)), '500x1+100x1'); // 6 元
  assert.equal(shape(composeNotes(137)), '100x1+10x3+1x7'); // 1.37 元
  assert.equal(shape(composeNotes(100)), '100x1'); // 1 元
  assert.equal(shape(composeNotes(5)), '1x5'); // 5 分 = 5 枚 1 分硬币
  assert.equal(shape(composeNotes(1)), '1x1'); // 1 分
  assert.equal(shape(composeNotes(11)), '10x1+1x1'); // 1 角 1 分
  assert.equal(shape(composeNotes(99)), '50x1+10x4+1x9'); // 9 角 9 分
});

test('composeNotes：边界与非法输入', () => {
  assert.deepEqual(composeNotes(0), []);
  assert.deepEqual(composeNotes(-500), []);
  assert.deepEqual(composeNotes(null), []);
  assert.deepEqual(composeNotes(undefined), []);
  assert.deepEqual(composeNotes(NaN), []);
  assert.deepEqual(composeNotes('abc'), []);
  // 角与分级的零头都不能被吞掉
  assert.equal(noteTotal(composeNotes(161370)), 161370);
  assert.equal(noteTotal(composeNotes(99)), 99);
  assert.equal(noteTotal(composeNotes(1)), 1);
  assert.equal(noteTotal(composeNotes(7)), 7);
  // 超大余额只截断展示：上限 100000000 分（100 万元），不报错
  const huge = composeNotes(999_999_999);
  assert.equal(noteTotal(huge), 100_000_000);
  assert.equal(noteCount(huge), 10000); // 100 万元全部用 100 元卷，共 10000 张
});

test('noteCount / noteTotal', () => {
  const c = composeNotes(148000);
  assert.equal(noteCount(c), 17);
  assert.equal(noteTotal(c), 148000);
  assert.equal(noteCount([]), 0);
  assert.equal(noteTotal([]), 0);
});

test('expandNotes：逐张展开，超出上限折叠', () => {
  const full = expandNotes(150000, 20);
  assert.equal(full.notes.length, 15);
  assert.deepEqual(full.folded, []);
  assert.ok(full.notes.every((n) => n.denom === 10000));

  const capped = expandNotes(150000, 6);
  assert.equal(capped.notes.length, 6);
  assert.deepEqual(capped.folded, [{ denom: 10000, count: 9 }]);

  const mixed = expandNotes(148000, 4);
  assert.deepEqual(mixed.notes.map((n) => n.denom), [10000, 10000, 10000, 10000]);
  assert.deepEqual(mixed.folded, [
    { denom: 10000, count: 10 },
    { denom: 5000, count: 1 },
    { denom: 2000, count: 1 },
    { denom: 1000, count: 1 },
  ]);
});

test('depositComposition：存入 1500 元就是 15 张 100 元', () => {
  assert.deepEqual(depositComposition(150000), [{ denom: 10000, count: 15, cents: 150000 }]);
  assert.deepEqual(depositComposition(15000), [
    { denom: 10000, count: 1, cents: 10000 },
    { denom: 5000, count: 1, cents: 5000 },
  ]);
  assert.deepEqual(depositComposition(0), []);
});

test('changeFor：花 20 元时抽出 1 张 100、找回 50+20+10', () => {
  const ch = changeFor(150000, 148000);
  assert.deepEqual(ch.out, [{ denom: 10000, count: 1 }]);
  assert.deepEqual(ch.in, [{ denom: 5000, count: 1 }, { denom: 2000, count: 1 }, { denom: 1000, count: 1 }]);
  assert.equal(ch.outTotal, 10000);
  assert.equal(ch.inTotal, 8000);
  assert.equal(ch.net, -2000);
});

test('changeFor：钱包里正好有那张零钱时就不用破开大钞', () => {
  const ch = changeFor(148000, 147000);
  assert.deepEqual(ch.out, [{ denom: 1000, count: 1 }]);
  assert.deepEqual(ch.in, []);
  assert.equal(ch.net, -1000);
});

test('changeFor：余额透支到负数时，钱包里的钞票全部抽出', () => {
  // 300 元（3 张 100）花掉 1500 元，余额 -1200 元，钱包里已经没有钞票
  const ch = changeFor(30000, -120000);
  assert.deepEqual(ch.out, [{ denom: 10000, count: 3 }]);
  assert.deepEqual(ch.in, []);
  assert.equal(ch.outTotal, 30000);
  assert.equal(ch.outTotal - ch.inTotal, 30000);
});

test('changeFor：整张扣减时不构成找零', () => {
  const ch = changeFor(150000, 149900);
  assert.deepEqual(ch.out, [{ denom: 10000, count: 1 }]);
  assert.deepEqual(ch.in, [
    { denom: 5000, count: 1 },
    { denom: 2000, count: 2 },
    { denom: 500, count: 1 },
    { denom: 100, count: 4 },
  ]);
  assert.equal(ch.net, -100);
});

test('changeFor：花光与余额归零时全部抽出', () => {
  const ch = changeFor(148000, 0);
  assert.equal(ch.outTotal, 148000);
  assert.deepEqual(ch.in, []);
  assert.equal(noteCount(ch.out), 17);
});

test('changeFor：不变时没有任何动作', () => {
  const ch = changeFor(148000, 148000);
  assert.deepEqual(ch.out, []);
  assert.deepEqual(ch.in, []);
  assert.equal(ch.net, 0);
});

test('changeFor：对任意金额都保持「新构成 = 旧构成 − 抽出 + 找回」', () => {
  const samples = [
    [150000, 148000], [148000, 147000], [150000, 149900], [161370, 161070],
    [1, 0], [0, 1], [99, 100], [100000, 33333], [33333, 100000],
    [77777, 12345], [12345, 77777], [200000, 200000], [0, 0], [7, 3],
    [30000, -120000], [161370, 161369], [30000, 180000], [150000, 149990],
  ];
  for (const [before, after] of samples) {
    const ch = changeFor(before, after);
    // 抽出与找回的差额应对应余额变化量的大小（消费时为正，存入时为负）
    // 余额没有涉及消费（新余额仍为非负）时，抽出与找回的差额恰好对应余额变化量；
    // 余额超支时钱巴里的钞票已全部抽出，消费金额可以大于钱巴里的钱。
    if (after >= 0) {
      assert.equal(
        Math.abs(ch.outTotal - ch.inTotal),
        Math.abs(after - before),
        `抽出与找回的差额应对应余额变化量：${before} -> ${after}`,
      );
    } else {
      assert.equal(ch.in.length, 0, `钱巴已空时不应找零：${before} -> ${after}`);
      assert.ok(ch.outTotal <= before, `抽出不能多于钱巴里的钱：${before} -> ${after}`);
    }

    const beforeMap = new Map(composeNotes(before).map((g) => [g.denom, g.count]));
    const afterMap = new Map(composeNotes(after).map((g) => [g.denom, g.count]));
    const rebuilt = new Map(beforeMap);
    for (const g of ch.out) rebuilt.set(g.denom, (rebuilt.get(g.denom) || 0) - g.count);
    for (const g of ch.in) rebuilt.set(g.denom, (rebuilt.get(g.denom) || 0) + g.count);

    for (const [denom, count] of rebuilt) {
      assert.equal(count, afterMap.get(denom) || 0, `面额 ${denom} 的张数应当吻合（${before} -> ${after}）`);
    }
    for (const [denom, count] of afterMap) {
      assert.equal(rebuilt.get(denom) || 0, count, `面额 ${denom} 缺少新构成的张数（${before} -> ${after}）`);
    }
  }
});

test('describeChange：文案与构成一致', () => {
  assert.equal(describeChange(150000, 148000), '抽出 ¥100，找回 ¥50 + ¥20 + ¥10');
  assert.equal(describeChange(148000, 147000), '抽出 ¥10');
  assert.equal(describeChange(0, 150000), '找回 ¥100 ×15');
  assert.equal(describeChange(150000, 149900), '抽出 ¥100，找回 ¥50 + ¥20 ×2 + ¥5 + ¥1 ×4');
  assert.equal(describeChange(150000, 149990), '抽出 ¥100，找回 ¥50 + ¥20 ×2 + ¥5 + ¥1 ×4 + 5角 + 1角 ×4');
  assert.equal(describeChange(148000, 148000), '');
});

test('describeComposition：钱包里的纸币构成一目了然', () => {
  assert.equal(describeComposition(148000), '¥100 ×14 · ¥50 ×1 · ¥20 ×1 · ¥10 ×1');
  assert.equal(describeComposition(150000), '¥100 ×15');
  assert.equal(describeComposition(161370), '¥100 ×16 · ¥10 ×1 · ¥1 ×3 · 5角 ×1 · 1角 ×2');
  assert.equal(describeComposition(99), '5角 ×1 · 1角 ×4 · 1分 ×9');
  assert.equal(describeComposition(0), '');
  assert.equal(describeComposition(-100), '');
});

test('贪心即最少张数：与动态规划最优解逐分一致', () => {
  // 用动态规划求「最少张数」的真值，200 元以内逐分比对贪心结果。
  const MAX = 20000;
  const INF = 1e9; // 用有限大数当哨兵，避免 MAX_SAFE_INTEGER + 1 溢出成 -1
  const best = new Int32Array(MAX + 1).fill(INF);
  best[0] = 0;
  for (let v = 1; v <= MAX; v += 1) {
    for (const d of NOTE_DENOMS) {
      if (d <= v && best[v - d] + 1 < best[v]) best[v] = best[v - d] + 1;
    }
  }
  for (let v = 1; v <= MAX; v += 1) {
    assert.equal(noteCount(composeNotes(v)), best[v], `金额 ${v} 分不是最少张数`);
  }
});

test('构成合计恒等于余额（含角与分级零头）', () => {
  for (const v of [1, 7, 13, 99, 100, 137, 999, 1000, 1001, 12345, 99999, 161370, 250000]) {
    assert.equal(noteTotal(composeNotes(v)), v, `合计应当等于 ${v} 分`);
  }
});
