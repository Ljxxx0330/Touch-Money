/**
 * tools/open.cjs —— 双击启动器（Node 无依赖）。
 *
 * 做三件事：
 *   1. 看 127.0.0.1:4173 是不是已经有一个本应用在跑（有就直接用，不再开第二个）；
 *   2. 没有就把自己 fork 成一个后台服务进程（tools/serve.cjs），等它能响应请求；
 *   3. 用系统默认浏览器打开 http://127.0.0.1:4173/。
 *
 * 为什么要这么绕一圈：本应用是 ES Modules，浏览器对 file:// 下的 import 按跨域处理，
 * 双击 index.html 会被 CORS 拦住（见 README「怎么打开」）。有一个本地静态服务器就行，
 * 这个脚本把「开服务器 + 开浏览器」合成一次双击。
 *
 * 关掉：这个窗口可以关掉（服务进程是独立的后代进程，不受影响）。
 * 想彻底停掉服务：node tools/open.cjs --stop
 */

'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const URL = `http://${HOST}:${PORT}/`;
const SERVE = path.join(__dirname, 'serve.cjs');

/** @param {string} url @returns {Promise<boolean>} 能连通返回 true */
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1200 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** 等服务器起来，最多等 maxMs 毫秒 */
async function waitReady(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await ping(URL)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** 用系统默认浏览器打开（Windows / macOS / Linux 各走各的） */
function openBrowser(url) {
  if (process.platform === 'win32') {
    // Start-Process 传 URL 会交给默认浏览器；参数是数组，不经 shell，没有引号问题
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Start-Process -FilePath '${url}'`], { detached: true, stdio: 'ignore' });
    child.on('error', () => manual(url));
    child.unref();
    return;
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => manual(url));
  child.unref();
}

function manual(url) {
  process.stdout.write(`浏览器没能自动打开。请自己访问 ${url}\n`);
}

async function stop() {
  const target = `serve.cjs`;
  if (process.platform !== 'win32') {
    process.stdout.write('--stop 目前只在 Windows 上实现；其它系统请直接结束 node 进程。\n');
    return 0;
  }
  const script =
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | ' +
    'Where-Object { $_.CommandLine -like \'*serve.cjs*\' } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }';
  const { execFile } = require('node:child_process');
  await new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
      (err, out) => {
        const ids = String(out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        process.stdout.write(ids.length ? `已停止服务进程：${ids.join('、')}\n` : '没有在跑的服务进程。\n');
        resolve(err ? 1 : 0);
      });
  });
  return 0;
}

(async () => {
  if (process.argv.includes('--stop')) {
    process.exitCode = await stop();
    return;
  }

  if (await ping(URL)) {
    process.stdout.write(`服务已经在 ${URL} 上运行，直接打开浏览器。\n`);
    openBrowser(URL);
    return;
  }

  process.stdout.write(`正在启动本地服务 ${URL} ...\n`);
  const child = spawn(process.execPath, [SERVE], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => {
    process.stderr.write(`启动服务失败：${err.message}\n`);
    process.stderr.write('请确认已安装 Node.js，或在项目文件夹里手动运行 node tools\\serve.cjs\n');
    process.exitCode = 1;
  });
  child.unref();

  if (!(await waitReady(6000))) {
    process.stderr.write(`服务没能起来（端口 ${PORT} 可能被别的程序占了）。\n`);
    process.stderr.write(`可以换个端口：set PORT=4180 && node tools\\open.cjs\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`服务已就绪，正在打开浏览器：${URL}\n`);
  openBrowser(URL);
})();
