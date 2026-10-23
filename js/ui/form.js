/**
 * form.js —— 表单控件工厂：字段、金额输入、分类图标卡、开关、防重复提交。
 * 每个控件自带 setError，校验逻辑留给调用方。
 */

import { icon } from './icons.js';
import { CAT_ICONS } from './common.js';
import { todayKey } from '../core/dates.js';

/**
 * 移动端键盘弹出时，避免输入框被完全遮挡。
 * @param {HTMLElement} input
 */
export function guardInputAgainstKeyboard(input) {
  const reveal = () => {
    const scroll = () => {
      try {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        input.scrollIntoView();
      }
    };
    // 软键盘弹出有动画延迟，稍后再滚一次
    scroll();
    setTimeout(scroll, 420);
  };
  input.addEventListener('focus', reveal);
  input.addEventListener('input', () => {
    if (document.activeElement === input) reveal();
  });
}

/**
 * 普通字段。
 * @param {{label:string, type?:string, value?:string, placeholder?:string, inputmode?:string,
 *   maxlength?:number, required?:boolean, hint?:string, id?:string, autocomplete?:string,
 *   optionalLabel?: string}} opts
 * @returns {{wrap: HTMLElement, input: HTMLElement, label: HTMLElement, setError: (msg: string) => void, clearError: () => void}}
 */
export function field(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = opts.label;
  if (opts.optionalLabel) {
    const opt = document.createElement('span');
    opt.className = 'opt';
    opt.textContent = opts.optionalLabel;
    label.appendChild(opt);
  }
  const id = opts.id || `f${Math.random().toString(36).slice(2, 8)}`;
  label.htmlFor = id;
  wrap.appendChild(label);

  const Tag = opts.type === 'textarea' ? 'textarea' : 'input';
  const input = document.createElement(Tag);
  input.id = id;
  input.className = opts.type === 'textarea' ? 'textarea' : 'input';
  if (opts.type && opts.type !== 'textarea') input.type = opts.type;
  if (opts.value != null) input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.inputmode) input.setAttribute('inputmode', opts.inputmode);
  if (opts.maxlength) input.maxLength = opts.maxlength;
  if (opts.required) input.required = true;
  if (opts.autocomplete) input.setAttribute('autocomplete', opts.autocomplete);
  wrap.appendChild(input);

  const hintId = `${id}-hint`;
  if (opts.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.id = hintId;
    hint.textContent = opts.hint;
    wrap.appendChild(hint);
    input.setAttribute('aria-describedby', hintId);
  }

  const err = document.createElement('p');
  err.className = 'field-error';
  err.hidden = true;
  const errIcon = icon('info', { size: 15 });
  err.appendChild(errIcon);
  const errText = document.createElement('span');
  err.appendChild(errText);
  wrap.appendChild(err);

  const setError = (msg) => {
    errText.textContent = msg;
    err.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  };
  const clearError = () => {
    err.hidden = true;
    errText.textContent = '';
    input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', clearError);
  guardInputAgainstKeyboard(input);
  return { wrap, input, label, setError, clearError };
}

/**
 * 金额输入：大号、带 ¥ 前缀，视觉上是表单的主角。
 * @param {{label?: string, value?: string, hint?: string, id?: string}} [opts]
 * @returns {{wrap: HTMLElement, input: HTMLInputElement, setError: (msg: string) => void, clearError: () => void, getValue: () => string}}
 */
export function moneyField(opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = opts.label || '消费金额';
  const id = opts.id || `m${Math.random().toString(36).slice(2, 8)}`;
  label.htmlFor = id;
  wrap.appendChild(label);

  const box = document.createElement('div');
  box.className = 'money-input';
  const sym = document.createElement('span');
  sym.className = 'money-sym-big';
  sym.textContent = '¥';
  sym.setAttribute('aria-hidden', 'true');
  box.appendChild(sym);

  const input = document.createElement('input');
  input.id = id;
  input.className = 'input';
  input.type = 'text';
  input.setAttribute('inputmode', 'decimal');
  input.autocomplete = 'off';
  input.placeholder = '18.00';
  if (opts.value != null) input.value = opts.value;
  box.appendChild(input);
  wrap.appendChild(box);

  if (opts.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = opts.hint;
    input.setAttribute('aria-describedby', `${id}-hint`);
    hint.id = `${id}-hint`;
    wrap.appendChild(hint);
  }

  const err = document.createElement('p');
  err.className = 'field-error';
  err.hidden = true;
  err.appendChild(icon('info', { size: 15 }));
  const errText = document.createElement('span');
  err.appendChild(errText);
  wrap.appendChild(err);

  const setError = (msg) => {
    errText.textContent = msg;
    err.hidden = false;
    box.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-invalid', 'true');
  };
  const clearError = () => {
    err.hidden = true;
    errText.textContent = '';
    box.removeAttribute('aria-invalid');
    input.removeAttribute('aria-invalid');
  };
  input.addEventListener('input', clearError);
  guardInputAgainstKeyboard(input);

  return {
    wrap,
    input,
    label,
    setError,
    clearError,
    getValue: () => input.value.trim(),
  };
}

/**
 * 下拉选择。
 * @param {{label: string, options: Array<{value: string, label: string}>, value?: string, hint?: string}} opts
 * @returns {{wrap: HTMLElement, select: HTMLSelectElement, label: HTMLElement}}
 */
export function selectField(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = opts.label;
  const id = `s${Math.random().toString(36).slice(2, 8)}`;
  label.htmlFor = id;
  wrap.appendChild(label);

  const select = document.createElement('select');
  select.id = id;
  select.className = 'select';
  for (const o of opts.options) {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    if (opts.value != null && o.value === opts.value) option.selected = true;
    select.appendChild(option);
  }
  wrap.appendChild(select);
  if (opts.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = opts.hint;
    select.setAttribute('aria-describedby', `${id}-hint`);
    hint.id = `${id}-hint`;
    wrap.appendChild(hint);
  }
  return { wrap, select, label };
}

/**
 * 开关。
 * @param {{label: string, checked?: boolean, onChange?: (on: boolean) => void, hint?: string}} opts
 * @returns {{wrap: HTMLElement, input: HTMLInputElement, renderState: () => void, isOn: () => boolean}}
 */
export function toggleField(opts) {
  const wrap = document.createElement('label');
  wrap.className = 'toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!opts.checked;
  wrap.appendChild(input);

  const track = document.createElement('span');
  track.className = 'toggle-track';
  track.setAttribute('aria-hidden', 'true');
  const knob = document.createElement('span');
  knob.className = 'toggle-knob';
  track.appendChild(knob);
  wrap.appendChild(track);

  const text = document.createElement('span');
  text.className = 'toggle-text';
  const l = document.createElement('span');
  l.className = 'toggle-label';
  l.textContent = opts.label;
  text.appendChild(l);
  if (opts.hint) {
    const hint = document.createElement('span');
    hint.className = 'toggle-hint';
    hint.textContent = opts.hint;
    text.appendChild(hint);
  }
  wrap.appendChild(text);

  const renderState = () => {
    wrap.classList.toggle('is-on', input.checked);
    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
  };
  input.addEventListener('change', () => {
    renderState();
    if (opts.onChange) opts.onChange(input.checked);
  });
  renderState();
  return { wrap, input, renderState, isOn: () => input.checked };
}

/**
 * 分类选择：图标卡片组（radio 语义，键盘可切换）。
 * @param {{label?: string, categories: Array<{id: string, label: string}>, value?: string, onChange?: (id: string) => void}} opts
 * @returns {{wrap: HTMLElement, getValue: () => string, setValue: (id: string) => void}}
 */
export function categoryChips(opts) {
  const wrap = document.createElement('fieldset');
  wrap.className = 'field';
  const legend = document.createElement('legend');
  legend.className = 'field-label';
  legend.textContent = opts.label || '消费分类';
  wrap.appendChild(legend);

  const chips = document.createElement('div');
  chips.className = 'chips';
  wrap.appendChild(chips);

  const name = `cat${Math.random().toString(36).slice(2, 8)}`;
  let current = opts.value || (opts.categories[0] && opts.categories[0].id) || 'other';
  const byId = new Map();

  const render = () => {
    for (const [id, chip] of byId) {
      const active = id === current;
      chip.classList.toggle('is-active', active);
      const input = chip.querySelector('input');
      if (input) input.checked = active;
      const tick = chip.querySelector('.chip-tick');
      if (tick) tick.textContent = active ? '已选' : '';
    }
  };

  for (const cat of opts.categories) {
    const chip = document.createElement('label');
    chip.className = 'chip';
    chip.dataset.cat = cat.id;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = cat.id;
    chip.appendChild(input);
    chip.appendChild(catIcon(cat.id, 22));
    const text = document.createElement('span');
    text.textContent = cat.label;
    chip.appendChild(text);
    const tick = document.createElement('span');
    tick.className = 'chip-tick';
    chip.appendChild(tick);
    input.addEventListener('change', () => {
      current = cat.id;
      render();
      if (opts.onChange) opts.onChange(cat.id);
    });
    byId.set(cat.id, chip);
    chips.appendChild(chip);
  }
  render();

  return {
    wrap,
    getValue: () => current,
    setValue: (id) => { current = id; render(); },
  };
}

/** 分类图标（common.js 的实现，这里转发一份，避免调用方两份 import 打架） */
function catIcon(category, size) {
  return icon(CAT_ICONS[category] || 'other', { size: size || 22 });
}

/**
 * 防重复提交：上一次还在处理中就不再进入。
 * @param {(event: Event) => any} fn
 */
export function submitGuard(fn) {
  let running = false;
  return async function guarded(event) {
    if (running) {
      if (event && event.preventDefault) event.preventDefault();
      return undefined;
    }
    running = true;
    try {
      return await fn(event);
    } finally {
      running = false;
    }
  };
}

/** 表单级错误框。 @returns {{el: HTMLElement, show: (msg: string) => void, hide: () => void}} */
export function formErrorBox() {
  const el = document.createElement('div');
  el.className = 'form-error';
  el.hidden = true;
  el.setAttribute('role', 'alert');
  const text = document.createElement('span');
  el.appendChild(text);
  return {
    el,
    show: (msg) => { text.textContent = msg; el.hidden = false; },
    hide: () => { el.hidden = true; text.textContent = ''; },
  };
}

/** @returns {string} 今天（本地日期）的 YYYY-MM-DD，用于 date input 默认值 */
export function todayInputValue() {
  return todayKey();
}

/**
 * 按钮。
 * @param {string} text
 * @param {{kind?: 'primary'|'ghost'|'danger'|'plain', type?: string, onClick?: () => void, block?: boolean, disabled?: boolean, icon?: string}} [opts]
 */
export function button(text, opts = {}) {
  const btn = document.createElement('button');
  btn.type = opts.type || 'button';
  const kind = opts.kind === 'plain' ? '' : ` btn-${opts.kind || 'ghost'}`;
  btn.className = `btn${kind}${opts.block ? ' btn-block' : ''}`;
  if (opts.icon) btn.appendChild(icon(opts.icon, { size: 18 }));
  const span = document.createElement('span');
  span.textContent = text;
  btn.appendChild(span);
  if (opts.onClick) btn.addEventListener('click', opts.onClick);
  if (opts.disabled) btn.disabled = true;
  return btn;
}
