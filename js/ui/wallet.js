/**
 * wallet.js —— 首页主视觉：一只装着人民币纸币的钱包（动画由内置的 GSAP 驱动）。
 *
 * 钱包里永远装着「当前余额的最少张数构成」（core/notes.js 负责算）。
 * 第六轮改了动画的口径：一笔要花掉多少钱，就按这笔钱自己的最少张数拆法去抽 ——
 * 花 124 元就是抽出 ¥100 + ¥20 + ¥1 + ¥1 + ¥1 + 1分 ×4，向上展开的也正是这几张。
 * 钱包里原本躺着哪些面额、找回哪些零钱，都不再影响要抽出哪几张（你要求的「简单一点」）。
 *
 * 动画全部走 GSAP 时间轴（js/vendor/gsap.min.js，UMD 构建挂在 window.gsap，
 * 由 js/vendor/gsap-boot.js 交给模块系统）：悬停展开是一条可反转的时间轴，抽出与飞入
 * 是一条带 stagger 的时间轴，余额数字滚动是一条带 snap 的时间轴。
 * 内置 GSAP 没加载成功（window.gsap 不存在）时，每条时间轴都退化成「直接跳到终态」，
 * 数据与布局不受影响。
 *
 * 视觉约定（与 css/styles.css 对应）：
 *   .wallet > .wallet-shadow / .wallet-back / .wallet-stack / .wallet-flight / .wallet-front
 *   钞票按面额分组：.wallet-stack > .note-group > .note.note-d{面额分}
 *   硬币不分面额分组：.wallet-stack > .coin.coin-d{面额分}，一枚压一枚往上排
 *   收起时同面额那一沓底边对齐、彼此只往右挪一点点（--gs）；面额之间等距往右排开
 *   （每组一个 --gx），所以收起时看到的是「底边齐平、从左到右一排面额」，每组都露出
 *   面额数字那半截（数字写在钞票右边缘，正好留在外面）。
 *   收起时整层钞票往下压 DECK_LIFT（GSAP 写在堆的 transform 上），大半藏在前盖后面；
 *   悬停时这一层抬回原位 = 向上展开。没指定交易的钱包（钱包页那种）整层整组展开；
 *   指定了交易的钱包（确认框）只把参与这笔的那几张抬起来，其余一张都不动。
 *   硬币那一列左对齐贴在钱包左缘外侧（一半在盒外），悬停时同样往上摊开。
 *   飞行层 .wallet-flight 是堆的兄弟节点、不吃堆的位移，所以飞入落点与抽出起点
 *   都要自己把 DECK_LIFT 算进 y。
 */

import { formatAmount, centsToYuan } from '../core/money.js';
import { composeNotes, noteCount, describeComposition, depositComposition, denomLabel, spendBills } from '../core/notes.js';
import { gsap, hasGsap, prefersReducedMotion } from '../vendor/gsap-boot.js';

/** 每种面额最多画几张（多余的用「+N 张」表示，避免钞票糊成一团） */
const MAX_FAN = 6;
/** 钞票合计最多画几张：再多就糊成一团（每种面额另有 MAX_FAN 上限，保证每种面额都露脸） */
const MAX_DRAWN = 12;
/** 每种面额的硬币最多画几枚 */
const MAX_COINS = 4;
/** 硬币合计最多画几枚：再多间距就被压到读不清面额标签（没画的由「+N 张」与 sr-only 的构成行说明） */
const MAX_COIN_TOTAL = 4;

/** 单次动画最多逐张飞入/抽出的张数（多余的合并成一次示意） */
const MAX_FLY = 10;
/** 逐张动画的间隔（秒，GSAP 的 stagger 用秒） */
const STAGGER_S = 0.048;

/* 槽位与步长都是「钱包盒内百分比」，与 css/styles.css 里的 calc 一一对应。
   钞票宽 30% / 高 20%：钱包盒是 4:3，30% 宽的钞票按真实纸币比例（约 2:1，100 元券
   155×77mm）算出来正好是盒高的 20%。底边压在 52%（前盖上沿），所以钞票是从袋口往上
   立着露出来的，面额数字写在钞票右边缘、收起时每组都露得出来。
   硬币宽 11% / 高 15%（屏幕上等长，画出来才是圆的），底边也压在 52%。 */
const NOTE_SLOT = { left: 10, w: 30, h: 20, groupStep: 19, sliver: 1.2 };
/** 钞票底边 = 前盖上沿（.wallet-front 是 inset: 52% 5% 3% 5%） */
const NOTE_BOTTOM = 52;
/** 收起时钞票的上边缘（底边压在袋口，所以顶 = 52 - 高 20） */
const NOTE_TOP = NOTE_BOTTOM - NOTE_SLOT.h;
/**
 * 收起时整层钞票往下压的量（占钱包盒高的百分比）：钞票大半塞进前盖后面，只露一条边和面额数字。
 * 悬停时这一层抬回原位 = 向上展开；指定了交易的钱包只把参与那几张抬回原位。
 * 飞行层是堆的兄弟节点、不吃这个位移，所以飞入落点与抽出起点都要自己把这个量算进 y，
 * 否则动画结束那一帧钞票会「跳」一格（堆里的位置与落点差 14%）。
 */
const DECK_LIFT = 14;
/** 面额组之间的理想间距；组数多时自动收紧，最后一组的右边缘不越过 BOX_RIGHT */
const GROUP_STEP_MAX = 19;
/** 悬停时同面额相邻两张的上升量上限（张数少时才有这么大，多则按上限摊不开） */
const GKU_MAX = 3.2;
/** 悬停摊开时最上面那张/枚不许越过盒顶这条线（再往上就出画面了） */
const MIN_TOP_HOVER = 6;
/** 硬币那一列的左缘：负值 = 一半探到钱包盒外（用户要求硬币可以在钱包外展示） */
const COIN_LEFT = -6;
const COIN_W = 11;
const COIN_H = 15;
const COIN_BOTTOM = 52;
/** 最下面那枚硬币的上边缘 */
const COIN_TOP = COIN_BOTTOM - COIN_H;
/** 硬币收起时相邻两枚的间距：露出来的那一条带就是这一格，面额标签要放得下（8% 约合 20px） */
const COIN_STEP = 8;
/** 硬币悬停时相邻两枚的间距上限（必须比收起时大，才看得出「向上展开」） */
const COIN_STEP_MAX = 12;
/** 收起时整列硬币的上沿：不许探出皮革后盖的上边缘（悬停才允许升到 MIN_TOP_HOVER） */
const COIN_MIN_TOP = 12;
/** 钱包盒内的可用右界（左右各留 5%；硬币那列故意越过左边线，不受这条约束） */
const BOX_RIGHT = 95;

/** 抽出时钞票往哪边飘（占钱包盒宽的正百分比）：钞票从左往右排开，所以往右上方飘出去 */
const FLY_OUT_X = 12;
/** 抽出终点（占钱包盒高的负百分比，相对收起后的位置）：-28% 时钞票底边正好离开盒顶 */
const FLY_OUT_Y = -28;
/** 硬币抽出终点：硬币贴左缘外侧，往左上方飘出去 */
const COIN_FLY_OUT_X = -10;
const COIN_FLY_OUT_Y = -22;
/** 飞入起点：从盒顶上方落下来 */
const FLY_IN_FROM_Y = -34;

/** @returns {boolean} 用户在系统里要求减少动态效果 */
export function reducedMotion() {
  return prefersReducedMotion();
}

/** 等 n 帧（给布局一点时间；GSAP 可用时它自己会排帧，这里只是补一帧） */
export function nextFrames(n) {
  const want = Math.max(1, n);
  return new Promise((resolve) => {
    let left = want;
    let done = false;
    /* 浏览器可能很久不给你帧（后台标签页、没有 GPU 的测试环境）。
       这里按墙上时间兜底：最迟 want*32 + 120ms 一定放行，不把调用方挂住。 */
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(floor);
      resolve();
    };
    const floor = setTimeout(finish, want * 32 + 120);
    const step = () => {
      left -= 1;
      if (left <= 0) finish();
      else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
      else setTimeout(step, 16);
    };
    step();
  });
}

/**
 * 跑一段动画，保证一定有个终点：
 * run 只需调用一次 finish，超时或抛错都会收尾并 resolve。
 * GSAP 的时间轴也可能因为浏览器不给帧而停在中间，这层兜底照旧留着。
 * @param {(finish: () => void) => void} run @param {number} [ms]
 */
export function runClosable(run, ms = 1200) {
  return new Promise((resolve) => {
    let done = false;
    let raf = 0;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(finish, ms + 300);
    try {
      run(finish);
    } catch (err) {
      console.warn('钱包动画执行出错，已跳过动画（数据不受影响）：', err);
      finish();
    }
  });
}

/**
 * 数字滚动（GSAP 时间轴 + snap 到整数分，不会出现 0.7 分钱这种中间值）。
 * @param {HTMLElement} el @param {{(cents:number):string}} format
 * @param {{from:number,to:number,duration?:number}} opts @param {((cents:number)=>void)} [onFrame]
 */
export function animateNumber(el, format, opts, onFrame) {
  const from = Math.round(Number(opts.from) || 0);
  const to = Math.round(Number(opts.to) || 0);
  const durationMs = Math.max(0, Number(opts.duration) || 700);
  if (reducedMotion() || from === to || durationMs === 0 || !hasGsap) {
    el.textContent = format(to);
    if (onFrame) onFrame(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const proxy = { cents: from };
    const duration = durationMs / 1000;
    let done = false;
    let watchdog = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      el.textContent = format(to);
      if (onFrame) onFrame(to);
      resolve();
    };
    try {
      const tl = gsap.timeline({
        paused: true,
        onComplete: finish,
        onInterrupt: finish,
      });
      tl.to(proxy, {
        cents: to,
        duration,
        ease: 'power2.out',
        snap: { cents: 1 },
        onUpdate: () => {
          if (done) return;
          const value = Math.round(proxy.cents);
          el.textContent = format(value);
          if (onFrame) onFrame(value);
        },
      });
      // 帧可能很久不来（后台标签页、没有 GPU 的测试环境）：按墙上时间兜底，
      // 最迟 duration + 120ms 一定写到终值并收尾，动画不会把调用方拖住。
      watchdog = setTimeout(finish, durationMs + 120);
      tl.play();
    } catch (err) {
      console.warn('余额滚动异常，直接写终值：', err);
      finish();
    }
  });
}

/** 余额对应的面额列表（兼容旧调用：按最少张数构成展开，每种最多 MAX_FAN 张） */
export function noteDenominations(balanceCents) {
  const out = [];
  for (const group of composeNotes(balanceCents)) {
    const n = Math.min(group.count, MAX_FAN);
    for (let i = 0; i < n; i += 1) out.push(group.denom);
  }
  return out;
}

/** 面额是否走硬币画法（角、分） */
function isCoinDenom(denomCents) {
  return denomCents < 100;
}

/** 按面额给一点旋转差异，看起来像真的一沓纸（底边对齐时摆角必须小，否则一眼看出不齐） */
function rotFor(index) {
  const table = [-0.5, 0.4, -0.3, 0.5, -0.4, 0.2];
  return table[index % table.length];
}

/** @param {number} denom @param {number} index 组内第几张（0 = 最左、画在本组最下面） */
function makeNote(denom, index) {
  const el = document.createElement('div');
  el.className = 'note note-d' + denom;
  el.style.setProperty('--i', String(index));
  el.style.setProperty('--rot', rotFor(index).toFixed(2) + 'deg');
  const face = document.createElement('span');
  face.className = 'note-face';
  face.textContent = denomLabel(denom);
  el.appendChild(face);
  return el;
}

/** @param {number} denom @param {number} index 硬币列里从上往下数第几枚 */
function makeCoin(denom, index) {
  const el = document.createElement('div');
  el.className = 'coin coin-d' + denom;
  el.style.setProperty('--i', String(index));
  el.style.setProperty('--rot', rotFor(index + 2).toFixed(2) + 'deg');
  const face = document.createElement('span');
  face.className = 'note-face';
  face.textContent = denomLabel(denom);
  el.appendChild(face);
  return el;
}

/**
 * 把「按面额分组的张数」摊平成逐张序列。
 * @param {Array<{denom:number,count:number}>} groups @param {number} cap
 */
function flatten(groups, cap) {
  const seq = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i += 1) {
      seq.push(group.denom);
      if (cap && seq.length >= cap) return seq;
    }
  }
  return seq;
}

/**
 * 规划钱包里怎么画：每种面额最多 MAX_FAN 张（硬币 MAX_COINS 枚）、钞票合计最多 MAX_DRAWN 张，
 * 然后按「同面额一沓底边对齐、面额之间等距往右排开」定出每一组的位置与悬停展开量。
 * renderStack（画在堆里）与飞行层的落点都读这一份规划，
 * 否则飞进来的钞票会落在和最终堆不同的位置，看起来像放错了地方。
 * @param {Array<{denom:number,count:number}>} comp 面额降序的构成
 * @returns {{noteGroups: Array<{denom:number,drawn:number}>,
 *   noteAt: Map<number, {gx:number,gs:number,gku:number,drawn:number}>,
 *   coinRows: number[], coinAt: Map<number, {startRow:number}>,
 *   coinStep:number, coinStepUp:number,
 *   drawnNotes:number, drawnCoins:number, total:number}}
 */
function planStack(comp) {
  const noteGroups = [];
  const coinRows = [];
  let noteIdx = 0;
  let coinIdx = 0;
  let total = 0;
  for (const group of comp) {
    const coin = isCoinDenom(group.denom);
    let take = Math.min(group.count, coin ? MAX_COINS : MAX_FAN);
    if (!coin) take = Math.min(take, Math.max(0, MAX_DRAWN - noteIdx));
    if (coin) take = Math.min(take, Math.max(0, MAX_COIN_TOTAL - coinIdx));
    if (coin) {
      for (let i = 0; i < take; i += 1) coinRows.push(group.denom);
      coinIdx += take;
    } else {
      if (take > 0) noteGroups.push({ denom: group.denom, drawn: take });
      noteIdx += take;
    }
    total += group.count;
  }

  // 面额组之间等距往右排开。组数多时自动收紧：最后一组的右边缘（含组内往右挪出来的
  // 那几条纸边）不许越过 BOX_RIGHT，否则右边那组的面额数字就被钱包盒切掉了。
  const g = noteGroups.length;
  const maxExtra = noteGroups.reduce((m, it) => Math.max(m, it.drawn - 1), 0);
  let step = g <= 1
    ? GROUP_STEP_MAX
    : Math.min(GROUP_STEP_MAX, (BOX_RIGHT - NOTE_SLOT.left - NOTE_SLOT.w) / (g - 1));
  let sliver = Math.min(NOTE_SLOT.sliver, step * 0.35);
  if (g > 1) {
    step = Math.min(step, (BOX_RIGHT - NOTE_SLOT.left - NOTE_SLOT.w - maxExtra * sliver) / (g - 1));
    sliver = Math.min(NOTE_SLOT.sliver, step * 0.35);
  }

  const noteAt = new Map();
  noteGroups.forEach((it, gi) => {
    // 悬停时这一沓最多能升多少：最上面那张的上边缘要留在 MIN_TOP_HOVER 之下。
    const gku = it.drawn <= 1
      ? GKU_MAX
      : Math.min(GKU_MAX, (NOTE_TOP - MIN_TOP_HOVER) / (it.drawn - 1));
    noteAt.set(it.denom, { gx: NOTE_SLOT.left + gi * step, gs: sliver, gku, drawn: it.drawn });
  });

  // 硬币不分面额铺开：一枚压一枚往上排，最大的那枚在最下面（最后画才盖得住上面那些）。
  // 露出来的带宽 = 间距，每枚的面额标签贴自己上缘，所以收起间距不能小于标签高度。
  const c = coinRows.length;
  const coinStep = c <= 1 ? COIN_STEP : Math.min(COIN_STEP, (COIN_TOP - COIN_MIN_TOP) / (c - 1));
  const coinStepUp = c <= 1 ? COIN_STEP_MAX : Math.min(COIN_STEP_MAX, (COIN_TOP - MIN_TOP_HOVER) / (c - 1));
  const coinAt = new Map();
  coinRows.forEach((denom, row) => {
    if (!coinAt.has(denom)) coinAt.set(denom, { startRow: row });
  });

  return {
    noteGroups, noteAt, coinRows, coinAt, coinStep, coinStepUp,
    drawnNotes: noteIdx, drawnCoins: coinIdx, total,
  };
}

/** 构成对应的规划（飞行落点与堆内位置共用；纯函数，同一个构成永远算出同一份） */
function planFor(comp) {
  return planStack(comp);
}

/**
 * 这笔钱参与哪几种面额、各参与几张。
 * 第六轮起这就是「花了多少」的答案：直接按这笔金额的最少张数拆法，
 * 不再去看钱包新旧构成差了什么。
 * @param {{out?: Array<{denom:number,count:number}>, in?: Array<{denom:number,count:number}>}
 *          | number | null | undefined} [changeOrCents]
 * @returns {Map<number, number>}
 */
function involvedMap(changeOrCents) {
  const m = new Map();
  if (changeOrCents === null || changeOrCents === undefined) return m;
  if (typeof changeOrCents === 'number') {
    for (const group of spendBills(changeOrCents)) m.set(group.denom, group.count);
    return m;
  }
  for (const list of [changeOrCents.out, changeOrCents.in]) {
    for (const group of list || []) {
      m.set(group.denom, (m.get(group.denom) || 0) + group.count);
    }
  }
  return m;
}

/**
 * 构建钱包。
 * @param {{balanceCents?: number, periodLabel?: string, compact?: boolean, showComposition?: boolean}} [opts]
 * @returns {{root: HTMLElement, wrap: HTMLElement, stack: HTMLElement, front: HTMLElement,
 *   balanceDisplay: HTMLElement, setBalance: (cents: number, opts?: {animate?: boolean, from?: number}) => Promise<void>,
 *   spend: (amountCents: number, opts?: {updateBalance?: boolean}) => Promise<void>,
 *   income: (amountCents: number, opts?: {updateBalance?: boolean}) => Promise<void>,
 *   setTransaction: (changeOrCents?: object | number) => void,
 *   destroy: () => void, getBalance: () => number, getCompositionText: () => string}}
 */
export function buildWallet(opts = {}) {
  const compact = opts.compact === true;
  const showComposition = opts.showComposition !== false;
  /** 本钱包创建的 GSAP 时间轴，destroy 时统一杀掉（视图重渲染不会留下孤儿时间轴） */
  const tweens = new Set();
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  /** 登记一条时间轴：不可用时返回 null，调用方照常往下走（退化成瞬时切换） */
  const keep = (tl) => {
    if (!tl) return null;
    tweens.add(tl);
    tl.eventCallback('onComplete', () => { tweens.delete(tl); });
    return tl;
  };

  const root = document.createElement('div');
  root.className = 'wallet' + (compact ? ' wallet-compact' : '');
  if (!compact) root.dataset.wallet = 'main';

  const shadow = document.createElement('div');
  shadow.className = 'wallet-shadow';
  shadow.setAttribute('aria-hidden', 'true');
  root.appendChild(shadow);

  const back = document.createElement('div');
  back.className = 'wallet-back';
  back.setAttribute('aria-hidden', 'true');
  root.appendChild(back);

  const stack = document.createElement('div');
  stack.className = 'wallet-stack';
  stack.setAttribute('aria-hidden', 'true');
  root.appendChild(stack);

  const flight = document.createElement('div');
  flight.className = 'wallet-flight';
  flight.setAttribute('aria-hidden', 'true');
  root.appendChild(flight);

  const front = document.createElement('div');
  front.className = 'wallet-front';
  const seam = document.createElement('span');
  seam.className = 'wallet-seam';
  front.appendChild(seam);
  const plate = document.createElement('span');
  plate.className = 'wallet-plate';
  plate.setAttribute('aria-hidden', 'true');
  front.appendChild(plate);

  const face = document.createElement('div');
  face.className = 'wallet-face';
  const label = document.createElement('div');
  label.className = 'wallet-label';
  label.textContent = '当前可支配余额';
  face.appendChild(label);

  const amount = document.createElement('div');
  amount.className = 'wallet-amount';
  const sym = document.createElement('span');
  sym.textContent = '¥';
  sym.className = 'wallet-currency';
  const wholeEl = document.createElement('span');
  wholeEl.className = 'wallet-whole';
  const fracEl = document.createElement('span');
  fracEl.className = 'wallet-frac';
  amount.appendChild(sym);
  amount.appendChild(wholeEl);
  amount.appendChild(fracEl);
  face.appendChild(amount);

  const periodEl = document.createElement('div');
  periodEl.className = 'wallet-period';
  if (opts.periodLabel) periodEl.textContent = opts.periodLabel;
  face.appendChild(periodEl);
  front.appendChild(face);
  root.appendChild(front);

  const clasp = document.createElement('span');
  clasp.className = 'wallet-clasp';
  clasp.setAttribute('aria-hidden', 'true');
  root.appendChild(clasp);

  const countEl = document.createElement('span');
  countEl.className = 'wallet-count';
  countEl.hidden = true;
  root.appendChild(countEl);

  // 构成说明挂在钱包外面，而且只对读屏软件存在：钱包盒是 4:3 的固定比例，钞票又立在袋口上，
  // 文字写在盒子里会被前盖和钞票压住；用户要求页面上别再出现「钱包里：¥100 ×16 …」这种
  // 长串，所以它改成 sr-only —— 视觉上没有了，读屏软件仍然能听到钱包里装的是什么。
  const wrap = document.createElement('div');
  wrap.className = 'wallet-wrap';
  wrap.appendChild(root);
  let compoEl = null;
  if (showComposition) {
    compoEl = document.createElement('p');
    compoEl.className = 'wallet-composition sr-only';
    compoEl.setAttribute('aria-live', 'polite');
    wrap.appendChild(compoEl);
  }

  let currentCents = Math.round(Number(opts.balanceCents) || 0);
  let plan = planFor(composeNotes(currentCents));
  // 这笔钱由哪几种面额组成、各几张：只有这些钞票与硬币会在悬停时展开，
  // 其余的一张都不动（你指出的：花一张 ¥100 不该把整沓十六张都摊开）。
  let involved = new Map();
  /** 悬停展开的时间轴：进入播、离开倒着播，所以鼠标移开是「收回去」而不是「瞬移回去」 */
  let hoverTl = null;

  /* ---------------- GSAP 工具 ---------------- */

  /**
   * 钱包盒的像素尺寸（飞行层与钱包盒同尺寸，所以「盒内百分比」直接换算成 px）。
   * 盒子还没布局（display:none 或宽 0）时返回 null，调用方退化成瞬时切换。
   * @returns {{w:number,h:number}|null}
   */
  function boxSize() {
    const rect = root.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    return { w: rect.width, h: rect.height };
  }

  /** 把「钱包盒内百分比」换算成 GSAP 用的像素位移 */
  function pxOf(box, xPct, yPct) {
    return { x: (box.w * xPct) / 100, y: (box.h * yPct) / 100 };
  }

  /** 把堆压回收起位置（GSAP 不可用时什么都不做，CSS 里留着同样的默认值兜底） */
  function setDeckCollapsed() {
    if (!hasGsap) return;
    try {
      gsap.set(stack, { yPercent: DECK_LIFT });
    } catch (err) {
      console.warn('钱包堆层初始位置设置失败：', err);
    }
  }

  /** 硬币列的间距写在堆上，CSS 用它做 --ck-run（收起态）与悬停态之间的过渡兜底。 */
  function writeCoinSpacing() {
    stack.style.setProperty('--ck', plan.coinStep.toFixed(2) + '%');
    stack.style.setProperty('--ck-up', plan.coinStepUp.toFixed(2) + '%');
  }

  function renderComposition() {
    if (!compoEl) return;
    if (currentCents <= 0) {
      compoEl.textContent = currentCents < 0
        ? '余额已经透支，钱包里没有钞票了。'
        : '钱包是空的。';
      return;
    }
    compoEl.textContent = '钱包里：' + describeComposition(currentCents);
  }

  function renderStack() {
    const comp = composeNotes(currentCents);
    plan = planFor(comp);
    const total = plan.total;
    stack.textContent = '';
    // 钞票按面额分组，小的组先 append、最大的组最后 append（DOM 里后画的盖在上面）：
    // 最左边那沓最大面额压在别人身上，右边各组于是只露出面额数字那半截 ——
    // 一眼看得出钱包里从大到小有哪些面额，又不会糊成一团。
    // 组内按 --i 从小到大 append：往右挪得最多的那张画在本组最上面。
    for (let gi = plan.noteGroups.length - 1; gi >= 0; gi -= 1) {
      const group = plan.noteGroups[gi];
      const info = plan.noteAt.get(group.denom);
      const grp = document.createElement('div');
      grp.className = 'note-group';
      grp.style.setProperty('--gx', info.gx.toFixed(2) + '%');
      grp.style.setProperty('--gs', info.gs.toFixed(2) + '%');
      grp.style.setProperty('--gk-up', info.gku.toFixed(2) + '%');
      // 只有参与这笔的那几张会展开，所以按「参与那几张里的第几张」编号、
      // 按参与张数算展开量 —— 跟这一沓一共画了几张无关。
      const nInv = Math.min(involved.get(group.denom) || 0, group.drawn);
      const rise = nInv > 1
        ? Math.min(info.gku, (NOTE_TOP - MIN_TOP_HOVER) / (nInv - 1))
        : 0;
      for (let i = 0; i < group.drawn; i += 1) {
        const note = makeNote(group.denom, i);
        if (i >= group.drawn - nInv) {
          const k = i - (group.drawn - nInv);
          note.classList.add('is-involved');
          note.style.setProperty('--i', String(k));
          note.style.setProperty('--gk-inv', rise.toFixed(2) + '%');
          // 参与那几张要盖在同组没参与的钞票上面（悬停展开时才看得出来）。
          // 前盖在 DOM 里排在堆之后、也没有 z-index，所以这个 z-index 不会把钞票提到皮革前面。
          note.style.zIndex = '2';
        }
        grp.appendChild(note);
      }
      stack.appendChild(grp);
    }
    // 硬币一枚压一枚往上排：从上往下 append，最下面那枚（最大面额）最后画才盖得住上面那些。
    // 硬币同理：只有参与这笔的那几枚展开，按「参与那几枚里的第几枚」编号。
    const coinRows = plan.coinRows;
    const cInvTotal = Math.min(
      coinRows.reduce((sum, denom) => sum + (involved.get(denom) || 0), 0),
      coinRows.length,
    );
    const cRise = cInvTotal > 1
      ? Math.min(plan.coinStepUp, (COIN_TOP - MIN_TOP_HOVER) / (cInvTotal - 1))
      : 0;
    let cTaken = 0;
    for (let r = coinRows.length - 1; r >= 0; r -= 1) {
      const denom = coinRows[r];
      const coin = makeCoin(denom, r);
      if (cTaken < cInvTotal) {
        coin.classList.add('is-involved');
        coin.style.setProperty('--i', String(cTaken));
        coin.style.setProperty('--ck-inv', cRise.toFixed(2) + '%');
        coin.style.zIndex = '2';
        cTaken += 1;
      }
      stack.appendChild(coin);
    }
    const drawn = plan.drawnNotes + plan.drawnCoins;
    const hidden = Math.max(0, total - drawn);
    if (hidden > 0) {
      const badge = document.createElement('span');
      badge.className = 'stack-count';
      badge.textContent = '+' + hidden + ' 张';
      stack.appendChild(badge);
    }
    writeCoinSpacing();
    root.classList.toggle('wallet-empty', total === 0);
    root.classList.toggle('is-negative', currentCents < 0);
    if (total > 0) {
      countEl.hidden = false;
      countEl.textContent = total + ' 张';
    } else {
      countEl.hidden = true;
      countEl.textContent = '';
    }
    renderComposition();
  }

  /* ---------------- 悬停展开 ---------------- */

  /** 展开时参与那几张要升到哪儿（占钱包盒高的负百分比，相对收起后的位置） */
  function involvedTargets() {
    const notes = stack.querySelectorAll('.note.is-involved');
    const coins = stack.querySelectorAll('.coin.is-involved');
    const box = boxSize();
    if (!box || (!notes.length && !coins.length)) return null;
    const noteY = [];
    notes.forEach((el) => {
      const rise = Number.parseFloat(el.style.getPropertyValue('--gk-inv')) || 0;
      noteY.push(pxOf(box, 0, -(DECK_LIFT + rise)).y);
    });
    const coinY = [];
    coins.forEach((el) => {
      const rise = Number.parseFloat(el.style.getPropertyValue('--ck-inv')) || 0;
      coinY.push(pxOf(box, 0, -(DECK_LIFT + rise)).y);
    });
    return { notes, coins, noteY, coinY };
  }

  /** 没指定交易的钱包（钱包页那种）：整层抬回原位 + 每组按张数往上摊开 */
  function plainTargets() {
    const box = boxSize();
    if (!box) return null;
    return {
      stackY: pxOf(box, 0, -DECK_LIFT).y,
      coinRun: plan.coinStepUp,
    };
  }

  function playHover() {
    if (!hasGsap || reducedMotion()) return;
    try {
      if (hoverTl && hoverTl.isActive() && !hoverTl.reversed()) return;
      const tl = gsap.timeline({ paused: true, defaults: { duration: 0.34, ease: 'power2.out' } });
      if (root.classList.contains('has-tx')) {
        const t = involvedTargets();
        if (!t) return;
        t.notes.forEach((el, i) => {
          tl.to(el, { y: t.noteY[i], duration: 0.3, ease: 'power2.out' }, 0);
        });
        t.coins.forEach((el, i) => {
          tl.to(el, { y: t.coinY[i], duration: 0.3, ease: 'power2.out' }, 0);
        });
        // 展开时「+N 张」那个徽标会被升到它头上的钞票压住半截，藏掉比压住好看
        if (t.notes.length || t.coins.length) {
          tl.to(stack, { '--ck-run': plan.coinStepUp, duration: 0.3 }, 0);
          tl.to('.stack-count', { opacity: 0, duration: 0.16 }, 0);
        }
      } else {
        const t = plainTargets();
        if (!t) return;
        tl.to(stack, { yPercent: 0, duration: 0.34, ease: 'power2.out' }, 0);
        // 每一组单独一条 tween：目标值就是这一组自己写的 --gk-up（JS 在规划时写进内联样式）。
        // 不能用 GSAP 的函数式取值去读 var()：GSAP 在动画开始那一刻就把目标值定死了，
        // 那时候读到的可能是上一次过渡中途的值，展开量就会忽大忽小。
        stack.querySelectorAll('.note-group').forEach((grp) => {
          const up = grp.style.getPropertyValue('--gk-up').trim();
          if (!up) return;
          tl.to(grp, { '--gk-run': up, duration: 0.34, ease: 'power2.out' }, 0);
        });
        tl.to(stack, { '--ck-run': plan.coinStepUp, duration: 0.34 }, 0);
        tl.to('.stack-count', { opacity: 0, duration: 0.16 }, 0);
      }
      hoverTl = keep(tl);
      tl.play();
    } catch (err) {
      console.warn('钱包悬停展开异常（数据不受影响）：', err);
    }
  }

  function reverseHover() {
    if (!hasGsap || reducedMotion()) return;
    try {
      if (!hoverTl) return;
      // 正在往前播就别打断：让它自己展开完（展开完再倒放，比中途硬切更顺）
      if (hoverTl.isActive() && !hoverTl.reversed()) return;
      hoverTl.reverse();
    } catch (err) {
      console.warn('钱包悬停收起异常（数据不受影响）：', err);
    }
  }

  /* ---------------- 飞行层 ---------------- */

  /**
   * 在飞行层里造一份「这笔钱」的钞票与硬币，位置就是它们在钱包里的真实槽位。
   * @param {number} cents 这笔金额（分）
   * @returns {{items: Array<{el:HTMLElement, landX:number, outX:number, outY:number, coin:boolean}>,
   *   box:{w:number,h:number}|null}}
   */
  function flightBills(cents) {
    const box = boxSize();
    const seq = flatten(spendBills(cents), MAX_FLY);
    const items = [];
    if (!box || !seq.length) return { items, box: null };
    const seen = new Map();
    for (const denom of seq) {
      const within = seen.get(denom) || 0;
      seen.set(denom, within + 1);
      const coin = isCoinDenom(denom);
      const el = coin ? makeCoin(denom, 0) : makeNote(denom, 0);
      let xPct;
      let yPct;
      if (coin) {
        // 硬币不分面额铺开，落点按「这一面额在硬币列里的起始行 + 同面额内第几枚」算
        const info = plan.coinAt.get(denom);
        const row = info ? Math.min(info.startRow + within, Math.max(0, plan.coinRows.length - 1)) : within;
        xPct = COIN_LEFT;
        yPct = COIN_TOP + DECK_LIFT - row * plan.coinStep;
      } else {
        const info = plan.noteAt.get(denom);
        const idx = Math.min(within, Math.max(0, (info ? info.drawn : 1) - 1));
        xPct = (info ? info.gx : NOTE_SLOT.left) + idx * (info ? info.gs : 0);
        // 堆被压低了 DECK_LIFT，飞行层不吃这个位移，所以落点要自己把这个量算进来
        yPct = NOTE_TOP + DECK_LIFT;
      }
      el.style.left = xPct.toFixed(2) + '%';
      el.style.top = yPct.toFixed(2) + '%';
      items.push({
        el,
        landX: pxOf(box, xPct, 0).x,
        outX: pxOf(box, coin ? COIN_FLY_OUT_X : FLY_OUT_X, 0).x,
        outY: pxOf(box, 0, coin ? COIN_FLY_OUT_Y : FLY_OUT_Y).y,
        coin,
      });
    }
    return { items, box };
  }

  function clearFlight() {
    flight.textContent = '';
  }

  /**
   * 抽出这笔钱：花了多少就抽出多少，逐张往上方飘出去。
   * @param {number} cents @returns {Promise<void>}
   */
  function playSpendOut(cents) {
    return runClosable((finish) => {
      const { items, box } = flightBills(cents);
      if (!hasGsap || reducedMotion() || !box || !items.length) {
        clearFlight();
        finish();
        return;
      }
      items.forEach((it) => flight.appendChild(it.el));
      // CSS 里 .wallet-flight .note 默认 opacity:0，GSAP 会把「当前值」当起点；
      // 不先点亮就是 0 → 0，整段飞行看不见钱。
      items.forEach((it) => gsap.set(it.el, { opacity: 1 }));
      root.classList.add('is-spending', 'is-open');
      const tl = keep(gsap.timeline({
        paused: true,
        defaults: { duration: 0.46, ease: 'power2.out' },
        onComplete: () => {
          root.classList.remove('is-spending', 'is-open');
          clearFlight();
          finish();
        },
      }));
      tl.to(items.map((it) => it.el), {
        y: (i) => items[i].outY,
        x: (i) => items[i].outX,
        rotation: (i) => (items[i].coin ? 3 : 2.4),
        opacity: 0,
        stagger: { each: STAGGER_S, from: 'start' },
      });
      tl.play();
    }, 1400);
  }

  /**
   * 存入这笔钱：这叠钱按自己的面额一张张从上方落进钱包。
   * @param {number} cents @returns {Promise<void>}
   */
  function playIncomeIn(cents) {
    return runClosable((finish) => {
      const { items, box } = flightBills(cents);
      if (!hasGsap || reducedMotion() || !box || !items.length) {
        clearFlight();
        finish();
        return;
      }
      const fromY = pxOf(box, 0, FLY_IN_FROM_Y).y;
      items.forEach((it) => {
        flight.appendChild(it.el);
        gsap.set(it.el, { y: fromY, opacity: 0 });
      });
      root.classList.add('is-income', 'is-open');
      const tl = keep(gsap.timeline({
        paused: true,
        defaults: { duration: 0.44, ease: 'power2.out' },
        onComplete: () => {
          root.classList.remove('is-income', 'is-open');
          clearFlight();
          finish();
        },
      }));
      tl.to(items.map((it) => it.el), {
        y: 0,
        x: 0,
        opacity: 1,
        stagger: { each: STAGGER_S, from: 'start' },
      });
      tl.play();
    }, 1400);
  }

  /**
   * 设置余额。
   * @param {number} cents @param {{animate?: boolean, from?: number}} [setOpts]
   */
  async function setBalance(cents, setOpts = {}) {
    const next = Math.round(Number(cents) || 0);
    const from = setOpts.from === undefined || setOpts.from === null
      ? currentCents
      : Math.round(Number(setOpts.from) || 0);
    currentCents = next;
    renderStack();
    setDeckCollapsed();
    if (setOpts.animate === false || reducedMotion()) {
      renderText(next);
      return;
    }
    await animateNumber(wholeEl, (value) => {
      const sign = value < 0 ? '-' : '';
      return sign + formatAmount(Math.abs(value)).split('.')[0];
    }, { from, to: next, duration: 700 }, (value) => {
      fracEl.textContent = '.' + formatAmount(Math.abs(value)).split('.')[1];
    });
  }

  /**
   * 花费：抽出「这笔钱本身」的钞票（花了多少抽多少），不演找回。
   * @param {number} amountCents @param {{updateBalance?: boolean}} [spendOpts]
   *   updateBalance:false 时只飞钞票，数字与 currentCents 都停在旧值，调用方必须自己 setBalance 收尾。
   */
  async function spend(amountCents, spendOpts = {}) {
    const from = currentCents;
    const to = from - Math.round(Number(amountCents) || 0);
    const keepBalance = spendOpts.updateBalance === false;
    setTransaction(amountCents);
    if (keepBalance) renderText(from);
    await playSpendOut(amountCents);
    // 飞完就把堆换成花掉之后的构成、压回袋口；数字单独处理：
    // keepBalance 时数字留在旧值，等调用方去滚（覆盖层随后调 setBalance({from}) 做滚动）。
    // 这里再 renderText(to) 会让数字先瞬跳到新值、再被滚回旧值，肉眼可见地闪一下。
    currentCents = to;
    renderStack();
    setDeckCollapsed();
    if (!keepBalance) renderText(to);
    // keepBalance 时数字**留在旧值**，等调用方去滚（覆盖层随后调 setBalance({from}) 做滚动）。
    // 这里再 renderText(to) 会让数字先瞬跳到新值、再被滚回旧值，肉眼可见地闪一下。
  }

  /**
   * 存入：把这叠钱按自己的面额一张张放进去。
   * @param {number} amountCents @param {{updateBalance?: boolean}} [incomeOpts]
   *   updateBalance:false 时只飞钞票，数字与 currentCents 都停在旧值，调用方必须自己 setBalance 收尾。
   */
  async function income(amountCents, incomeOpts = {}) {
    const from = currentCents;
    const to = from + Math.round(Number(amountCents) || 0);
    const keepBalance = incomeOpts.updateBalance === false;
    setTransaction(amountCents);
    if (keepBalance) renderText(from);
    await playIncomeIn(amountCents);
    // 同 spend：堆立刻换成新构成，数字留给调用方滚，别在这里瞬写新值。
    currentCents = to;
    renderStack();
    setDeckCollapsed();
    if (!keepBalance) renderText(to);
    // 同 spend：数字留给调用方滚，别在这里瞬写新值。
  }

  /**
   * 告诉钱包「这笔钱由哪些面额组成」：悬停时只有这几张展开，其余的一张都不动。
   * @param {{out?: Array<{denom:number,count:number}>, in?: Array<{denom:number,count:number}>}
   *          | number} [changeOrCents] 传金额（分）就是「花了多少就展开多少」；
   *   也兼容旧的 {out,in} 构成差对象。
   */
  function setTransaction(changeOrCents) {
    involved = involvedMap(changeOrCents);
    // 有交易上下文的钱包只展开参与那几种面额；没上下文的（钱包页那种）整组展开。
    root.classList.toggle('has-tx', involved.size > 0);
    renderStack();
  }

  function renderText(cents) {
    const sign = cents < 0 ? '-' : '';
    wholeEl.textContent = sign + formatAmount(Math.abs(cents)).split('.')[0];
    fracEl.textContent = '.' + formatAmount(Math.abs(cents)).split('.')[1];
  }

  const onEnter = (e) => {
    if (e && e.target && e.target.closest && e.target.closest('.wallet')) playHover();
  };
  const onLeave = (e) => {
    if (e && e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.wallet')) return;
    reverseHover();
  };
  root.addEventListener('pointerenter', onEnter);
  root.addEventListener('pointerleave', onLeave);

  renderText(currentCents);
  renderStack();
  setDeckCollapsed();

  function destroy() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (hasGsap) {
      try {
        for (const tl of tweens) tl.kill();
        if (hoverTl) hoverTl.kill();
        gsap.killTweensOf(stack);
        gsap.killTweensOf(flight.querySelectorAll('.note, .coin'));
        gsap.killTweensOf('.stack-count');
      } catch (err) {
        console.warn('钱包时间轴清理异常：', err);
      }
    }
    tweens.clear();
    hoverTl = null;
    root.removeEventListener('pointerenter', onEnter);
    root.removeEventListener('pointerleave', onLeave);
    clearFlight();
    // 只摘自己挂出去的那一层：wrap 进了 DOM 就摘 wrap（连带构成说明），
    // 否则摘 root。不能再往上爬——root 的父节点是调用方的容器（首页的 .hero-wallet、
    // 覆盖层的 .cash-stage），再删一次就把别人的容器也删掉了。
    const own = wrap.parentNode ? wrap : root;
    if (own.parentNode) own.parentNode.removeChild(own);
  }

  return {
    root,
    wrap,
    stack,
    front,
    balanceDisplay: wholeEl,
    composition: compoEl,
    setBalance,
    spend,
    income,
    setTransaction,
    destroy,
    getBalance: () => currentCents,
    getCompositionText: () => describeComposition(currentCents),
  };
}

export { centsToYuan, depositComposition };
