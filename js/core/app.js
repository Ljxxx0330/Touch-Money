/**
 * app.js —— 应用外壳：路由、顶部品牌与日期、底部导航、提示条、全局错误兜底。
 * 路由用 hash，刷新后仍停在原页面；所有导航都真实可点、可后退。
 */

import * as state from './state.js';
import { APP_LABEL, APP_NAME, STORAGE_KEY } from './storage.js';
import { humanDate, todayKey } from './dates.js';
import { formatAmount } from './money.js';
import { closeAllModals, openModal } from '../ui/modal.js';
import { toast, toastError, toastSuccess, toastWarn } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { categoryLabel } from '../core/budget.js';
import { renderWalletView } from '../views/wallet-view.js';
import { renderAddView } from '../views/add-view.js';
import { renderStatsView } from '../views/stats-view.js';
import { renderRecordsView, openRecordDetail } from '../views/records-view.js';
import { renderWishlistView } from '../views/wishlist-view.js';
import { renderBudgetView } from '../views/budget-view.js';
import { renderSettingsView } from '../views/settings-view.js';

const ROUTES = [
  { id: 'wallet', label: '钱包', icon: 'wallet', render: renderWalletView },
  { id: 'add', label: '记一笔', icon: 'pencil', render: renderAddView },
  { id: 'stats', label: '统计', icon: 'chart', render: renderStatsView },
  { id: 'records', label: '记录', icon: 'list', render: renderRecordsView },
  { id: 'wishlist', label: '愿望', icon: 'heart', render: renderWishlistView },
  { id: 'budget', label: '生活费', icon: 'coin', render: renderBudgetView },
  { id: 'settings', label: '设置', icon: 'gear', render: renderSettingsView },
];

const app = {
  route: 'wallet',
  shell: null,
  main: null,
  noticesHost: null,
  nav: null,
  dateEl: null,
  viewHandle: null,
  booted: false,
};

/** 包一层：任何写操作之后刷新当前视图，保证界面与数据一致。 */
function buildActions() {
  const wrap = (fn) => (...args) => {
    const res = fn(...args);
    refresh();
    return res;
  };
  return {
    addRecord: wrap(state.addRecord),
    updateRecord: wrap(state.updateRecord),
    deleteRecord: wrap(state.deleteRecord),
    addWishItem: wrap(state.addWishItem),
    updateWishItem: wrap(state.updateWishItem),
    deleteWishItem: wrap(state.deleteWishItem),
    markWishPurchased: wrap(state.markWishPurchased),
    recordWishPurchase: wrap(state.recordWishPurchase),
    setMonthlyFee: wrap(state.setMonthlyFee),
    setCycleDay: wrap(state.setCycleDay),
    setCarryOver: wrap(state.setCarryOver),
    setReminderPercent: wrap(state.setReminderPercent),
    setWishCoolingDefault: wrap(state.setWishCoolingDefault),
    importJsonText: wrap(state.importJsonText),
    previewImport: state.previewImport,
    clearAllData: wrap(state.clearAllData),
    loadDemoData: wrap(state.loadDemoData),
    exportJsonText: state.exportJsonText,
    getFeePreview: state.getFeePreview,
  };
}

function buildCtx() {
  return {
    navigate,
    refresh,
    getState: state.getState,
    getBudgetView: state.getBudgetView,
    getStatsView: state.getStatsView,
    getRecordById: state.getRecordById,
    getWishById: state.getWishById,
    sortedRecords: state.sortedRecords,
    sortedWishlist: state.sortedWishlist,
    coolingRemainingMs: state.coolingRemainingMs,
    isConfigured: state.isConfiguredFlag,
    isStorageAvailable: state.isStorageAvailableFlag,
    prefersReducedMotion: state.prefersReducedMotion,
    categoryLabel,
    actions: buildActions(),
    toast,
    toastSuccess,
    toastError,
    toastWarn,
    openModal,
    openRecordDetail,
    STORAGE_KEY,
    APP_NAME,
    APP_LABEL,
  };
}

/* ---------------- 外壳 ---------------- */

const NAV_ROUTES = ['wallet', 'add', 'stats', 'records', 'wishlist'];

function renderShell() {
  const shell = document.createElement('div');
  shell.className = 'shell';

  const header = document.createElement('header');
  header.className = 'app-header';

  const brand = document.createElement('div');
  brand.className = 'brand';
  const logo = document.createElement('span');
  logo.className = 'brand-mark';
  logo.setAttribute('aria-hidden', 'true');
  const logoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  logoSvg.setAttribute('viewBox', '0 0 32 32');
  logoSvg.setAttribute('aria-hidden', 'true');
  logoSvg.innerHTML =
    '<rect class="brand-wallet-body" x="3" y="8" width="26" height="18" rx="4"/>' +
    '<path class="brand-wallet-flap" d="M3 12h26"/>' +
    '<circle class="brand-wallet-clasp" cx="22" cy="18" r="3.2"/>';
  logo.appendChild(logoSvg);

  const brandText = document.createElement('span');
  brandText.className = 'brand-text';
  const nameEl = document.createElement('span');
  nameEl.className = 'brand-name';
  nameEl.textContent = APP_NAME;
  const tagEl = document.createElement('span');
  tagEl.className = 'brand-tagline';
  tagEl.textContent = '让每一笔消费，都被真正感受到';
  brandText.appendChild(nameEl);
  brandText.appendChild(tagEl);
  brand.appendChild(logo);
  brand.appendChild(brandText);
  header.appendChild(brand);

  const headerRight = document.createElement('div');
  headerRight.className = 'header-right';
  const dateEl = document.createElement('p');
  dateEl.className = 'app-date';
  dateEl.textContent = humanDate(todayKey());
  headerRight.appendChild(dateEl);
  app.dateEl = dateEl;

  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'icon-btn';
  gear.setAttribute('aria-label', '打开设置菜单');
  gear.title = '设置';
  gear.appendChild(icon('gear', { size: 22 }));
  gear.addEventListener('click', openSettingsMenu);
  headerRight.appendChild(gear);
  header.appendChild(headerRight);

  shell.appendChild(header);

  const main = document.createElement('main');
  main.id = 'main';
  main.className = 'main';
  main.setAttribute('tabindex', '-1');
  shell.appendChild(main);

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', '主导航');
  for (const id of NAV_ROUTES) {
    const route = ROUTES.find((r) => r.id === id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-btn';
    btn.dataset.route = route.id;
    btn.appendChild(icon(route.icon, { size: 22 }));
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = route.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => navigate(route.id));
    nav.appendChild(btn);
  }
  shell.appendChild(nav);

  const noticesHost = document.createElement('div');
  noticesHost.className = 'notices';
  noticesHost.setAttribute('role', 'status');
  noticesHost.setAttribute('aria-live', 'polite');
  main.appendChild(noticesHost);

  return { shell, main, nav, noticesHost };
}

function syncNav() {
  if (!app.nav) return;
  for (const btn of app.nav.querySelectorAll('.nav-btn')) {
    const active = btn.dataset.route === app.route;
    btn.classList.toggle('is-active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function renderNotices() {
  if (!app.noticesHost) return;
  const notices = state.getNotices();
  app.noticesHost.textContent = '';
  for (const n of notices) {
    const el = document.createElement('div');
    el.className = `notice notice-${n.level}`;
    const text = document.createElement('span');
    text.className = 'notice-text';
    text.textContent = n.text;
    el.appendChild(text);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notice-close';
    btn.setAttribute('aria-label', '关闭提示');
    btn.textContent = '×';
    btn.addEventListener('click', () => state.dismissNotice(n.id));
    el.appendChild(btn);
    app.noticesHost.appendChild(el);
  }
}

/* ---------------- 视图渲染 ---------------- */

function renderView() {
  if (!app.main) return;
  const route = ROUTES.find((r) => r.id === app.route) || ROUTES[0];

  // 保留提示条节点，只替换其后的视图内容
  const keep = app.noticesHost;
  while (app.main.firstChild) app.main.removeChild(app.main.firstChild);
  app.main.appendChild(keep);

  if (app.dateEl) app.dateEl.textContent = humanDate(todayKey());

  const container = document.createElement('div');
  container.className = 'view';
  app.main.appendChild(container);

  app.viewHandle = route.render(container, buildCtx()) || null;
  syncNav();
  renderNotices();
}

function refresh() {
  renderView();
}

function navigate(routeId, { replace = false } = {}) {
  const route = ROUTES.find((r) => r.id === routeId) ? routeId : 'wallet';
  closeAllModals('route');
  app.route = route;
  const target = `#${route}`;
  if (window.location.hash !== target) {
    if (replace) window.location.replace(target);
    else window.location.hash = route;
  }
  renderView();
  if (app.main) {
    try {
      app.main.focus({ preventScroll: true });
    } catch {
      /* 老浏览器不支持 preventScroll */
    }
  }
  window.scrollTo({ top: 0, behavior: state.prefersReducedMotion() ? 'auto' : 'smooth' });
}

function routeFromHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
  return ROUTES.some((r) => r.id === raw) ? raw : 'wallet';
}

/* ---------------- 顶部设置菜单 ---------------- */

function openSettingsMenu() {
  const body = document.createElement('div');
  body.className = 'stack';

  const p = document.createElement('p');
  p.className = 'menu-note';
  p.textContent = '这里管理生活费、预算提醒和你的数据。所有数据都只留在这台设备的浏览器里。';
  body.appendChild(p);

  const list = document.createElement('div');
  list.className = 'menu-list';

  const items = [
    { label: '生活费与预算周期', desc: '初始生活费、周期起始日、结余结转、提醒阈值', route: 'budget' },
    { label: '数据与隐私', desc: '导出 JSON、导入、清空、关于本应用', route: 'settings' },
  ];
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    const l = document.createElement('span');
    l.className = 'menu-item-label';
    l.textContent = item.label;
    const d = document.createElement('span');
    d.className = 'menu-item-desc';
    d.textContent = item.desc;
    btn.appendChild(l);
    btn.appendChild(d);
    btn.addEventListener('click', () => {
      openModalHandle.close('nav');
      navigate(item.route);
    });
    list.appendChild(btn);
  }
  body.appendChild(list);

  const demoBtn = document.createElement('button');
  demoBtn.type = 'button';
  demoBtn.className = 'menu-item menu-item-subtle';
  const dl = document.createElement('span');
  dl.className = 'menu-item-label';
  dl.textContent = '载入示例数据';
  const dd = document.createElement('span');
  dd.className = 'menu-item-desc';
  dd.textContent = '写入一组虚构样例，方便先看效果；随时可以在设置里清空';
  demoBtn.appendChild(dl);
  demoBtn.appendChild(dd);
  demoBtn.addEventListener('click', () => {
    openModalHandle.close('demo');
    state.loadDemoData();
    refresh();
  });
  body.appendChild(demoBtn);

  const openModalHandle = openModal({
    title: '设置',
    body,
    buttons: [
      { text: '关闭', kind: 'ghost', onClick: (h) => h.close('close') },
      {
        text: '记一笔',
        kind: 'primary',
        onClick: (h) => {
          h.close('add');
          navigate('add');
        },
      },
    ],
  });
}

/* ---------------- 启动 ---------------- */

export function boot() {
  const mounted = mount();
  if (!mounted) return;

  state.init();

  // 启动时按当前 hash 决定视图：支持深链接与刷新后停在原页面。
  app.route = routeFromHash();

  window.addEventListener('hashchange', () => {
    const next = routeFromHash();
    if (next !== app.route) {
      app.route = next;
      renderView();
    }
  });

  window.addEventListener('error', (e) => {
    console.error('未捕获错误：', e.error || e.message);
    toastError('页面出现一个意外错误，已继续运行；可以刷新页面重试。');
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('未处理的 Promise 异常：', e.reason);
  });

  state.subscribe(() => {
    renderNotices();
  });

  // 跳转链接：本应用用 hash 路由，直接让 #main 进 hash 会被当成非法路由，
  // 所以拦截默认行为，只用键盘把焦点移到主内容区。
  const skip = document.querySelector('.skip-link');
  if (skip && app.main) {
    skip.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        app.main.focus({ preventScroll: true });
      } catch {
        app.main.focus();
      }
    });
  }

  app.booted = true;
  renderView();
  console.info(`${APP_NAME} ${APP_LABEL} 已启动 · 存储键 ${STORAGE_KEY}`);
}

function mount() {
  const root = document.getElementById('app');
  if (!root) {
    const fallback = document.querySelector('.boot-error');
    if (fallback) fallback.hidden = false;
    console.error('找不到 #app 容器，页面未能启动');
    return false;
  }
  const { shell, main, nav, noticesHost } = renderShell();
  root.textContent = '';
  root.appendChild(shell);
  app.shell = shell;
  app.main = main;
  app.nav = nav;
  app.noticesHost = noticesHost;
  return true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
