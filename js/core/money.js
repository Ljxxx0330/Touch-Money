/**
 * money.js —— 金额工具。
 * 所有金额一律以「整数分」存储与计算，只在展示时转成元，避免浮点误差。
 */

export const CENTS_PER_YUAN = 100;

/** 元（数字/字符串）→ 分（整数），四舍五入到分。 */
export function yuanToCents(yuan) {
  const n = Number(yuan);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * CENTS_PER_YUAN);
}

/** 分 → 元（数字，仅用于计算，不直接展示）。 */
export function centsToYuan(cents) {
  if (!Number.isFinite(cents)) return NaN;
  return cents / CENTS_PER_YUAN;
}

/** 单笔金额上限（分）：100 万元。超出多半是输入错误。 */
export const MAX_AMOUNT_CENTS = 1_000_000 * CENTS_PER_YUAN;

/**
 * 解析用户输入的金额文本 → 分。
 * 支持：'18'、'18.5'、'18.00'、'¥1,234.56'、' 26.8 '。
 * 千分位逗号必须每三位一组，小数最多两位；非法输入返回 { ok:false, error }。
 */
export function parseAmountToCents(input) {
  if (input === null || input === undefined) {
    return { ok: false, error: '请输入金额' };
  }
  const stripped = String(input).replace(/[¥￥\s]/g, '');
  if (!stripped) {
    return { ok: false, error: '请输入金额' };
  }
  // 逗号只允许作为千分位分隔符：'1,234.56' 合法，'12,34.5' 不合法
  if (!/^\d+(,\d{3})*(?:\.\d{1,2})?$/.test(stripped)) {
    return { ok: false, error: '金额格式不正确：逗号只能用于千分位，小数最多两位' };
  }
  const cleaned = stripped.replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: '金额格式不正确，小数最多两位' };
  }
  const cents = Math.round(Number(cleaned) * CENTS_PER_YUAN);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, error: '金额必须大于 0' };
  }
  if (cents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: '金额过大，单笔上限 1000000 元' };
  }
  return { ok: true, cents };
}

/** 整数 → 千分位字符串。 */
function groupDigits(intText) {
  return String(intText).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 分 → '1,234.56'（不含货币符号，负号在最前）。 */
export function formatAmount(cents) {
  const value = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const yuan = Math.floor(abs / CENTS_PER_YUAN);
  const frac = String(abs % CENTS_PER_YUAN).padStart(2, '0');
  return `${sign}${groupDigits(yuan)}.${frac}`;
}

/** 分 → '¥1,234.56'。 */
export function formatCents(cents) {
  return `¥${formatAmount(cents)}`;
}

/** 分 → '1,234'（四舍五入到元，用于图表与紧凑场景）。 */
export function formatCentsWhole(cents) {
  const value = Number.isFinite(cents) ? cents : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const rounded = Math.round(abs / CENTS_PER_YUAN);
  return `${sign}${groupDigits(rounded)}`;
}

/** part / whole，whole<=0 时安全返回 0。 */
export function ratio(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return part / whole;
}

/** part / whole → 百分数（0..100，可能超过 100）。 */
export function toPercent(part, whole) {
  return ratio(part, whole) * 100;
}

/** 把比例限制到 0..1，用于进度条宽度。 */
/**
 * 百分比显示文本：最多两位小数，去掉无意义的尾随 0。
 * 例如 19.314999999999998 -> "19.31"，25 -> "25"，33.91146777116231 -> "33.91"。
 * @param {number|string} value 已经是百分数的数值
 * @returns {string}
 */
export function percentText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(parseFloat(n.toFixed(2)));
}

export function clampRatio(part, whole) {
  return Math.max(0, Math.min(1, ratio(part, whole)));
}
