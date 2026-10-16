/**
 * form.js —— 表单控件构造与校验辅助。统一 label / 错误位 / 无障碍关联。
 */

import { CATEGORIES } from '../core/budget.js';
import { toDateKey } from '../core/dates.js';

let uid = 0;
function nextId(prefix) {
  uid += 1;
  return `${prefix}_${uid}`;
}

/** 手机键盘弹出时避免输入框被遮挡：聚焦后滚到可视区中部。 */
export function guardInputAgainstKeyboard(input) {
  input.addEventListener('focus', () => {
    const delay = window.navigator && /Mobi|Android/i.test(window.navigator.userAgent) ? 420 : 120;
    setTimeout(() => {
      try {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        input.scrollIntoView();
      }
    }, delay);
  });
}

/**
 * 文本 / 数字 / 日期输入框（带 label 与错误位）。
 * @param {{label:string, type?:string, value?:string, placeholder?:string, inputmode?:string,
 *            maxlength?:number, required?:boolean, hint?:string, id?:string, autocomplete?:string}} opts
 * @returns {{wrap:HTMLElement, input:HTMLInputElement, label:HTMLElement, setError:(msg:string)=>void, clearError:()=>void}}
 */
export function field(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const id = opts.id || nextId('f');
  const label = document.createElement('label');
  label.className = 'field-label';
  label.setAttribute('for', id);
  label.textContent = opts.label;
  if (opts.required) {
    const star = document.createElement('span');
    star.className = 'field-required';
    star.textContent = ' 必填';
    label.appendChild(star);
  }
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.id = id;
  input.className = 'input';
  input.type = opts.type || 'text';
  if (opts.inputmode) input.setAttribute('inputmode', opts.inputmode);
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.maxlength) input.maxLength = opts.maxlength;
  if (opts.value !== undefined) input.value = opts.value;
  if (opts.required) input.setAttribute('aria-required', 'true');
  if (opts.autocomplete) input.setAttribute('autocomplete', opts.autocomplete);
  input.addEventListener('input', () => clearError());
  wrap.appendChild(input);

  let errorId = '';
  const errorEl = document.createElement('p');
  errorEl.className = 'field-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;
  wrap.appendChild(errorEl);

  if (opts.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = opts.hint;
    wrap.appendChild(hint);
  }

  guardInputAgainstKeyboard(input);

  function setError(msg) {
    if (!msg) return clearError();
    errorId = errorId || nextId('err');
    errorEl.id = errorId;
    errorEl.textContent = msg;
    errorEl.hidden = false;
    input.classList.add('input-invalid');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
    input.classList.remove('input-invalid');
    input.removeAttribute('aria-invalid');
    if (errorId) input.removeAttribute('aria-describedby');
  }

  return { wrap, input, label, setError, clearError };
}

/**
 * 下拉选择框。
 * @param {{label:string, options:Array<{value:string,label:string}>, value?:string, hint?:string}} opts
 */
export function selectField(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = nextId('s');

  const label = document.createElement('label');
  label.className = 'field-label';
  label.setAttribute('for', id);
  label.textContent = opts.label;
  wrap.appendChild(label);

  const select = document.createElement('select');
  select.id = id;
  select.className = 'input select';
  for (const o of opts.options || []) {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    select.appendChild(option);
  }
  if (opts.value !== undefined) select.value = opts.value;
  wrap.appendChild(select);

  if (opts.hint) {
    const hint = document.createElement('p');
    hint.className = 'field-hint';
    hint.textContent = opts.hint;
    wrap.appendChild(hint);
  }

  return { wrap, select, label };
}

/**
 * 开关（真实 checkbox，标签文字 + 状态文字，不只靠颜色表达）。
 * @param {{label:string, checked:boolean, onChange:(on:boolean)=>void, hint?:string, onText?:string, offText?:string}} opts
 */
export function toggleField(opts) {
  const wrap = document.createElement('label');
  wrap.className = 'toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'toggle-input';
  input.checked = !!opts.checked;

  const track = document.createElement('span');
  track.className = 'toggle-track';
  track.setAttribute('aria-hidden', 'true');
  const knob = document.createElement('span');
  knob.className = 'toggle-knob';
  track.appendChild(knob);

  const text = document.createElement('span');
  text.className = 'toggle-text';
  const title = document.createElement('span');
  title.className = 'toggle-title';
  title.textContent = opts.label;
  text.appendChild(title);
  if (opts.hint) {
    const hint = document.createElement('span');
    hint.className = 'toggle-hint';
    hint.textContent = opts.hint;
    text.appendChild(hint);
  }

  const stateText = document.createElement('span');
  stateText.className = 'toggle-state';
  const renderState = () => {
    stateText.textContent = input.checked
      ? opts.onText || '已开启'
      : opts.offText || '已关闭';
    stateText.classList.toggle('is-on', input.checked);
  };
  renderState();

  input.addEventListener('change', () => {
    renderState();
    if (typeof opts.onChange === 'function') opts.onChange(input.checked);
  });

  wrap.appendChild(input);
  wrap.appendChild(track);
  wrap.appendChild(text);
  wrap.appendChild(stateText);
  return { wrap, input, renderState };
}

/**
 * 分类选择（chip 单选组）。用 radio 实现，键盘可用，不只靠颜色（选中项带勾号）。
 * @param {{label:string, value?:string, name?:string, onChange?:(id:string)=>void}} opts
 * @returns {{wrap:HTMLElement, getValue:()=>string, setValue:(id:string)=>void}}
 */
export function categoryChips(opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field chips-field';
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'chips-set';
  const legend = document.createElement('legend');
  legend.className = 'field-label';
  legend.textContent = opts.label || '分类';
  fieldset.appendChild(legend);

  const name = opts.name || nextId('cat');
  const row = document.createElement('div');
  row.className = 'chips';
  const inputs = new Map();

  for (const cat of CATEGORIES) {
    const chip = document.createElement('label');
    chip.className = 'chip';
    chip.dataset.cat = cat.id;
    chip.dataset.cat = cat.id;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = cat.id;
    radio.className = 'chip-input';
    radio.checked = (opts.value || 'food') === cat.id;

    const box = document.createElement('span');
    box.className = 'chip-box';
    box.setAttribute('aria-hidden', 'true');
    box.textContent = cat.label;

    const tick = document.createElement('span');
    tick.className = 'chip-tick';
    tick.textContent = '已选';
    box.appendChild(tick);

    radio.addEventListener('change', () => {
      if (radio.checked) {
        if (typeof opts.onChange === 'function') opts.onChange(cat.id);
      }
      sync();
    });

    chip.appendChild(radio);
    chip.appendChild(box);
    row.appendChild(chip);
    inputs.set(cat.id, radio);
  }

  function sync() {
    for (const [id, radio] of inputs) {
      radio.parentNode.classList.toggle('is-active', radio.checked);
    }
  }
  sync();

  fieldset.appendChild(row);
  wrap.appendChild(fieldset);

  return {
    wrap,
    getValue: () => {
      for (const [id, radio] of inputs) if (radio.checked) return id;
      return 'food';
    },
    setValue: (id) => {
      const radio = inputs.get(id);
      if (radio) {
        radio.checked = true;
        sync();
      }
    },
  };
}

/** 提交防抖：同一表单在上一次提交完成前不再重复提交。 */
export function submitGuard(fn) {
  let busy = false;
  return async function guarded(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      await fn(event);
    } finally {
      busy = false;
    }
  };
}

/** 表单级错误提示条。 */
export function formErrorBox() {
  const el = document.createElement('p');
  el.className = 'form-error';
  el.setAttribute('role', 'alert');
  el.hidden = true;
  return {
    el,
    show(msg) {
      el.textContent = msg || '';
      el.hidden = !msg;
    },
  };
}

/** 今天的本地日期（用于日期输入框默认值）。 */
export function todayInputValue() {
  return toDateKey(new Date());
}

/** 按钮构造。 */
export function button(text, { kind = 'ghost', type = 'button', onClick, block = false, disabled = false } = {}) {
  const btn = document.createElement('button');
  btn.type = type;
  btn.className = `btn btn-${kind}${block ? ' btn-block' : ''}`;
  btn.textContent = text;
  btn.disabled = !!disabled;
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  return btn;
}
