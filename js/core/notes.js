/**
 * notes.js —— 钱包纸币构成（纯函数，可单测）。
 *
 * 目标：让「余额」重新变成一叠可以数得清的钞票。
 *  - 钱包里始终展示当前余额的「最少张数」拆法（人民币常用面额：
 *    100 / 50 / 20 / 10 / 5 / 1 元，外加 5 角、1 角、1 分以精确表示余额的零头）。
 *  - 花费时的「抽出哪些、找回哪些」由新旧构成之差得出，
 *    例如 1500 元（15 张 100）花掉 20 元 → 抽出 1 张 100，找回 50 + 20 + 10，
 *    新构成 14 张 100 + 50 + 20 + 10；再花 10 元 → 那张 10 元直接抽出。
 *
 * 这里的贪心对人民币面额序列是最优的（每个大面额都是下一档的整数倍，
 * 且 20/50/100 之间 100 = 2×50 = 5×20），所以「最少张数」成立。
 */

/** 面额表（单位：分），从大到小。 */
export const NOTE_DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 1];

/** 面额标签（用于展示在钞票上）。 */
export function noteLabel(denomCents) {
  const d = Math.round(Number(denomCents) || 0);
  if (d >= 100) return String(Math.round(d / 100));
  if (d === 50) return '5角';
  if (d === 10) return '1角';
  if (d === 1) return '1分';
  return String(d);
}

/**
 * 带单位的面额标签：元面额带 ¥ 前缀，角/分面额直接写「5角」「1分」。
 * 这样「¥1」（1 元）和「1分」（0.01 元）不会在界面上看起来一样。
 * @param {number} denomCents 面额（分）
 * @returns {string}
 */
export function denomLabel(denomCents) {
  const d = Math.round(Number(denomCents) || 0);
  const label = noteLabel(d);
  return d >= 100 ? `¥${label}` : label;
}

/**
 * 把金额（分）拆成最少张数的纸币。
 * @param {number} cents 金额（分）；<= 0 或非法时返回空数组
 * @returns {Array<{denom:number, count:number, cents:number}>} 从大到小
 */
export function composeNotes(cents) {
  let rest = Math.round(Number(cents) || 0);
  if (!Number.isFinite(rest) || rest <= 0) return [];
  // 展示上限 100 万元（= 1_000_000_00 分）：再多就不一张张画了
  rest = Math.min(rest, 100_000_000);
  const out = [];
  for (const d of NOTE_DENOMS) {
    if (rest < d) continue;
    const count = Math.floor(rest / d);
    rest -= count * d;
    out.push({ denom: d, count, cents: count * d });
  }
  return out;
}

/** 合计张数。 */
export function noteCount(composition) {
  return (composition || []).reduce((sum, g) => sum + g.count, 0);
}

/** 合计金额（分），用于自检。 */
export function noteTotal(composition) {
  return (composition || []).reduce((sum, g) => sum + g.cents, 0);
}

/**
 * 把金额拆成一串可以逐张飞入钱包的纸币（按面额从大到小重复展开）。
 * @param {number} cents 金额（分）
 * @param {number} [maxNotes] 最多展开多少张，超出部分折叠成「×N」
 * @returns {{notes:Array<{denom:number}>, folded:Array<{denom:number, count:number}>}}
 */
export function expandNotes(cents, maxNotes = 12) {
  const groups = composeNotes(cents);
  const notes = [];
  const folded = [];
  let used = 0;
  const cap = Math.max(1, Math.round(Number(maxNotes) || 12));
  for (const g of groups) {
    const take = Math.min(g.count, Math.max(0, cap - used));
    for (let i = 0; i < take; i += 1) notes.push({ denom: g.denom });
    used += take;
    if (take < g.count) folded.push({ denom: g.denom, count: g.count - take });
  }
  return { notes, folded };
}

/**
 * 从旧余额到新余额，钱包里的纸币要怎么变：抽出哪些、放回哪些。
 * 抽出减去找回恒等于余额的变化量（消费为正、存入为负）。
 * @param {number} beforeCents 变化前的余额（分）
 * @param {number} afterCents 变化后的余额（分）
 * @returns {{out:Array<{denom:number,count:number}>, in:Array<{denom:number,count:number}>,
 *              outTotal:number, inTotal:number, net:number}}
 */
export function changeFor(beforeCents, afterCents) {
  const before = composeNotes(beforeCents);
  const after = composeNotes(afterCents);
  const beforeMap = new Map(before.map((g) => [g.denom, g.count]));
  const afterMap = new Map(after.map((g) => [g.denom, g.count]));
  const out = [];
  const inNotes = [];
  for (const d of NOTE_DENOMS) {
    const from = beforeMap.get(d) || 0;
    const to = afterMap.get(d) || 0;
    if (from > to) out.push({ denom: d, count: from - to });
    else if (to > from) inNotes.push({ denom: d, count: to - from });
  }
  const outTotal = out.reduce((s, g) => s + g.denom * g.count, 0);
  const inTotal = inNotes.reduce((s, g) => s + g.denom * g.count, 0);
  return { out, in: inNotes, outTotal, inTotal, net: inTotal - outTotal };
}

/**
 * 找零说明文字，例如「抽出 ¥100 ×1，找回 ¥50 + ¥20 + ¥10」。
 * @param {number} beforeCents
 * @param {number} afterCents
 * @returns {string} 空串表示构成没有变化（只是少了同样的钞票）
 */
export function describeChange(beforeCents, afterCents) {
  const { out, in: inNotes } = changeFor(beforeCents, afterCents);
  const outParts = out.map((g) => `${denomLabel(g.denom)}${g.count > 1 ? ` ×${g.count}` : ''}`);
  const inParts = inNotes.map((g) => `${denomLabel(g.denom)}${g.count > 1 ? ` ×${g.count}` : ''}`);
  if (!outParts.length && !inParts.length) return '';
  const pieces = [];
  if (outParts.length) pieces.push(`抽出 ${outParts.join(' + ')}`);
  if (inParts.length) pieces.push(`找回 ${inParts.join(' + ')}`);
  return pieces.join('，');
}

/**
 * 钱包里纸币的构成说明，例如「¥100 ×14 · ¥50 ×1 · ¥20 ×1 · ¥10 ×1」。
 * @param {number} cents 余额（分）
 * @returns {string}
 */
export function describeComposition(cents) {
  const groups = composeNotes(cents);
  if (!groups.length) return '';
  return groups.map((g) => `${denomLabel(g.denom)} ×${g.count}`).join(' · ');
}

/**
 * 存入一笔钱时，这叠钱本身长什么样（用于「存入动画」逐张飞入）。
 * @param {number} cents 存入金额（分）
 * @returns {Array<{denom:number, count:number, cents:number}>}
 */
export function depositComposition(cents) {
  return composeNotes(cents);
}


/**
 * 这笔钱本身由哪些钞票组成（花了多少就抽出多少）。
 *
 * 第六轮改的就是这件事：动画不再去看「钱包新旧构成差了多少」，而是直接按这笔
 * 金额自己的最少张数拆法来演 —— 花 124 元就是抽出 ¥100 + ¥20 + ¥1 + ¥1 + ¥1 + 1分 ×4，
 * 钱包里原本躺着的是哪些面额、找回哪些零钱，都不影响要抽出哪几张。
 *
 * @param {number} cents 这笔金额（分）
 * @returns {Array<{denom:number, count:number, cents:number}>} 从大到小
 */
export function spendBills(cents) {
  return composeNotes(cents);
}
