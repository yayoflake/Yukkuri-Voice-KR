// app.js — UI 글루: 한국어 → 가타카나 변환 후 AquesTalk1로 합성/재생
import { load } from './vendor/aquestalk.bundle.js';
import { koreanToKatakana, hiraToKata, kataToHira, normalizeProsody } from './k2k.js?v=20260624a';
import { normalizeNumbers } from './numread.js?v=20260621';
import { katakanaToKorean } from './k2h.js?v=20260622';

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const voiceEl = $('voice');
const speedEl = $('speed');
const speedVal = $('speedval');
const playBtn = $('play');         // 위쪽(라이트): 한국어 칸을 단순 변환해 재생
const convertBtn = $('convert');   // ▼ 변환: 한국어 칸을 변환해 아래 고급 편집 칸에 넣기
const playKanaBtn = $('playkana'); // 아래쪽(고급): 가나 칸을 그대로 재생
const kanaEl = $('kana');          // 편집 가능한 가나 칸 (아래쪽 재생의 기준)
const kanaViewEl = $('kanaview');  // 재생 중 textarea 대신 보여줄 하이라이트용 div
const kanaReadEl = $('kanaread');  // 가나 칸의 한국어 읽기 발음(보조 표기)
const msgEl = $('msg');            // 위쪽 재생 버튼 밑 오류 메시지 (붉은글씨)
const msgKanaEl = $('msgkana');    // 아래쪽 재생 버튼 밑 오류 메시지
const autoSlashBtn = $('autoslash'); // 띄어쓰기 → 악센트구 / 자동 변환 토글 버튼
const kbToggle = $('kbtoggle');    // 가나 키보드 열기
const kbdEl = $('kbd');            // 가나 키보드 팝오버
const kbdTabs = $('kbdtabs');      // 탭(청음/탁음/작은가나)
const kbdBody = $('kbdbody');      // 탭별 키 그리드가 들어갈 영역
const hiraToggle = $('hiratoggle'); // 히라가나 표시 토글

// 히라가나 표시 모드: 켜면 예시·키보드·편집창의 가타카나를 전부 히라가나로 보여준다.
// (합성은 어차피 hiraToKata로 가타카나화하므로 편집창 내용이 히라가나여도 그대로 재생된다.)
let hiragana = false;
const displayKana = (s) => (hiragana ? kataToHira(s) : s);

// 음성 자산(zip/wasm)이 들어있는 폴더
const VOICES_BASE = new URL('voices/', document.baseURI).href;

// 현재 로드된 AquesTalk 인스턴스 (음성당 ~1GB라 한 번에 하나만 유지)
let current = null;        // { voice, aq }
let busy = false;          // 로드/합성 중 (이때 버튼은 잠금)
let audioCtx = null;       // Web Audio 컨텍스트 (구간 합성 결과를 이어붙여 재생)
let currentSource = null;  // 재생 중인 BufferSource (있으면 = 재생 중)
let currentGain = null;    // 재생 체인의 GainNode (정지 시 램프다운용)
let activeBtn = null;      // 재생/준비 UI를 표시 중인 버튼 (위/아래)

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // 무음 keepalive: 출력 스트림을 계속 열어둔다. 이게 없으면 재생이 끝나고 노드를
    // 해제할 때 활성 소스가 사라져 브라우저가 오디오 장치를 닫고, 그 순간 "툭/작게 튐"이 난다.
    try {
      const ka = audioCtx.createConstantSource();
      ka.offset.value = 0;
      ka.connect(audioCtx.destination);
      ka.start();
    } catch { /* ConstantSource 미지원 시 무시 */ }
  }
  return audioCtx;
}

// 재생창 밑 메시지: 오류만 붉은글씨로 표시. btn에 따라 위/아래 메시지 칸을 고른다.
// (재생중/재생완료 같은 상태는 재생 버튼의 표시가 대신하므로 메시지로 띄우지 않는다)
function setError(btn, msg = '') {
  (btn === playKanaBtn ? msgKanaEl : msgEl).textContent = msg;
}

// 버튼 상태:  'idle' ▶재생 / 'loading' ⏳준비중 / 'playing' ■정지 (위/아래 라벨 동일)
function setPlayUI(btn, mode) {
  btn.disabled = (mode === 'loading');
  btn.textContent =
    mode === 'loading' ? '⏳ 준비 중…' :
    mode === 'playing' ? '■ 정지' : (btn.dataset.idle || '▶ 재생');
}

// 두 버튼을 모두 idle로 되돌린다 (재생 종료/중지/오류 시)
function resetPlayUI() {
  setPlayUI(playBtn, 'idle');
  setPlayUI(playKanaBtn, 'idle');
  activeBtn = null;
  clearHighlight();
}

// 재생 중지 + 리소스 정리. 파형 중간에서 뚝 끊으면 클릭이 나므로, 게인을 짧게 램프다운한
// 뒤 정지·해제한다. (자연 종료로 불려도 안전 — 이미 끝났으면 stop은 무시됨)
function stopPlayback() {
  if (!currentSource) return;
  const src = currentSource, gain = currentGain;
  src.onended = null;
  currentSource = null; currentGain = null;
  if (gain && audioCtx) {
    const t = audioCtx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.012); // 12ms 페이드아웃
    } catch { /* 무시 */ }
    try { src.stop(t + 0.02); } catch { /* 이미 끝남 */ }
    setTimeout(() => { try { src.disconnect(); gain.disconnect(); } catch { /* 무시 */ } }, 60);
  } else {
    try { src.stop(); } catch { /* 이미 끝남 */ }
    try { src.disconnect(); } catch { /* 무시 */ }
  }
}

// ── 고급 재생 중 "덩어리(악센트구)" 하이라이트 ────────────────────
// 하이라이트는 재생 중에만 필요하고 그땐 편집을 안 하므로, textarea를 숨기고 같은 모양의
// div(kanaViewEl)로 바꿔치기해 거기에 현재 발음 중인 덩어리를 통째로 <mark>로 칠한다.
// (겹치는 backdrop이 아니라 교체라 두 레이어를 픽셀로 맞출 필요가 없다 = 정렬이 안 어긋난다.)
// 덩어리는 구분 기호(/ . , 。 、 공백 x)로 나뉘며, 그 덩어리가 발음되는 동안 계속 켜 둔다.
// 타이밍: 합성 오디오엔 음소별 시각이 없으므로, 각 덩어리를 모라 수에 비례해 길이를 나눠 갖고,
// 덩어리 사이 쉼(. ,)은 retimePauses의 실제 목표 길이(초)만큼 시간을 끼워 동기를 맞춘다.
let hlSegs = null;     // [{ a, b, start }] — 칠할 덩어리 범위[a,b)와 시작시각(초), 텍스트 순
let hlStart = 0;       // 재생 시작 시점의 ctx.currentTime
let hlRAF = 0;         // requestAnimationFrame 핸들
let hlActive = -1;     // 현재 칠해진 덩어리 인덱스(hlSegs 기준)
let hlOn = false;      // 현재 div로 바꿔치기(하이라이트 표시) 중인가

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => HTML_ESC[c]);

// 덩어리를 끊는 구분 기호. / 는 악센트구, 공백·x 는 경계, . , 。 、 는 쉼.
const HL_SEP = new Set(['/', '／', '.', ',', '。', '、', 'x', 'X', 'ｘ', 'Ｘ', ' ', '\t', '\n', '\r']);
// 덩어리 안에서 한 글자가 차지하는 박자(모라). 장음(-ー)도 포함, 작은가나는 0(앞과 한 모라).
const HL_SMALL = 'ァィゥェォャュョぁぃぅぇぉゃゅょ';
function hlMora(ch) {
  if (ch === 'ー' || ch === '-') return 1;
  if (HL_SMALL.includes(ch)) return 0;
  if (/[ぁ-ゖァ-ヶ]/.test(ch)) return 1; // 가나 1모라 (ッ ン 포함)
  return 0;                               // ' > < · 태그문자 등은 시간 없음
}

// textarea → div 로 바꿔치기(같은 높이로 고정해 박스가 안 튀게)
function showKanaView() {
  if (hlOn) return;
  kanaViewEl.style.height = kanaEl.offsetHeight + 'px';
  kanaViewEl.scrollTop = kanaEl.scrollTop;
  kanaEl.hidden = true;
  kanaViewEl.hidden = false;
  hlOn = true;
}
// div → textarea 로 되돌린다
function hideKanaView() {
  if (!hlOn) return;
  kanaViewEl.hidden = true;
  kanaEl.hidden = false;
  kanaViewEl.textContent = '';
  hlOn = false;
}

// hlSegs[k] 덩어리를 통째로 칠한 div를 그린다. k<0이면 강조 없이 본문만.
function paintHighlight(k) {
  const text = kanaEl.value;
  if (k < 0 || !hlSegs || k >= hlSegs.length) {
    kanaViewEl.textContent = text;
  } else {
    const { a, b } = hlSegs[k];
    kanaViewEl.innerHTML =
      escapeHtml(text.slice(0, a)) +
      '<mark>' + escapeHtml(text.slice(a, b)) + '</mark>' +
      escapeHtml(text.slice(b));
    const mark = kanaViewEl.querySelector('mark');
    if (mark) mark.scrollIntoView({ block: 'nearest' }); // 긴 글이면 강조 부분으로 스크롤
  }
  hlActive = k;
}

function clearHighlight() {
  if (hlRAF) { cancelAnimationFrame(hlRAF); hlRAF = 0; }
  hlSegs = null;
  hlActive = -1;
  hideKanaView();
}

// 합성 오디오의 단시간 에너지(RMS)를 누적한 프로파일. energyAtTime(t)=t초까지의 누적에너지,
// timeAtEnergy(e)=누적에너지가 e에 닿는 초. 쉼(무음)에선 에너지가 안 쌓여 평탄해진다.
function makeEnergyProfile(data, sr) {
  const hop = Math.max(1, Math.round(sr * 0.005));   // 5ms 간격
  const half = Math.max(hop, Math.round(sr * 0.01)); // ±10ms 창
  const K = Math.max(1, Math.floor(data.length / hop));
  const cum = new Float64Array(K + 1);               // cum[k] = 0..k 구간 RMS 누적
  for (let k = 0; k < K; k++) {
    const c = k * hop, lo = Math.max(0, c - half), hi = Math.min(data.length, c + half);
    let s = 0; for (let i = lo; i < hi; i++) s += data[i] * data[i];
    cum[k + 1] = cum[k] + Math.sqrt(s / Math.max(1, hi - lo));
  }
  const total = cum[K] || 1;
  const energyAtTime = (t) => { let k = Math.round((t * sr) / hop); if (k < 0) k = 0; if (k > K) k = K; return cum[k]; };
  // 누적에너지가 e를 "넘어서는" 첫 지점(상한). 무음 평탄구간은 건너뛰어 그 끝(=소리 재개)으로.
  const timeAtEnergy = (e) => {
    const target = Math.min(Math.max(e, 0), total);
    let lo = 0, hi = K;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid + 1; else hi = mid; }
    if (lo <= 0) return 0;
    const e0 = cum[lo - 1], e1 = cum[lo], frac = e1 > e0 ? (target - e0) / (e1 - e0) : 0;
    return ((lo - 1 + frac) * hop) / sr;
  };
  return { total, energyAtTime, timeAtEnergy };
}

// minGapSec 이상 이어지는 무음 구간 [start,end](초). 마침표(긴 쉼)를 실제 무음에 못박는 데 쓴다.
function detectGaps(data, sr, minGapSec) {
  const n = data.length, thr = 0.006, minGap = Math.round(sr * minGapSec), gaps = [];
  for (let i = 0; i < n;) {
    if (Math.abs(data[i]) < thr) {
      let j = i; while (j < n && Math.abs(data[j]) < thr) j++;
      if (j - i >= minGap) gaps.push([i / sr, j / sr]);
      i = j;
    } else { let j = i; while (j < n && Math.abs(data[j]) >= thr) j++; i = j; }
  }
  return gaps;
}

// 가나 칸 텍스트를 구분 기호로 덩어리로 나누고 각 덩어리 시작시각을 만든다.
//  · 마침표(.。)는 긴 쉼이라 실제 무음 구간에 "문장 경계"를 못박는다.
//  · 각 문장 안에서만 에너지 비례로 덩어리를 분배한다(문장 간 에너지 불균형이 안 샘).
// 마침표가 없으면 전체가 한 문장. data가 없으면 시간 비례로 폴백.
function buildHighlight(text, duration, data, sr) {
  const n = text.length;
  // @('여기서부터 재생') 뒤만 칠한다 — 합성도 @ 뒤만 하므로 시간축이 맞는다. (@ 없으면 -1+1=0)
  const startIdx = text.lastIndexOf('@') + 1;
  const chunks = []; // { a, b, mora, period }  period=직전 구분자가 마침표였나
  let cur = null, pendingPeriod = false;
  for (let i = startIdx; i < n; i++) {
    const ch = text[i];
    if (HL_SEP.has(ch)) {
      if (cur) { chunks.push(cur); cur = null; }
      if (ch === '.' || ch === '。') pendingPeriod = true;
      continue;
    }
    if (!cur) { cur = { a: i, b: i + 1, mora: 0, period: pendingPeriod }; pendingPeriod = false; }
    else cur.b = i + 1;
    cur.mora += hlMora(ch);
  }
  if (cur) chunks.push(cur);

  const real = chunks.filter((c) => c.mora > 0);
  if (!real.length) { hlSegs = null; return; }
  real[0].period = false; // 첫 문장 앞엔 쉼 없음(trim됨)

  // 시간 비례 폴백(파형 없음)
  if (!data) {
    const totalMora = real.reduce((s, c) => s + c.mora, 0);
    const segs = []; let cum = 0;
    for (const c of real) { segs.push({ a: c.a, b: c.b, start: (cum / totalMora) * duration }); cum += c.mora; }
    hlSegs = segs; return;
  }

  const prof = makeEnergyProfile(data, sr);
  // 마침표 문장 경계(real 인덱스)를, 탐지한 긴 무음(0.12s↑: 마침표 ~0.24s만, 쉼표·촉음 제외)에
  // 위치 순으로 못박는다. (개수가 어긋나면 가능한 만큼만.)
  const bounds = []; for (let i = 1; i < real.length; i++) if (real[i].period) bounds.push(i);
  let anchors = [];
  if (bounds.length) {
    const gaps = detectGaps(data, sr, 0.12);
    const m = Math.min(gaps.length, bounds.length);
    anchors = gaps.slice().sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, m).sort((x, y) => x[0] - y[0]);
  }
  const P = anchors.length;

  // 문장 s = real[lo..hi]. 오디오 구간 [Ta,Tb] 안에서 그 문장의 에너지만으로 분배.
  const segs = [];
  for (let s = 0; s <= P; s++) {
    const lo = s === 0 ? 0 : bounds[s - 1];
    const hi = s === P ? real.length - 1 : bounds[s] - 1;
    const Ta = s === 0 ? 0 : anchors[s - 1][1];        // 직전 무음 끝
    const Tb = s === P ? duration : anchors[s][0];     // 다음 무음 시작
    const Ea = prof.energyAtTime(Ta), Eb = prof.energyAtTime(Tb);
    let M = 0; for (let i = lo; i <= hi; i++) M += real[i].mora;
    let c = 0;
    for (let i = lo; i <= hi; i++) {
      const e = Ea + (M > 0 ? c / M : 0) * (Eb - Ea);
      segs.push({ a: real[i].a, b: real[i].b, start: prof.timeAtEnergy(e) });
      c += real[i].mora;
    }
  }
  hlSegs = segs;
}

// 재생 동안 매 프레임 현재 시각의 덩어리를 칠한다. "이미 시작한 마지막 덩어리"를 켜므로
// 쉼 구간엔 직전 덩어리가 계속 켜져 있고, 덩어리 사이에 빈틈이 안 생긴다.
function highlightTick() {
  if (!hlSegs || !audioCtx) return;
  const elapsed = audioCtx.currentTime - hlStart;
  let k = -1;
  for (let i = 0; i < hlSegs.length; i++) { if (elapsed >= hlSegs[i].start) k = i; else break; }
  if (k !== hlActive) paintHighlight(k);
  hlRAF = requestAnimationFrame(highlightTick);
}

// 고급 재생이 막 시작될 때 호출 — div로 바꿔치기하고 타임라인·추적 루프를 건다.
// buffer의 실제 파형(에너지)으로 덩어리 시작시각을 잡아 동기를 맞춘다.
function startHighlight(buffer) {
  clearHighlight();
  buildHighlight(kanaEl.value, buffer.duration, buffer.getChannelData(0), buffer.sampleRate);
  if (!hlSegs) return;
  showKanaView();
  paintHighlight(0);
  // 하이라이트는 ctx.currentTime 기준인데 실제 들리는 소리는 출력 지연만큼 늦다. 그만큼
  // 시작 기준시각을 미뤄 들리는 소리에 맞춘다(브라우저가 안 주면 0, 과대값은 0.2s로 캡).
  const lat = Math.min(0.2, audioCtx.outputLatency || audioCtx.baseLatency || 0);
  hlStart = audioCtx.currentTime + lat;
  hlRAF = requestAnimationFrame(highlightTick);
}

// 띄어쓰기를 악센트구 구분자 / 로 자동 변환할지 (토글 버튼으로 켜고 끔)
let autoSlash = true;

// 한국어 칸에 직접 친 운율 기호(악센트핵 ' 류, 악센트구 / )는 단순 재생에서 무시한다.
// 커스텀 운율(' / -)은 아래쪽 가나 칸에서만 다룬다.
const KO_MARKS_RE = /['‘’ʹ´`/／]/g;

// 한국어 칸 → 가타카나 (직접 친 운율 기호는 제거하고 단순 변환)
function koreanKana() {
  const src = normalizeNumbers(textEl.value.replace(KO_MARKS_RE, ''));
  return koreanToKatakana(src, { autoSlash }).kana;
}

// 가나 칸의 한국어 읽기 발음을 보조 표기 칸에 갱신한다 (' / - 등 기호는 그대로 보존)
function updateKanaRead() {
  kanaReadEl.textContent = katakanaToKorean(kanaEl.value);
}

let kanaDirty = false;     // 사용자가 고급 편집 칸을 직접 고쳤는지(변환 덮어쓰기 경고용)
let suppressDirty = false; // 프로그램이 칸 값을 바꾸는 동안엔 편집 플래그를 올리지 않음

// 편집 칸 값 교체. Ctrl+Z로 되돌릴 수 있게 네이티브 undo 스택을 보존한다(execCommand).
function setKanaValue(text) {
  suppressDirty = true;
  kanaEl.focus();
  kanaEl.select();
  const ok = text
    ? document.execCommand('insertText', false, text)
    : document.execCommand('delete');
  if (!ok) kanaEl.value = text; // execCommand 미지원 시 폴백(undo 불가)
  suppressDirty = false;
}

// 한국어 입력이 바뀌면 가나 칸을 새로 채운다 (변환결과 표시 + 편집의 출발점)
function regenerate() {
  // 직접 고친 내용이 있으면 덮어쓰기 전에 한 번 확인
  if (kanaDirty && kanaEl.value.trim() &&
      !confirm('편집한 내용을 덮어씁니다. 계속할까요?')) {
    return;
  }
  setKanaValue(displayKana(koreanKana()));
  updateKanaRead();
  kanaDirty = false;
}

// 선택된 음성 인스턴스 확보 (필요하면 로드, 음성이 바뀌면 이전 것 해제)
async function ensureVoice(voice) {
  if (current && current.voice === voice) return current.aq;
  if (current) {
    const old = current; current = null;
    try { await old.aq.destroy(); } catch { /* 무시 */ }
  }
  const aq = await load(voice, { baseUrl: VOICES_BASE });
  current = { voice, aq };
  return aq;
}

// ── 구간별 속도·피치 ──────────────────────────────────────────────
// 가나 칸 태그로 그 자리부터 다음 같은 태그까지 속도/피치를 바꾼다.
//   [속도] : 50~300, 말 빠르기(절대).       예) [120]オハヨ[250]ゴザイマス
//   [±속도]: 현재 속도에서 ±n(상대·누적).   예) [+50]ハヤク[-50]モドル ([속도]의 > < 버전)
//   {반음} : -12~+12 반음, 음 높이(강세).   예) ガ{+4}ガ{0}ガ (가운데만 높게)
//   > / <  : 현재 피치에서 한 단계(±1반음) 올림/내림(상대·누적). 예) >ユックリ< (올렸다 원위치)
//   x      : 억양 초기화 경계. 。처럼 끊고 리셋하되 쉼 없이 이어 붙인다(단위별 따로 합성).
// 태그가 없으면 전체가 슬라이더 속도·기본 피치다(기존과 동일).
//
// AquesTalk1엔 구간 속도·피치 기능이 없다. 구간마다 따로 합성하면 호출마다 억양이
// 리셋돼 "문장이 끊긴다". 그래서 ① 태그를 다 떼고 전체를 한 번에 합성해 연속 억양을 얻고
// ② 합성된 오디오에서 각 구간에 해당하는 "시간 구간"만 골라 위상 보코더로 속도/피치를 바꾼다.
// 구간의 시간 위치는 음소 타이밍을 알 수 없어 모라 수 비례로 추정한다(±1모라 오차).
function clampSpeed(v) { return Math.min(300, Math.max(50, v | 0)); }
function clampSemis(v) { return Math.min(12, Math.max(-12, v | 0)); }

// 모라 수(박자) 추정용 가중치. 시간 슬라이스 위치를 모라 비례로 잡는 데 쓴다.
const SMALL_KANA = 'ァィゥェォャュョ';
function moraWeight(ch) {
  if (ch === '。') return 1.6;  // 쉼(retimePauses 목표 길이에 맞춤)
  if (ch === '、') return 0.4;  // 짧은 쉼
  if (ch === 'ー') return 1;    // 장음 +1박
  if (SMALL_KANA.includes(ch)) return 0; // 작은가나는 앞 글자와 한 모라
  if (/[ァ-ヶ]/.test(ch)) return 1;       // 일반 가타카나 1모라 (ッ ン 포함)
  return 0;                     // ' / 공백 등은 시간 없음
}
function moraSum(s) { let w = 0; for (const ch of s) w += moraWeight(ch); return w; }

// 태그를 파싱해 (속도·피치) 구간으로 나눈다. 값이 같은 이웃 구간은 하나로 합친다
// (값을 안 바꾸는 {0} 등은 구간을 나누지 않게 — 단일 합성이라 영향은 없지만 보코더 횟수를 줄임).
// init: 직전 단위에서 이어받는 시작 상태(속도·피치). x로 단위를 끊어도 사용자가 지정한
// 속도/누적 피치(> < {반음})는 보존하려고 마지막 상태를 돌려준다(억양 리셋은 따로 합성으로).
function parseSegments(kana, defaultSpeed, init) {
  const re = /\[([+-]?\d{1,3})\]|\{([+-]?\d{1,2})\}|([<>])/g;
  const raw = [];
  let speed = init?.speed ?? defaultSpeed, semis = init?.semis ?? 0, last = 0, m;
  const push = (t) => { if (t) raw.push({ text: t, speed, semis }); };
  while ((m = re.exec(kana)) !== null) {
    push(kana.slice(last, m.index));
    if (m[1] !== undefined)                                          // [속도] 절대 / [+n][-n] 상대 누적
      speed = clampSpeed(/^[+-]/.test(m[1]) ? speed + Number(m[1]) : Number(m[1]));
    else if (m[2] !== undefined) semis = clampSemis(Number(m[2]));   // {반음} 절대
    else semis = clampSemis(semis + (m[3] === '>' ? 1 : -1));        // > 올림 / < 내림 상대
    last = re.lastIndex;
  }
  push(kana.slice(last));
  const segs = [];
  for (const r of raw) {
    const prev = segs[segs.length - 1];
    if (prev && prev.speed === r.speed && prev.semis === r.semis) prev.text += r.text;
    else segs.push({ ...r });
  }
  return { segs, speed, semis };
}

// aq.run 결과(WAV 바이트)를 decodeAudioData가 받는 ArrayBuffer로.
function toArrayBuffer(wav) {
  if (wav instanceof ArrayBuffer) return wav;
  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
}

// 앞뒤 무음만 떼어낸 Float32 (내부 쉼 。、은 보존). margin 만큼 여유를 둔다.
function trimEnds(data, sr) {
  const n = data.length, thr = 0.004;
  let s = 0, e = n;
  while (s < n && Math.abs(data[s]) < thr) s++;
  while (e > s && Math.abs(data[e - 1]) < thr) e--;
  const margin = Math.round(sr * 0.005);
  s = Math.max(0, s - margin);
  e = Math.min(n, e + margin);
  return e > s ? data.subarray(s, e) : data.subarray(0, 0);
}

// AquesTalk가 ,(、)·.(。)에 넣는 쉼을 부호별 목표 길이로 다시 잡는다(,는 짧게·.는 살짝 길게).
// 핵심: 합성 오디오엔 쉼 무음 말고도 촉음(ッ) 무음이 섞여 있다. 쉼 무음은 촉음보다 길므로
// "가장 긴 N개"를 쉼으로 지목하고(N=쉼 묶음 수), 위치 순서대로 부호에 대응시킨다. 촉음 무음은
// 더 짧아 선택되지 않아 보존된다. (개수·위치 추정 방식은 촉음·긴쉼에서 어긋나 버그가 났음)
const PAUSE_TARGET = { '、': 0.045, '。': 0.24 };
function retimePauses(data, sr, fullKana) {
  const n = data.length, thr = 0.004, minGap = Math.round(sr * 0.05);
  const gaps = []; // 무음 구간 [start,end) (쉼 + 촉음 등 모두)
  for (let i = 0; i < n;) {
    let j = i;
    if (Math.abs(data[i]) < thr) { while (j < n && Math.abs(data[j]) < thr) j++; if (j - i >= minGap) gaps.push([i, j]); }
    else { while (j < n && Math.abs(data[j]) >= thr) j++; }
    i = j;
  }
  if (!gaps.length) return data;
  // 쉼 묶음별 목표 길이(초), 텍스트 순서. 연속 쉼(.. ,, 등)은 AquesTalk가 무음 1개(N배 길이)로
  // 합쳐 내므로 마크도 하나로 묶고 목표를 합산한다(...→0.72s).
  const marks = [];
  for (let idx = 0; idx < fullKana.length; idx++) {
    const ch = fullKana[idx], prev = fullKana[idx - 1];
    if (ch === '、' || ch === '。') {
      if (marks.length && (prev === '、' || prev === '。')) marks[marks.length - 1] += PAUSE_TARGET[ch];
      else marks.push(PAUSE_TARGET[ch]);
    }
  }
  if (!marks.length) return data;
  // 가장 긴 무음 N개 = 쉼(촉음보다 김). 위치 순으로 정렬해 부호(텍스트 순)와 1:1 대응.
  const byLen = [...gaps.keys()].sort((a, b) => (gaps[b][1] - gaps[b][0]) - (gaps[a][1] - gaps[a][0]));
  const pauseIdx = byLen.slice(0, marks.length).sort((a, b) => a - b);
  const target = new Map();
  pauseIdx.forEach((gi, k) => target.set(gi, marks[k]));
  if (!target.size) return data;
  // 재조립: 매칭된 무음을 "정확히" 합산 목표 길이의 무음으로 교체한다. AquesTalk가 ,,를
  // 얼마로 내든(렌더 gap 길이) 의존하지 않고 우리가 합산한 값을 그대로 박는다. 그래서
  // ,,는 항상 ,의 2배가 된다. 나머지 무음(촉음 등)은 그대로 보존.
  const pieces = []; let prev = 0; // {a,b}=원본 복사 | {sil}=무음 삽입(샘플 수)
  for (let gi = 0; gi < gaps.length; gi++) {
    if (!target.has(gi)) continue;
    const [a, b] = gaps[gi];
    pieces.push({ a: prev, b: a });
    pieces.push({ sil: Math.round(target.get(gi) * sr) });
    prev = b;
  }
  pieces.push({ a: prev, b: n });
  let outLen = 0; for (const p of pieces) outLen += p.sil != null ? p.sil : (p.b - p.a);
  const out = new Float32Array(outLen);
  let off = 0;
  for (const p of pieces) {
    if (p.sil != null) { off += p.sil; } // 0으로 초기화돼 있어 그대로 무음
    else { out.set(data.subarray(p.a, p.b), off); off += p.b - p.a; }
  }
  return out;
}

// 문자 위치 → 샘플 위치 매핑(fullKana 코드포인트 경계마다 한 칸, 길이 = 글자수+1).
// 쉼(、。)은 retimePauses가 박은 "실제 고정 길이"(PAUSE_TARGET)를 그대로 차지하고, 나머지
// 샘플(=발음·촉음)만 발음 모라에 비례 배분한다. 쉼을 모라 가중치(0.4/1.6)로 근사하던 기존
// 방식은 그 근사값이 고정 길이와 어긋나, 쉼이 길어질수록(쉼표 중첩) 뒤따르는 구간 경계가
// 밀려 반음·속도 전환 타이밍이 어긋났다. retime 실패 등으로 쉼 길이가 안 맞으면 모라비례로 폴백.
function charSampleMap(fullKana, M, sr) {
  let pauseSamples = 0, speechMora = 0;
  for (const ch of fullKana) {
    const pt = PAUSE_TARGET[ch];
    if (pt != null) pauseSamples += pt * sr;
    else speechMora += moraWeight(ch);
  }
  const map = [0];
  if (pauseSamples >= M || speechMora <= 0) { // 폴백: 전부 모라 비례
    const total = moraSum(fullKana) || 1;
    let cum = 0;
    for (const ch of fullKana) { cum += moraWeight(ch); map.push((cum / total) * M); }
    return map;
  }
  const speechSamples = M - pauseSamples;
  let s = 0;
  for (const ch of fullKana) {
    const pt = PAUSE_TARGET[ch];
    s += pt != null ? pt * sr : (moraWeight(ch) / speechMora) * speechSamples;
    map.push(s);
  }
  return map;
}

// ── DSP: FFT · 위상 보코더 · 리샘플 ──────────────────────────────
// 외부 의존성 없이 인라인 구현. 단일 합성 오디오의 한 구간만 시간축/피치로 변형한다.
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function hann(N) {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  return w;
}

// 박스카 이동평균(러닝합)으로 계단 파라미터를 완만한 램프로 바꾼다. 경계의 피치/속도
// 급변을 win 길이에 걸쳐 점진적 글라이드로 만들어 불연속(클릭)과 계단형 억양을 없앤다.
function smooth(arr, win) {
  const n = arr.length;
  if (win < 2 || n === 0) return arr;
  const half = win >> 1;
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < Math.min(half, n); i++) sum += arr[i];
  let cnt = Math.min(half, n);
  for (let i = 0; i < n; i++) {
    const add = i + half, sub = i - half - 1;
    if (add < n) { sum += arr[add]; cnt++; }
    if (sub >= 0) { sum -= arr[sub]; cnt--; }
    out[i] = sum / cnt;
  }
  return out;
}

// 양끝 페이드(클릭/끊김 방지). 끝은 좀 더 길게 줘 마지막 음절이 "팍" 잘리지 않고
// 자연스럽게 잦아들게 한다. (제자리 수정)
function fadeEdges(a, sr) {
  const fi = Math.min(Math.round(sr * 0.006), a.length >> 1);   // 시작 6ms
  const fo = Math.min(Math.round(sr * 0.018), a.length >> 1);   // 끝 18ms
  for (let i = 0; i < fi; i++) a[i] *= i / fi;
  for (let i = 0; i < fo; i++) a[a.length - 1 - i] *= i / fo;
  return a;
}

// 시변(time-varying) 위상 보코더: 전체를 한 번에 통과시키며 표본별 피치비 p[]·시간축 g[](=p*속도)를
// 적용한다. 합성 위상(sumPhase)이 끝까지 안 끊겨 구간 경계의 클릭이 원천적으로 안 생긴다.
//   1단계: 가변 분석홉으로 g 배 시간신축(피치 보존) → Y
//   2단계: Y를 p 비율로 가변 리샘플 → 피치 ×p, 길이는 g/p=속도배
function warpVocoder(x, g, p, sr) {
  const N = 1024, Rs = 256, twoPi = 2 * Math.PI, L = x.length;
  const win = hann(N);
  // 끝에 N 무음 패딩: 분석 프레임이 마지막 실제 샘플까지 완전히 덮게 한다. 패딩이 없으면
  // 루프가 입력 끝 N만큼을 못 읽어 마지막 음절이 잘리고, 정규화 테이퍼도 끝 음절을 깎는다.
  const xp = new Float32Array(L + N); xp.set(x);
  let G = 0; for (let i = 0; i < L; i++) G += g[i];          // ≈ 1단계 출력 길이
  const framesCap = Math.ceil(G / Rs) + 8;
  const Y = new Float32Array(framesCap * Rs + N), Ynorm = new Float32Array(Y.length);
  const taAtFrame = new Float32Array(framesCap);
  const lastPhase = new Float32Array(N / 2 + 1), sumPhase = new Float32Array(N / 2 + 1);
  const re = new Float32Array(N), im = new Float32Array(N);
  let ta = 0, prevTa = 0, m = 0;
  while (ta < L && m < framesCap) { // 마지막 실제 샘플(ta<L)까지 프레임 생성
    const base = Math.floor(ta);
    for (let i = 0; i < N; i++) { re[i] = xp[base + i] * win[i]; im[i] = 0; }
    fft(re, im, false);
    const da = ta - prevTa; // 이번 프레임의 분석홉(가변)
    for (let k = 0; k <= N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const phase = Math.atan2(im[k], re[k]);
      if (m === 0) { sumPhase[k] = phase; }
      else {
        const omega = twoPi * k / N;            // 표본당 빈 중심 주파수
        let dphi = phase - lastPhase[k] - omega * da;
        dphi -= twoPi * Math.round(dphi / twoPi);
        sumPhase[k] += (omega + dphi / da) * Rs; // 참주파수 × 합성홉
      }
      lastPhase[k] = phase;
      re[k] = mag * Math.cos(sumPhase[k]); im[k] = mag * Math.sin(sumPhase[k]);
    }
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    im[0] = 0; im[N / 2] = 0;
    fft(re, im, true);
    const off = m * Rs;
    for (let i = 0; i < N; i++) { Y[off + i] += re[i] * win[i]; Ynorm[off + i] += win[i] * win[i]; }
    taAtFrame[m] = ta;
    prevTa = ta;
    ta += Rs / g[Math.min(L - 1, base)]; // g>1 → 천천히 전진(늘림)
    m++;
  }
  const numFrames = m, Ylen = numFrames > 0 ? (numFrames - 1) * Rs + N : 0;
  // 합성측 overlap-add 정규화. 합성홉 Rs가 일정해 가운데(완전 겹침)의 norm은 상수다.
  // 표본별 Ynorm으로 나누면 겹침이 적은 양끝에서 0에 가까운 값으로 나눠 진폭이 폭발한다
  // (끝부분 "팍팍" 튐의 원인). 그 상수(최댓값)로 나누면 양끝은 자연 감쇠(테이퍼)돼 폭발이 없다.
  let maxN = 0; for (let i = 0; i < Ylen; i++) if (Ynorm[i] > maxN) maxN = Ynorm[i];
  if (maxN > 0) for (let i = 0; i < Ylen; i++) Y[i] /= maxN;

  // 2단계: Y를 p 비율로 가변 리샘플 (p는 해당 프레임의 입력시각 ta로 역참조)
  const fin = new Float32Array(Math.ceil(Ylen * 2) + 4);
  let rp = 0, fi = 0;
  while (rp < Ylen - 1 && fi < fin.length) {
    const fm = Math.min(numFrames - 1, Math.floor(rp / Rs));
    const tau = taAtFrame[fm];
    const pl = p[Math.min(L - 1, Math.max(0, Math.round(tau)))] || 1;
    const i0 = Math.floor(rp), frac = rp - i0;
    fin[fi++] = Y[i0] + (Y[i0 + 1] - Y[i0]) * frac;
    rp += pl;
  }
  return fin.subarray(0, fi);
}

// 한 합성 단위(x로 끊긴 한 덩어리)를 합성·후처리해 { data, state }로 돌려준다. (fade/pad/재생은 호출측)
// 단위마다 따로 aq.run 하므로 AquesTalk 억양이 단위별로 리셋된다(= x의 "초기화"). 단, 속도·누적
// 피치(> < {반음})는 init으로 이어받고 마지막 state로 돌려줘, x가 그 값까지 리셋하지 않게 한다.
async function synthUnit(aq, ctx, unitKana, baseSpeed, init) {
  const { segs, speed, semis } = parseSegments(unitKana, baseSpeed, init);
  const state = { speed, semis };
  const fullKana = segs.map((s) => s.text).join('').trim();
  if (!fullKana) return { data: null, state };
  await new Promise((r) => setTimeout(r, 0)); // 동기 합성 전 UI 갱신 양보
  const decoded = await ctx.decodeAudioData(toArrayBuffer(aq.run(fullKana, baseSpeed)));
  const sr = decoded.sampleRate;
  const data = retimePauses(trimEnds(decoded.getChannelData(0), sr), sr, fullKana);
  // 구간 경계를 글자→샘플 매핑(쉼은 고정 길이, 발음은 모라 비례)으로 찍어 표본별 피치(반음)·
  // 속도 파라미터를 만든다. 쉼표가 중첩돼도 쉼 길이를 정확히 반영해 전환 타이밍이 안 밀린다.
  const M = data.length;
  const map = charSampleMap(fullKana, M, sr);
  const semisArr = new Float32Array(M);
  const tsArr = new Float32Array(M).fill(1);
  let cp = 0, changed = false;
  for (let i = 0; i < segs.length; i++) {
    const startS = Math.round(map[cp]);
    cp += [...segs[i].text].length;
    const endS = i === segs.length - 1 ? M : Math.round(map[cp]);
    const ts = baseSpeed / segs[i].speed;
    for (let n = startS; n < endS; n++) { semisArr[n] = segs[i].semis; tsArr[n] = ts; }
    if (segs[i].semis !== 0 || segs[i].speed !== baseSpeed) changed = true;
  }
  if (!changed) return { data: data.slice(), state }; // 태그 없음 → 원본 그대로
  await new Promise((r) => setTimeout(r, 0)); // 무거운 변형 전 UI 양보
  // 경계를 ~40ms 램프로 완만하게: 계단형 급변과 위상 불연속 제거
  const win = Math.max(2, Math.round(sr * 0.04));
  const sS = smooth(semisArr, win), tS = smooth(tsArr, win);
  const p = new Float32Array(M), g = new Float32Array(M);
  for (let n = 0; n < M; n++) { p[n] = Math.pow(2, sS[n] / 12); g[n] = p[n] * tS[n]; }
  return { data: warpVocoder(data, g, p, sr), state };
}

// 쉼 부호 1개의 길이(초). x 경계에선 쉼을 명시적 무음으로 바꿔 넣는다(아래 참고).
function pauseSec(ch) {
  if (ch === '。' || ch === '.') return 0.18;
  if (ch === '、' || ch === ',') return 0.08;
  return 0;
}

// 단위의 앞뒤 쉼 부호(、。)를 떼어 초 단위 길이로 환산하고, 가운데(core)만 합성 텍스트로 남긴다.
// (앞뒤 쉼은 따로 합성하면 무음→trimEnds로 증발하므로, 명시적 무음으로 단위 사이에 끼운다)
function splitPause(unit) {
  let i = 0, j = unit.length, lead = 0, trail = 0, s;
  while (i < j && (s = pauseSec(unit[i]))) { lead += s; i++; }
  while (j > i && (s = pauseSec(unit[j - 1]))) { trail += s; j--; }
  return { lead, core: unit.slice(i, j), trail };
}

function silenceArr(sec, sr) { return new Float32Array(Math.max(0, Math.round(sec * sr))); }

// AquesTalk1은 촉음 ッ 뒤에 자음으로 시작하는 모라가 와야 한다. 어말·쉼(、。)·x 경계·
// 모음가나(ア행)·ン·ー·ッ 앞에 놓인 ッ은 합성 오류(ERROR 102)나 이상한 소리(앗→아쏘)를 낸다.
// 한국어 변환은 어말 파열음 받침을 이미 떨어뜨리지만(codaKana), 가나 칸 직접 입력은
// 이 경로로 바로 들어오므로 여기서 "매달린 ッ"을 떨어뜨린다. 예) アッ→ア, …ヨ、アッ→…ヨ、ア
const SOKUON_VOWEL = new Set([...'アイウエオァィゥェォ']);
function dropDanglingSokuon(s) {
  const a = [...s];
  const out = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 'ッ') {
      // 뒤따르는 운율기호('><)·구간태그([..]{..})를 건너뛰고 다음 가나를 본다.
      let j = i + 1;
      while (j < a.length) {
        const c = a[j];
        if (c === "'" || c === '>' || c === '<') { j++; continue; }
        if (c === '[' || c === '{') {
          const close = c === '[' ? ']' : '}';
          while (j < a.length && a[j] !== close) j++;
          j++; continue;
        }
        break;
      }
      const nxt = a[j];
      const geminable = nxt && /[ァ-ヶ]/.test(nxt)
        && !SOKUON_VOWEL.has(nxt) && nxt !== 'ン' && nxt !== 'ー' && nxt !== 'ッ';
      if (!geminable) continue; // 떨어뜨림
    }
    out.push(a[i]);
  }
  return out.join('');
}

// 운율 보조 표기 정규화(normalizeProsody: ' 통일, 하이픈→장음 ー)를 구간 태그 바깥에만 적용한다.
// 태그([±속도] {±반음}) 안의 음수 부호 -가 장음 ー로 바뀌면 파싱이 깨져 그 태그가 글자 그대로
// AquesTalk에 넘어가 ERROR 105가 난다. 태그는 ASCII 그대로 두고 그 사이 텍스트만 정규화한다.
const TAG_RE = /\[[+-]?\d{1,3}\]|\{[+-]?\d{1,2}\}/g;
function normalizeProsodyOutsideTags(s) {
  let out = '', last = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s)) !== null) {
    out += normalizeProsody(s.slice(last, m.index)) + m[0];
    last = TAG_RE.lastIndex;
  }
  return out + normalizeProsody(s.slice(last));
}

// 오디오/무음 조각들을 잇는다. fade=true(쉼 없는 x 경계)면 등파워 크로스페이드로 매끄럽게
// 겹치고, 아니면(무음을 낀 경계) 그대로 맞붙인다(조각 끝/시작이 잦아들어 클릭 없음).
function concatItems(items, sr) {
  items = items.filter((it) => it.data && it.data.length);
  if (items.length === 0) return new Float32Array(0);
  const fadeLen = Math.round(sr * 0.025); // 25ms 겹침
  let cap = 0; for (const it of items) cap += it.data.length;
  const out = new Float32Array(cap);
  out.set(items[0].data, 0);
  let pos = items[0].data.length;
  for (let i = 1; i < items.length; i++) {
    const s = items[i].data;
    const f = items[i].fade ? Math.min(fadeLen, pos, s.length) : 0;
    const start = pos - f;
    for (let j = 0; j < f; j++) {
      const t = (j + 0.5) / f;
      out[start + j] = out[start + j] * Math.cos(t * Math.PI / 2) + s[j] * Math.sin(t * Math.PI / 2);
    }
    out.set(s.subarray(f), start + f);
    pos = start + f + (s.length - f);
  }
  return out.slice(0, pos);
}

// 공통 재생: 주어진 가나 문자열을 합성해 재생한다. btn은 UI를 표시할 버튼.
// 준비/합성 중이면 무시, 재생 중인 같은 버튼을 다시 누르면 정지, 다른 버튼이면 멈추고 새로 재생.
async function playKana(kana, btn) {
  if (busy) return;
  if (currentSource) {
    const wasActive = activeBtn === btn;
    stopPlayback();
    resetPlayUI();
    if (wasActive) return;
  }

  // 합성용으로 가타카나로 정규화하고, 운율 보조 표기(' / 하이픈→장음 ー)도
  // AquesTalk1이 받는 형태로 정리한다. ([속도] 태그는 ASCII라 정규화에 안 걸림)
  // 변환결과 칸은 . , 를 ASCII로 보여주지만, 실제 합성은 AquesTalk1 쉼 기호 。 、 로 바꿔 넣는다.
  // 공백문자(스페이스·탭·줄바꿈)는 합성에서 의미가 없으므로 모두 제거한다.
  // @ : '여기서부터 재생'. @ 뒤(여러 개면 마지막 @ 기준)만 합성해, 중간을 편집하고도
  //     매번 처음부터 듣지 않게 한다. (@ 자체는 빠지고, 하이라이트도 @ 뒤만 칠한다 → buildHighlight)
  //     단, @ 앞에서 지정한 속도·피치([속도] {반음} > <)는 @ 시점의 누적 상태로 이어받아
  //     재생한다. parseSegments로 prefix의 태그를 끝까지 훑어 마지막 상태를 얻는다(x는 일반 글자
  //     취급이라 속도/피치 누적엔 영향 없음 — x는 억양 리셋만).
  let atInit = null;
  const atPos = kana.lastIndexOf('@');
  if (atPos >= 0) {
    const pre = parseSegments(kana.slice(0, atPos), Number(speedEl.value));
    atInit = { speed: pre.speed, semis: pre.semis };
    kana = kana.slice(atPos + 1);
  }

  kana = normalizeProsodyOutsideTags(hiraToKata(kana))
    .replace(/\./g, '。')
    .replace(/,/g, '、')
    .replace(/\s+/g, '')
    .trim();
  kana = dropDanglingSokuon(kana); // 자음 모라가 안 오는 촉음 ッ 제거 (ERROR 102/이상한 소리 방지)
  if (!kana) { setError(btn, '가나가 비어 있음'); return; }

  setError(btn); // 이전 오류 메시지 지우기
  busy = true;
  activeBtn = btn;
  setPlayUI(btn, 'loading');

  // 1) 음성 로드 + (x로 끊긴) 단위별 합성·후처리 후 이어붙이기 (실제 실패가 날 수 있는 구간)
  let buffer;
  try {
    const aq = await ensureVoice(voiceEl.value);
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const baseSpeed = Number(speedEl.value);
    const sr = ctx.sampleRate;

    // x(초기화·무쉼 경계)로 합성 단위를 나눈다. 단위마다 따로 합성해 억양을 리셋하고,
    // 쉼 없이 크로스페이드로 잇는다. x가 없으면 단위 하나(기존과 동일).
    // x 경계에 붙은 쉼(,,, 등)은 합성하면 무음→trim으로 증발하므로, 명시적 무음으로 끼운다.
    const units = kana.split(/[xXｘＸ]/);
    const items = [];
    let pending = 0; // 다음 오디오 앞에 넣을 누적 무음(초)
    let state = atInit || { speed: baseSpeed, semis: 0 }; // x 경계·@ 시작을 넘어 이어지는 속도·누적 피치
    for (const u of units) {
      const { lead, core, trail } = splitPause(u);
      pending += lead;
      let m = null;
      if (core) { const r = await synthUnit(aq, ctx, core, baseSpeed, state); state = r.state; m = r.data; }
      if (m && m.length) {
        if (items.length && pending > 0) {
          items.push({ data: silenceArr(pending, sr), fade: false }); // 쉼 → 무음 삽입
          items.push({ data: m, fade: false });
        } else {
          items.push({ data: m, fade: items.length > 0 }); // 0갭 x 경계 → 크로스페이드
        }
        pending = trail;
      } else {
        pending += trail; // 합성할 게 없으면(순수 쉼 단위 등) 쉼만 누적
      }
    }
    const merged = concatItems(items, sr);
    if (!merged.length) throw new Error('읽을 가나가 없음');
    fadeEdges(merged, sr); // 시작/끝 클릭 방지

    // 끝에 무음 패딩 — 자연 종료(자동 정지)의 노드 해제·스트림 닫힘이 무음 구간에서
    // 일어나게 해 "팍" 소리를 분리한다.
    const pad = Math.round(sr * 0.04);
    buffer = merged.length ? ctx.createBuffer(1, merged.length + pad, sr) : null;
    if (buffer) buffer.copyToChannel(merged, 0);
  } catch (e) {
    console.error(e);
    busy = false;
    setError(btn, '오류: ' + (e?.message || e));
    resetPlayUI();
    return;
  }
  busy = false;
  if (!buffer) { setError(btn, '합성 결과가 비어 있음'); resetPlayUI(); return; }

  // 2) 재생 시작 (Source → Gain → 출력. 정지 시 게인 램프다운으로 클릭 방지)
  stopPlayback(); // 혹시 남은 것 정리
  const ctx = getCtx();
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(ctx.destination);
  currentSource = src;
  currentGain = gain;
  src.onended = () => { if (currentSource === src) { stopPlayback(); resetPlayUI(); } };
  setPlayUI(btn, 'playing');
  src.start();
  // 아래쪽(고급) 재생만: 가나 칸의 현재 덩어리를 따라 하이라이트한다.
  if (btn === playKanaBtn) startHighlight(buffer);
}

// ▼ 변환 버튼을 눌러야 비로소 한국어 칸 → 고급 편집 칸으로 옮긴다(실시간 갱신 안 함).
convertBtn.addEventListener('click', regenerate);
// 가나 칸을 직접 고치면 편집 플래그를 세우고 한국어 읽기 보조 표기도 따라 갱신
kanaEl.addEventListener('input', () => {
  if (!suppressDirty) kanaDirty = true;
  updateKanaRead();
});
// 자동 / 토글 버튼: 켜고 끌 때 상태만 바꾼다. 고급 편집 칸은 ▼ 변환을 눌러야 갱신된다.
autoSlashBtn.addEventListener('click', () => {
  autoSlash = !autoSlash;
  autoSlashBtn.classList.toggle('active', autoSlash);
  autoSlashBtn.setAttribute('aria-pressed', String(autoSlash));
});
speedEl.addEventListener('input', () => { speedVal.textContent = speedEl.value; });
// 위쪽(라이트): 한국어 칸을 단순 변환해 재생
playBtn.addEventListener('click', () => playKana(koreanKana(), playBtn));
// 아래쪽(고급): 가나 칸을 그대로(직접 넣은 ' / 포함) 재생
playKanaBtn.addEventListener('click', () => playKana(kanaEl.value, playKanaBtn));
// 음성을 바꾸면 재생 중인 소리는 멈춤
voiceEl.addEventListener('change', () => { if (currentSource) { stopPlayback(); resetPlayUI(); } });

// ── 가나 키보드 ───────────────────────────────────────────────────
// 청음/탁음·반탁음/작은가나·기호를 탭으로 나눠 한 화면당 키 수를 줄이고 키를 키운다.
// 키는 가나 칸의 (기억해 둔) 커서 위치에 삽입. ⌫는 커서 앞 한 글자 삭제.
const KB_BASE = [
  ['ア','イ','ウ','エ','オ'],
  ['カ','キ','ク','ケ','コ'],
  ['サ','シ','ス','セ','ソ'],
  ['タ','チ','ツ','テ','ト'],
  ['ナ','ニ','ヌ','ネ','ノ'],
  ['ハ','ヒ','フ','ヘ','ホ'],
  ['マ','ミ','ム','メ','モ'],
  ['ヤ','','ユ','','ヨ'],
  ['ラ','リ','ル','レ','ロ'],
  ['ワ','ヲ','ン','',''],
];
const KB_DAKU = [
  ['ガ','ギ','グ','ゲ','ゴ'],
  ['ザ','ジ','ズ','ゼ','ゾ'],
  ['ダ','ヂ','ヅ','デ','ド'],
  ['バ','ビ','ブ','ベ','ボ'],
  ['パ','ピ','プ','ペ','ポ'],
];
const KB_SMALL = [
  ['ァ','ィ','ゥ','ェ','ォ'],
  ['ャ','ュ','ョ','ッ','ー'],
  ["'", '、', '。', '⌫', ''],
];

const KB_TABS = [['청음', KB_BASE], ['탁음·반탁음', KB_DAKU], ['스테가나·기호', KB_SMALL]];
const kbGrids = [];

// 단독으로 한글 한 음절이 안 되는 가나는 교재에서 통용되는 표기로 보여 준다.
//   ン→응, ッ→촉음, ー→장음, 스테가나(작은 가나)는 그 가나가 내는 모음/요음으로.
const KANA_READ_OVERRIDE = {
  'ン': '응', 'ッ': '촉음', 'ー': '장음',
  'ァ': '아', 'ィ': '이', 'ゥ': '우', 'ェ': '에', 'ォ': '오',
  'ャ': '야', 'ュ': '유', 'ョ': '요',
};

// 버튼 아래에 보조로 띄울 한글 발음. 운율·구분 기호(' 、 。 ⌫)는 비워 둔다.
function kanaReading(ch) {
  if (ch in KANA_READ_OVERRIDE) return KANA_READ_OVERRIDE[ch];
  const r = katakanaToKorean(ch);
  return /^[가-힣]+$/.test(r) ? r : '';
}

function buildKeyboard() {
  KB_TABS.forEach(([label, rows], i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = label;
    tab.dataset.tab = i;
    if (i === 0) tab.classList.add('active');
    kbdTabs.appendChild(tab);

    const grid = document.createElement('div');
    grid.className = 'kbd-grid';
    grid.hidden = i !== 0;
    for (const row of rows) for (const ch of row) {
      if (ch === '') { const s = document.createElement('span'); s.className = 'spacer'; grid.appendChild(s); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.k = ch;
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = ch;
      b.appendChild(k);
      const reading = kanaReading(ch);
      if (reading) {
        const r = document.createElement('span');
        r.className = 'r';
        r.textContent = reading;
        b.appendChild(r);
      }
      grid.appendChild(b);
    }
    kbGrids.push(grid);
    kbdBody.appendChild(grid);
  });
}
buildKeyboard();

function showTab(i) {
  kbGrids.forEach((g, j) => { g.hidden = j !== i; });
  for (const t of kbdTabs.children) t.classList.toggle('active', Number(t.dataset.tab) === i);
}
kbdTabs.addEventListener('click', (e) => {
  const t = e.target.closest('button[data-tab]');
  if (t) showTab(Number(t.dataset.tab));
});

// 가나 칸의 커서 위치를 기억해 둔다(모달이 열리면 포커스가 칸을 벗어나므로).
let caret = null; // { s, e }
const rememberCaret = () => { caret = { s: kanaEl.selectionStart, e: kanaEl.selectionEnd }; };
for (const ev of ['keyup', 'click', 'select', 'focus', 'input']) kanaEl.addEventListener(ev, rememberCaret);

// 기억한 커서 위치에 문자열 삽입 (선택 영역이 있으면 대체)
function insertKana(text) {
  const len = kanaEl.value.length;
  let s = Math.min(caret ? caret.s : len, len);
  const e = Math.min(caret ? caret.e : len, len);
  kanaEl.value = kanaEl.value.slice(0, s) + text + kanaEl.value.slice(e);
  const pos = s + text.length;
  caret = { s: pos, e: pos };
  kanaEl.setSelectionRange(pos, pos);
  kanaDirty = true;
  updateKanaRead();
}
// 커서 앞 한 글자 삭제 (선택 영역이 있으면 그 영역 삭제)
function backspaceKana() {
  const len = kanaEl.value.length;
  let s = Math.min(caret ? caret.s : len, len);
  const e = Math.min(caret ? caret.e : len, len);
  if (s === e) { if (s === 0) return; s -= 1; }
  kanaEl.value = kanaEl.value.slice(0, s) + kanaEl.value.slice(e);
  caret = { s, e: s };
  kanaEl.setSelectionRange(s, s);
  kanaDirty = true;
  updateKanaRead();
}

function openKeyboard() { kbdEl.hidden = false; kbToggle.classList.add('active'); }
function closeKeyboard() { kbdEl.hidden = true; kbToggle.classList.remove('active'); }

kbToggle.addEventListener('click', () => (kbdEl.hidden ? openKeyboard() : closeKeyboard()));
// Esc 로만 닫기 (바깥 클릭으로는 닫지 않음)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !kbdEl.hidden) closeKeyboard(); });

// mousedown에서 처리(+preventDefault)해 모달 클릭이 가나 칸 선택을 흐트러뜨리지 않게
kbdBody.addEventListener('mousedown', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  e.preventDefault();
  if (b.dataset.k === '⌫') backspaceKana();
  else insertKana(displayKana(b.dataset.k));
});

// 히라가나 토글: 켜고 끌 때 키보드 라벨·예시·편집창을 한꺼번에 가타카나↔히라가나로 바꾼다.
// dataset.k(키 정체)는 가타카나로 두고, 보이는 .k 라벨과 삽입 문자만 모드를 따른다.
const exampleCodes = [...document.querySelectorAll('.examples code')]
  .map((el) => ({ el, kata: el.textContent }));

function refreshKeyboardLabels() {
  for (const b of kbdBody.querySelectorAll('button[data-k]')) {
    const k = b.querySelector('.k');
    if (k) k.textContent = displayKana(b.dataset.k);
  }
}
function refreshExamples() {
  for (const { el, kata } of exampleCodes) el.textContent = displayKana(kata);
}

hiraToggle.addEventListener('click', () => {
  hiragana = !hiragana;
  hiraToggle.classList.toggle('active', hiragana);
  hiraToggle.setAttribute('aria-pressed', String(hiragana));
  // 편집창 내용도 현재 모드로 변환 (양방향 가역 변환이라 안전)
  kanaEl.value = hiragana ? kataToHira(kanaEl.value) : hiraToKata(kanaEl.value);
  updateKanaRead();
  refreshKeyboardLabels();
  refreshExamples();
});

// 첫 로드 시 기본 한국어를 변환해 변환결과 칸을 채운다
regenerate();
