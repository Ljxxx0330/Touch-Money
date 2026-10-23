/**
 * icons.js —— 原创内联 SVG 图标（不依赖图标库、不使用 emoji）。
 * 统一 24x24 viewBox、stroke 继承 currentColor、aria-hidden。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  wallet: [
    'M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5v1',
    'M3 7.5v10A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-7a2.5 2.5 0 0 0-2.5-2.5H6',
    'M17.5 13.5h.01',
  ],
  pencil: ['M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z', 'M14.5 6.5l3 3'],
  chart: ['M4 20h16', 'M7 20V12', 'M12 20V6', 'M17 20v-5'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  heart: ['M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7 3.6c0 5-7 9.4-7 9.4z'],
  gear: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V20a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H20a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  download: ['M12 4v11', 'M8 11l4 4 4-4', 'M5 19h14'],
  upload: ['M12 20V9', 'M8 13l4-4 4 4', 'M5 5h14'],
  trash: ['M5 7h14', 'M9 7V5h6v2', 'M7 7l1 13h8l1-13', 'M10 11v6', 'M14 11v6'],
  coin: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'M12 7v10',
    'M15 9.5c0-1.1-1.3-2-3-2s-3 .9-3 2 1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2-3-.9-3-2',
  ],
  calendar: [
    'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
    'M4 10h16',
    'M9 4v3',
    'M15 4v3',
  ],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  check: ['M5 13l4 4 10-10'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  note: ['M6 4h9l4 4v12H6z', 'M15 4v4h4', 'M9 12h6', 'M9 16h4'],

  /* 外壳与导航 */
  bell: [
    'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z',
    'M10.5 19a1.6 1.6 0 0 0 3 0',
  ],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  arrowRight: ['M4 12h15', 'M13 6l6 6-6 6'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M16.5 16.5L21 21'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  shield: ['M12 20s7-3 7-9V6l-7-3-7 3v5c0 6 7 9 7 9z', 'M9.5 11.5l2 2 3.5-3.5'],
  logout: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h9'],

  /* 分类图标（原创，不用 emoji） */
  food: [
    'M4 11h16a8 8 0 0 1-16 0z',
    'M3 19h18',
    'M9 7c0-1.4 1-1.8 1.5-2.6',
    'M13.5 7c0-1.4 1-1.8 1.5-2.6',
  ],
  transport: [
    'M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9H5V6z',
    'M5 11h14',
    'M7 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'M17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  ],
  study: [
    'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13z',
    'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z',
  ],
  shopping: [
    'M6 8h12l-1 12H7L6 8z',
    'M9.5 8V6.5a2.5 2.5 0 0 1 5 0V8',
  ],
  fun: [
    'M9 20a8 8 0 1 1 8-8',
    'M12 9l3 3-3 3-3-3 3-3z',
    'M15 12h6',
  ],
  daily: [
    'M12 4c3 3.6 5 5.9 5 8.6A5 5 0 0 1 7 12.6C7 9.9 9 7.6 12 4z',
    'M9.5 14.5a2.6 2.6 0 0 0 3 2',
  ],
  other: [
    'M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6zM14 14h4v4h-4z',
  ],
};

/**
 * @param {string} name PATHS 中的键
 * @param {{size?:number, className?:string, filled?:boolean, strokeWidth?:number}} [opts]
 * @returns {SVGElement}
 */
export function icon(name, opts = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(opts.size || 24));
  svg.setAttribute('height', String(opts.size || 24));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(opts.strokeWidth || 1.7));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (opts.className) svg.setAttribute('class', opts.className);

  const shapes = PATHS[name] || PATHS.info;
  for (const d of shapes) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    if (opts.filled) path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
