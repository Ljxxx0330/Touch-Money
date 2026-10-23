/**
 * settings-view.js —— 手机页的「我的」。
 * 头像行整行点进钱包；下面每一行都是一个真入口（生活费设置、预算提醒、导出、导入、
 * 示例数据、清空、关于），没有摆着好看的假按钮。
 *
 * 数据全部留在本机 LocalStorage，默认不上传、不请求网络、不接触支付凭证。
 * 导入一定先预检再确认，预检本身不写库；清空要两次确认。
 */

import { todayKey, humanPeriod, stampForFilename, currentPeriodKey } from '../core/dates.js';
import { formatAmount, formatCents } from '../core/money.js';
import { card, linkButton, detailCell } from '../ui/common.js';
import { button, selectField } from '../ui/form.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { icon } from '../ui/icons.js';

/** 与 README / TASKS 里的版本保持一致 */
const APP_VERSION = '1.3.0';

/** 小工具：建元素 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * 设置行：左标题 + 说明，右边是操作。
 * opts.stack = 按钮竖排：两个按钮并排在 430px 的手机页里会把左边的说明挤没。
 */
function setRow(title, desc, actions, opts = {}) {
  const row = el('div', 'set-row');
  const info = el('div');
  info.appendChild(el('h3', null, title));
  if (desc) info.appendChild(el('p', null, desc));
  row.appendChild(info);
  const host = el('div', 'set-actions');
  if (opts.stack) {
    host.style.flexDirection = 'column';
    host.style.alignItems = 'stretch';
  }
  for (const node of actions) host.appendChild(node);
  row.appendChild(host);
  return row;
}

/** 带图标的列表项（隐私说明用） */
function listItem(text, iconName) {
  const li = el('li');
  li.appendChild(icon(iconName || 'shield', { size: 16 }));
  li.appendChild(el('span', null, text));
  return li;
}

/** 导入失败：说清楚原因，并且当场说明数据有没有被动过 */
function showImportError(message) {
  openModal({
    title: '导入失败',
    body: el('p', 'confirm-message', `${message}\n当前数据没有被改动。`),
    buttons: [{ text: '知道了', kind: 'primary', onClick: (h) => h.close('button') }],
  });
}

/** 关于 TouchMoney：整屏，内容就是原来那张「关于」卡片 */
function openAbout(ctx) {
  const body = el('div');
  const head = el('div', 'about-head');
  const mark = el('div', 'about-mark');
  mark.appendChild(icon('wallet', { size: 26 }));
  head.appendChild(mark);
  const meta = el('div');
  meta.appendChild(el('div', 'about-name', `${ctx.APP_LABEL || '触钱'} · TouchMoney`));
  meta.appendChild(el('div', 'about-ver', `v${APP_VERSION} · 数据格式 v1 · ${todayKey()}`));
  head.appendChild(meta);
  body.appendChild(head);

  body.appendChild(el('p', 'field-hint',
    '个人开发的消费感知工具原型。口号是「让每一笔消费，都被真正感受到」——让数字重新拥有重量：钱包里装着真实面额的纸币，花掉一笔，就有一张被抽走、该找零的找零。'));
  body.appendChild(el('p', 'detail-note',
    '技术栈：原生 HTML5 + CSS3 + JavaScript（ES Modules）+ LocalStorage + 原创 SVG/CSS 纸币与钱包图形。无框架、无第三方依赖、无需构建步骤。'));
  body.appendChild(el('p', 'detail-note',
    `存储键名 ${ctx.STORAGE_KEY || 'touchmoney.v1'}；读到的数据格式不对时会先备份再空白启动，不会崩溃。`));
  body.appendChild(el('p', 'detail-note',
    '钱包里的纸币是虚拟视觉表现，不代表真实货币，也不代表任何银行、支付产品或人民币图样。'));

  openModal({
    title: '关于 TouchMoney',
    sub: `v${APP_VERSION}`,
    body,
    buttons: [{ text: '关闭', kind: 'ghost', onClick: (h) => h.close('button') }],
  });
}

/** 导入数据：选文件 → 预检 → 看清会发生什么 → 才写入 */
function openImport(ctx) {
  const fileInput = el('input', 'file-input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  const fileCell = el('label', 'field');
  fileCell.append(el('span', 'field-label', '选择 JSON 文件'), fileInput);

  const modeSelect = selectField({
    label: '导入方式',
    value: 'merge',
    options: [
      { value: 'merge', label: '合并到现有数据（重复的记录会跳过）' },
      { value: 'replace', label: '替换现有数据（先清空，再写入文件内容）' },
    ],
    hint: '不确定时选「合并」，它不会动你已有的记录。',
  });

  const body = el('div');
  body.appendChild(fileCell);
  body.appendChild(modeSelect.wrap);
  body.appendChild(el('p', 'field-hint', '导入不会自动上传任何东西；文件也只在你选择时才会被读取。'));

  let pendingText = '';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    pendingText = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingText = String(reader.result == null ? '' : reader.result);
      if (!pendingText) ctx.toastWarn('这个文件是空的');
    };
    reader.onerror = () => {
      pendingText = '';
      fileInput.value = '';
      ctx.toastError('文件读取失败');
    };
    reader.readAsText(file, 'utf-8');
  });

  async function runImport(handle) {
    if (!pendingText) { ctx.toastWarn('先选一个 JSON 文件'); return; }
    const mode = modeSelect.select.value === 'replace' ? 'replace' : 'merge';
    const preview = ctx.actions.previewImport(pendingText, mode);
    if (!preview || !preview.ok) {
      showImportError((preview && preview.error) || '无法解析这个文件。');
      return;
    }
    const c = preview.counts;
    const lines = [];
    lines.push(`文件里共有 ${preview.stats.foundRecords} 笔消费、${preview.stats.foundWishlist} 条愿望。`);
    lines.push(`将新增：消费 ${c.records} 笔 · 愿望 ${c.wishlist} 条`);
    if (mode === 'merge') lines.push(`重复跳过：消费 ${c.skippedRecords} 笔 · 愿望 ${c.skippedWishlist} 条`);
    else lines.push('替换模式：现有数据会被文件内容覆盖。');
    if (preview.notes && preview.notes.length) lines.push(`清洗提示：${preview.notes.join('；')}`);
    lines.push(`导入方式：${mode === 'replace' ? '替换现有数据' : '合并到现有数据'}`);

    const ok = await confirmDialog({
      title: '确认导入',
      message: lines[0],
      detail: lines.slice(1).join('\n'),
      confirmText: '确认导入',
      cancelText: '取消',
    });
    if (!ok) return;

    const res = ctx.actions.importJsonText(pendingText, mode);
    if (!res || !res.ok) {
      showImportError((res && res.error) || '导入失败。');
      return;
    }
    ctx.toastSuccess(`导入完成：新增消费 ${res.counts.records} 笔、愿望 ${res.counts.wishlist} 条`);
    pendingText = '';
    fileInput.value = '';
    handle.close('imported');
  }

  openModal({
    title: '导入数据',
    sub: '先检查文件、给你看清会发生什么，再决定要不要写入。预检不会改动任何数据。',
    body,
    buttons: [
      { text: '关闭', kind: 'ghost', onClick: (h) => h.close('cancel') },
      { text: '检查并导入', kind: 'primary', icon: 'upload', onClick: (h) => { runImport(h); } },
    ],
  });
}

export function renderSettingsView(content, ctx) {
  const state = ctx.getState();
  const settings = state.settings;
  const view = ctx.getBudgetView();
  const pk = currentPeriodKey(settings.cycleDay);

  /* ---------------- 头像行：整行点进去就是钱包 ---------------- */
  const meCard = card({ headingLevel: 3 });
  const go = el('button', 'me-card');
  go.type = 'button';
  go.setAttribute('aria-label', '进入我的钱包');
  const avatar = el('div', 'me-avatar');
  avatar.appendChild(icon('wallet', { size: 22 }));
  go.appendChild(avatar);
  const who = el('div');
  who.style.minWidth = '0';
  who.appendChild(el('div', 'me-name', '我的钱包'));
  who.appendChild(el('div', 'me-sub', ctx.isConfigured()
    ? `余额 ${formatCents(view.balanceCents)} 元 · 当前周期 ${pk} · ${state.records.length} 笔消费 · ${state.wishlist.length} 条愿望`
    : '还没设定生活费 · 点进去写一个数'));
  go.appendChild(who);
  const chev = el('span', 'me-go');
  chev.appendChild(icon('arrowRight', { size: 18 }));
  go.appendChild(chev);
  go.addEventListener('click', () => ctx.navigate('wallet'));
  meCard.body.appendChild(go);
  content.appendChild(meCard.section);

  /* ---------------- 生活费与预算摘要 ---------------- */
  const feeCard = card({
    title: '生活费与预算',
    sub: '这里只改数字，不改你的消费记录。',
    action: linkButton('去调整', () => ctx.navigate('budget')),
  });
  if (!ctx.isConfigured()) {
    feeCard.body.appendChild(el('p', 'field-hint', '还没有设定生活费。设好之后，这里会显示本月预算与余额。'));
  } else {
    const list = el('dl', 'detail-list');
    list.appendChild(detailCell('本月初始生活费', `${formatAmount(view.monthlyFeeCents)} 元`, 'fee'));
    list.appendChild(detailCell('本月累计消费', `${formatAmount(view.monthSpentCents)} 元`, 'spent'));
    list.appendChild(detailCell('本月剩余预算', `${formatAmount(view.remainingCents)} 元`, 'left'));
    list.appendChild(detailCell('当前可支配余额', `${formatAmount(view.balanceCents)} 元`, 'balance'));
    feeCard.body.appendChild(list);
    feeCard.body.appendChild(el('p', 'detail-note',
      `预算周期：${humanPeriod(view.periodStart, view.cycleDay)} · 当前周期 ${pk} · `
      + (view.carryOver ? '开启结余结转' : '关闭结余结转')
      + ` · 提醒阈值 ${settings.reminderPercent ? `${settings.reminderPercent}%` : '未设'}`));
  }
  content.appendChild(feeCard.section);

  /* ---------------- 设置列表：每行一个真入口 ---------------- */
  const dataCard = card({ title: '设置', sub: '导出、导入、示例、清空、关于。每一步都写清楚会发生什么。' });
  const setList = el('div', 'set-list');

  setList.appendChild(setRow('生活费设置', ctx.isConfigured()
    ? `本月初始 ${formatAmount(view.monthlyFeeCents)} 元 · 每月 ${settings.cycleDay} 日换周期 · ${view.carryOver ? '结余结转开' : '结余结转关'}`
    : '还没设定本月生活费。写一个数，之后每笔消费都从它里面扣。',
    [linkButton('去调整', () => ctx.navigate('budget'))]));

  setList.appendChild(setRow('预算提醒', settings.reminderPercent
    ? `花到 ${settings.reminderPercent}% 时提醒你 · 改数字也在「生活费与预算」那一页`
    : '没设提醒阈值。设一条线，花到那儿这里就会出现提示。',
    [linkButton('去调整', () => ctx.navigate('budget'))]));

  const dlBtn = button('下载 JSON 文件', { kind: 'ghost', icon: 'download' });
  const clipBtn = button('复制到剪贴板', { kind: 'ghost', icon: 'note' });
  dlBtn.addEventListener('click', () => {
    const text = ctx.actions.exportJsonText();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `touchmoney-${stampForFilename()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ctx.toastSuccess(`已导出 ${state.records.length} 笔消费与 ${state.wishlist.length} 条愿望`);
  });
  clipBtn.addEventListener('click', async () => {
    const text = ctx.actions.exportJsonText();
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard api');
      await navigator.clipboard.writeText(text);
      ctx.toastSuccess('导出内容已复制到剪贴板');
    } catch {
      // 复制失败不吞掉数据：给一个可全选复制的文本框。
      const box = el('textarea', 'export-text');
      box.readOnly = true;
      box.value = text;
      openModal({
        title: '复制这段 JSON',
        body: box,
        buttons: [{ text: '关闭', kind: 'ghost', onClick: (h) => h.close('button') }],
      });
      box.focus();
      box.select();
      ctx.toastWarn('浏览器不允许直接写入剪贴板，已给你选好内容，按 Ctrl+C 复制。');
    }
  });
  setList.appendChild(setRow('数据导出',
    '导出为 JSON 文本文件，里面是全部设置、消费记录与愿望清单。换电脑时用它把数据带走。',
    [dlBtn, clipBtn], { stack: true }));

  setList.appendChild(setRow('数据导入',
    '先检查文件、给你看清会发生什么，再决定要不要写入。预检不会改动任何数据。',
    [linkButton('选择文件', () => openImport(ctx))]));

  const demoBtn = button('载入示例数据', { kind: 'ghost', icon: 'coin' });
  demoBtn.addEventListener('click', () => {
    const res = ctx.actions.loadDemoData();
    if (res && res.ok) ctx.toastSuccess('已载入示例数据，可以去各个页面看看效果');
    else ctx.toastError((res && res.error) || '载入失败');
  });
  setList.appendChild(setRow('载入示例数据',
    '用一套演示用的生活费、消费记录与愿望覆盖当前数据，想快速看看效果时用。',
    [demoBtn]));

  const clearBtn = button('清空所有数据', { kind: 'danger', icon: 'trash' });
  clearBtn.addEventListener('click', async () => {
    const first = await confirmDialog({
      title: '清空全部数据？',
      message: `将删除 ${state.records.length} 笔消费记录与 ${state.wishlist.length} 条愿望，以及生活费设置。`,
      detail: '此操作不可撤销。建议先导出 JSON 备份。',
      confirmText: '继续',
      cancelText: '取消',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: '再确认一次：真的要清空吗？',
      message: '清空后页面会回到首次打开时的状态。',
      detail: '数据只存在这台设备的浏览器里，删掉就没有别的地方能找回。',
      confirmText: '确认清空',
      cancelText: '保留数据',
      danger: true,
    });
    if (!second) return;
    const res = ctx.actions.clearAllData();
    if (res && res.ok) ctx.toastSuccess('已清空全部数据');
    else ctx.toastError((res && res.error) || '清空失败');
  });
  setList.appendChild(setRow('清空所有数据',
    '删除本机全部记录与设置，需要两次确认。',
    [clearBtn]));

  setList.appendChild(setRow('关于 TouchMoney',
    `v${APP_VERSION} · 数据格式 v1 · 本机浏览器 · ${todayKey()}`,
    [linkButton('查看', () => openAbout(ctx))]));

  dataCard.body.appendChild(setList);
  content.appendChild(dataCard.section);

  /* ---------------- 本地存储 ---------------- */
  const storeCard = card({ title: '本地存储' });
  if (!ctx.isStorageAvailable()) {
    storeCard.body.appendChild(el('p', 'field-hint', '这个浏览器环境不允许本地存储（例如无痕窗口）。你仍然可以用，但刷新后数据不会保留。'));
  } else {
    let bytes = 0;
    try { bytes = new Blob([JSON.stringify(state)]).size; } catch { bytes = 0; }
    const list = el('dl', 'detail-list');
    list.appendChild(detailCell('存储位置', '本机浏览器 LocalStorage', '', `键名 ${ctx.STORAGE_KEY || 'touchmoney.v1'}`));
    list.appendChild(detailCell('占用空间', `约 ${(bytes / 1024).toFixed(1)} KB`, '', '上限由浏览器决定，通常 5MB 左右'));
    list.appendChild(detailCell('数据量', `${state.records.length} 笔消费 · ${state.wishlist.length} 条愿望`, '', `当前周期 ${pk}`));
    storeCard.body.appendChild(list);
  }
  content.appendChild(storeCard.section);

  /* ---------------- 隐私说明 ---------------- */
  const privacyCard = card({ title: '隐私说明' });
  const ul = el('ul', 'privacy-list');
  [
    '所有数据只保存在这台设备的浏览器里，默认不上传，也没有任何网络请求。',
    '不收集支付密码、银行卡密码、微信支付凭证，也不连接任何支付系统。',
    '金额以整数分保存，日期按本地时区计算，避免时区带来的统计偏差。',
    '导出文件是纯文本 JSON，里面是你自己填的内容，你可以随时删除它。',
    '这是一个消费感知工具，不是银行或支付软件，不会替你做决定，也不评判你的消费。',
  ].forEach((text) => ul.appendChild(listItem(text)));
  privacyCard.body.appendChild(ul);
  content.appendChild(privacyCard.section);
}
