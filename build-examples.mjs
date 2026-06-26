// 예제 음원 미리 렌더: 헤드리스 Chrome(puppeteer)으로 앱의 실제 합성 경로(synthesizeKana)를
// 그대로 돌려 각 예제를 audio/<id>.mp3 로 뽑아 둔다. 앱은 예제 클릭 시 이 mp3를 받아 즉시
// 재생하므로 v86 에뮬레이터 부팅(수십 초)이 사라진다. 음질·운율은 브라우저 재생과 100% 동일.
//   실행:  npm run build:examples   (Chrome 경로는 CHROME 환경변수로 덮어쓸 수 있음)
import http from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { extname, join, normalize } from 'path';
import puppeteer from 'puppeteer-core';
import lamejs from '@breezystack/lamejs';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.zip': 'application/zip', '.css': 'text/css', '.json': 'application/json',
};

// 정적 서버 (validate-browser.mjs와 동일한 최소 구성)
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
const base = `http://localhost:${server.address().port}/`;
console.log('serving at', base);

// Int16 PCM → MP3(mono 128kbps) 바이트
function encodeMp3(samples, sr) {
  const enc = new lamejs.Mp3Encoder(1, sr, 128);
  const block = 1152;
  const out = [];
  for (let i = 0; i < samples.length; i += block) {
    const chunk = samples.subarray(i, i + block);
    const buf = enc.encodeBuffer(chunk);
    if (buf.length) out.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) out.push(Buffer.from(end));
  return Buffer.concat(out);
}

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  protocolTimeout: 600000, // 긴 예제(노래·포엠) + v86 부팅 대비
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => { const t = m.text(); if (!/Autoplay|AudioContext/.test(t)) console.log('  [page]', t); });

await page.goto(base + '?nopreload=1', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__renderExample === 'function', { timeout: 30000 });

// 예제 뱃지 id 목록(HTML 순서)
const ids = await page.$$eval('.example-badge', (els) => els.map((e) => e.id).filter(Boolean));
console.log('examples:', ids.join(', '));

await mkdir(join(ROOT, 'audio'), { recursive: true });
const manifest = {};
for (const id of ids) {
  process.stdout.write(`렌더 ${id} … `);
  const { sr, silences, pcm16 } = await page.evaluate((x) => window.__renderExample(x), id);
  // base64 → Int16Array (정렬 안전하게 복사)
  const buf = Buffer.from(pcm16, 'base64');
  const samples = new Int16Array(buf.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2);
  const mp3 = encodeMp3(samples, sr);
  await writeFile(join(ROOT, 'audio', id + '.mp3'), mp3);
  manifest[id] = { silences };
  console.log(`${(samples.length / sr).toFixed(1)}s → ${(mp3.length / 1024).toFixed(0)}KB`);
}

await writeFile(join(ROOT, 'audio', 'examples.json'), JSON.stringify(manifest) + '\n');
console.log('wrote audio/examples.json');

await browser.close();
server.close();
console.log('done.');
