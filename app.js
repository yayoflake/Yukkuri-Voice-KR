// app.js — UI 글루: 한국어 → 가타카나 변환 후 AquesTalk1로 합성/재생
import { load } from './vendor/aquestalk.bundle.js';
import { koreanToKatakana, hiraToKata, normalizeProsody } from './k2k.js?v=20260621';
import { normalizeNumbers } from './numread.js?v=20260621';

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const voiceEl = $('voice');
const speedEl = $('speed');
const speedVal = $('speedval');
const playBtn = $('play');         // 위쪽(라이트): 한국어 칸을 단순 변환해 재생
const playKanaBtn = $('playkana'); // 아래쪽(고급): 가나 칸을 그대로 재생
const kanaEl = $('kana');          // 편집 가능한 가나 칸 (아래쪽 재생의 기준)
const msgEl = $('msg');            // 위쪽 재생 버튼 밑 오류 메시지 (붉은글씨)
const msgKanaEl = $('msgkana');    // 아래쪽 재생 버튼 밑 오류 메시지
const autoSlashBtn = $('autoslash'); // 띄어쓰기 → 악센트구 / 자동 변환 토글 버튼
const kbToggle = $('kbtoggle');    // 가나 키보드 열기
const kbdEl = $('kbd');            // 가나 키보드 팝오버
const kbdTabs = $('kbdtabs');      // 탭(청음/탁음/작은가나)
const kbdBody = $('kbdbody');      // 탭별 키 그리드가 들어갈 영역

// 음성 자산(zip/wasm)이 들어있는 폴더
const VOICES_BASE = new URL('voices/', document.baseURI).href;

// 현재 로드된 AquesTalk 인스턴스 (음성당 ~1GB라 한 번에 하나만 유지)
let current = null;        // { voice, aq }
let busy = false;          // 로드/합성 중 (이때 버튼은 잠금)
let currentAudio = null;   // 재생 중인 Audio (있으면 = 재생 중)
let lastUrl = null;
let activeBtn = null;      // 재생/준비 UI를 표시 중인 버튼 (위/아래)

// 재생창 밑 메시지: 오류만 붉은글씨로 표시. btn에 따라 위/아래 메시지 칸을 고른다.
// (재생중/재생완료 같은 상태는 재생 버튼의 표시가 대신하므로 메시지로 띄우지 않는다)
function setError(btn, msg = '') {
  (btn === playKanaBtn ? msgKanaEl : msgEl).textContent = msg;
}

// 버튼의 평상시(idle) 라벨 — 위/아래가 다르다
function idleLabel(btn) {
  return '▶ 재생';
}

// 버튼 상태:  'idle' ▶재생 / 'loading' ⏳준비중 / 'playing' ■정지
function setPlayUI(btn, mode) {
  btn.disabled = (mode === 'loading');
  btn.textContent =
    mode === 'loading' ? '⏳ 준비 중…' :
    mode === 'playing' ? '■ 정지' : idleLabel(btn);
}

// 두 버튼을 모두 idle로 되돌린다 (재생 종료/중지/오류 시)
function resetPlayUI() {
  setPlayUI(playBtn, 'idle');
  setPlayUI(playKanaBtn, 'idle');
  activeBtn = null;
}

// 재생 중지 + 리소스 정리
function stopPlayback() {
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
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

// 한국어 입력이 바뀌면 가나 칸을 새로 채운다 (변환결과 표시 + 고급 편집의 출발점)
function regenerate() {
  kanaEl.value = koreanKana();
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

// 공통 재생: 주어진 가나 문자열을 합성해 재생한다. btn은 UI를 표시할 버튼.
// 준비/합성 중이면 무시, 재생 중인 같은 버튼을 다시 누르면 정지, 다른 버튼이면 멈추고 새로 재생.
async function playKana(kana, btn) {
  if (busy) return;
  if (currentAudio) {
    const wasActive = activeBtn === btn;
    stopPlayback();
    resetPlayUI();
    if (wasActive) return;
  }

  // 합성용으로 가타카나로 정규화하고, 운율 보조 표기(' / 하이픈→장음 ー)도
  // AquesTalk1이 받는 형태로 정리한다.
  kana = normalizeProsody(hiraToKata(kana)).trim();
  if (!kana) { setError(btn, '가나가 비어 있음'); return; }

  setError(btn); // 이전 오류 메시지 지우기
  busy = true;
  activeBtn = btn;
  setPlayUI(btn, 'loading');

  // 1) 음성 로드 + 합성 (실제 실패가 날 수 있는 구간)
  let wav;
  try {
    const aq = await ensureVoice(voiceEl.value);
    await new Promise((r) => setTimeout(r, 0)); // 동기 합성 전 UI 갱신 양보
    wav = aq.run(kana, Number(speedEl.value));
  } catch (e) {
    console.error(e);
    busy = false;
    setError(btn, '오류: ' + (e?.message || e));
    resetPlayUI();
    return;
  }
  busy = false;

  // 2) 재생 시작
  stopPlayback(); // 혹시 남은 것 정리
  lastUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  const audio = new Audio(lastUrl);
  currentAudio = audio;
  audio.onended = () => { stopPlayback(); resetPlayUI(); };
  setPlayUI(btn, 'playing');
  audio.play().catch((e) => {
    // 정지(stopPlayback)로 인한 중단(AbortError)은 정상이므로 무시
    if (e && e.name === 'AbortError') return;
    console.error(e);
    stopPlayback();
    setError(btn, '재생 오류: ' + (e?.message || e));
    resetPlayUI();
  });
}

textEl.addEventListener('input', regenerate);
// 자동 / 토글 버튼: 켜고 끌 때마다 변환결과를 다시 만든다
autoSlashBtn.addEventListener('click', () => {
  autoSlash = !autoSlash;
  autoSlashBtn.classList.toggle('active', autoSlash);
  autoSlashBtn.setAttribute('aria-pressed', String(autoSlash));
  regenerate();
});
speedEl.addEventListener('input', () => { speedVal.textContent = speedEl.value; });
// 위쪽(라이트): 한국어 칸을 단순 변환해 재생
playBtn.addEventListener('click', () => playKana(koreanKana(), playBtn));
// 아래쪽(고급): 가나 칸을 그대로(직접 넣은 ' / 포함) 재생
playKanaBtn.addEventListener('click', () => playKana(kanaEl.value, playKanaBtn));
// 음성을 바꾸면 재생 중인 소리는 멈춤
voiceEl.addEventListener('change', () => { if (currentAudio) { stopPlayback(); resetPlayUI(); } });

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

const KB_TABS = [['청음', KB_BASE], ['탁음·반탁음', KB_DAKU], ['작은가나·기호', KB_SMALL]];
const kbGrids = [];

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
      b.textContent = ch;
      b.dataset.k = ch;
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
  else insertKana(b.dataset.k);
});

// 첫 로드 시 기본 한국어를 변환해 변환결과 칸을 채운다
regenerate();
