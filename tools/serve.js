/*!
 * tools/serve.js — 本地静态预览服务器（可选）
 * 运行：node tools/serve.js            默认 0.0.0.0:5173，同一 Wi-Fi 下的手机/平板也能访问
 *       node tools/serve.js 8080       指定端口
 *       node tools/serve.js --local    只允许本机访问（等价于旧行为）
 * 说明：直接双击 rollcall.html 也能用，这个脚本主要是方便在浏览器里调试、或者让其他设备打开。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const localOnly = args.indexOf('--local') >= 0 || args.indexOf('-l') >= 0;
const portArg = args.find((arg) => /^\d+$/.test(arg));
const port = Number(portArg || 5173);
const host = localOnly ? '127.0.0.1' : '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* 本机的局域网地址，用来告诉使用者其他设备该访问哪个网址 */
function lanAddresses() {
  const out = [];
  Object.keys(os.networkInterfaces()).forEach((name) => {
    (os.networkInterfaces()[name] || []).forEach((info) => {
      if (info.family === 'IPv4' && !info.internal) out.push({ name: name, address: info.address });
    });
  });
  return out;
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const relative = urlPath === '/' ? 'rollcall.html' : urlPath.replace(/^\/+/, '');
  const target = path.resolve(root, relative);

  if (!target.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found: ' + relative);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(port, host, () => {
  console.log('本机预览： http://localhost:' + port);
  if (!localOnly) {
    const list = lanAddresses();
    if (list.length) {
      console.log('同一 Wi-Fi 下的其他设备可以打开：');
      list.forEach((item) => console.log('  http://' + item.address + ':' + port + '   （' + item.name + '）'));
    } else {
      console.log('没有找到局域网地址，其他设备可能无法访问。');
    }
    console.log('提示：Windows 首次运行会弹出防火墙询问，请勾选「专用网络」并允许。');
  }
  console.log('（Ctrl+C 结束，或直接关掉这个终端窗口）');
});
