// numread.js — 숫자 → 문맥에 맞는 한글 수사(數詞) 변환 (k2k 앞단 전처리)
//
// AquesTalk1과 k2k.js는 한글만 읽으므로, 입력의 아라비아 숫자를 미리 한글로 바꾼다.
// 한국어 수 읽기는 "무엇을 세는가"에 따라 두 체계로 갈린다:
//   · 한자어 수사(일·이·삼…)  : 연도/월/일, 금액(원), 도량형, %, 층/호, 일반 숫자
//   · 고유어 수사(한·두·세…)  : 개·명·마리·살·시(時)처럼 '세는 단위'가 붙을 때 (1~99)
//   · 자릿수 읽기(공·일·이…)   : 전화번호처럼 하이픈으로 끊긴 숫자열 (0→공)
//
//   예) 1개→한개   1년→일년   10000원→만원   1957년→천구백오십칠년
//       010-1234-5678→공일공-일이삼사-오육칠팔
//
// 한계(문맥만으로는 모호한 것들):
//   · '번'은 횟수면 고유어(세 번), 번호면 한자어(삼 번)다 → 여기선 고유어로 본다.
//   · '분'은 사람이면 고유어(한 분), 시간이면 한자어(일 분)다 → 여기선 한자어(분)로 본다.
//   필요하면 아래 단위 목록을 옮겨 조정하면 된다.

// ── 한자어(漢字語) 수사 ───────────────────────────────────────────
const SINO_ONES = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SINO_UNIT = ['', '십', '백', '천'];          // 1·10·100·1000 자리
const SINO_BIG  = ['', '만', '억', '조', '경'];     // 4자리마다 끊는 큰 단위

// 0~9999 한 묶음. 1은 십/백/천 앞에서 '일'을 떨어뜨린다 (십, 백, 천).
function sinoUnder10000(n) {
  let r = '';
  const s = String(n).padStart(4, '0');
  for (let i = 0; i < 4; i++) {
    const d = +s[i];
    const unit = SINO_UNIT[3 - i];
    if (d === 0) continue;
    r += (d === 1 && unit) ? unit : SINO_ONES[d] + unit;
  }
  return r;
}

// 정수 → 한자어. 만 자리의 단독 1은 떨어뜨린다(만 ○○). 억/조의 1은 살린다(일억).
export function sinoFromInt(n) {
  if (n === 0) return '영';
  let x = BigInt(n);
  const groups = [];
  while (x > 0n) { groups.push(Number(x % 10000n)); x /= 10000n; }
  let r = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    let part = sinoUnder10000(groups[i]);
    if (groups[i] === 1 && SINO_BIG[i] === '만') part = '';   // 일만 → 만
    r += part + SINO_BIG[i];
  }
  return r;
}

// ── 고유어 수사 (1~99, 단위 앞 관형형) ────────────────────────────
// 한(1) 두(2) 세(3) 네(4) 스무(20·단독) … 그 외는 단독형과 같다.
const NAT_ONES = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉'];
const NAT_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

export function nativeFromInt(n) {
  if (n <= 0 || n > 99) return null;            // 0·100 이상은 한자어로 폴백
  const t = Math.floor(n / 10), o = n % 10;
  let r = '';
  if (t) r += (t === 2 && o === 0) ? '스무' : NAT_TENS[t];   // 스무 개 / 스물한 개
  if (o) r += NAT_ONES[o];
  return r;
}

// ── 자릿수 읽기 (전화번호 등) ─────────────────────────────────────
const DIGIT = ['공', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']; // 0→공
function readDigits(s) {
  return s.replace(/\d/g, (d) => DIGIT[+d]);
}

// ── 세는 단위(분류사) 목록 ────────────────────────────────────────
// 고유어로 읽는 단위 (1~99일 때). 길이가 긴 것부터 매칭하도록 정렬은 매칭부에서.
const NATIVE_UNITS = new Set([
  '개', '명', '마리', '살', '시간', '시', '번째', '번', '벌', '켤레', '권', '잔',
  '병', '그릇', '대', '채', '척', '자루', '그루', '송이', '포기', '통', '갑', '줄',
  '가지', '곳', '군데', '사람', '마디', '조각', '봉지', '상자', '캔', '판', '쌍',
  '모', '첩', '접시', '손', '단', '끼', '배', '컵', '알',
]);
// 한자어로 읽는 단위
const SINO_UNITS = new Set([
  '년', '월', '일', '주일', '주', '개월', '분', '초', '원', '달러', '엔', '위안',
  '센트', '유로', '파운드', '층', '호실', '호', '동', '번지', '페이지', '쪽',
  '인분', '인', '도', '그램', '킬로그램', '밀리그램', '톤', '미터', '센티미터',
  '킬로미터', '밀리미터', '리터', '평', '퍼센트', '프로', '등', '위', '회', '차',
  '학년', '학기', '교시', '호선', '칼로리', '와트', '볼트',
  'kg', 'mg', 'km', 'cm', 'mm', 'ml', 'cc', 'g', 'm', 'l', 't',
  '%', '℃', '°',
]);

// 6월·10월은 불규칙: 유월·시월 (육월/십월 아님)
const MONTH_IRREGULAR = { 6: '유', 10: '시' };

// 기호·약어 단위 → 실제 읽는 한글 (k2k는 한글만 읽으므로 미리 풀어준다)
const UNIT_SPOKEN = {
  '%': '퍼센트', '프로': '퍼센트',
  'kg': '킬로그램', 'g': '그램', 'mg': '밀리그램', 't': '톤',
  'km': '킬로미터', 'm': '미터', 'cm': '센티미터', 'mm': '밀리미터',
  'l': '리터', 'ml': '밀리리터', 'cc': '씨씨',
  '℃': '도', '°': '도',
};

// 숫자 바로 뒤 한글(또는 단위문자)에서 가장 긴 알려진 단위를 prefix로 찾는다.
function matchUnit(word) {
  for (let len = Math.min(4, word.length); len >= 1; len--) {
    const cand = word.slice(0, len);
    if (NATIVE_UNITS.has(cand)) return { unit: cand, native: true };
    if (SINO_UNITS.has(cand)) return { unit: cand, native: false };
  }
  return null;
}

// ── 메인: 텍스트의 숫자를 한글 수사로 치환 ────────────────────────
export function normalizeNumbers(text) {
  // 1) 전화번호 등 하이픈으로 끊긴 숫자열 → 자릿수 읽기 (먼저 처리)
  text = text.replace(/(?<![\d-])\d{2,4}(?:-\d{2,4}){1,3}(?![\d-])/g, (m) => readDigits(m));

  // 2) 일반 숫자(+소수) (+뒤따르는 단위)
  //    그룹: [정수][.소수][공백][뒤 한글/단위문자]
  return text.replace(
    /(\d+(?:,\d{3})*)(?:\.(\d+))?(\s*)([가-힣A-Za-z%℃°]+)?/g,
    (m, intRaw, frac, space, word = '') => {
      const intVal = parseInt(intRaw.replace(/,/g, ''), 10);
      if (Number.isNaN(intVal)) return m;

      // 뒤따르는 글자에서 알려진 단위를 떼어낸다 (나머지는 그대로 둔다)
      let unit = '', rest = word;
      if (word) {
        const hit = matchUnit(word);
        if (hit) { unit = hit.unit; rest = word.slice(unit.length); }
      }
      const isNativeUnit = unit && NATIVE_UNITS.has(unit);
      const hasFrac = frac != null;

      // 읽기 본문 결정
      let reading;
      if (isNativeUnit && !hasFrac) {
        reading = nativeFromInt(intVal) ?? sinoFromInt(intVal);   // 1~99만 고유어
      } else {
        reading = sinoFromInt(intVal);
      }

      // 기호·약어 단위는 실제 읽는 한글로 치환 (%→퍼센트, cm→센티미터 …)
      if (unit && UNIT_SPOKEN[unit]) unit = UNIT_SPOKEN[unit];

      // 소수: 점 + 자릿수 읽기(0→영)
      if (hasFrac) reading += '점' + frac.replace(/\d/g, (d) => SINO_ONES[+d] || '영');

      // 6월·10월 불규칙
      if (unit === '월' && MONTH_IRREGULAR[intVal] && !hasFrac) {
        reading = MONTH_IRREGULAR[intVal];
      }

      // 단위와 나머지 글자를 다시 붙인다. 단위가 안 떨어졌으면 원래 공백 유지.
      return reading + unit + (unit ? '' : space) + rest;
    },
  );
}
