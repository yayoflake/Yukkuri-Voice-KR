// k2h.js — 가타카나(AquesTalk1 음성기호열) → 한국어 읽기 발음 표기
//
// 고급 편집 칸에 들어있는 가나가 "한국어로 어떻게 읽히는지" 눈으로 확인하기 위한
// 보조 표기다. 합성에 쓰는 값이 아니라 사람이 읽는 가이드이므로 가장 가까운 한글로 근사한다.
//   · ン → 앞 음절의 ㄴ받침 (コンニチワ → 콘니치와)
//   · ッ → 앞 음절의 ㅅ받침 (ガッコウ → 갓코우)
//   · 拗音(작은 ャ/ュ/ョ/ェ) → イ단 자음 + ㅑ/ㅠ/ㅛ/ㅖ (キャ→캬, シュ→슈)
//   · 외래음(작은 ァ/ィ/ゥ/ェ/ォ) → 앞 가나 자음 + 해당 모음 (ティ→티, トゥ→투)
// 운율·구분 기호(' / - ー 、 。)와 그 밖의 문자는 절대 생략하지 않고 그대로 흘려보낸다.

import { hiraToKata } from './k2k.js?v=20260623c';

// ── 한글 자모 / 합성 ──────────────────────────────────────────────
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const J = Object.fromEntries(JUNG.map((c, i) => [c, i])); // 모음 → 인덱스
const JONG_KO = { 'ㄴ': 4, 'ㅅ': 19 };                    // 받침으로 쓰는 것만

function compose(cho, jung, jong = 0) {
  return String.fromCharCode(0xac00 + (cho * 21 + jung) * 28 + jong);
}
// 완성형 한글 1글자 → { cho, jung, jong }. 한글이 아니면 null.
function decompose(syl) {
  if (!syl || syl.length !== 1) return null;
  const code = syl.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  return { cho: Math.floor(code / 588), jung: Math.floor(code / 28) % 21, jong: code % 28 };
}

// ── 가타카나 1모라 → 한글 ─────────────────────────────────────────
const KATA = {
  'ア':'아','イ':'이','ウ':'우','エ':'에','オ':'오',
  'カ':'카','キ':'키','ク':'쿠','ケ':'케','コ':'코',
  'ガ':'가','ギ':'기','グ':'구','ゲ':'게','ゴ':'고',
  'サ':'사','シ':'시','ス':'스','セ':'세','ソ':'소',
  'ザ':'자','ジ':'지','ズ':'즈','ゼ':'제','ゾ':'조',
  'タ':'타','チ':'치','ツ':'츠','テ':'테','ト':'토',
  'ダ':'다','ヂ':'지','ヅ':'즈','デ':'데','ド':'도',
  'ナ':'나','ニ':'니','ヌ':'누','ネ':'네','ノ':'노',
  'ハ':'하','ヒ':'히','フ':'후','ヘ':'헤','ホ':'호',
  'バ':'바','ビ':'비','ブ':'부','ベ':'베','ボ':'보',
  'パ':'파','ピ':'피','プ':'푸','ペ':'페','ポ':'포',
  'マ':'마','ミ':'미','ム':'무','メ':'메','モ':'모',
  'ヤ':'야','ユ':'유','ヨ':'요',
  'ラ':'라','リ':'리','ル':'루','レ':'레','ロ':'로',
  'ワ':'와','ヲ':'오','ヴ':'부',
};

// 拗音이 붙을 수 있는 イ단 가나 (자음 + ㅑ/ㅠ/ㅛ/ㅖ 로 합성)
const I_COL = new Set(['キ','シ','チ','ニ','ヒ','ミ','リ','ギ','ジ','ヂ','ビ','ピ']);
// ㅈ/ㅊ 계열은 한국어에서 활음이 죽으므로 단모음으로 (チャ→차, ジュ→주)
const YOON_PLAIN = { 'ャ': J['ㅏ'], 'ュ': J['ㅜ'], 'ョ': J['ㅗ'], 'ェ': J['ㅔ'] };
const YOON_GLIDE = { 'ャ': J['ㅑ'], 'ュ': J['ㅠ'], 'ョ': J['ㅛ'], 'ェ': J['ㅖ'] };

function composeYoon(baseHangul, small) {
  const d = decompose(baseHangul);
  if (!d) return baseHangul + small;
  const palatal = [12, 13, 14].includes(d.cho); // ㅈ ㅉ ㅊ
  return compose(d.cho, (palatal ? YOON_PLAIN : YOON_GLIDE)[small]);
}

// 작은 모음(외래음) — 앞 가나의 자음을 살리고 모음만 교체
const SMALL_VOWEL = { 'ァ': J['ㅏ'], 'ィ': J['ㅣ'], 'ゥ': J['ㅜ'], 'ェ': J['ㅔ'], 'ォ': J['ㅗ'] };
const SMALL_SPECIAL = { 'イェ':'예', 'ウィ':'위', 'ウェ':'웨', 'ウォ':'워', 'ウァ':'와' };

function composeSmallVowel(baseCh, small) {
  const sp = SMALL_SPECIAL[baseCh + small];
  if (sp) return sp;
  const d = decompose(KATA[baseCh]);
  if (!d) return KATA[baseCh] + small;
  return compose(d.cho, SMALL_VOWEL[small]);
}

// 앞 음절에 받침을 붙인다. 못 붙이면(앞이 한글이 아니거나 이미 받침 있음) 낱자로 흘림.
function attachJong(out, jongIdx, jamo) {
  const last = out[out.length - 1];
  const d = decompose(last);
  if (d && d.jong === 0) { out[out.length - 1] = compose(d.cho, d.jung, jongIdx); return; }
  out.push(jamo);
}

// ── 메인 변환 ─────────────────────────────────────────────────────
export function katakanaToKorean(input) {
  const chars = [...hiraToKata(input || '')];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], next = chars[i + 1];

    if (ch === 'ン') { attachJong(out, JONG_KO['ㄴ'], 'ㄴ'); continue; }
    if (ch === 'ッ') { attachJong(out, JONG_KO['ㅅ'], 'ㅅ'); continue; }

    if (KATA[ch]) {
      if (next && I_COL.has(ch) && YOON_GLIDE[next] !== undefined) {
        out.push(composeYoon(KATA[ch], next)); i++; continue;
      }
      if (next && SMALL_VOWEL[next] !== undefined) {
        out.push(composeSmallVowel(ch, next)); i++; continue;
      }
      out.push(KATA[ch]);
      continue;
    }

    // 운율·구분 기호(' / - ー 、 。)와 그 외 문자는 그대로 보존 (생략 금지)
    out.push(ch);
  }
  return out.join('');
}
