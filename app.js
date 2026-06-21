// app.js — UI 글루: 한국어 → 가타카나 변환 후 AquesTalk1로 합성/재생
import { load } from './vendor/aquestalk.bundle.js';
import { koreanToKatakana, kataToHira, hiraToKata, normalizeProsody } from './k2k.js';
import { normalizeNumbers } from './numread.js';

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const voiceEl = $('voice');
const speedEl = $('speed');
const speedVal = $('speedval');
const convertBtn = $('convert');   // 한국어 → 가나 변환 트리거
const playBtn = $('play');
const kanaEl = $('kana');          // 편집 가능한 가나 칸 (재생의 기준)
const statusEl = $('status');
const scriptEl = $('script');      // 가타카나/히라가나 토글

let script = 'kata';               // 현재 표기: 'kata' | 'hira'

// 음성 자산(zip/wasm)이 들어있는 폴더
const VOICES_BASE = new URL('voices/', document.baseURI).href;

// 현재 로드된 AquesTalk 인스턴스 (음성당 ~1GB라 한 번에 하나만 유지)
let current = null;        // { voice, aq }
let busy = false;          // 로드/합성 중 (이때 버튼은 잠금)
let currentAudio = null;   // 재생 중인 Audio (있으면 = 재생 중)
let lastUrl = null;

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', isErr);
}

// 버튼 상태:  'idle' ▶재생 / 'loading' ⏳준비중 / 'playing' ■정지
function setPlayUI(mode) {
  playBtn.disabled = (mode === 'loading');
  playBtn.textContent =
    mode === 'loading' ? '⏳ 준비 중…' :
    mode === 'playing' ? '■ 정지' : '▶ 재생';
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

// 한국어 입력이 바뀌면 가나 칸을 (현재 표기로) 새로 채운다
function regenerate() {
  const { kana } = koreanToKatakana(normalizeNumbers(textEl.value));
  kanaEl.value = script === 'hira' ? kataToHira(kana) : kana;
}

// 선택된 음성 인스턴스 확보 (필요하면 로드, 음성이 바뀌면 이전 것 해제)
async function ensureVoice(voice) {
  if (current && current.voice === voice) return current.aq;
  if (current) {
    const old = current; current = null;
    try { await old.aq.destroy(); } catch { /* 무시 */ }
  }
  setStatus('음성 엔진 로딩 중… (최초 1회, 수십 초 소요)');
  const aq = await load(voice, { baseUrl: VOICES_BASE });
  current = { voice, aq };
  return aq;
}

// 버튼 클릭: 준비/합성 중이면 무시, 재생 중이면 정지, 그 외엔 새로 재생
async function onPlayClick() {
  if (busy) return;
  if (currentAudio) { stopPlayback(); setStatus('정지됨'); setPlayUI('idle'); return; }

  // 재생 기준은 (편집 가능한) 가나 칸. 히라가나가 섞여 있어도 합성용으로 가타카나로 정규화하고,
  // 운율 보조 표기(악센트핵 ' / 하이픈→장음 ー)도 AquesTalk1이 받는 형태로 정리한다.
  const kana = normalizeProsody(hiraToKata(kanaEl.value)).trim();
  if (!kana) { setStatus('가나가 비어 있음', true); return; }

  busy = true;
  setPlayUI('loading');

  // 1) 음성 로드 + 합성 (실제 실패가 날 수 있는 구간)
  let wav;
  try {
    const aq = await ensureVoice(voiceEl.value);
    setStatus('합성 중…');
    await new Promise((r) => setTimeout(r, 0)); // 동기 합성 전 UI 갱신 양보
    wav = aq.run(kana, Number(speedEl.value));
  } catch (e) {
    console.error(e);
    busy = false;
    setStatus('오류: ' + (e?.message || e), true);
    setPlayUI('idle');
    return;
  }
  busy = false;

  // 2) 재생 시작
  stopPlayback(); // 혹시 남은 것 정리
  lastUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  const audio = new Audio(lastUrl);
  currentAudio = audio;
  audio.onended = () => { stopPlayback(); setStatus('재생 완료'); setPlayUI('idle'); };
  setPlayUI('playing');
  setStatus('재생 중');
  audio.play().catch((e) => {
    // 정지(stopPlayback)로 인한 중단(AbortError)은 정상이므로 무시
    if (e && e.name === 'AbortError') return;
    console.error(e);
    stopPlayback();
    setStatus('재생 오류: ' + (e?.message || e), true);
    setPlayUI('idle');
  });
}

convertBtn.addEventListener('click', regenerate);
speedEl.addEventListener('input', () => { speedVal.textContent = speedEl.value; });
playBtn.addEventListener('click', onPlayClick);
// 음성을 바꾸면 재생 중인 소리는 멈춤
voiceEl.addEventListener('change', () => { if (currentAudio) { stopPlayback(); setPlayUI('idle'); } });

// 표기 토글: 현재 칸 내용을 보존한 채 가타카나 ↔ 히라가나로 변환
scriptEl.addEventListener('click', (e) => {
  const target = e.target.closest('button[data-script]');
  if (!target) return;
  const next = target.dataset.script;
  if (next === script) return;
  script = next;
  for (const b of scriptEl.querySelectorAll('button')) b.classList.toggle('active', b.dataset.script === script);
  kanaEl.value = script === 'hira' ? kataToHira(kanaEl.value) : hiraToKata(kanaEl.value);
});
