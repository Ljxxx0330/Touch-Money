/**
 * serve.cjs —— 零依赖本地静态服务器（开发/演示用）
 *
 * 为什么需要它：本项目用原生 ES Modules，直接双击 index.html（file:// 协议）
 * 会被浏览器的 CORS 规则拦住模块加载，页面会提示需要模块服务器。
 *
 * 用法：node tools/serve.cjs   然后浏览器打开 http://127.0.0.1:4173/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// 项目根目录 = 本文件所在目录的上一级，不依赖当前工作目录。
const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = url === '/' ? '/index.html' : url;
    // 只允许读项目根目录内的文件，挡掉 ../ 越界。
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 ' + rel);
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        // 开发时禁用缓存，改完代码刷新即生效。
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => {
    console.log('TouchMoney 已启动：http://' + HOST + ':' + PORT + '/  （根目录 ' + ROOT + '）');
  });
