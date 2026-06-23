// 실제 Chrome(헤드리스)로 브라우저 경로 검증: 페이지에서 변환→합성까지 수행
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const MIME = {
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.wasm':'application/wasm', '.zip':'application/zip', '.css':'text/css',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const fp = normalize(join(ROOT, urlPath === '/' ? '/index.html' : urlPath));
    if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/`;
console.log('serving at', base);

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

const page = await browser.newPage();
page.on('console', (m) => console.log('  [page]', m.text()));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(base, { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const { load } = await import('./vendor/aquestalk.bundle.js');
  const { koreanToKatakana } = await import('./k2k.js');
  const baseUrl = new URL('voices/', document.baseURI).href;
  const tests = ['안녕하세요', '음악', '윳쿠리 보이스입니다'];
  const aq = await load('f1', { baseUrl });
  const out = [];
  for (const t of tests) {
    const { kana } = koreanToKatakana(t);
    const wav = aq.run(kana, 100);
    out.push({ t, kana, bytes: wav.length });
  }
  await aq.destroy();
  return out;
});

console.log('── 브라우저 합성 결과 ──');
for (const r of result) console.log(`OK  ${r.t}  (${r.kana})  → ${r.bytes} bytes`);

await browser.close();
server.close();
console.log('done');
