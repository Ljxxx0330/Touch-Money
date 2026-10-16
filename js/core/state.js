/**
 * state.js —— 应用状态中枢：加载、保存、增删改、订阅通知。
 * 所有金额变动都通过这里发生，保证「余额 / 统计 / 记录」始终一致。
 */

import {
  computeCurrentBudget,
  computeStats,
  defaultSettings,
  isConfigured,
  previewFeeChange,
  CATEGORIES,
} from './budget.js';
import { addDays, currentPeriodKey, fromDateKey, lastNDays, normalizeCycleDay, toDateKey, today } from './dates.js';
import {
  STORAGE_KEY,
  emptyState,
  exportJson,
  loadState,
  makeId,
  mergeImport,
  parseImport,
  saveState,
  SCHEMA_VERSION,
} from './storage.js';

const state = {
  data: emptyState(),
  storageAvailable: true,
  notices: [],
  firedReminders: new Set(),
};

const listeners = new Set();
let noticeSeq = 0;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of Array.from(listeners)) {
    try {
      fn(state);
    } catch (err) {
      console.error('订阅者渲染出错：', err);
    }
  }
}

/** 持久化并在失败时提示（不抛错）。 */
function persist() {
  const res = saveState(state.data);
  if (!res.ok) pushNotice(res.error, { level: 'error', sticky: true });
  return res.ok;
}

/**
 * 顶部提示条。sticky=true 的错误提示不会自动消失。
 */
export function pushNotice(text, opts = {}) {
  if (!text) return;
  const level = opts.level || 'info';
  const id = `n_${Date.now().toString(36)}_${(noticeSeq++).toString(36)}`;
  state.notices.push({ id, text, level, sticky: !!opts.sticky });
  if (state.notices.length > 6) state.notices.splice(0, state.notices.length - 6);
  if (!opts.sticky) {
    setTimeout(() => dismissNotice(id), 6000);
  }
}

export function dismissNotice(id) {
  const before = state.notices.length;
  state.notices = state.notices.filter((n) => n.id !== id);
  if (state.notices.length !== before) emit();
}

export function clearNotices() {
  state.notices = [];
}

export function getNotices() {
  return state.notices.slice();
}

export function getState() {
  return state.data;
}

export function isStorageAvailableFlag() {
  return state.storageAvailable;
}

export function isConfiguredFlag() {
  return isConfigured(state.data.settings);
}

/** 系统「减少动态效果」开关。 */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** 启动时加载数据。 */
export function init() {
  const loaded = loadState();
  state.data = loaded.state;
  state.storageAvailable = loaded.storageAvailable;
  for (const note of loaded.notes || []) {
    pushNotice(note, { level: loaded.corrupt ? 'error' : 'warn', sticky: !!loaded.corrupt });
  }
  if (!loaded.storageAvailable) {
    pushNotice('本地存储不可用，关闭页面后数据不会保留。', { level: 'error', sticky: true });
  }
  emit();
  return state.data;
}

/**
 * 把输入日期归一为 YYYY-MM-DD。
 * 字符串输入必须先通过 fromDateKey 的回环校验——
 * '2025-02-29' 这类不存在的日期会被 JS 溢出成 '2025-03-01'，不能静默接受。
 * @returns {string|null} 合法则返回 YYYY-MM-DD，否则 null
 */
function normalizeInputDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const d = fromDateKey(value.trim());
    return d ? toDateKey(d) : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toDateKey(value);
  }
  const d = fromDateKey(String(value));
  return d ? toDateKey(d) : null;
}

/* ---------------- 消费记录 ---------------- */

/** 按日期倒序（新的一天在前）。 */
export function sortedRecords(records) {
  return (records || []).slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    if (ca !== cb) return ca < cb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

export function getRecordById(id) {
  return state.data.records.find((r) => r.id === id) || null;
}

/**
 * 新增消费记录。
 * @param {{amount:number, title:string, category:string, date:string, note?:string, isNonEssential?:boolean, linkedWishId?:string}} input
 * @returns {{ok:boolean, record:object|null, error:string}}
 */
export function addRecord(input) {
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, record: null, error: '金额必须大于 0' };
  const title = String(input.title || '').trim();
  if (!title) return { ok: false, record: null, error: '请填写消费名称' };
  const category = CATEGORIES.some((c) => c.id === input.category) ? input.category : 'other';
  const rawDate = input.date === undefined || input.date === null || input.date === '' ? toDateKey(new Date()) : input.date;
  const date = normalizeInputDate(rawDate);
  if (!date) return { ok: false, record: null, error: '日期无效' };

  const nowIso = new Date().toISOString();
  const record = {
    id: makeId('r'),
    amount,
    title: title.slice(0, 60),
    category,
    date,
    note: String(input.note || '').trim().slice(0, 200),
    isNonEssential: !!input.isNonEssential,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  state.data.records.push(record);
  persist();
  checkBudgetReminder();
  emit();
  return { ok: true, record, error: '' };
}

/**
 * 编辑消费记录（部分字段更新）。
 * @returns {{ok:boolean, record:object|null, error:string}}
 */
export function updateRecord(id, patch) {
  const record = getRecordById(id);
  if (!record) return { ok: false, record: null, error: '记录不存在，可能已被删除' };

  const next = { ...record };
  if (patch.amount !== undefined) {
    const amount = Math.round(Number(patch.amount));
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, record: null, error: '金额必须大于 0' };
    next.amount = amount;
  }
  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (!title) return { ok: false, record: null, error: '请填写消费名称' };
    next.title = title.slice(0, 60);
  }
  if (patch.category !== undefined) {
    if (!CATEGORIES.some((c) => c.id === patch.category)) return { ok: false, record: null, error: '分类无效' };
    next.category = patch.category;
  }
  if (patch.date !== undefined) {
    const date = normalizeInputDate(patch.date);
    if (!date) return { ok: false, record: null, error: '日期无效' };
    next.date = date;
  }
  if (patch.note !== undefined) next.note = String(patch.note).trim().slice(0, 200);
  if (patch.isNonEssential !== undefined) next.isNonEssential = !!patch.isNonEssential;

  next.updatedAt = new Date().toISOString();
  Object.assign(record, next);
  persist();
  checkBudgetReminder();
  emit();
  return { ok: true, record, error: '' };
}

export function deleteRecord(id) {
  const idx = state.data.records.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false, error: '记录不存在，可能已被删除' };
  const [removed] = state.data.records.splice(idx, 1);
  // 若该记录是某条愿望的「已记账」凭据，解除关联，避免愿望状态与数据不一致
  for (const w of state.data.wishlist) {
    if (w.recordedRecordId === id) w.recordedRecordId = '';
  }
  persist();
  emit();
  return { ok: true, error: '', removed };
}

/** 预算提醒：本周期消费比例首次跨过阈值时提示一次。 */
function checkBudgetReminder() {
  const settings = state.data.settings;
  const threshold = Number(settings.reminderPercent) || 0;
  if (threshold <= 0) return;
  const view = computeCurrentBudget(state.data);
  if (view.monthlyFeeCents <= 0) return;
  const percent = Math.round((view.monthSpentCents / view.monthlyFeeCents) * 100);
  if (percent < threshold) return;
  const key = `${view.periodKey}:${threshold}`;
  if (state.firedReminders.has(key)) return;
  state.firedReminders.add(key);
  pushNotice(
    `预算提醒：本周期已消费 ${percent}%（阈值 ${threshold}%），剩余 ¥${(view.remainingCents / 100).toFixed(2)}。`,
    { level: 'warn' },
  );
}

/* ---------------- 愿望清单 ---------------- */

export function getWishById(id) {
  return state.data.wishlist.find((w) => w.id === id) || null;
}

export function sortedWishlist(wishlist) {
  const rank = { pending: 0, hold: 1, purchased: 2 };
  return (wishlist || []).slice().sort((a, b) => {
    const ra = rank[a.status] ?? 0;
    const rb = rank[b.status] ?? 0;
    if (ra !== rb) return ra - rb;
    if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/** 冷静期剩余毫秒；未开启冷静期返回 0。 */
export function coolingRemainingMs(item) {
  if (!item || !item.coolingEnabled) return 0;
  const added = new Date(`${item.addedAt}T00:00:00`).getTime();
  if (!Number.isFinite(added)) return 0;
  const end = added + 24 * 60 * 60 * 1000;
  return Math.max(0, end - Date.now());
}

export function addWishItem(input) {
  const name = String(input.name || '').trim();
  if (!name) return { ok: false, item: null, error: '请填写商品名称' };
  const price = Math.round(Number(input.priceCents));
  if (!Number.isFinite(price) || price < 0) return { ok: false, item: null, error: '价格无效' };
  const nowIso = new Date().toISOString();
  const item = {
    id: makeId('w'),
    name: name.slice(0, 60),
    priceCents: price,
    addedAt: toDateKey(new Date()),
    reason: String(input.reason || '').trim().slice(0, 200),
    plannedDate: input.plannedDate ? toDateKey(input.plannedDate) : '',
    status: 'pending',
    coolingEnabled: input.coolingEnabled === undefined ? !!state.data.settings.wishCoolingDefault : !!input.coolingEnabled,
    purchasedAt: '',
    recordedRecordId: '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  state.data.wishlist.push(item);
  persist();
  emit();
  return { ok: true, item, error: '' };
}

export function updateWishItem(id, patch) {
  const item = getWishById(id);
  if (!item) return { ok: false, item: null, error: '愿望条目不存在' };
  const next = { ...item };
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) return { ok: false, item: null, error: '请填写商品名称' };
    next.name = name.slice(0, 60);
  }
  if (patch.priceCents !== undefined) {
    const price = Math.round(Number(patch.priceCents));
    if (!Number.isFinite(price) || price < 0) return { ok: false, item: null, error: '价格无效' };
    next.priceCents = price;
  }
  if (patch.reason !== undefined) next.reason = String(patch.reason).trim().slice(0, 200);
  if (patch.plannedDate !== undefined) next.plannedDate = patch.plannedDate ? toDateKey(patch.plannedDate) : '';
  if (patch.coolingEnabled !== undefined) next.coolingEnabled = !!patch.coolingEnabled;
  if (patch.status !== undefined) {
    if (!['pending', 'hold', 'purchased'].includes(patch.status)) return { ok: false, item: null, error: '状态无效' };
    next.status = patch.status;
    if (patch.status === 'purchased' && !item.purchasedAt) next.purchasedAt = new Date().toISOString();
    if (patch.status !== 'purchased') next.purchasedAt = '';
  }
  next.updatedAt = new Date().toISOString();
  Object.assign(item, next);
  persist();
  emit();
  return { ok: true, item, error: '' };
}

export function deleteWishItem(id) {
  const idx = state.data.wishlist.findIndex((w) => w.id === id);
  if (idx < 0) return { ok: false, error: '愿望条目不存在' };
  state.data.wishlist.splice(idx, 1);
  persist();
  emit();
  return { ok: true, error: '' };
}

/**
 * 标记已购买 —— 只改状态，绝不自动扣款。
 * 是否真的记账由 recordWishPurchase 决定。
 */
export function markWishPurchased(id) {
  const item = getWishById(id);
  if (!item) return { ok: false, item: null, error: '愿望条目不存在' };
  item.status = 'purchased';
  item.purchasedAt = new Date().toISOString();
  item.updatedAt = item.purchasedAt;
  persist();
  emit();
  return { ok: true, item, error: '' };
}

/**
 * 为已购买的愿望记一笔实际消费（真正的扣款入口，只此一处）。
 * 已记过账的条目不会再次扣款。
 * @returns {{ok:boolean, record:object|null, error:string}}
 */
export function recordWishPurchase(id, amountCents, category = 'shopping') {
  const item = getWishById(id);
  if (!item) return { ok: false, record: null, error: '愿望条目不存在' };
  if (item.recordedRecordId && getRecordById(item.recordedRecordId)) {
    return { ok: false, record: null, error: '这条愿望已经记过账，不会重复扣款' };
  }
  const res = addRecord({
    amount: amountCents,
    title: item.name,
    category,
    date: toDateKey(new Date()),
    note: item.reason ? `愿望清单：${item.reason}` : '愿望清单：已购买',
    isNonEssential: true,
  });
  if (!res.ok) return res;
  item.recordedRecordId = res.record.id;
  item.status = 'purchased';
  if (!item.purchasedAt) item.purchasedAt = new Date().toISOString();
  item.updatedAt = new Date().toISOString();
  persist();
  emit();
  return { ok: true, record: res.record, error: '' };
}

/* ---------------- 生活费与设置 ---------------- */

export function getBudgetView() {
  return computeCurrentBudget(state.data);
}

export function getStatsView() {
  return computeStats(state.data);
}

export function getFeePreview(newFeeCents) {
  return previewFeeChange(state.data, newFeeCents);
}

/**
 * 设置当前周期的初始生活费。
 * 只改当前周期：历史各期的设定与消费保持不变，余额按差额同步调整。
 */
export function setMonthlyFee(newFeeCents) {
  const cents = Math.round(Number(newFeeCents));
  if (!Number.isFinite(cents) || cents < 0) return { ok: false, error: '生活费金额无效' };
  const periodKey = currentPeriodKey(normalizeCycleDay(state.data.settings.cycleDay));
  state.data.settings.monthlyFeeCents = cents;
  state.data.settings.months = { ...(state.data.settings.months || {}), [periodKey]: cents };
  state.firedReminders.clear();
  persist();
  emit();
  return { ok: true, error: '', periodKey };
}

export function setCycleDay(day) {
  const cd = normalizeCycleDay(day);
  state.data.settings.cycleDay = cd;
  state.firedReminders.clear();
  persist();
  emit();
  return { ok: true, error: '', cycleDay: cd };
}

export function setCarryOver(on) {
  state.data.settings.carryOver = !!on;
  state.firedReminders.clear();
  persist();
  emit();
  return { ok: true, error: '' };
}

export function setReminderPercent(percent) {
  const n = Math.round(Number(percent));
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: '提醒阈值需在 0–100 之间' };
  state.data.settings.reminderPercent = n;
  state.firedReminders.clear();
  persist();
  emit();
  return { ok: true, error: '' };
}

export function setWishCoolingDefault(on) {
  state.data.settings.wishCoolingDefault = !!on;
  persist();
  emit();
  return { ok: true, error: '' };
}

/* ---------------- 数据管理 ---------------- */

export function exportJsonText() {
  return exportJson(state.data);
}

/**
 * 导入预检：只校验与试算，不改动状态、不写存储。
 * 返回形状与 importJsonText 一致，调用方不必再拆 plan。
 * @returns {{ok:true, counts:object, notes:string[], stats:object, incoming:object} | {ok:false, error:string}}
 */
/**
 * 按导入方式决定最终落地（或预检）的数据与计数。
 * replace 模式必须整份采用文件内容——包括 settings.months 与 wishCoolingDefault 等
 * 零散字段；mergeImport 是为合并设计的，只挑部分 settings 字段，直接复用它做替换
 * 会静默丢掉这些字段（实测踩过）。
 * @param {object} incoming parseImport 得到的数据
 * @param {'merge'|'replace'} mode
 * @returns {{state: object, counts: object}}
 */
function importResultFor(incoming, mode) {
  if (mode === 'replace') {
    return {
      state: { ...incoming, schemaVersion: SCHEMA_VERSION },
      counts: {
        records: incoming.records.length,
        wishlist: incoming.wishlist.length,
        skippedRecords: 0,
        skippedWishlist: 0,
      },
    };
  }
  const merged = mergeImport(state.data, incoming);
  return { state: merged.state, counts: merged.counts };
}

export function previewImport(text, mode = 'merge') {
  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = importResultFor(parsed.state, mode);
  return {
    ok: true,
    error: '',
    counts: result.counts,
    notes: parsed.notes,
    stats: parsed.stats,
    incoming: parsed.state,
  };
}

export function importJsonText(text, mode = 'merge') {
  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const result = importResultFor(parsed.state, mode);
  state.data = { ...result.state, schemaVersion: SCHEMA_VERSION };
  state.firedReminders.clear();
  persist();
  emit();
  return {
    ok: true,
    error: '',
    counts: result.counts,
    notes: parsed.notes,
    stats: parsed.stats,
  };
}

export function clearAllData() {
  state.data = emptyState();
  state.firedReminders.clear();
  try {
    if (state.storageAvailable) window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 删除失败时下面 persist 仍会写入空白数据 */
  }
  persist();
  emit();
  return { ok: true, error: '' };
}

/* ---------------- 示例数据（用户主动点击才会写入） ---------------- */

const DEMO_PLAN = [
  { offset: 0, amount: 1800, title: '食堂午饭', category: 'food', note: '示例数据' },
  { offset: 0, amount: 400, title: '公交充值', category: 'transport', note: '示例数据' },
  { offset: 1, amount: 2600, title: '奶茶', category: 'food', note: '示例数据' },
  { offset: 2, amount: 6800, title: '专业书', category: 'study', note: '示例数据' },
  { offset: 3, amount: 1500, title: '洗衣液', category: 'daily', note: '示例数据' },
  { offset: 4, amount: 3200, title: '电影票', category: 'fun', note: '示例数据', isNonEssential: true },
  { offset: 5, amount: 1200, title: '早餐豆浆', category: 'food', note: '示例数据' },
  { offset: 6, amount: 9900, title: '卫衣', category: 'shopping', note: '示例数据', isNonEssential: true },
  { offset: 9, amount: 2200, title: '地铁出行', category: 'transport', note: '示例数据' },
  { offset: 12, amount: 4500, title: '聚餐 AA', category: 'food', note: '示例数据' },
];

/**
 * 载入一组示例数据，便于立刻看到效果。
 * 只在用户主动点击时调用；正常启动不会产生任何虚构数据。
 */
export function loadDemoData() {
  const days = lastNDays(15);
  const base = emptyState();
  base.settings.monthlyFeeCents = 200000;
  const periodKey = currentPeriodKey(1);
  base.settings.months[periodKey] = 200000;
  base.settings.reminderPercent = 80;

  const nowIso = new Date().toISOString();
  base.records = DEMO_PLAN.map((p, i) => {
    const date = days[days.length - 1 - p.offset] || days[0];
    return {
      id: `demo_r_${i}`,
      amount: p.amount,
      title: p.title,
      category: p.category,
      date,
      note: p.note,
      isNonEssential: !!p.isNonEssential,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  base.wishlist = [
    {
      id: 'demo_w_0',
      name: '降噪耳机',
      priceCents: 89900,
      addedAt: days[days.length - 3],
      reason: '自习室太吵，想专注一点',
      plannedDate: '',
      status: 'pending',
      coolingEnabled: true,
      purchasedAt: '',
      recordedRecordId: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'demo_w_1',
      name: '机械键盘',
      priceCents: 39900,
      addedAt: days[days.length - 8],
      reason: '旧键盘一个键失灵了',
      plannedDate: toDateKey(addDays(today(), 5)),
      status: 'pending',
      coolingEnabled: false,
      purchasedAt: '',
      recordedRecordId: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ].map((w) => ({
    ...w,
    plannedDate: w.plannedDate && /^\d{4}-\d{2}-\d{2}$/.test(w.plannedDate) ? w.plannedDate : '',
  }));

  state.data = base;
  state.firedReminders.clear();
  persist();
  emit();
  pushNotice('已载入示例数据，你可以先看看效果；清空数据即可回到空白状态。');
  return { ok: true };
}
