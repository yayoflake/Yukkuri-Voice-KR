// 음성별 라우드니스 실측 → app.js의 VOICE_GAIN 보정표 산출.
// 실행: node measure-loudness.mjs   (같은 문장을 8음성으로 합성해 RMS/피크를 잰다)
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import path from 'path';

// v86 번들이 __require("fs") 등을 쓰는데 ESM엔 require가 없다 → 전역에 심고 동적 import
globalThis.require = createRequire(import.meta.url);
const { load } = await import('./vendor/aquestalk.bundle.js');

const baseUrl = pathToFileURL(path.resolve('voices')).href + '/';
const VOICES = ['f1', 'f2', 'm1', 'm2', 'dvd', 'imd1', 'jgr', 'r1'];
// 다양한 모라가 섞인 중립 문장(가타카나)
const TEXT = 'コンニチワ。キョーワイイテンキデスネ。ゲンキニアソビマショー。';

function parseWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12; // 'RIFF'....'WAVE'
  let bits = 16, ch = 1, dataOff = -1, dataLen = 0;
  while (off + 8 <= dv.byteLength) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const sz = dv.getUint32(off + 4, true);
    if (id === 'fmt ') { ch = dv.getUint16(off + 10, true); bits = dv.getUint16(off + 22, true); }
    else if (id === 'data') { dataOff = off + 8; dataLen = sz; }
    off += 8 + sz + (sz & 1);
  }
  const n = Math.floor(dataLen / (bits / 8) / ch);
  let sumSq = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const s = dv.getInt16(dataOff + i * 2 * ch, true) / 32768;
    sumSq += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sumSq / n), peak, n };
}

const results = [];
for (const v of VOICES) {
  const aq = await load(v, { baseUrl });
  const wav = aq.run(TEXT, 100);
  const m = parseWav(wav instanceof Uint8Array ? wav : new Uint8Array(wav));
  await aq.destroy();
  const dbfs = 20 * Math.log10(m.rms);
  results.push({ v, rms: m.rms, peak: m.peak, dbfs });
  console.error(`${v}\tRMS ${m.rms.toFixed(4)}\t${dbfs.toFixed(2)} dBFS\tpeak ${m.peak.toFixed(3)}`);
}

// 가장 조용한 음성에 맞춰 더 큰 음성만 감쇠 (게인<=1 → 클리핑 위험 없음)
const minRms = Math.min(...results.map((r) => r.rms));
const table = {};
for (const r of results) table[r.v] = Math.round((minRms / r.rms) * 100) / 100;
console.error('\nVOICE_GAIN =', JSON.stringify(table));
