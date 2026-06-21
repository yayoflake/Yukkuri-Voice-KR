// 실제 Chrome으로 재생/정지 버튼 상태 전이 검증 (중복재생 방지 포함)
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.zip':'application/zip','.css':'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const fp = normalize(join(ROOT, p === '/' ? '/index.html' : p));
    if (!fp.startsWith(ROOT)) return res.writeHead(403).end();
    const data = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'shell', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => console.log('  [page]', m.text()));
const status = () => page.$eval('#status', (e) => e.textContent.trim());

await page.goto(base, { waitUntil: 'load' });
const btn = () => page.$eval('#play', (b) => b.textContent.trim());
const waitBtn = async (txt, ms) => page.waitForFunction(
  (t) => document.getElementById('play').textContent.trim() === t, { timeout: ms }, txt);

let failed = false;
const check = (cond, msg) => { console.log((cond ? '  OK  ' : '  FAIL') + ' ' + msg); if (!cond) failed = true; };

console.log('초기 버튼:', await btn());
check((await btn()) === '▶ 재생', '초기 상태 = ▶ 재생');
await page.type('#text', '안녕하세요');
await page.click('#convert');   // 한국어 → 가나 변환 (재생 전 필수)

await page.click('#play');
await waitBtn('⏳ 준비 중…', 5000);
console.log('로드/합성 시작 →', await btn());

// 재생 시작될 때까지 대기 (엔진 부팅 포함)
await waitBtn('■ 정지', 120000);
console.log('재생 시작 →', await btn());

// 재생 중 정지 클릭 → idle로, 오류 메시지 없어야 함
await page.click('#play');
await waitBtn('▶ 재생', 5000);
const s1 = await status();
console.log('정지 후 status =', JSON.stringify(s1));
check((await btn()) === '▶ 재생', '정지하면 ▶ 재생으로 복귀');
check(!s1.includes('오류'), '정지 시 오류 메시지 없음 (AbortError 무시)');

// 다시 재생 가능한지 + 동시에 audio 하나만 존재(중복재생 방지)
await page.click('#play');
await waitBtn('■ 정지', 120000);
const n = await page.evaluate(() => document.querySelectorAll('audio').length);
check(n <= 1, `재생 중 audio 엘리먼트 ${n}개 (≤1 이어야 중복 아님)`);

await browser.close();
server.close();
console.log(failed ? '\nUI 검증 실패' : '\nUI 검증 통과');
process.exit(failed ? 1 : 0);
