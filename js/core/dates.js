/**
 * dates.js —— 全部使用「本地日期」，绝不混用 UTC，避免跨日/跨月偏差。
 * 日期一律表示为本地日期字符串 YYYY-MM-DD（periodKey 为 YYYY-MM）。
 */

export const MS_PER_DAY = 86400000;

/** 本地 Date → YYYY-MM-DD。 */
export function toDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → 本地零点 Date（new Date(y, m-1, d)）。 */
export function fromDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // 回环校验：new Date(2025,1,29) 会变成 3-05，这里判定为非法
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** YYYY-MM → 当月天数。 */
export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** 本地今天。 */
export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function todayKey() {
  return toDateKey(today());
}

/** 加天数（按天为单位，保留时分秒）。 */
export function addDays(date, n) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** 加月份，日期做月末钳制（2026-01-31 +1 月 → 2026-02-28）。 */
export function addMonths(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const targetMonth = d.getMonth() + n;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  const max = daysInMonth(d.getFullYear(), d.getMonth());
  d.setDate(Math.min(day, max));
  return d;
}

/** 周期锚点（cycleDay）合法范围 1..28，保证每月都存在该日。 */
export function normalizeCycleDay(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 28) return 1;
  return n;
}

/** 某个日期所属周期的起始日（本地）。 */
export function periodStartFor(date, cycleDay) {
  const cd = normalizeCycleDay(cycleDay);
  const d = date instanceof Date ? date : fromDateKey(date);
  if (!d) return null;
  const cur = new Date(d.getFullYear(), d.getMonth(), Math.min(d.getDate(), daysInMonth(d.getFullYear(), d.getMonth())));
  const anchor = new Date(cur.getFullYear(), cur.getMonth(), cd);
  if (cur < anchor) return new Date(cur.getFullYear(), cur.getMonth() - 1, cd);
  return anchor;
}

/** 周期的下一期起始日。 */
export function nextPeriodStart(start) {
  return addMonths(start, 1);
}

/** YYYY-MM 的下一期 key。 */
export function nextPeriodKey(key) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const n = addMonths(d, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM 的上一期 key。 */
export function prevPeriodKey(key) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const n = addMonths(d, -1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

/** 日期所属周期 key（YYYY-MM，以周期起始日的年月为准）。 */
export function periodKeyOf(date, cycleDay) {
  const start = periodStartFor(date, cycleDay);
  if (!start) return null;
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
}

/** 当前周期 key。 */
export function currentPeriodKey(cycleDay, now = today()) {
  return periodKeyOf(now, cycleDay);
}

/** 从 fromKey（含）开始，逐期推进到 toKey（含）。 */
export function periodRange(fromKey, toKey) {
  const keys = [];
  if (!fromKey || !toKey) return keys;
  let cur = String(fromKey);
  let guard = 0;
  while (guard < 600) {
    keys.push(cur);
    if (cur >= toKey) break;
    cur = nextPeriodKey(cur);
    guard++;
  }
  return keys;
}

/** 最近 n 天的日期 key 列表（含今天，按时间正序）。 */
export function lastNDays(n, now = today()) {
  const keys = [];
  for (let i = n - 1; i >= 0; i--) keys.push(toDateKey(addDays(now, -i)));
  return keys;
}

/** 本周（本地周一为一周起点）的日期 key 列表。 */
export function weekKeys(now = today()) {
  const offset = (now.getDay() + 6) % 7; // 周一 = 0
  const monday = addDays(now, -offset);
  const keys = [];
  for (let i = 0; i < 7; i++) keys.push(toDateKey(addDays(monday, i)));
  return keys;
}

/** 用于展示的自然语言日期：今天 / 昨天 / 10-15 / 2026-09-15。 */
export function humanDate(key, now = today()) {
  const d = fromDateKey(key);
  if (!d) return String(key || '');
  const diff = Math.round((now.getTime() - d.getTime()) / MS_PER_DAY);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (d.getFullYear() === now.getFullYear()) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return toDateKey(d);
}

/** 周期标题，例如 cycleDay=1 → 「2026年10月」，否则「10月15日 起」。 */
export function humanPeriod(start, cycleDay) {
  const label = `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`;
  if (normalizeCycleDay(cycleDay) === 1) return label;
  return `${label} · ${start.getMonth() + 1}月${start.getDate()}日起`;
}

/** 本地时区说明文本（用于「关于」与统计脚注）。 */
export function timeZoneLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
  } catch {
    return '本地时区';
  }
}

/** 当前时间文本（用于导出文件命名）。 */
export function stampForFilename(now = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
