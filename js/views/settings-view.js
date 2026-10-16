/**
 * settings-view.js —— 设置：生活费入口、预算提醒、数据导出/导入/清空、关于与隐私。
 * 第一版不联网、不上传，所有数据只留在本机 LocalStorage。
 */

import { stampForFilename } from '../core/dates.js';
import { formatAmount } from '../core/money.js';
import { APP_LABEL, APP_NAME, SCHEMA_VERSION, STORAGE_KEY } from '../core/storage.js';
import { card, linkButton, statLine } from '../ui/common.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { button, selectField } from '../ui/form.js';
import { icon } from '../ui/icons.js';

const APP_VERSION = '1.0.0';

export function renderSettingsView(container, ctx) {
  const state = ctx.getState();
  const frag = document.createDocumentFragment();

  /* ---------- 生活费与提醒 ---------- */
  const budgetCard = card({
    title: '生活费与预算',
    action: linkButton('去调整', () => ctx.navigate('budget')),
  });
  const view = ctx.getBudgetView();
  budgetCard.body.appendChild(statLine('本月初始生活费', `¥${formatAmount(view.monthlyFeeCents)}`));
  budgetCard.body.appendChild(statLine('当前可支配余额', `¥${formatAmount(view.balanceCents)}`));
  budgetCard.body.appendChild(
    statLine('预算提醒阈值', state.settings.reminderPercent > 0 ? `${state.settings.reminderPercent}%` : '未开启'),
  );
  budgetCard.body.appendChild(
    statLine('结余结转', state.settings.carryOver !== false ? '已开启（往期结余/透支会滚入本期）' : '已关闭'),
  );
  frag.appendChild(budgetCard.section);

  /* ---------- 本地存储状态 ---------- */
  const storeCard = card({ title: '本地存储' });
  const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
  storeCard.body.appendChild(
    statLine('存储位置', `浏览器 LocalStorage · 键名 ${STORAGE_KEY}`, {
      hint: ctx.isStorageAvailable()
        ? `已占用约 ${(bytes / 1024).toFixed(1)} KB（上限由浏览器决定，通常 5MB 左右）`
        : '当前不可用：可能是浏览器隐私模式，本次改动不会持久化',
    }),
  );
  storeCard.body.appendChild(
    statLine('数据量', `${state.records.length} 笔消费 · ${state.wishlist.length} 条愿望`),
  );
  frag.appendChild(storeCard.section);

  /* ---------- 导出 ---------- */
  const exportCard = card({ title: '导出数据' });
  const exportIntro = document.createElement('p');
  exportIntro.className = 'field-hint';
  exportIntro.textContent = '导出为一个 JSON 文本文件，包含全部设置、消费记录与愿望清单。换电脑或备份时用它。';
  exportCard.body.appendChild(exportIntro);

  const exportRow = document.createElement('div');
  exportRow.className = 'btn-row';
  const downloadBtn = button('下载 JSON 文件', {
    kind: 'primary',
    onClick: () => {
      const text = ctx.actions.exportJsonText();
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `touchmoney-${stampForFilename()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ctx.toastSuccess(`已导出 ${state.records.length} 笔消费与 ${state.wishlist.length} 条愿望`);
    },
  });
  exportRow.appendChild(downloadBtn);

  const copyBtn = button('复制到剪贴板', {
    kind: 'ghost',
    onClick: async () => {
      const text = ctx.actions.exportJsonText();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          ctx.toastSuccess('导出内容已复制到剪贴板');
        } else {
          throw new Error('clipboard unavailable');
        }
      } catch {
        openModal({
          title: '复制导出内容',
          body: (() => {
            const ta = document.createElement('textarea');
            ta.className = 'input textarea export-text';
            ta.rows = 10;
            ta.value = text;
            ta.setAttribute('aria-label', '导出的 JSON 文本');
            ta.focus();
            return ta;
          })(),
          buttons: [{ text: '关闭', kind: 'ghost', onClick: (h) => h.close('close') }],
        });
        ctx.toastWarn('浏览器不允许直接复制，已在窗口里给出文本，请手动复制');
      }
    },
  });
  exportRow.appendChild(copyBtn);
  exportCard.body.appendChild(exportRow);
  frag.appendChild(exportCard.section);

  /* ---------- 导入 ---------- */
  const importCard = card({ title: '导入数据' });
  const importIntro = document.createElement('p');
  importIntro.className = 'field-hint';
  importIntro.textContent =
    '选择之前导出的 JSON 文件。导入前会校验文件结构与数据类型，不合格的内容会被拒绝或清洗，不会让页面崩溃。';
  importCard.body.appendChild(importIntro);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.className = 'input file-input';
  fileInput.id = 'import-file';
  const fileLabel = document.createElement('label');
  fileLabel.className = 'field-label';
  fileLabel.setAttribute('for', 'import-file');
  fileLabel.textContent = '选择 JSON 文件';
  importCard.body.appendChild(fileLabel);
  importCard.body.appendChild(fileInput);

  const modeSelect = selectField({
    label: '导入方式',
    value: 'merge',
    options: [
      { value: 'merge', label: '合并到现有数据（重复的记录会跳过）' },
      { value: 'replace', label: '替换现有数据（先清空，再写入文件内容）' },
    ],
    hint: '不确定时选「合并」，它不会动你已有的记录。',
  });
  importCard.body.appendChild(modeSelect.wrap);

  const importBtn = button('检查并导入', { kind: 'primary', disabled: true });
  importBtn.disabled = true;
  importCard.body.appendChild(importBtn);

  fileInput.addEventListener('change', () => {
    importBtn.disabled = !fileInput.files || fileInput.files.length === 0;
  });

  importBtn.addEventListener('click', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      ctx.toastError('请先选择文件');
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch (err) {
      ctx.toastError('读取文件失败：' + (err && err.message ? err.message : String(err)));
      return;
    }

    // 先做一次「预检」：用当前数据跑一遍导入逻辑，但不落地。
    const preview = ctx.actions.previewImport(text, modeSelect.select.value);
    if (!preview.ok) {
      await confirmDialog({
        title: '导入失败',
        message: preview.error,
        detail: '文件没有被改动，当前数据保持原样。',
        confirmText: '知道了',
        cancelText: '关闭',
      });
      return;
    }

    const counts = preview.counts;
    const detailLines = [
      `将新增：消费 ${counts.records} 笔 · 愿望 ${counts.wishlist} 条`,
      `重复跳过：消费 ${counts.skippedRecords} 笔 · 愿望 ${counts.skippedWishlist} 条`,
      `导入方式：${modeSelect.select.value === 'replace' ? '替换现有数据' : '合并到现有数据'}`,
    ];
    if (preview.notes && preview.notes.length) detailLines.push('清洗提示：' + preview.notes.join('；'));

    const ok = await confirmDialog({
      title: '确认导入',
      message: `文件里共有 ${preview.stats.foundRecords} 笔消费、${preview.stats.foundWishlist} 条愿望。`,
      detail: detailLines.join('\n'),
      confirmText: '确认导入',
      cancelText: '取消',
    });
    if (!ok) return;

    const res = ctx.actions.importJsonText(text, modeSelect.select.value);
    if (!res.ok) {
      ctx.toastError(res.error);
      return;
    }
    ctx.toastSuccess(
      `导入完成：新增消费 ${res.counts.records} 笔、愿望 ${res.counts.wishlist} 条`,
    );
    fileInput.value = '';
    importBtn.disabled = true;
  });
  frag.appendChild(importCard.section);

  /* ---------- 清空 ---------- */
  const clearCard = card({ title: '清空数据' });
  const clearIntro = document.createElement('p');
  clearIntro.className = 'field-hint';
  clearIntro.textContent = '删除本机全部消费记录、愿望清单与生活费设置。清空前请先导出备份。';
  clearCard.body.appendChild(clearIntro);
  const clearRow = document.createElement('div');
  clearRow.className = 'btn-row';
  clearRow.appendChild(
    button('清空全部数据', {
      kind: 'danger',
      onClick: async () => {
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
        if (!res.ok) {
          ctx.toastError(res.error);
          return;
        }
        ctx.toastSuccess('已清空全部数据');
      },
    }),
  );
  clearCard.body.appendChild(clearRow);
  frag.appendChild(clearCard.section);

  /* ---------- 示例数据 ---------- */
  const demoCard = card({ title: '示例数据' });
  const demoIntro = document.createElement('p');
  demoIntro.className = 'field-hint';
  demoIntro.textContent = '载入一组虚构样例，用来先看效果。示例数据不是你的真实消费，随时可以清空。';
  demoCard.body.appendChild(demoIntro);
  const demoRow = document.createElement('div');
  demoRow.className = 'btn-row';
  demoRow.appendChild(
    button('载入示例数据', {
      kind: 'ghost',
      onClick: () => {
        ctx.actions.loadDemoData();
      },
    }),
  );
  demoCard.body.appendChild(demoRow);
  frag.appendChild(demoCard.section);

  /* ---------- 关于与隐私 ---------- */
  const aboutCard = card({ title: '关于' });
  const aboutIcon = icon('coin', { size: 28, className: 'about-icon' });
  aboutCard.body.appendChild(aboutIcon);
  const aboutName = document.createElement('p');
  aboutName.className = 'about-name';
  aboutName.textContent = `${APP_NAME}（${APP_LABEL}）v${APP_VERSION} · 数据格式 v${SCHEMA_VERSION}`;
  aboutCard.body.appendChild(aboutName);
  const aboutText = document.createElement('p');
  aboutText.className = 'about-text';
  aboutText.textContent =
    '一个面向大学生的消费感知工具原型：用虚拟现金与「消费前 → 消费后」的确认，让花钱这个数字重新有重量。它是个人开发的记账原型，不是银行或支付软件，不替你做决定，也不评判你的消费。';
  aboutCard.body.appendChild(aboutText);

  const privacy = document.createElement('ul');
  privacy.className = 'privacy-list';
  for (const line of [
    '所有数据只保存在本机浏览器 LocalStorage，不上传服务器，第一版没有任何网络请求。',
    '不收集支付密码、银行卡密码、微信支付凭证，也不连接任何支付系统。',
    '金额以整数「分」保存，展示时换算成元，避免浮点误差。',
    '日期按本地时区计算，不会因为 UTC 换算把消费跑到上个月或下个月。',
    '导出文件是纯文本 JSON，内容完全由你自己掌控和保管。',
  ]) {
    const li = document.createElement('li');
    li.textContent = line;
    privacy.appendChild(li);
  }
  aboutCard.body.appendChild(privacy);

  const tech = document.createElement('p');
  tech.className = 'muted-note';
  tech.textContent = '技术栈：原生 HTML5 + CSS3 + JavaScript（ES Modules）+ LocalStorage + 原创 SVG/CSS 动画，无框架、无第三方依赖、无需构建。';
  aboutCard.body.appendChild(tech);
  frag.appendChild(aboutCard.section);

  container.appendChild(frag);
  return { focus: () => {} };
}


