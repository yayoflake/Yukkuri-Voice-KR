// 의존성 없는 초간단 정적 서버.  실행:  npm run serve  (또는  node serve.mjs)
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { spawn } from 'child_process';

// 시작 시 기본 브라우저로 자동 열기 (NO_OPEN=1 이면 생략)
function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  const cmds = {
    win32: ['cmd', ['/c', 'start', '""', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const c = cmds[process.platform];
  if (!c) return;
  try { spawn(c[0], c[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* 무시 */ }
}

const ROOT = process.cwd();
const PORT = process.env.PORT || 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.zip': 'application/zip',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const fp = normalize(join(ROOT, urlPath === '/' ? '/index.html' : urlPath));
  if (!fp.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const data = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`▶ ${url}  (이 창을 닫거나 Ctrl+C 로 종료)`);
  openBrowser(url);
});
