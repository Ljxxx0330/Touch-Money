/**
 * budget.js —— 预算与余额计算（纯函数，可单测）。
 *
 * 四个概念必须严格区分：
 *  - monthlyFeeCents  本月初始生活费（该周期设定的生活费）
 *  - balanceCents     当前可支配余额 = 各期初始生活费之和 − 全部历史消费
 *  - monthSpentCents  本周期累计消费（只统计本周期，不含历史）
 *  - remainingCents   本周期剩余预算 = 本月初始生活费 − 本周期累计消费
 *
 * 余额链（carryOver=true）：从最早有记录的周期一路滚到当前周期，
 * 每期结余 = 该期初始生活费 − 该期消费，结余滚入下一期。
 * carryOver=false 时不结转，余额只由当前周期决定。
 * 因此编辑/删除历史某笔消费，余额与统计都会同步、正确地变化。
 */

import {
  currentPeriodKey,
  fromDateKey,
  lastNDays,
  normalizeCycleDay,
  periodKeyOf,
  periodRange,
  periodStartFor,
  toDateKey,
  today,
  weekKeys,
} from './dates.js';

export const CATEGORIES = [
  { id: 'food', label: '餐饮' },
  { id: 'transport', label: '交通' },
  { id: 'study', label: '学习' },
  { id: 'shopping', label: '购物' },
  { id: 'fun', label: '娱乐' },
  { id: 'daily', label: '日用品' },
  { id: 'other', label: '其他' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function categoryLabel(id) {
  const hit = CATEGORIES.find((c) => c.id === id);
  return hit ? hit.label : '其他';
}

/** 默认设置：生活费未设置（0 分），自然月周期，结转，无提醒阈值。 */
export function defaultSettings() {
  return {
    monthlyFeeCents: 0,
    cycleDay: 1,
    carryOver: true,
    reminderPercent: 0,
    wishCoolingDefault: false,
    months: {},
  };
}

export function isConfigured(settings) {
  return !!(settings && Number.isInteger(settings.monthlyFeeCents) && settings.monthlyFeeCents > 0);
}

/** 最早需要纳入余额链的周期：months 与 records 中最早的周期，都没有则为当前周期。 */
export function earliestPeriodKey(settings, records) {
  const cycleDay = normalizeCycleDay(settings && settings.cycleDay);
  const keys = [];
  const months = (settings && settings.months) || {};
  for (const k of Object.keys(months)) {
    if (/^\d{4}-\d{2}$/.test(k)) keys.push(k);
  }
  for (const r of records || []) {
    const k = periodKeyOf(r.date, cycleDay);
    if (k) keys.push(k);
  }
  const cur = currentPeriodKey(cycleDay);
  keys.push(cur);
  keys.sort();
  return keys[0] || cur;
}

/** 某周期的初始生活费：该期设定值 > 全局 monthlyFeeCents > 0。 */
export function feeForPeriod(settings, periodKey) {
  const months = (settings && settings.months) || {};
  const own = months[periodKey];
  if (Number.isInteger(own) && own >= 0) return own;
  const global = settings && Number(settings.monthlyFeeCents);
  if (Number.isFinite(global) && global > 0) return Math.round(global);
  return 0;
}

/**
 * 计算某个周期的预算视图。
 * @param {{settings:object, records:Array}} state
 * @param {string} [pk] 目标周期 key，默认当前周期
 */
export function computeBudget(state, pk) {
  const settings = state.settings || defaultSettings();
  const records = Array.isArray(state.records) ? state.records : [];
  const cycleDay = normalizeCycleDay(settings.cycleDay);
  const carryOver = settings.carryOver !== false;
  const current = currentPeriodKey(cycleDay);
  const periodKey = pk || current;

  const spentByPeriod = new Map();
  for (const r of records) {
    const k = periodKeyOf(r.date, cycleDay);
    if (!k) continue;
    spentByPeriod.set(k, (spentByPeriod.get(k) || 0) + (Math.round(r.amount) || 0));
  }

  const start = carryOver ? earliestPeriodKey(settings, records) : periodKey;
  const chain = periodRange(start, periodKey);

  let carryInCents = 0;
  for (const k of chain) {
    if (k === periodKey) break;
    carryInCents += feeForPeriod(settings, k) - (spentByPeriod.get(k) || 0);
  }

  const monthlyFeeCents = feeForPeriod(settings, periodKey);
  const monthSpentCents = spentByPeriod.get(periodKey) || 0;
  const remainingCents = monthlyFeeCents - monthSpentCents;
  const balanceCents = carryOver
    ? monthlyFeeCents + carryInCents - monthSpentCents
    : remainingCents;

  return {
    periodKey,
    periodStart: periodStartFor(new Date(periodKey + '-01T00:00:00'), cycleDay),
    cycleDay,
    carryOver,
    isCurrent: periodKey === current,
    monthlyFeeCents,
    monthSpentCents,
    remainingCents,
    balanceCents,
    carryInCents: carryOver ? carryInCents : 0,
    usedRatio: monthlyFeeCents > 0 ? monthSpentCents / monthlyFeeCents : 0,
    spentByPeriod,
  };
}

/** 当前周期视图（最常用）。 */
export function computeCurrentBudget(state) {
  return computeBudget(state);
}

/**
 * 修改当前周期初始生活费后的余额预览（不写状态）。
 * 只改当前周期的设定值，历史各期保持不变。
 * @returns {{before:number, after:number, delta:number, viewAfter:object}}
 */
export function previewFeeChange(state, newFeeCents) {
  const before = computeCurrentBudget(state);
  const next = {
    ...state,
    settings: {
      ...state.settings,
      monthlyFeeCents: newFeeCents,
      months: { ...(state.settings.months || {}), [before.periodKey]: newFeeCents },
    },
  };
  const after = computeCurrentBudget(next);
  return {
    before: before.balanceCents,
    after: after.balanceCents,
    delta: after.balanceCents - before.balanceCents,
    viewAfter: after,
  };
}

/** 消费占比：本笔金额 / 本月初始生活费。 */
export function shareOfFee(amountCents, feeCents) {
  if (!feeCents || feeCents <= 0) return 0;
  return amountCents / feeCents;
}

/**
 * 统计视图：今日 / 本周 / 本月消费、分类占比、最近 7 天趋势、预算使用。
 * 全部来自真实记录，无数据时返回空结构（UI 负责空状态）。
 * @param {{settings:object, records:Array}} state
 * @param {{todayKey?:string, weekKeys?:string[]}} [opts] 便于单测注入日期
 */
export function computeStats(state, opts = {}) {
  const settings = state.settings || defaultSettings();
  const records = Array.isArray(state.records) ? state.records : [];
  const cycleDay = normalizeCycleDay(settings.cycleDay);
  const now = opts.todayKey ? fromDateKey(opts.todayKey) : today();
  const tKey = opts.todayKey || toDateKey(now);
  const wKeys = opts.weekKeys || weekKeys(now);
  const curPeriod = currentPeriodKey(cycleDay);

  const trendKeys = lastNDays(7, now);
  const trendMap = new Map(trendKeys.map((k) => [k, 0]));
  const byCategory = new Map(CATEGORIES.map((c) => [c.id, 0]));
  let todayTotalCents = 0;
  let weekTotalCents = 0;
  let monthTotalCents = 0;
  let nonEssentialCents = 0;

  for (const r of records) {
    const amount = Math.round(r.amount) || 0;
    const period = periodKeyOf(r.date, cycleDay);
    if (r.date === tKey) todayTotalCents += amount;
    if (wKeys.includes(r.date)) weekTotalCents += amount;
    if (period === curPeriod) {
      monthTotalCents += amount;
      byCategory.set(r.category, (byCategory.get(r.category) || 0) + amount);
      if (r.isNonEssential) nonEssentialCents += amount;
    }
    if (trendMap.has(r.date)) trendMap.set(r.date, trendMap.get(r.date) + amount);
  }

  const categories = CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    cents: byCategory.get(c.id) || 0,
  }))
    .filter((c) => c.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  const budget = computeBudget(state, curPeriod);

  return {
    todayKey: tKey,
    todayTotalCents,
    weekTotalCents,
    monthTotalCents,
    nonEssentialCents,
    categories,
    trend: trendKeys.map((k) => ({ date: k, cents: trendMap.get(k) || 0 })),
    trendMaxCents: Math.max(...trendKeys.map((k) => trendMap.get(k) || 0)),
    budget,
    hasAnyRecord: records.length > 0,
    hasMonthData: monthTotalCents > 0,
  };
}
