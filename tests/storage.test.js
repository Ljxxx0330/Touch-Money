/**
 * storage.test.js —— 存储、清洗、导入导出单测。
 * 要求：LocalStorage 读不到 / 格式不对时必须安全处理，不能崩溃。
 */

import { installBrowserMock } from './browser-mock.js';

installBrowserMock();
import test from 'node:test';
import assert from 'node:assert/strict';

const dates = await import('../js/core/dates.js');
const storage = await import('../js/core/storage.js');
const budget = await import('../js/core/budget.js');

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
    ...extra,
  };
}

function wish(id, extra = {}) {
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
    ...extra,
  };
}

function mkState(settings, records, wishlist) {
  const st = storage.emptyState();
  if (settings) st.settings = { ...budget.defaultSettings(), ...settings };
  if (records) st.records = records;
  if (wishlist) st.wishlist = wishlist;
  return st;
}

/* ---------------- 清洗 ---------------- */

test('sanitizeState：垃圾输入一律回到空白状态，不抛错', () => {
  for (const input of [null, undefined, 0, 'str', true, [], ['a'], NaN]) {
    const { state, notes, stats } = storage.sanitizeState(input);
    assert.equal(state.records.length, 0);
    assert.equal(state.wishlist.length, 0);
    assert.equal(state.settings.monthlyFeeCents, 0);
    assert.ok(Array.isArray(notes));
    assert.equal(stats.foundRecords, 0);
  }
});

test('sanitizeState：无效记录被丢弃，可修复的字段被修正', () => {
  const input = {
    records: [
      rec('ok1'),
      rec('bad_amount', { amount: 0 }),
      rec('bad_amount2', { amount: -3 }),
      rec('bad_amount3', { amount: 'abc' }),
      rec('bad_amount4', { amount: 12.345 }),
      rec('bad_amount4', { amount: 12.345 }),
      rec('bad_date', { date: '2025-02-29' }),
      rec('bad_date2', { date: 'not-a-date' }),
      '我不是对象',
      rec('bad_cat', { category: '外星分类' }),
      { id: 'no_title', amount: 500, date: TODAY_KEY },
      rec('ok1', { amount: 900, id: 'r1_dup' }),
      { amount: 700, date: TODAY_KEY, title: '没有 id', id: 'r1_noid' },
    ],
  };
  const { state, notes, stats } = storage.sanitizeState(input);

  assert.equal(stats.foundRecords, 13);
  assert.equal(stats.droppedRecords, 6, '金额/日期/非对象的问题记录被丢弃');
  assert.equal(state.records.length, 7);

  const byId = new Map(state.records.map((r) => [r.id, r]));
  assert.equal(byId.size, 7, '每条都有唯一 id');
  assert.equal(byId.get('bad_cat').category, 'other', '未知分类归入「其他」');
  assert.equal(byId.get('no_title').title, '未命名消费', '缺名称补默认名');
  assert.equal(byId.get('no_title').category, 'other', '缺分类也归入「其他」');
  assert.equal(byId.get('no_title').amount, 500);
  assert.ok(byId.get('r1_dup'), '重复 id 的那条被保留但换了新 id');
  assert.ok(byId.get('r1_noid'), '没有 id 的记录被补了 id');
  assert.equal(byId.get('r1_dup').amount, 900);

  const kept = byId.get('ok1');
  assert.equal(kept.amount, 1800);
  assert.equal(kept.isNonEssential, false);
  assert.equal(kept.note, '');
  assert.equal(typeof kept.createdAt, 'string');
  assert.ok(notes.length > 0, '清洗过程要留下可读提示');
  assert.ok(notes.some((n) => n.includes('丢弃')));
});

test('sanitizeState：设置字段归一化（周期日 1..28、阈值 0..100、往期生活费）', () => {
  const { state, notes } = storage.sanitizeState({
    settings: {
      monthlyFeeCents: 200000,
      cycleDay: 31,
      carryOver: true,
      reminderPercent: 180,
      wishCoolingDefault: true,
      months: { '2026-10': 150000, '2026-13': 999, 'garbage': 100, '2026-09': -5, '2026-08': 'abc' },
    },
    records: [rec('r1')],
  });
  assert.equal(state.settings.monthlyFeeCents, 200000);
  assert.equal(state.settings.cycleDay, 1, '31 日不是合法的周期起始日');
  assert.equal(state.settings.carryOver, true);
  assert.equal(state.settings.reminderPercent, 100, '阈值被夹到 0..100');
  assert.equal(state.settings.wishCoolingDefault, true);
  assert.deepEqual(state.settings.months, { '2026-10': 150000 }, '往期生活费只保留合法项（key 的月份必须存在、值必须是非负整数）');
  assert.equal(notes.length, 0, '字段齐全时不该产生清洗提示');
  assert.ok(notes.some((n) => n.includes('默认设置')) === false, 'settings 存在时不应报「设置缺失」');
});

test('sanitizeState：愿望条目清洗与状态兜底', () => {
  const { state, stats } = storage.sanitizeState({
    wishlist: [
      wish('w1'),
      wish('w_bad_price', { priceCents: -1 }),
      wish('w_bad_price2', { priceCents: 'abc' }),
      { priceCents: 100, name: '' },
      wish('w_bad_status', { status: '外星状态' }),
      wish('w_bad_date', { addedAt: '2025-02-29', plannedDate: 'nope' }),
    ],
  });
  assert.equal(stats.foundWishlist, 6);
  assert.equal(stats.droppedWishlist, 3);
  assert.equal(state.wishlist.length, 3);
  assert.equal(state.wishlist[1].status, 'pending');
  assert.equal(state.wishlist[2].addedAt, dates.todayKey(), '非法添加日期回落到今天');
  assert.equal(state.wishlist[2].plannedDate, '');
  assert.equal(state.wishlist[0].coolingEnabled, false);
});

/* ---------------- 损坏存储 ---------------- */

test('loadState：JSON 损坏时备份原始内容并按空白启动', () => {
  const corrupt = '{ 这不是 JSON ';
  window.localStorage.setItem(storage.STORAGE_KEY, corrupt);
  const res = storage.loadState();

  assert.equal(res.corrupt, true);
  assert.equal(res.state.records.length, 0);
  assert.equal(res.state.settings.monthlyFeeCents, 0);
  assert.ok(res.backupKey.startsWith('touchmoney.corrupt-backup.'));
  assert.equal(window.localStorage.getItem(res.backupKey), corrupt, '原始内容必须留档');
  assert.equal(window.localStorage.getItem(storage.STORAGE_KEY), null, '损坏的主键已清空，避免反复报错');
  assert.ok(res.notes.some((n) => n.includes('JSON 损坏')));
});

test('loadState：空存储返回空白状态；正常数据原样读回', () => {
  window.localStorage.clear();
  const empty = storage.loadState();
  assert.equal(empty.corrupt, false);
  assert.equal(empty.state.records.length, 0);
  assert.equal(empty.notes.length, 0);

  const st = mkState({ monthlyFeeCents: 200000 }, [rec('r1')], [wish('w1')]);
  assert.equal(storage.saveState(st).ok, true);
  const back = storage.loadState();
  assert.equal(back.state.records.length, 1);
  assert.equal(back.state.records[0].id, 'r1');
  assert.equal(back.state.settings.monthlyFeeCents, 200000);
  assert.equal(back.state.wishlist[0].name, '蓝牙耳机');
  assert.equal(back.corrupt, false);
});

test('loadState：结构不对但不算损坏（对象数组）时安全降级', () => {
  window.localStorage.setItem(storage.STORAGE_KEY, JSON.stringify([1, 2, 3]));
  const res = storage.loadState();
  assert.equal(res.corrupt, false, '合法 JSON 但结构不对，不算损坏');
  assert.equal(res.state.records.length, 0);
  assert.ok(res.notes.some((n) => n.includes('数据结构不正确')));
});

/* ---------------- 导出 / 导入 ---------------- */

test('exportJson + parseImport：往返一致，带可识别信封', () => {
  const st = mkState({ monthlyFeeCents: 200000, reminderPercent: 80 }, [rec('r1')], [wish('w1')]);
  const text = storage.exportJson(st);
  const envelope = JSON.parse(text);
  assert.equal(envelope.app, 'TouchMoney');
  assert.equal(envelope.appLabel, '触钱');
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(typeof envelope.exportedAt, 'string');
  assert.equal(envelope.data.records.length, 1);

  const back = storage.parseImport(text);
  assert.equal(back.ok, true);
  assert.equal(back.state.records[0].id, 'r1');
  assert.equal(back.state.records[0].amount, 1800);
  assert.equal(back.state.wishlist[0].id, 'w1');
  assert.equal(back.state.settings.monthlyFeeCents, 200000);
  assert.equal(back.state.settings.reminderPercent, 80);
});

test('parseImport：坏 JSON / 顶层不是对象 / 别家 app / 缺 data / 无可识别字段', () => {
  let res = storage.parseImport('{"records": [');
  assert.equal(res.ok, false);
  assert.match(res.error, /不是合法的 JSON/);

  res = storage.parseImport('[1,2,3]');
  assert.equal(res.ok, false);
  assert.match(res.error, /顶层必须是对象/);

  res = storage.parseImport(JSON.stringify({ app: 'SomeOtherApp', data: { records: [] } }));
  assert.equal(res.ok, false);
  assert.match(res.error, /不是 TouchMoney/);

  res = storage.parseImport(JSON.stringify({ app: 'TouchMoney' }));
  assert.equal(res.ok, false);
  assert.match(res.error, /缺少 data/);

  res = storage.parseImport(JSON.stringify({ app: 'TouchMoney', data: { foo: 1 } }));
  assert.equal(res.ok, false);
  assert.match(res.error, /settings \/ records \/ wishlist/);

  res = storage.parseImport('');
  assert.equal(res.ok, false);
  assert.match(res.error, /内容为空/);

  res = storage.parseImport(null);
  assert.equal(res.ok, false);
});

test('parseImport：裸数据对象（无信封）也能读', () => {
  const res = storage.parseImport(JSON.stringify({ records: [rec('r1')], settings: { monthlyFeeCents: 100000 } }));
  assert.equal(res.ok, true);
  assert.equal(res.state.records.length, 1);
  assert.equal(res.state.settings.monthlyFeeCents, 100000);
});

test('mergeImport：id 冲突跳过，不重复追加', () => {
  const current = mkState({ monthlyFeeCents: 200000 }, [rec('r1')], [wish('w1')]);
  const incoming = mkState({ monthlyFeeCents: 300000 }, [rec('r1', { amount: 999 }), rec('r2'), rec('r3')], [wish('w1'), wish('w2')]);
  const { state, counts } = storage.mergeImport(current, incoming);

  assert.equal(counts.records, 2, '只新增两条');
  assert.equal(counts.skippedRecords, 1);
  assert.equal(counts.wishlist, 1);
  assert.equal(counts.skippedWishlist, 1);
  assert.equal(state.records.length, 3);
  assert.equal(state.records.find((r) => r.id === 'r1').amount, 1800, '已有记录不被导入覆盖');
  assert.equal(state.wishlist.length, 2);
  assert.equal(state.settings.monthlyFeeCents, 200000, '当前已设置生活费时保留当前设定');
});

test('mergeImport：当前未设置生活费时采纳导入的设置', () => {
  const current = mkState(null, [], []);
  const incoming = mkState({ monthlyFeeCents: 250000, cycleDay: 15, reminderPercent: 70 }, [rec('r2')], []);
  const { state, counts } = storage.mergeImport(current, incoming);
  assert.equal(counts.records, 1);
  assert.equal(state.settings.monthlyFeeCents, 250000);
  assert.equal(state.settings.cycleDay, 15);
  assert.equal(state.settings.reminderPercent, 70);
});

test('saveState / loadState：刷新（重新读取）后数据仍在', () => {
  window.localStorage.clear();
  const st = mkState({ monthlyFeeCents: 150000 }, [rec('r1'), rec('r2', { amount: 2600 })], [wish('w1')]);
  assert.equal(storage.saveState(st).ok, true);

  // 模拟刷新：重新 import 一个新模块实例，读同一份 localStorage
  const fresh = storage.loadState();
  assert.equal(fresh.state.records.length, 2);
  assert.equal(fresh.state.wishlist.length, 1);
  assert.equal(fresh.state.settings.monthlyFeeCents, 150000);
  assert.equal(fresh.state.records[1].amount, 2600);
});

test('emptyState / defaultSettings：干净的起点', () => {
  const st = storage.emptyState();
  assert.deepEqual(st.records, []);
  assert.deepEqual(st.wishlist, []);
  assert.equal(st.schemaVersion, 1);
  assert.equal(st.settings.monthlyFeeCents, 0);
  assert.equal(st.settings.cycleDay, 1);
  assert.equal(st.settings.carryOver, true);
  assert.equal(st.settings.reminderPercent, 0);
  assert.deepEqual(st.settings.months, {});
  assert.notEqual(storage.makeId('r'), storage.makeId('r'), 'id 不能重复');
  assert.ok(storage.makeId('r').startsWith('r_'));
});
