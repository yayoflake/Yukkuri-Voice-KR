// k2k.js — 한국어(한글) → 가타카나(AquesTalk1 음성기호열) 변환기
//
// 핵심 철학: 받침(종성)은 "음절"이 아니라 코다(coda) 자음이다. 따라서 모음을 붙여
// プ/ム/ク 처럼 만들지 않고, 일본어의 발음(撥音) ン 또는 촉음 っ 으로 근사한다.
//   예) 입니다 → (비음화) 임니다 → イン·ニ·ダ = インニダ
//
// 적용하는 한국어 음운 규칙:
//   · 연음(連音)      : 받침이 다음 ㅇ 초성으로 넘어감          음악→으막
//   · 구개음화         : ㄷ/ㅌ + ㅣ → ㅈ/ㅊ                      같이→가치
//   · 격음화(거센소리) : ㅎ ↔ ㄱ/ㄷ/ㅂ/ㅈ → ㅋ/ㅌ/ㅍ/ㅊ        좋다→조타
//   · 유음화          : ㄴ↔ㄹ 인접 → ㄹㄹ                       신라→실라
//   · 비음화          : 파열음 받침 + ㄴ/ㅁ → 비음             입니다→임니다, 국물→궁물
//   · 유성음화         : 모음/비음 사이 ㄱㄷㅂㅈ → 탁음(g/d/b/j)  아버지→アボジ
// 일본어에 없는 음(ㅓ→오, ㅡ→우, ㅐ/ㅔ→에)은 가장 가까운 가타카나로 근사한다.
//
// 규칙으로 못 잡는 닫힌 예외(한자어 '의' 등)는 발음 예외 사전(dict.js)으로 보정한다.

import { WORD_OVERRIDES } from './dict.js';

// ── 한글 자모 테이블 ───────────────────────────────────────────────
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 종성(겹받침 포함) → 자음 낱자 배열 (연음 분리에 사용)
const JONG_PARTS = {
  '':[], 'ㄱ':['ㄱ'], 'ㄲ':['ㄲ'], 'ㄳ':['ㄱ','ㅅ'], 'ㄴ':['ㄴ'], 'ㄵ':['ㄴ','ㅈ'],
  'ㄶ':['ㄴ','ㅎ'], 'ㄷ':['ㄷ'], 'ㄹ':['ㄹ'], 'ㄺ':['ㄹ','ㄱ'], 'ㄻ':['ㄹ','ㅁ'],
  'ㄼ':['ㄹ','ㅂ'], 'ㄽ':['ㄹ','ㅅ'], 'ㄾ':['ㄹ','ㅌ'], 'ㄿ':['ㄹ','ㅍ'], 'ㅀ':['ㄹ','ㅎ'],
  'ㅁ':['ㅁ'], 'ㅂ':['ㅂ'], 'ㅄ':['ㅂ','ㅅ'], 'ㅅ':['ㅅ'], 'ㅆ':['ㅆ'], 'ㅇ':['ㅇ'],
  'ㅈ':['ㅈ'], 'ㅊ':['ㅊ'], 'ㅋ':['ㅋ'], 'ㅌ':['ㅌ'], 'ㅍ':['ㅍ'], 'ㅎ':['ㅎ'],
};

// 중성 21종 → { 활음(glide), 기본모음(base) }.  일본어에 없는 음은 근사.
const JUNG = [
  ['','a'],  // ㅏ
  ['','e'],  // ㅐ ≈ ㅔ
  ['y','a'], // ㅑ
  ['y','e'], // ㅒ
  ['','o'],  // ㅓ ≈ ㅗ
  ['','e'],  // ㅔ
  ['y','o'], // ㅕ
  ['y','e'], // ㅖ
  ['','o'],  // ㅗ
  ['w','a'], // ㅘ
  ['w','e'], // ㅙ
  ['w','e'], // ㅚ
  ['y','o'], // ㅛ
  ['','u'],  // ㅜ
  ['w','o'], // ㅝ
  ['w','e'], // ㅞ
  ['w','i'], // ㅟ
  ['y','u'], // ㅠ
  ['','u'],  // ㅡ ≈ ㅜ
  ['w','i'], // ㅢ ≈ 위
  ['','i'],  // ㅣ
];

// 행(行)별 가타카나 [a, i, u, e, o]
const ROWS = {
  '' : ['ア','イ','ウ','エ','オ'],
  k  : ['カ','キ','ク','ケ','コ'],
  g  : ['ガ','ギ','グ','ゲ','ゴ'],
  s  : ['サ','シ','ス','セ','ソ'],
  z  : ['ザ','ジ','ズ','ゼ','ゾ'],
  t  : ['タ','チ','ツ','テ','ト'],
  d  : ['ダ','ジ','ズ','デ','ド'],
  n  : ['ナ','ニ','ヌ','ネ','ノ'],
  h  : ['ハ','ヒ','フ','ヘ','ホ'],
  b  : ['バ','ビ','ブ','ベ','ボ'],
  p  : ['パ','ピ','プ','ペ','ポ'],
  m  : ['マ','ミ','ム','メ','モ'],
  r  : ['ラ','リ','ル','レ','ロ'],
  j  : ['ジャ','ジ','ジュ','ジェ','ジョ'],
  ch : ['チャ','チ','チュ','チェ','チョ'],
};
const BASE_IDX = { a:0, i:1, u:2, e:3, o:4 };

// 외래음(タ/ダ행의 i·u열 보정): 일본어 タ行은 i열이 チ(chi)·u열이 ツ(tsu)라
// 한국어 티/디/투/두/트/드가 전부 チ/ジ/ツ/ズ로 뭉개진다. 한국어 원음을 살려
// AquesTalk1이 받아주는 ティ/トゥ·ディ/ドゥ로 따로 매핑한다. (디오→ティオ, 파티→パティ)
const FOREIGN_TD = { t: { i:'ティ', u:'トゥ' }, d: { i:'ディ', u:'ドゥ' } };

// 자음 행 + 활음 + 기본모음 → 가타카나 1모라
function buildMora(row, glide, base) {
  const R = ROWS[row];
  const idx = BASE_IDX[base];
  if (glide === '') {
    const f = FOREIGN_TD[row];
    if (f && f[base]) return f[base];
    return R[idx];
  }
  if (glide === 'y') {
    if (row === '') return { a:'ヤ', u:'ユ', o:'ヨ', e:'イェ', i:'イ' }[base];
    if (base === 'i') return R[1];
    return R[1] + { a:'ャ', u:'ュ', o:'ョ', e:'ェ' }[base];
  }
  // glide === 'w': AquesTalk1이 クァ류(자음+小ァ)를 거부(ERROR 105)하고, 단순화 요청에 따라
  // 반모음 w를 떨어뜨려 단모음으로 근사한다.  과→カ, 와→ア, 위→イ, 워→オ
  return R[idx];
}

// ── 종성 7종 중화 ─────────────────────────────────────────────────
function neutLetter(c) {
  if ('ㄱㄲㅋ'.includes(c)) return 'ㄱ';
  if (c === 'ㄴ') return 'ㄴ';
  if ('ㄷㅅㅆㅈㅊㅌㅎ'.includes(c)) return 'ㄷ';
  if (c === 'ㄹ') return 'ㄹ';
  if (c === 'ㅁ') return 'ㅁ';
  if ('ㅂㅍ'.includes(c)) return 'ㅂ';
  if (c === 'ㅇ') return 'ㅇ';
  return 'ㄷ';
}
const DOUBLE_REP = {
  'ㄱㅅ':'ㄱ','ㄴㅈ':'ㄴ','ㄴㅎ':'ㄴ','ㄹㄱ':'ㄱ','ㄹㅁ':'ㅁ','ㄹㅂ':'ㄹ',
  'ㄹㅅ':'ㄹ','ㄹㅌ':'ㄹ','ㄹㅍ':'ㅂ','ㄹㅎ':'ㄹ','ㅂㅅ':'ㅂ',
};
function neutCluster(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return neutLetter(parts[0]);
  return DOUBLE_REP[parts.join('')] ?? neutLetter(parts[0]);
}

// ── 텍스트 → 토큰 ─────────────────────────────────────────────────
const HANGUL_BASE = 0xac00, HANGUL_LAST = 0xd7a3;

// 운율 기호로 인식할 입력 문자(키보드/자동고침 변형 포함).
//   · 악센트핵: 아포스트로피 ' 류 (음이 내려가는 자리)
//   · 장음    : 하이픈 - 류 / 반각 장음 ｰ
const ACCENT_MARKS = "'‘’ʹ´`";
const LONG_MARKS = "-‐‑‒–—―－−ｰ";

function tokenize(text) {
  const tokens = [];
  let lastSyl = null;          // 운율 기호(' / -)를 붙일 직전 음절 토큰
  let pendingBoundary = false; // 직전에 공백이 있었나 (다음 음절을 새 어절로 표시)
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const s = code - HANGUL_BASE;
      const tok = {
        type: 'syl',
        cho: CHO[Math.floor(s / 588)],
        jung: Math.floor(s / 28) % 21,
        jong: JONG_PARTS[JONG[s % 28]].slice(),
        coda: '',
        suffix: '',            // 음절 뒤에 그대로 붙는 운율 기호 (' 또는 ー)
        boundaryBefore: pendingBoundary, // 앞에 공백(어절 경계)이 있었음
      };
      pendingBoundary = false;
      tokens.push(tok);
      lastSyl = tok;
    } else if (ACCENT_MARKS.includes(ch)) {
      // 악센트핵: 바로 앞 음절 뒤에 ' 를 단다. 발음 규칙에는 영향을 주지 않는다.
      if (lastSyl) lastSyl.suffix += "'";
    } else if (LONG_MARKS.includes(ch)) {
      // 장음: 하이픈을 앞 음절의 장음 기호 ー 로. (아- → アー).  발음 규칙엔 영향 없음.
      if (lastSyl) lastSyl.suffix += 'ー';
    } else if (ch === '\n' || ch === '\r') {
      // 줄바꿈: 문장 끝으로 보고 쉼(。)
      tokens.push({ type: 'sep', kana: '。' });
      lastSyl = null;
      pendingBoundary = false;
    } else if (/\s/.test(ch)) {
      // 공백(줄바꿈 제외)은 어절 경계로 본다. 다음 음절에 boundaryBefore를 달아
      // 연음을 절음(받침→대표음 후 연음)으로 처리하고(샤인머스캣 알아 → …ケダラ),
      // ㅎ약화는 막으며, 연음으로 안 묶인 경계엔 악센트구 구분자 / 를 넣는다.
      pendingBoundary = true;
      continue;
    } else if ('.!?…。！？'.includes(ch)) {
      tokens.push({ type: 'sep', kana: '。' });
      lastSyl = null;
      pendingBoundary = false;
    } else if (',、·､'.includes(ch)) {
      tokens.push({ type: 'sep', kana: '、' });
      lastSyl = null;
      pendingBoundary = false;
    }
    // 그 외(라틴/숫자 등)는 AquesTalk가 읽지 못하므로 건너뜀
  }
  return tokens;
}

// ── 0) 조사 '의' → [에] ───────────────────────────────────────────
// 관형격 조사 '의'는 표준발음상 [에]로 읽는다. (주변의→주벼네, 나의→나에)
// 조건: ㅇ+ㅢ 단독 음절이면서 (1) 어두가 아니고(앞에 같은 어절 음절이 있고)
//       (2) 어절 끝(뒤가 새 어절·구두점·문장끝)인 경우만. 연음보다 먼저 적용.
//   → 주의를·회의에서처럼 뒤에 조사가 붙는 한자어 '의'는 [이]로 남고(둘째 조건 탈락),
//     의사·의미 같은 어두 '의'도 그대로 둔다(첫째 조건 탈락).
//   한계: 한자어가 어절 끝일 때(회의 시작·민주주의)는 [에]가 되지만, 더 흔한 조사 쪽을 택함.
function applyEuiParticle(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1];
    if (t.type !== 'syl' || prev.type !== 'syl') continue;
    if (!(t.cho === 'ㅇ' && t.jung === 19 && t.jong.length === 0 && !t.boundaryBefore)) continue;
    const euljeolFinal = !next || next.type !== 'syl' || next.boundaryBefore;
    if (euljeolFinal) t.jung = 5; // ㅢ(19) → ㅔ(5)
  }
  return tokens;
}

// ── 1) ㅎ 약화 ────────────────────────────────────────────────────
// 공명음(ㄴ/ㅁ/ㅇ/ㄹ) 받침 뒤의 ㅎ은 모음 사이에서 약화·탈락한다.
// 연음보다 먼저 적용해야 받침이 다음 음절로 넘어간다.
//   대단하다 → 대단아다 → (연음) 대다나다,  융합 → 융압,  결혼 → 겨론
function applyHWeakening(tokens) {
  for (let i = 0; i < tokens.length - 1; i++) {
    const cur = tokens[i], nxt = tokens[i + 1];
    if (cur.type !== 'syl' || nxt.type !== 'syl') continue;
    if (nxt.boundaryBefore) continue; // 어절 경계 너머로는 ㅎ약화 안 함
    if (nxt.cho !== 'ㅎ' || cur.jong.length === 0) continue;
    const last = cur.jong[cur.jong.length - 1];
    if ('ㄴㅁㅇㄹ'.includes(last)) nxt.cho = 'ㅇ'; // ㅎ → ㅇ(무자음). 받침은 연음 단계에서 넘어감
  }
  return tokens;
}

// ── 1) 연음 + 구개음화 ────────────────────────────────────────────
function applyLiaison(tokens) {
  for (let i = 0; i < tokens.length - 1; i++) {
    const cur = tokens[i], nxt = tokens[i + 1];
    if (cur.type !== 'syl' || nxt.type !== 'syl') continue;
    const canLiaise = cur.jong.length && nxt.cho === 'ㅇ' &&
                      !(cur.jong.length === 1 && cur.jong[0] === 'ㅇ');
    if (!canLiaise) continue;

    if (nxt.boundaryBefore) {
      // 어절 경계 = 절음(絶音). 받침을 7종 대표음으로 바꾼 뒤(ㅅ→ㄷ, ㅋ→ㄱ, ㅍ→ㅂ …)
      // 그 대표음만 다음 음절 초성으로 넘긴다. 겹받침은 대표음 하나만 넘기고 나머진 탈락.
      //   옷 안에→오/단에,  샤인머스캣 알아→…캐/달아(…ケ/ダラ),  닭 앞→다/가파
      const rep = neutCluster(cur.jong);
      cur.jong = [];
      if (rep && rep !== 'ㅇ') nxt.cho = rep;
      // boundaryBefore는 그대로 둔다 — 발음(대표음 연음)은 살리되 띄어쓰기 자리의
      // 악센트구 구분자 / 는 유지한다. (정말 이상하다 → チョンマ/リサンアダ)
      // 절음은 실질형태소 앞이라 구개음화(ㄷ+ㅣ→ㅈ) 대상이 아니므로 적용하지 않는다.
    } else {
      // 같은 어절 안: 원음 그대로 연음(옷이→오시), 겹받침은 앞 자음만 남김(닭이→달기)
      let parts = cur.jong.filter((c) => c !== 'ㅎ'); // ㅎ 탈락(좋아→조아)
      if (parts.length === 0) cur.jong = [];
      else if (parts.length === 1) { cur.jong = []; nxt.cho = parts[0]; }
      else { cur.jong = [parts[0]]; nxt.cho = parts[1]; }
      // 구개음화: 넘어간 ㄷ/ㅌ + ㅣ → ㅈ/ㅊ  (같이→가티→가치)
      if (nxt.jung === 20) {
        if (nxt.cho === 'ㄷ') nxt.cho = 'ㅈ';
        else if (nxt.cho === 'ㅌ') nxt.cho = 'ㅊ';
      }
    }
  }
  return tokens;
}

// ── 2) 종성 중화 → 단일 대표 코다 ─────────────────────────────────
function reduceCodas(tokens) {
  for (const t of tokens) if (t.type === 'syl') t.coda = neutCluster(t.jong);
  return tokens;
}

// ── 3) 자음동화 (격음화 → 유음화 → ㄹ비음화 → 비음화) ─────────────
const ASPIRATE = { 'ㄱ':'ㅋ', 'ㄷ':'ㅌ', 'ㅂ':'ㅍ', 'ㅈ':'ㅊ' };

function applyAssimilation(tokens) {
  for (let i = 0; i < tokens.length - 1; i++) {
    const L = tokens[i], R = tokens[i + 1];
    if (L.type !== 'syl' || R.type !== 'syl') continue;
    let C = L.coda, O = R.cho;

    // 격음화: ㅎ받침 + 예사소리, 또는 예사소리받침 + ㅎ
    if (L.jong.length === 1 && L.jong[0] === 'ㅎ' && ASPIRATE[O]) { O = ASPIRATE[O]; C = ''; }
    else if (O === 'ㅎ' && ASPIRATE[C]) { O = ASPIRATE[C]; C = ''; }

    if (C) {
      // 유음화
      if (C === 'ㄹ' && O === 'ㄴ') O = 'ㄹ';
      else if (C === 'ㄴ' && O === 'ㄹ') C = 'ㄹ';
      // ㄹ의 비음화: 비음/파열음 받침 + ㄹ → ㄹ이 ㄴ으로
      else if (O === 'ㄹ' && 'ㄱㄷㅂㅁㅇ'.includes(C)) O = 'ㄴ';
      // 비음화: 파열음 받침 + ㄴ/ㅁ
      if (O === 'ㄴ' || O === 'ㅁ') {
        if (C === 'ㄱ') C = 'ㅇ';
        else if (C === 'ㄷ') C = 'ㄴ';
        else if (C === 'ㅂ') C = 'ㅁ';
      }
    }
    L.coda = C; R.cho = O;
  }
  return tokens;
}

// ── 4) 초성 → 가타카나 행 (유성음화 반영) ─────────────────────────
const VOICED_CODA = new Set(['', 'ㄴ', 'ㅁ', 'ㅇ', 'ㄹ']); // 앞이 모음/비음/유음 → 유성 환경

function onsetRow(onset, voiced) {
  switch (onset) {
    case 'ㄱ': return voiced ? 'g' : 'k';
    case 'ㄷ': return voiced ? 'd' : 't';
    case 'ㅂ': return voiced ? 'b' : 'p';
    case 'ㅈ': return voiced ? 'j' : 'ch';
    case 'ㄲ': case 'ㅋ': return 'k';
    case 'ㄸ': case 'ㅌ': return 't';
    case 'ㅃ': case 'ㅍ': return 'p';
    case 'ㅉ': case 'ㅊ': return 'ch';
    case 'ㅅ': case 'ㅆ': return 's';
    case 'ㄴ': return 'n';
    case 'ㅁ': return 'm';
    case 'ㄹ': return 'r';
    case 'ㅎ': return 'h';
    case 'ㅇ': default: return '';
  }
}

// 코다 → 가타카나.
//  · 비음 ㄴ/ㅁ/ㅇ → 撥音 ン
//  · 유음 ㄹ → 보통 ン (ル로 하면 "루" 모음이 끼어 어색). 단 ㄹㄹ(유음화) 연쇄는
//    ラ행이 이어져야 자연스러우므로 그 자리만 ル 유지.  (신라→シルラ, 밥을→パブン)
//  · 파열음 ㄱ/ㄷ/ㅂ → 촉음 っ. 단 AquesTalk1은 어절 끝의 っ을 거부하므로
//    뒤에 음절이 이어질 때만 쓰고, 어말에서는 (가짜 모음 없이) 떨어뜨린다.
function codaKana(coda, nextCho) {
  if (coda === 'ㄴ' || coda === 'ㅁ' || coda === 'ㅇ') return 'ン';
  if (coda === 'ㄹ') return nextCho === 'ㄹ' ? 'ル' : 'ン';
  if (coda === 'ㄱ' || coda === 'ㄷ' || coda === 'ㅂ') return nextCho ? 'ッ' : '';
  return '';
}

// ── 예외 사전 ─────────────────────────────────────────────────────
// 어절(공백·구두점으로 끊긴 한글 덩어리)이 사전 키와 정확히 일치하면 등록된 발음으로
// 치환한다. 규칙 적용 전에 돌려, 치환된 발음이 그대로 규칙을 타도록 한다. (회의→회이→ヘイ)
function applyDict(text) {
  return text.replace(/[가-힣]+/g, (w) => WORD_OVERRIDES[w] ?? w);
}

// ── 메인 변환 ─────────────────────────────────────────────────────
export function koreanToKatakana(text) {
  let tokens = tokenize(applyDict(text));
  tokens = applyEuiParticle(tokens);
  tokens = applyHWeakening(tokens);
  tokens = applyLiaison(tokens);
  tokens = reduceCodas(tokens);
  tokens = applyAssimilation(tokens);

  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'sep') { out.push(t.kana); continue; }

    // 악센트구 경계: 앞이 음절이면 / 를 넣는다 (문두·쉼 뒤면 생략)
    const prev = tokens[i - 1];
    if (t.boundaryBefore && prev && prev.type === 'syl') out.push('/');

    // 유성음화 판정: 바로 앞이 음절이고, 그 코다가 모음/비음/유음이면 유성
    // (어절 경계를 넘어서도 유지 — 전 가요 → ジョンガヨ)
    const voiced = prev && prev.type === 'syl' && VOICED_CODA.has(prev.coda);

    // 다음이 같은 어절의 음절일 때만 코다를 "뒤에 음절이 옴"으로 본다.
    // 연음으로 묶이지 않은 어절 경계(boundaryBefore)나 비음절 앞이면 코다는 어말로 처리
    // → 파열음 받침은 촉음 ッ 없이 떨어진다 (밥 먹어 → パン/モゴ).
    const next = tokens[i + 1];
    const nextCho = next && next.type === 'syl' && !next.boundaryBefore ? next.cho : null;
    const [glide, base] = JUNG[t.jung];
    const row = onsetRow(t.cho, voiced);
    out.push(buildMora(row, glide, base) + codaKana(t.coda, nextCho) + t.suffix);
  }

  // 구분자 정리
  let kana = out.join('');
  kana = kana.replace(/\/?([、。])\/?/g, '$1');               // 쉼표·마침표(쉼) 옆의 / 는 잉여 → 제거
  kana = kana.replace(/[、。]+/g, (m) => (m.includes('。') ? '。' : '、'));
  kana = kana.replace(/\/{2,}/g, '/');                        // 연속 악센트구 구분자 → 하나
  kana = kana.replace(/^[、。\/]+/, '').replace(/\/+$/, '');   // 앞쪽 잉여 구분자·끝의 악센트구 / 제거
                                                              // (사용자가 명시한 끝의 。/、 는 보존)
  return { kana };
}

// ── 운율 보조 표기 정규화 (악센트핵 · 장음) ───────────────────────
// 사용자가 가나 칸에 직접 넣는 AquesTalk1 음성기호열 운율 기호를 정리한다.
//   · 악센트핵: 음이 내려가는 자리에 아포스트로피(')를 둔다.  例) コンニ'チワ
//     키보드/자동고침이 만드는 여러 따옴표(' ' ´ ` ʹ)를 표준 ' 로 통일.
//   · 장음: 한국어 사용자가 쓰기 쉬운 하이픈(-)을 장음 기호 ー 로 바꾼다.  例) ア- → アー
//     여러 종류의 하이픈·대시·반각 장음(ｰ)도 모두 ー 로 통일.
// AquesTalk1은 ' 와 ー 를 그대로 받으므로 합성 직전에 한 번만 적용하면 된다.
export function normalizeProsody(s) {
  return s
    .replace(new RegExp(`[${ACCENT_MARKS}]`, 'g'), "'")
    .replace(new RegExp(`[${LONG_MARKS}]`, 'g'), 'ー');
}

// ── 가타카나 ↔ 히라가나 ───────────────────────────────────────────
// 가타카나 블록(U+30A1–U+30F6)과 히라가나 블록(U+3041–U+3096)은 0x60 차이.
// ー(장음)·小書き·ッ·ン·、。 모두 그대로/대응되어 안전하다.
export function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
export function hiraToKata(s) {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
