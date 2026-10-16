/**
 * state.test.js —— 状态中枢单测：记账 → 余额/统计同步、愿望清单不重复扣款、
 * 生活费调整保留历史、导入导出、清空、示例数据、持久化（刷新后仍在）。
 */

import { installBrowserMock } from './browser-mock.js';
installBrowserMock();

import test from 'node:test';
import assert from 'node:assert/strict';

const dates = await import('../js/core/dates.js');
const storage = await import('../js/core/storage.js');
const budget = await import('../js/core/budget.js');
const state = await import('../js/core/state.js');

const TODAY_KEY = dates.todayKey();

function rec(id, extra = {}) {
  return {
    id,
    amount: 1800,
    title: '食堂午饭',
    category: 'food',
    date: TODAY_KEY,
    note: '',
    isNonEssential: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function wishItem(id, extra = {}) {
  return {
    id,
    name: '蓝牙耳机',
    priceCents: 29900,
    addedAt: TODAY_KEY,
    reason: '上网课用',
    plannedDate: '',
    status: 'pending',
    coolingEnabled: false,
    purchasedAt: '',
    recordedRecordId: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/** 重置到干净的已知状态（顺带清掉 localStorage 与通知队列）。 */
function reset({ fee = 0, records = [], wishlist = [], ...settings } = {}) {
  window.localStorage.clear();
  state.clearNotices();
  const st = storage.emptyState();
  st.settings = { ...st.settings, monthlyFeeCents: fee, ...settings };
  if (fee > 0) st.settings.months[dates.currentPeriodKey(st.settings.cycleDay)] = fee;
  st.records = records.map((r) => ({ ...r }));
  st.wishlist = wishlist.map((w) => ({ ...w }));
  storage.saveState(st);
  state.init();
  state.clearNotices();
  return st;
}

/* ---------------- 记账与余额 ---------------- */

test('addRecord：校验输入，成功后余额与统计同步', () => {
  reset({ fee: 200000 });
  const before = state.getBudgetView();
  assert.equal(before.balanceCents, 200000);

  const res = state.addRecord({ amount: 1800, title: '食堂午饭', category: 'food', date: TODAY_KEY });
  assert.equal(res.ok, true);
  assert.equal(res.record.amount, 1800);
  assert.equal(res.record.id.startsWith('r_'), true);

  const after = state.getBudgetView();
  assert.equal(after.monthSpentCents, 1800);
  assert.equal(after.remainingCents, 198200);
  assert.equal(after.balanceCents, 198200, '余额必须随消费减少');
  assert.equal(state.getStatsView().todayTotalCents, 1800, '今日统计同步');

  const bad = [
    { amount: 0, title: '零元' },
    { amount: -500, title: '负数' },
    { amount: 1800, title: '   ' },
    { amount: 1800, title: '坏日期', date: '2025-02-29' },
  ];
  for (const input of bad) {
    const r = state.addRecord(input);
    assert.equal(r.ok, false, `应拒绝 ${JSON.stringify(input)}`);
    assert.equal(r.record, null);
    assert.ok(r.error.length > 0);
  }
  assert.equal(state.getBudgetView().monthSpentCents, 1800, '失败的记账不改动任何数字');
});

test('addRecord：未知分类归入「其他」，备注与标记被保留', () => {
  reset({ fee: 200000 });
  const res = state.addRecord({
    amount: 2600,
    title: '奶茶',
    category: '外星分类',
    date: TODAY_KEY,
    note: '  和朋友一起  ',
    isNonEssential: true,
  });
  assert.equal(res.ok, true);
  assert.equal(res.record.category, 'other');
  assert.equal(res.record.note, '和朋友一起');
  assert.equal(res.record.isNonEssential, true);
  const stats = state.getStatsView();
  assert.equal(stats.nonEssentialCents, 2600);
  assert.equal(stats.categories.find((c) => c.id === 'other').cents, 2600);
});

test('updateRecord / deleteRecord：余额与统计跟着重新计算', () => {
  reset({ fee: 200000, records: [rec('r1')] });
  assert.equal(state.getBudgetView().monthSpentCents, 1800);

  const up = state.updateRecord('r1', { amount: 2000 });
  assert.equal(up.ok, true);
  assert.equal(up.record.amount, 2000);
  assert.equal(state.getBudgetView().monthSpentCents, 2000, '改金额后重新统计');
  assert.equal(state.getBudgetView().balanceCents, 198000);

  assert.equal(state.updateRecord('r1', { amount: 0 }).ok, false);
  assert.equal(state.updateRecord('r1', { category: '不存在' }).ok, false);
  assert.equal(state.updateRecord('r1', { date: '2025-13-01' }).ok, false);
  assert.equal(state.updateRecord('r1', { title: '' }).ok, false);
  assert.equal(state.updateRecord('missing', { amount: 100 }).ok, false);
  assert.equal(state.getBudgetView().monthSpentCents, 2000, '失败的编辑不改动数字');

  const del = state.deleteRecord('r1');
  assert.equal(del.ok, true);
  assert.equal(del.removed.amount, 2000);
  assert.equal(state.getState().records.length, 0);
  assert.equal(state.getBudgetView().monthSpentCents, 0);
  assert.equal(state.getBudgetView().balanceCents, 200000, '删除后余额回到原值');
  assert.equal(state.deleteRecord('r1').ok, false);
});

/* ---------------- 愿望清单：不重复扣款 ---------------- */

test('愿望清单：标记已购买不扣款，记实际消费才扣款，且不重复扣款', () => {
  reset({ fee: 200000, wishlist: [wishItem('w1')] });
  const startBalance = state.getBudgetView().balanceCents;
  assert.equal(startBalance, 200000);

  const marked = state.markWishPurchased('w1');
  assert.equal(marked.ok, true);
  assert.equal(state.getBudgetView().balanceCents, startBalance, '只是标记，绝不能扣钱');
  assert.equal(state.getState().records.length, 0, '标记不产生消费记录');
  assert.equal(state.getWishById('w1').status, 'purchased');
  assert.ok(state.getWishById('w1').purchasedAt, '要记录购买时间');

  const booked = state.recordWishPurchase('w1', 29900);
  assert.equal(booked.ok, true);
  assert.equal(state.getBudgetView().balanceCents, 170100, '记实际消费才扣款');
  assert.equal(state.getState().records.length, 1);
  assert.equal(state.getState().records[0].title, '蓝牙耳机');
  assert.equal(state.getState().records[0].category, 'shopping');
  assert.equal(state.getWishById('w1').recordedRecordId, booked.record.id);

  const again = state.recordWishPurchase('w1', 29900);
  assert.equal(again.ok, false);
  assert.match(again.error, /不会重复扣款/);
  assert.equal(state.getBudgetView().balanceCents, 170100, '第二次调用不能再扣一次');
  assert.equal(state.getState().records.length, 1);

  // 删掉那条记账记录后，解除关联，可以重新记账
  state.deleteRecord(booked.record.id);
  assert.equal(state.getWishById('w1').recordedRecordId, '');
  const rebook = state.recordWishPurchase('w1', 30000);
  assert.equal(rebook.ok, true);
  assert.equal(state.getBudgetView().balanceCents, 170000);
});

test('愿望清单：新增 / 编辑 / 删除 / 冷静期', () => {
  reset({ fee: 200000 });
  const res = state.addWishItem({ name: '蓝牙耳机', priceCents: 29900, reason: '上网课用' });
  assert.equal(res.ok, true);
  assert.equal(res.item.addedAt, TODAY_KEY);
  assert.equal(res.item.status, 'pending');
  assert.equal(res.item.coolingEnabled, false, '默认不开冷静期，必须由用户主动选');

  assert.equal(state.addWishItem({ name: '', priceCents: 100 }).ok, false);
  assert.equal(state.addWishItem({ name: 'x', priceCents: -1 }).ok, false);

  // 打开默认冷静期后新增的条目自动带上冷静期
  state.setWishCoolingDefault(true);
  const cooled = state.addWishItem({ name: '机械键盘', priceCents: 39900 });
  assert.equal(cooled.item.coolingEnabled, true);
  const remain = state.coolingRemainingMs(cooled.item);
  assert.ok(remain > 0 && remain <= 24 * 60 * 60 * 1000, '当天新增的冷静期条目应还剩 0..24h');
  assert.equal(state.coolingRemainingMs(res.item), 0, '没开冷静期的条目剩余为 0');

  const edited = state.updateWishItem(res.item.id, { name: ' 降噪耳机 ', priceCents: 35000 });
  assert.equal(edited.ok, true);
  assert.equal(edited.item.name, '降噪耳机');
  assert.equal(edited.item.priceCents, 35000);
  assert.equal(state.updateWishItem(res.item.id, { status: '外星' }).ok, false);

  const hold = state.updateWishItem(res.item.id, { status: 'hold' });
  assert.equal(hold.ok, true);
  assert.equal(hold.item.purchasedAt, '', '不是已购买就不该有购买时间');

  assert.equal(state.deleteWishItem(res.item.id).ok, true);
  assert.equal(state.deleteWishItem(res.item.id).ok, false);
  assert.equal(state.getWishById(res.item.id), null);
});

/* ---------------- 生活费与设置 ---------------- */

test('setMonthlyFee：只改本期，历史设定与消费记录都保留', () => {
  reset({ fee: 200000, records: [rec('r1')] });
  const periodKey = dates.currentPeriodKey(1);
  const before = state.getBudgetView();
  assert.equal(before.balanceCents, 198200);

  const res = state.setMonthlyFee(150000);
  assert.equal(res.ok, true);
  assert.equal(res.periodKey, periodKey);

  const after = state.getBudgetView();
  assert.equal(after.monthlyFeeCents, 150000);
  assert.equal(after.monthSpentCents, 1800, '已消费金额不因改生活费变化');
  assert.equal(after.remainingCents, 148200);
  assert.equal(after.balanceCents, 198200 - 50000, '余额按差额同步调整');

  const st = state.getState();
  assert.equal(st.settings.months[periodKey], 150000);
  assert.equal(st.records.length, 1, '消费记录一条都不能少');

  // 往期单独设定过就不受本期影响
  const prevKey = dates.prevPeriodKey(periodKey);
  st.settings.months[prevKey] = 300000;
  assert.equal(state.getBudgetView().monthlyFeeCents, 150000, '本期仍用本期的设定');

  assert.equal(state.setMonthlyFee(-1).ok, false);
  assert.equal(state.setMonthlyFee('abc').ok, false);
  assert.equal(state.setMonthlyFee(0).ok, true, '归零是合法操作（等于取消预算）');
});

test('预算提醒：跨过阈值只提示一次', () => {
  reset({ fee: 200000, records: [rec('r1', { amount: 150000 })] });
  assert.equal(state.setReminderPercent(80).ok, true);
  assert.equal(state.getNotices().length, 0, '设置阈值本身不该弹提示');

  state.addRecord({ amount: 20000, title: '奶茶', category: 'food', date: TODAY_KEY });
  const fired = state.getNotices().filter((n) => n.text.includes('预算提醒'));
  assert.equal(fired.length, 1, '跨过阈值提示一次');
  assert.equal(fired[0].level, 'warn');
  assert.match(fired[0].text, /80%/);

  state.addRecord({ amount: 30200, title: '聚餐', category: 'food', date: TODAY_KEY });
  assert.equal(
    state.getNotices().filter((n) => n.text.includes('预算提醒')).length,
    1,
    '同一周期同一阈值不重复提示',
  );

  assert.equal(state.setReminderPercent(101).ok, false);
  assert.equal(state.setReminderPercent(-1).ok, false);
  assert.equal(state.setReminderPercent(0).ok, true, '0 = 关闭提醒');
  assert.equal(state.setCycleDay(31).cycleDay, 1, '非法周期起始日归 1');
  assert.equal(state.setCycleDay(15).cycleDay, 15);
  state.setCarryOver(false);
  assert.equal(state.getState().settings.carryOver, false);
});

/* ---------------- 导入 / 导出 / 清空 ---------------- */

test('导出 → 预检 → 导入：往返一致，预检不落地', () => {
  reset({ fee: 200000, records: [rec('r1')], wishlist: [wishItem('w1')] });
  const text = state.exportJsonText();
  const envelope = JSON.parse(text);
  assert.equal(envelope.app, 'TouchMoney');
  assert.equal(envelope.data.records.length, 1);

  const plan = state.previewImport(text, 'merge');
  assert.equal(plan.ok, true);
  assert.equal(plan.counts.records, 0, '同一份数据合并进来没有新记录');
  assert.equal(plan.counts.skippedRecords, 1);
  assert.equal(state.getState().records.length, 1, '预检不能改动状态');

  assert.equal(state.importJsonText('不是 JSON', 'merge').ok, false);
  assert.equal(state.getState().records.length, 1, '导入失败不改动状态');

  const merged = state.importJsonText(text, 'merge');
  assert.equal(merged.ok, true);
  assert.equal(merged.counts.records, 0);
  assert.equal(state.getState().records.length, 1);

  // 换一份带新 id 的数据：合并追加、替换覆盖
  const other = storage.exportJson({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: { ...budget.defaultSettings(), monthlyFeeCents: 300000 },
    records: [rec('r_new', { amount: 5000 })],
    wishlist: [],
  });
  const m2 = state.importJsonText(other, 'merge');
  assert.equal(m2.ok, true);
  assert.equal(m2.counts.records, 1);
  assert.equal(state.getState().records.length, 2);
  assert.equal(state.getState().settings.monthlyFeeCents, 200000, '当前已设置生活费时不被导入覆盖');

  const rep = state.importJsonText(other, 'replace');
  assert.equal(rep.ok, true);
  assert.equal(state.getState().records.length, 1);
  assert.equal(state.getState().records[0].id, 'r_new');
  assert.equal(state.getState().wishlist.length, 0, '替换模式清掉了愿望清单');
});

test('clearAllData：回到空白状态并清掉本地存储', () => {
  reset({ fee: 200000, records: [rec('r1')], wishlist: [wishItem('w1')] });
  assert.equal(window.localStorage.getItem(storage.STORAGE_KEY) !== null, true);

  const res = state.clearAllData();
  assert.equal(res.ok, true);
  assert.equal(state.getState().records.length, 0);
  assert.equal(state.getState().wishlist.length, 0);
  assert.equal(state.getState().settings.monthlyFeeCents, 0);
  assert.equal(state.isConfiguredFlag(), false);
  assert.equal(state.getBudgetView().balanceCents, 0);
  assert.equal(state.getStatsView().hasAnyRecord, false);

  const saved = JSON.parse(window.localStorage.getItem(storage.STORAGE_KEY));
  assert.equal(saved.records.length, 0);
  assert.equal(saved.wishlist.length, 0);
});

test('loadDemoData：只在主动调用时写入示例数据', () => {
  reset();
  assert.equal(state.getState().records.length, 0, '正常启动不该有虚构数据');

  const res = state.loadDemoData();
  assert.equal(res.ok, true);
  const st = state.getState();
  assert.equal(st.records.length, 10);
  assert.equal(st.wishlist.length, 2);
  assert.equal(st.settings.monthlyFeeCents, 200000);
  assert.equal(st.settings.reminderPercent, 80);
  assert.ok(st.records.every((r) => r.id.startsWith('demo_r_')));
  assert.ok(st.records.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
  assert.ok(st.records.every((r) => Number.isInteger(r.amount) && r.amount > 0));
  assert.ok(st.wishlist.every((w) => w.id.startsWith('demo_w_')));

  const view = state.getBudgetView();
  assert.equal(view.monthlyFeeCents, 200000);
  assert.ok(view.monthSpentCents > 0, '示例数据应该能立刻看到效果');
  assert.equal(state.getStatsView().hasAnyRecord, true);
});

/* ---------------- 排序 / 持久化 ---------------- */

test('sortedRecords / sortedWishlist：稳定的展示顺序', () => {
  const records = [
    rec('a', { date: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' }),
    rec('b', { date: '2026-10-15', createdAt: '2026-10-15T00:00:00.000Z' }),
    rec('c', { date: '2026-10-15', createdAt: '2026-10-15T00:00:01.000Z' }),
    rec('d', { date: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z' }),
  ];
  const sorted = state.sortedRecords(records);
  assert.deepEqual(sorted.map((r) => r.id), ['c', 'b', 'a', 'd'], '新日期在前，同日新记录在前');
  assert.equal(records.length, 4, '排序不改动原数组');

  const list = [wishItem('p', { status: 'purchased' }), wishItem('h', { status: 'hold' }), wishItem('q', { status: 'pending' })];
  const wl = state.sortedWishlist(list);
  assert.deepEqual(wl.map((w) => w.status), ['pending', 'hold', 'purchased'], '想买的在前、已买的沉底');
});

test('持久化：写入本地存储，重新读取（模拟刷新）后数据仍在', () => {
  reset();
  state.setMonthlyFee(200000);
  const res = state.addRecord({ amount: 1800, title: '食堂午饭', category: 'food', date: TODAY_KEY });
  state.addWishItem({ name: '蓝牙耳机', priceCents: 29900 });

  const raw = window.localStorage.getItem(storage.STORAGE_KEY);
  assert.ok(raw, '必须真的写进 localStorage');
  const saved = JSON.parse(raw);
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].id, res.record.id);
  assert.equal(saved.settings.monthlyFeeCents, 200000);
  assert.equal(saved.wishlist.length, 1);

  // 模拟刷新：重新 init 会从 localStorage 读回
  state.clearNotices();
  const reloaded = state.init();
  assert.equal(reloaded.records.length, 1);
  assert.equal(reloaded.wishlist.length, 1);
  assert.equal(state.getBudgetView().balanceCents, 198200);
  assert.equal(state.isConfiguredFlag(), true);
  assert.equal(state.isStorageAvailableFlag(), true);
});

test('通知队列：可关闭、可清空、最多保留 6 条', () => {
  state.clearNotices();
  assert.equal(state.getNotices().length, 0);
  state.pushNotice('测试提示', { level: 'warn' });
  const list = state.getNotices();
  assert.equal(list.length, 1);
  assert.equal(list[0].level, 'warn');
  assert.equal(list[0].sticky, false);
  state.dismissNotice(list[0].id);
  assert.equal(state.getNotices().length, 0);

  for (let i = 0; i < 8; i++) state.pushNotice(`提示 ${i}`);
  assert.equal(state.getNotices().length, 6, '旧提示自动淘汰，不无限堆积');
  state.clearNotices();
  assert.equal(state.getNotices().length, 0);
  state.pushNotice('');
  assert.equal(state.getNotices().length, 0, '空文本不产生提示');
});

test('订阅：状态变化会通知渲染层', () => {
  reset({ fee: 200000 });
  let calls = 0;
  const unsub = state.subscribe(() => { calls += 1; });
  state.addRecord({ amount: 100, title: '一瓶水', category: 'food', date: TODAY_KEY });
  assert.ok(calls > 0, '写操作后要触发重渲染');
  unsub();
  const frozen = calls;
  state.addRecord({ amount: 100, title: '另一瓶水', category: 'food', date: TODAY_KEY });
  assert.equal(calls, frozen, '取消订阅后不再回调');
});
