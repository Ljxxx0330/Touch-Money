/**
 * 应用外壳（手机形态）。
 *
 * 整个应用是一个「手机页」：窄屏时全出血铺满屏幕，宽屏时把它居中放进一个设备框里。
 * 滚动只发生在 .phone-screen 内部；标题栏与底部标签栏钉在框上，像真的 App。
 * 轻提示、模态框、消费成功覆盖层都挂在 .app-frame 里面，所以它们永远只盖住手机页，
 * 不会跑到设备框外面去。
 *
 * 宽屏时框子上下各有一条介绍带（品牌 + 口号 + 纸币插画 + 卖点 / 五张介绍卡）。
 * 那两段只是说明这个原型是什么，不是功能入口，所以手机形态下整块不出现。
 *
 * 数据层不依赖这一层：视图通过 ctx 拿状态与动作，写成功后由这里统一刷新。
 */

import {
  getState, init as initState, subscribe, getNotices, dismissNotice, clearNotices,
  prefersReducedMotion, isStorageAvailableFlag, isConfiguredFlag,
  getBudgetView, getStatsView, getRecordById, getWishById, sortedRecords, sortedWishlist,
  coolingRemainingMs, setMonthlyFee, setCycleDay, setCarryOver, setReminderPercent,
  setWishCoolingDefault, addRecord, updateRecord, deleteRecord, addWishItem, updateWishItem,
  deleteWishItem, markWishPurchased, recordWishPurchase, exportJsonText, previewImport,
  importJsonText, clearAllData, loadDemoData, getFeePreview,
} from './state.js';
import { categoryLabel } from './budget.js';
import { humanDate, humanPeriod, currentPeriodKey, todayKey } from './dates.js';
import { formatAmount, formatCents } from './money.js';
import { STORAGE_KEY, APP_NAME, APP_LABEL } from './storage.js';
import { icon } from '../ui/icons.js';
import { toast, toastSuccess, toastError, toastWarn } from '../ui/toast.js';
import { openModal, confirmDialog, closeAllModals } from '../ui/modal.js';
import { renderWalletView } from '../views/wallet-view.js';
import { renderAddView, openRecordConfirm } from '../views/add-view.js';
import { renderStatsView } from '../views/stats-view.js';
import { renderRecordsView, openRecordDetail } from '../views/records-view.js';
import { renderWishlistView } from '../views/wishlist-view.js';
import { renderBudgetView } from '../views/budget-view.js';
import { renderSettingsView } from '../views/settings-view.js';

/** 底部标签栏上的五个入口，顺序就是手机页从左到右的顺序。 */
const TAB_IDS = ['wallet', 'records', 'stats', 'wishlist', 'settings'];

/**
 * 路由表。
 * tab     —— 在标签栏上显示成什么（没有这个字段就不占标签位）
 * tabOf   —— 这个页面自己不占标签位，但进入时点亮哪个标签（子页面挂到父入口下面）
 * back    —— 标题栏左边的返回箭头去哪（没有就不显示箭头）
 */
const ROUTES = [
  {
    id: 'wallet', title: '我的钱包', sub: '这个月还剩多少钱，一眼看见。',
    icon: 'wallet', tab: '钱包', back: null, render: renderWalletView,
  },
  {
    id: 'add', title: '记一笔', sub: '花出去的钱，值得停下来三秒。',
    icon: 'pencil', tabOf: 'wallet', back: 'wallet', render: renderAddView,
  },
  {
    id: 'stats', title: '消费统计', sub: '看看钱都去了哪里。',
    icon: 'chart', tab: '统计', back: null, render: renderStatsView,
  },
  {
    id: 'records', title: '消费记录', sub: '每一笔都在这里，可以改、可以删。',
    icon: 'list', tab: '记录', back: null, render: renderRecordsView,
  },
  {
    id: 'settings', title: '设置', sub: '生活费、提醒和你的数据。',
    icon: 'gear', tab: '我的', back: null, render: renderSettingsView,
  },
  {
    id: 'wishlist', title: '愿望清单', sub: '想买的东西先放一放，等一等再决定。',
    icon: 'heart', tab: '愿望清单', back: null, render: renderWishlistView,
  },
  {
    id: 'budget', title: '生活费管理', sub: '把口径对齐，数字才有意义。',
    icon: 'coin', tabOf: 'settings', back: 'settings', render: renderBudgetView,
  },
];

const app = {
  frame: null,
  screen: null,
  topTitle: null,
  topSub: null,
  topBack: null,
  topActions: null,
  bellBtn: null,
  noticesHost: null,
  viewHost: null,
  tabbar: null,
  statusTime: null,
  statusTimer: 0,
  route: 'wallet',
  headerAction: null,
  booted: false,
};

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function routeById(id) {
  return ROUTES.find((r) => r.id === id) || ROUTES[0];
}

/** 当前页面应该点亮哪个标签：标签页点亮自己，子页面点亮它的来路。 */
function tabIdFor(id) {
  const route = routeById(id);
  const target = route.tab ? route.id : route.tabOf;
  return TAB_IDS.includes(target) ? target : null;
}

function routeFromHash() {
  const raw = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).split('?')[0];
  return ROUTES.some((r) => r.id === raw) ? raw : 'wallet';
}

/* ---------------- 手机页外壳 ---------------- */

function topButton(name, label, onClick) {
  const btn = el('button', 'top-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(icon(name, { size: 20 }));
  btn.addEventListener('click', onClick);
  return btn;
}

/** 装饰性状态栏：只有宽屏出现（真手机上系统自己就有这些，窄屏不重复画）。 */
function phoneStatus() {
  const bar = el('div', 'phone-status');
  app.statusTime = el('span', 'phone-status-time');
  const right = el('div', 'phone-status-right');
  right.innerHTML = '<svg viewBox="0 0 24 12" width="18" height="9" aria-hidden="true">'
    + '<rect x="0" y="7" width="3" height="5" rx="1" fill="currentColor"/>'
    + '<rect x="5" y="4.5" width="3" height="7.5" rx="1" fill="currentColor"/>'
    + '<rect x="10" y="2" width="3" height="10" rx="1" fill="currentColor"/>'
    + '<rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" opacity=".3"/></svg>'
    + '<svg viewBox="0 0 26 12" width="24" height="11" aria-hidden="true">'
    + '<rect x="0.75" y="0.75" width="21.5" height="10.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<rect x="3" y="3" width="14" height="6" rx="1.5" fill="currentColor"/>'
    + '<rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor"/></svg>';
  bar.append(app.statusTime, right);
  writeStatusTime();
  app.statusTimer = window.setInterval(writeStatusTime, 30000);
  return bar;
}

function writeStatusTime() {
  if (!app.statusTime) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  app.statusTime.textContent = `${hh}:${mm}`;
}

/** 宽屏时框子上方的介绍带：品牌、口号、纸币插画、四个卖点。 */
function deskBand() {
  const band = el('div', 'desk-band');
  const brand = el('div', 'desk-brand');
  brand.appendChild(icon('wallet', { size: 54, className: 'desk-brand-mark' }));
  const text = el('div');
  const name = el('div', 'desk-name');
  name.textContent = 'TouchMoney ';
  const cn = el('span', 'desk-name-cn');
  cn.textContent = '触钱';
  name.appendChild(cn);
  const tagline = el('p', 'desk-tagline');
  tagline.innerHTML = '让每一笔消费，都被<b>真正</b>感受到。钱包里装着的是真实面额的纸币。';
  text.append(name, tagline);
  brand.appendChild(text);

  const wrap = el('div', 'desk-notes-wrap');
  wrap.innerHTML = '<svg class="desk-notes" viewBox="0 0 340 150" role="img" '
    + 'aria-label="三张不同颜色的纸币扇形排开，旁边一枚硬币">'
    + '<g transform="translate(96 118) rotate(-16)">'
    + '<rect x="-74" y="-52" width="148" height="74" rx="9" fill="var(--note-teal)" stroke="#4f888f" stroke-width="1.6"/>'
    + '<circle cx="-34" cy="-15" r="16" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>'
    + '<text x="-34" y="-9" text-anchor="middle" font-size="15" font-weight="700" fill="#2f5d63">50</text>'
    + '<rect x="6" y="-27" width="58" height="7" rx="3.5" fill="#ffffff" fill-opacity=".4"/>'
    + '<rect x="6" y="-13" width="40" height="7" rx="3.5" fill="#ffffff" fill-opacity=".26"/></g>'
    + '<g transform="translate(170 108) rotate(-4)">'
    + '<rect x="-74" y="-52" width="148" height="74" rx="9" fill="var(--note-gold)" stroke="#a8813f" stroke-width="1.6"/>'
    + '<circle cx="-34" cy="-15" r="16" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>'
    + '<text x="-34" y="-9" text-anchor="middle" font-size="15" font-weight="700" fill="#7d5f28">20</text>'
    + '<rect x="6" y="-27" width="58" height="7" rx="3.5" fill="#ffffff" fill-opacity=".4"/>'
    + '<rect x="6" y="-13" width="40" height="7" rx="3.5" fill="#ffffff" fill-opacity=".26"/></g>'
    + '<g transform="translate(246 100) rotate(9)">'
    + '<rect x="-74" y="-52" width="148" height="74" rx="9" fill="var(--note-red)" stroke="#b0483d" stroke-width="1.6"/>'
    + '<circle cx="-34" cy="-15" r="16" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>'
    + '<text x="-34" y="-9" text-anchor="middle" font-size="15" font-weight="700" fill="#8c3e2c">100</text>'
    + '<rect x="6" y="-27" width="58" height="7" rx="3.5" fill="#ffffff" fill-opacity=".4"/>'
    + '<rect x="6" y="-13" width="40" height="7" rx="3.5" fill="#ffffff" fill-opacity=".26"/></g>'
    + '<circle cx="40" cy="124" r="17" fill="#cf9f6b" stroke="#9c6f42" stroke-width="1.6"/>'
    + '<text x="40" y="129" text-anchor="middle" font-size="13" font-weight="700" fill="#6b4a26">5</text>'
    + '</svg>';
  band.append(brand, wrap);

  const pills = el('div', 'desk-pills');
  for (const label of ['虚拟现金钱包', '消费感知', '生活费管理', '理性消费']) {
    const pill = el('span', 'desk-pill');
    pill.textContent = label;
    pills.appendChild(pill);
  }
  band.appendChild(pills);
  return band;
}

/** 宽屏时框子下方的五张介绍卡。 */
function deskFoot() {
  const cards = [
    ['wallet', '虚拟现金钱包', '余额就是钱包里的钞票：花一笔抽一张，找零换小面额，再重新塞回去。'],
    ['note', '消费感知', '记下来之前先看清消费前后的余额和钱包的样子，确认了才算数。'],
    ['chart', '数据统计', '分类占比、七天趋势、预算使用率，全部来自你自己的真实记录。'],
    ['heart', '理性消费', '想买的先写进愿望清单，可选 24 小时冷静期；标记购买不会自动扣钱。'],
    ['shield', '隐私安全', '数据只存在这台设备的浏览器里，不自动上传，也不要账号。'],
  ];
  const foot = el('div', 'desk-foot');
  for (const item of cards) {
    const card = el('div', 'desk-card');
    card.appendChild(icon(item[0], { size: 24 }));
    const h = el('h3');
    h.textContent = item[1];
    const p = el('p');
    p.textContent = item[2];
    card.append(h, p);
    foot.appendChild(card);
  }
  return foot;
}

function renderShell() {
  const mount = document.getElementById('app');
  if (!mount) return false;
  mount.innerHTML = '';

  app.frame = el('div', 'app-frame');
  app.frame.appendChild(phoneStatus());

  const top = el('header', 'app-top');
  const left = el('div', 'top-slot');
  app.topBack = topButton('arrowRight', '返回上一页', () => {
    navigate(routeById(app.route).back || 'wallet');
  });
  // arrowRight 是唯一可用的箭头图标，翻过来当返回键
  app.topBack.querySelector('svg').style.transform = 'rotate(180deg)';
  app.topBack.hidden = true;
  left.appendChild(app.topBack);

  app.topTitle = el('h1', 'top-title');
  app.topSub = el('span', 'top-title-sub');
  app.topTitle.appendChild(app.topSub);

  app.topActions = el('div', 'top-slot top-slot-right');
  top.append(left, app.topTitle, app.topActions);

  app.screen = el('main', 'phone-screen');
  app.screen.id = 'main';
  app.screen.tabIndex = -1;
  app.noticesHost = el('div', 'notices');
  app.noticesHost.id = 'notices';
  app.noticesHost.setAttribute('role', 'status');
  app.noticesHost.setAttribute('aria-live', 'polite');
  app.viewHost = el('div', 'view');
  app.viewHost.style.display = 'contents';
  app.screen.append(app.noticesHost, app.viewHost);

  app.tabbar = el('nav', 'tabbar');
  app.tabbar.setAttribute('aria-label', '主导航');

  app.frame.append(top, app.screen, app.tabbar);

  // 轻提示 / 模态框 / 消费成功覆盖层都搬进手机页内部：它们绝对定位时只盖住手机页
  for (const id of ['toast-root', 'modal-root', 'cash-overlay-root']) {
    let host = document.getElementById(id);
    if (!host) host = el('div');
    host.id = id;
    app.frame.appendChild(host);
  }

  if (window.matchMedia('(min-width: 1000px)').matches) {
    mount.appendChild(deskBand());
    mount.appendChild(app.frame);
    mount.appendChild(deskFoot());
  } else {
    mount.appendChild(app.frame);
  }
  return true;
}

/* ---------------- 标题栏与标签栏 ---------------- */

function renderTabs() {
  const activeId = tabIdFor(app.route);
  app.tabbar.innerHTML = '';
  for (const id of TAB_IDS) {
    const route = routeById(id);
    const active = id === activeId;
    const btn = el('button', 'tab-btn');
    btn.type = 'button';
    if (active) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'page');
    }
    btn.appendChild(icon(route.icon, { size: 22, filled: active, strokeWidth: active ? 2.1 : 1.7 }));
    const label = el('span');
    label.textContent = route.tab || route.title;
    btn.appendChild(label);
    btn.addEventListener('click', () => navigate(id));
    app.tabbar.appendChild(btn);
  }
}

/**
 * 视图在渲染时可以给自己放一个标题栏右侧按钮（例如记录页的搜索）。
 * 每次重画都会先清掉，所以视图不用自己记得清。
 */
function setHeaderAction(opts) {
  app.headerAction = opts || null;
}

function applyHeaderAction() {
  if (!app.topActions) return;
  app.topActions.innerHTML = '';
  if (app.route === 'wallet') {
    const bell = topButton('bell', '查看提示', openNoticesMenu);
    const badge = el('span', 'bell-badge');
    badge.hidden = true;
    bell.appendChild(badge);
    app.bellBtn = bell;
    app.topActions.appendChild(bell);
    syncBell();
    return;
  }
  app.bellBtn = null;
  const action = app.headerAction;
  if (!action) return;
  const btn = topButton(action.icon, action.label, action.onClick);
  if (action.text) {
    btn.classList.add('is-pill');
    const label = el('span');
    label.textContent = action.text;
    btn.appendChild(label);
  }
  app.topActions.appendChild(btn);
}

function syncBell() {
  if (!app.bellBtn) return;
  const badge = app.bellBtn.querySelector('.bell-badge');
  if (!badge) return;
  const count = getNotices().length;
  if (count === 0) {
    badge.hidden = true;
    app.bellBtn.setAttribute('aria-label', '查看提示');
    return;
  }
  badge.hidden = false;
  badge.textContent = count > 9 ? '9+' : String(count);
  app.bellBtn.setAttribute('aria-label', `查看提示（${count} 条）`);
}

function renderTopBar(route) {
  // textContent 会清掉标题里的子节点，所以挂完文本再把副标题接回去
  app.topTitle.textContent = route.title;
  app.topTitle.appendChild(app.topSub);
  app.topSub.textContent = route.sub || '';
  app.topSub.hidden = !route.sub;
  app.topBack.hidden = !route.back;
  if (route.back) {
    const label = `返回${routeById(route.back).title}`;
    app.topBack.setAttribute('aria-label', label);
    app.topBack.title = label;
  }
}

/* ---------------- 提示条 ---------------- */

function renderNotices() {
  if (!app.noticesHost) return;
  const notices = getNotices();
  app.noticesHost.innerHTML = '';
  for (const notice of notices) {
    const level = notice.level === 'error' ? 'error' : notice.level === 'warn' ? 'warn' : 'info';
    const row = el('div', `notice notice-${level}`);
    const text = el('p', 'notice-text');
    text.textContent = notice.text;
    const close = el('button', 'notice-close');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭这条提示');
    close.textContent = '×';
    close.addEventListener('click', () => dismissNotice(notice.id));
    row.append(text, close);
    app.noticesHost.appendChild(row);
  }
  syncBell();
}

function openNoticesMenu() {
  const notices = getNotices();
  const body = el('div');
  if (notices.length === 0) {
    const p = el('p', 'muted-note');
    p.textContent = '现在没有需要提醒你的事。消费跨过你设的预算阈值时，提示会出现在这里。';
    body.appendChild(p);
  } else {
    const list = el('div', 'row-list');
    for (const notice of notices) {
      const row = el('div', 'row-item');
      row.style.gridTemplateColumns = 'minmax(0, 1fr) auto';
      const main = el('div', 'row-main');
      const title = el('p', 'row-title');
      title.style.whiteSpace = 'normal';
      title.textContent = notice.text;
      main.appendChild(title);
      const close = el('button', 'btn btn-ghost');
      close.type = 'button';
      close.textContent = '关闭';
      close.addEventListener('click', () => dismissNotice(notice.id));
      row.append(main, close);
      list.appendChild(row);
    }
    body.appendChild(list);
  }
  const buttons = [{ text: '知道了', kind: 'ghost', onClick: (handle) => handle.close('close') }];
  if (notices.length > 0) {
    buttons.unshift({ text: '全部关闭', kind: 'plain', onClick: () => clearNotices() });
  }
  openModal({
    title: '提示',
    sub: '这里只放和你的生活费、预算有关的提醒。',
    body,
    buttons,
  });
}

/* ---------------- 渲染与导航 ---------------- */

function buildCtx() {
  return {
    navigate,
    refresh,
    setHeaderAction,
    getState,
    getBudgetView,
    getStatsView,
    getRecordById,
    getWishById,
    sortedRecords,
    sortedWishlist,
    coolingRemainingMs,
    isConfigured: isConfiguredFlag,
    isStorageAvailable: isStorageAvailableFlag,
    prefersReducedMotion,
    categoryLabel,
    humanDate,
    humanPeriod,
    currentPeriodKey,
    todayKey,
    formatAmount,
    formatCents,
    actions,
    toast,
    toastSuccess,
    toastError,
    toastWarn,
    openModal,
    confirmDialog,
    openRecordDetail: (id) => openRecordDetail(id, buildCtx()),
    openRecordConfirm: (opts) => openRecordConfirm(opts, buildCtx()),
    STORAGE_KEY,
    APP_NAME,
    APP_LABEL,
  };
}

function renderView() {
  const route = routeById(app.route);
  app.headerAction = null;

  // 换掉整个视图容器：旧节点连同里面的钱包一起丢掉，不给残留监听留机会
  const content = el('div', 'view');
  content.style.display = 'contents';
  app.viewHost.replaceWith(content);
  app.viewHost = content;
  app.screen.appendChild(content);

  try {
    route.render(content, buildCtx());
  } catch (err) {
    console.error(err);
    const box = el('div', 'form-error');
    box.removeAttribute('hidden');
    box.textContent = '这个页面没能渲染出来。刷新页面通常就好；数据不会因此丢失。';
    content.appendChild(box);
  }

  renderTopBar(route);
  applyHeaderAction();
  renderTabs();
  document.title = `${route.title} · TouchMoney 触钱`;
}

function refresh() {
  if (!app.booted) return;
  renderView();
  renderNotices();
}

function navigate(id, opts = {}) {
  const route = routeById(id);
  closeAllModals('route');
  app.route = route.id;
  const target = `#${route.id}`;
  if (window.location.hash !== target) {
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', target);
    } else {
      window.location.hash = target;
    }
  }
  renderView();
  renderNotices();
  if (!opts.keepScroll) {
    app.screen.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
  try {
    app.screen.focus({ preventScroll: true });
  } catch {
    app.screen.focus();
  }
}

/** 系统「减少动态效果」偏好：滚动和动画都要照它来。 */
function reducedMotion() {
  return prefersReducedMotion();
}

/** 写操作成功后统一刷新：视图不用自己记得重画。 */
function afterChange(result) {
  if (result && result.ok) {
    refresh();
  }
  return result;
}

const actions = {
  addRecord: (draft) => afterChange(addRecord(draft)),
  updateRecord: (id, patch) => afterChange(updateRecord(id, patch)),
  deleteRecord: (id) => afterChange(deleteRecord(id)),
  addWishItem: (draft) => afterChange(addWishItem(draft)),
  updateWishItem: (id, patch) => afterChange(updateWishItem(id, patch)),
  deleteWishItem: (id) => afterChange(deleteWishItem(id)),
  markWishPurchased: (id) => afterChange(markWishPurchased(id)),
  recordWishPurchase: (id, cents, category) => afterChange(recordWishPurchase(id, cents, category)),
  setMonthlyFee: (cents) => afterChange(setMonthlyFee(cents)),
  setCycleDay: (day) => afterChange(setCycleDay(day)),
  setCarryOver: (on) => afterChange(setCarryOver(on)),
  setReminderPercent: (n) => afterChange(setReminderPercent(n)),
  setWishCoolingDefault: (on) => afterChange(setWishCoolingDefault(on)),
  importJsonText: (text, mode) => afterChange(importJsonText(text, mode)),
  clearAllData: () => afterChange(clearAllData()),
  loadDemoData: () => afterChange(loadDemoData()),
  previewImport: (text, mode) => previewImport(text, mode),
  exportJsonText: () => exportJsonText(),
  getFeePreview: (cents) => getFeePreview(cents),
};

/* ---------------- 启动 ---------------- */

function boot() {
  const mount = document.getElementById('app');
  if (!mount) return;
  if (!renderShell()) {
    const box = document.querySelector('.boot-error');
    if (box) box.hidden = false;
    return;
  }

  initState();
  // 启动时按当前 hash 决定视图：支持深链接与刷新后停在原页面
  app.route = routeFromHash();
  app.booted = true;

  // 跳转链接：本应用用 hash 路由，直接让 #main 进 hash 会被当成非法路由，
  // 所以拦掉默认行为，只用键盘把焦点移到内容区。
  const skip = document.querySelector('.skip-link');
  if (skip) {
    skip.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        app.screen.focus({ preventScroll: true });
      } catch {
        app.screen.focus();
      }
    });
  }

  window.addEventListener('error', (event) => {
    console.error(event.error || event.message);
    toastError('页面出现一个意外错误，已继续运行；可以刷新页面重试。');
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
  });

  subscribe(renderNotices);

  window.addEventListener('hashchange', () => {
    const next = routeFromHash();
    if (next === app.route) return;
    closeAllModals('route');
    app.route = next;
    renderView();
    renderNotices();
    app.screen.scrollTo({ top: 0, behavior: 'auto' });
  });
  window.addEventListener('popstate', () => {
    const next = routeFromHash();
    if (next === app.route) return;
    app.route = next;
    renderView();
    renderNotices();
  });

  renderView();
  renderNotices();
  console.info(`TouchMoney 触钱已启动 · 数据键 ${STORAGE_KEY} · 手机形态（窄屏全出血，宽屏居中设备框）`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { navigate, refresh, boot, actions, ROUTES };
