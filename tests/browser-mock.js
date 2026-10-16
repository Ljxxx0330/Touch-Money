/**
 * browser-mock.js —— 测试用的最小浏览器环境模拟。
 * 必须在被测模块之前 import（Node ESM 按 import 顺序执行）。
 */

class MockStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(String(key));
  }
  clear() {
    this.map.clear();
  }
  key(index) {
    return Array.from(this.map.keys())[index] ?? null;
  }
}

export function installBrowserMock() {
  const storage = new MockStorage();
  const listeners = new Map();

  const win = {
    localStorage: storage,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    navigator: { userAgent: 'node-test' },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    },
    scrollTo() {},
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    location: { hash: '' },
  };

  globalThis.window = win;
  globalThis.localStorage = storage;
  globalThis.matchMedia = win.matchMedia;
  // Node 24+ 内置 navigator（只有 getter），直接赋值会在 ESM 严格模式下抛错
  try {
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, writable: true, configurable: true });
  } catch {
    /* 保留内置 navigator */
  }
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

  return { storage, win };
}

export { MockStorage };
