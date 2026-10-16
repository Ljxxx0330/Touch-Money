/**
 * storage.js —— LocalStorage 读写 + 结构/类型校验。
 * 任何读取失败、JSON 损坏、字段缺失都安全处理：页面不崩溃，坏数据被丢弃并提示。
 */

import { fromDateKey, toDateKey, normalizeCycleDay } from './dates.js';
import { CATEGORY_IDS, defaultSettings } from './budget.js';

export const APP_NAME = 'TouchMoney';
export const APP_LABEL = '触钱';
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'touchmoney.v1';
const BACKUP_PREFIX = 'touchmoney.corrupt-backup.';

let idCounter = 0;
/** 生成记录 id（时间戳 + 递增计数 + 随机尾巴，避免同一毫秒冲突）。 */
export function makeId(prefix = 'r') {
  idCounter = (idCounter + 1) % 100000;
  const rand = Math.floor(Math.random() * 46656).toString(36);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${rand}`;
}

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    settings: defaultSettings(),
    records: [],
    wishlist: [],
  };
}

/** LocalStorage 是否真的可用（隐私模式 / 禁用存储时会抛错）。 */
export function isStorageAvailable() {
  try {
    const probe = '__touchmoney_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
};
const asInt = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : null;
};
const asBool = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);

/** 校验并清洗单条消费记录；返回 null 表示整条丢弃。 */
function sanitizeRecord(raw, notes, stats, usedIds) {
  stats.foundRecords++;
  if (!raw || typeof raw !== 'object') {
    stats.droppedRecords++;
    notes.push('丢弃了一条不是对象的消费记录');
    return null;
  }
  const amount = asInt(raw.amount);
  if (amount === null || amount <= 0) {
    stats.droppedRecords++;
    notes.push('丢弃了金额无效的消费记录');
    return null;
  }
  const date = fromDateKey(raw.date);
  if (!date) {
    stats.droppedRecords++;
    notes.push('丢弃了日期无效的消费记录');
    return null;
  }
  const category = CATEGORY_IDS.includes(raw.category) ? raw.category : 'other';
  if (category !== raw.category) notes.push('把一条无法识别分类的记录归入「其他」');

  let title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 60) : '';
  if (!title) {
    title = '未命名消费';
    notes.push('给一条缺少名称的消费记录补了默认名称');
  }

  let id = typeof raw.id === 'string' && raw.id ? raw.id : makeId('r');
  if (usedIds.has(id)) {
    id = makeId('r');
    notes.push('发现重复的记录 id，已重新生成');
  }
  usedIds.add(id);

  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '';
  const nowIso = new Date().toISOString();
  return {
    id,
    amount,
    title,
    category,
    date: toDateKey(date),
    note,
    isNonEssential: asBool(raw.isNonEssential),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso,
  };
}

const WISH_STATUSES = ['pending', 'hold', 'purchased'];

/** 校验并清洗单条愿望清单条目。 */
function sanitizeWishItem(raw, notes, stats, usedIds) {
  stats.foundWishlist++;
  if (!raw || typeof raw !== 'object') {
    stats.droppedWishlist++;
    return null;
  }
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
  if (!name) {
    stats.droppedWishlist++;
    notes.push('丢弃了一条没有名称的愿望条目');
    return null;
  }
  const price = asInt(raw.priceCents);
  if (price === null || price < 0) {
    stats.droppedWishlist++;
    notes.push('丢弃了一条价格无效的愿望条目');
    return null;
  }
  let id = typeof raw.id === 'string' && raw.id ? raw.id : makeId('w');
  if (usedIds.has(id)) {
    id = makeId('w');
    notes.push('发现重复的愿望 id，已重新生成');
  }
  usedIds.add(id);
  const addedAt = fromDateKey(raw.addedAt);
  const nowIso = new Date().toISOString();
  const planned = fromDateKey(raw.plannedDate);
  const status = WISH_STATUSES.includes(raw.status) ? raw.status : 'pending';
  return {
    id,
    name,
    priceCents: price,
    addedAt: addedAt ? toDateKey(addedAt) : toDateKey(new Date()),
    reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 200) : '',
    plannedDate: planned ? toDateKey(planned) : '',
    status,
    coolingEnabled: asBool(raw.coolingEnabled),
    purchasedAt: typeof raw.purchasedAt === 'string' ? raw.purchasedAt : '',
    recordedRecordId:
      typeof raw.recordedRecordId === 'string' && raw.recordedRecordId ? raw.recordedRecordId : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso,
  };
}

/** 校验并清洗设置。 */
function sanitizeSettings(raw, notes) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    notes.push('设置缺失，已使用默认设置');
    return base;
  }
  const fee = asInt(raw.monthlyFeeCents);
  if (fee === null || fee < 0) notes.push('生活费金额无效，已归零');

  const months = {};
  const rawMonths = raw.months && typeof raw.months === 'object' ? raw.months : {};
  for (const [k, v] of Object.entries(rawMonths)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    if (!fromDateKey(k + '-01')) continue; // 月份本身要存在（'2026-13' 这类无效）
    const cents = asInt(v);
    if (cents === null || cents < 0) continue;
    months[k] = cents;
  }

  return {
    monthlyFeeCents: fee === null || fee < 0 ? 0 : fee,
    cycleDay: normalizeCycleDay(raw.cycleDay),
    carryOver: asBool(raw.carryOver, true),
    reminderPercent: clampInt(raw.reminderPercent, 0, 100, 0),
    wishCoolingDefault: asBool(raw.wishCoolingDefault),
    months,
  };
}

/**
 * 清洗任意来源的状态对象（LocalStorage / 导入文件）。
 * @returns {{state:object, notes:string[], stats:object}}
 */
export function sanitizeState(input) {
  const stats = {
    foundRecords: 0,
    droppedRecords: 0,
    foundWishlist: 0,
    droppedWishlist: 0,
    invalidJson: false,
  };
  const notes = [];
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!raw) {
    notes.push('数据结构不正确，已重置为空白数据');
    return { state: emptyState(), notes, stats };
  }

  const usedRecordIds = new Set();
  const usedWishIds = new Set();
  const records = [];
  for (const item of Array.isArray(raw.records) ? raw.records : []) {
    const rec = sanitizeRecord(item, notes, stats, usedRecordIds);
    if (rec) records.push(rec);
  }
  if (!Array.isArray(raw.records) && raw.records !== undefined) {
    notes.push('消费记录列表格式不正确，已忽略');
  }

  const wishlist = [];
  for (const item of Array.isArray(raw.wishlist) ? raw.wishlist : []) {
    const w = sanitizeWishItem(item, notes, stats, usedWishIds);
    if (w) wishlist.push(w);
  }
  if (!Array.isArray(raw.wishlist) && raw.wishlist !== undefined) {
    notes.push('愿望清单列表格式不正确，已忽略');
  }

  const state = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    settings: sanitizeSettings(raw.settings, notes),
    records,
    wishlist,
  };
  return { state, notes, stats };
}

/**
 * 读取状态。永不抛错。
 * @returns {{state:object, storageAvailable:boolean, notes:string[], corrupt:boolean, backupKey:string}}
 */
export function loadState() {
  if (!isStorageAvailable()) {
    return {
      state: emptyState(),
      storageAvailable: false,
      notes: ['浏览器本地存储不可用（可能是隐私模式），本次改动只保存在内存中。'],
      corrupt: false,
      backupKey: '',
    };
  }

  let text = null;
  try {
    text = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return {
      state: emptyState(),
      storageAvailable: true,
      notes: ['读取本地存储失败：' + (err && err.message ? err.message : String(err))],
      corrupt: false,
      backupKey: '',
    };
  }

  if (text === null || text === undefined || text === '') {
    return { state: emptyState(), storageAvailable: true, notes: [], corrupt: false, backupKey: '' };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const backupKey = BACKUP_PREFIX + Date.now();
    try {
      window.localStorage.setItem(backupKey, text);
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 备份失败也不阻塞页面 */
    }
    return {
      state: emptyState(),
      storageAvailable: true,
      notes: [
        '本地数据无法解析（JSON 损坏），已按空白数据启动，原始内容备份到 ' + backupKey + '。',
      ],
      corrupt: true,
      backupKey,
    };
  }

  const { state, notes, stats } = sanitizeState(parsed);
  stats.invalidJson = false;
  return {
    state,
    storageAvailable: true,
    notes: notes.filter(Boolean),
    corrupt: false,
    backupKey: '',
  };
}

/**
 * 保存状态。
 * @returns {{ok:boolean, error:string}}
 */
export function saveState(state) {
  if (!isStorageAvailable()) {
    return { ok: false, error: '本地存储不可用，数据未持久化' };
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true, error: '' };
  } catch (err) {
    const name = err && err.name ? err.name : '';
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return { ok: false, error: '本地存储空间已满，数据未能保存' };
    }
    return { ok: false, error: '保存失败：' + (err && err.message ? err.message : String(err)) };
  }
}

/** 导出为 JSON 文本（带信封，便于以后扩展）。 */
export function exportJson(state) {
  const envelope = {
    app: APP_NAME,
    appLabel: APP_LABEL,
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    data: state,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * 校验导入文本：支持本项目的导出信封，也支持裸的数据对象。
 * @returns {{ok:true, state:object, notes:string[], stats:object} | {ok:false, error:string}}
 */
export function parseImport(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: '文件内容为空' };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: '不是合法的 JSON 文件：' + (err && err.message ? err.message : String(err)) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON 顶层必须是对象' };
  }

  let payload = parsed;
  if (parsed.app !== undefined || parsed.data !== undefined) {
    if (parsed.app && parsed.app !== APP_NAME) {
      return { ok: false, error: `这是「${parsed.app}」的数据文件，不是 TouchMoney 的导出文件` };
    }
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return { ok: false, error: '导出文件缺少 data 数据块' };
    }
    payload = parsed.data;
  }

  if (payload.settings === undefined && payload.records === undefined && payload.wishlist === undefined) {
    return { ok: false, error: '文件里没有找到 settings / records / wishlist 任何一项，无法识别为 TouchMoney 数据' };
  }

  const { state, notes, stats } = sanitizeState(payload);
  return { ok: true, state, notes, stats };
}

/**
 * 合并导入数据到当前状态（追加，不覆盖现有记录）。
 * id 冲突的记录直接跳过；设置保留当前状态（除非当前未设置生活费且导入有设置）。
 */
export function mergeImport(current, incoming) {
  const existingIds = new Set(current.records.map((r) => r.id));
  const existingWishIds = new Set(current.wishlist.map((w) => w.id));
  const added = { records: 0, wishlist: 0, skippedRecords: 0, skippedWishlist: 0 };

  const records = current.records.slice();
  for (const r of incoming.records) {
    if (existingIds.has(r.id)) {
      added.skippedRecords++;
      continue;
    }
    existingIds.add(r.id);
    records.push(r);
    added.records++;
  }

  const wishlist = current.wishlist.slice();
  for (const w of incoming.wishlist) {
    if (existingWishIds.has(w.id)) {
      added.skippedWishlist++;
      continue;
    }
    existingWishIds.add(w.id);
    wishlist.push(w);
    added.wishlist++;
  }

  const settings = { ...current.settings };
  if (!isConfiguredValue(settings.monthlyFeeCents) && incoming.settings.monthlyFeeCents > 0) {
    settings.monthlyFeeCents = incoming.settings.monthlyFeeCents;
    settings.cycleDay = incoming.settings.cycleDay;
    settings.carryOver = incoming.settings.carryOver;
    settings.reminderPercent = incoming.settings.reminderPercent;
  }

  return {
    state: { ...current, schemaVersion: SCHEMA_VERSION, settings, records, wishlist },
    counts: added,
  };
}

const isConfiguredValue = (v) => Number.isInteger(v) && v > 0;
