import { koreanToKatakana } from '../k2k.js';
import { load } from 'aquestalk.js';

const samples = [
  '안녕하세요',
  '안녕하세요. 윳쿠리 보이스입니다.',
  '입니다',          // 비음화: 임니다 → インニダ
  '감사합니다',      // ハムニダ → カムサ…? 비음화 확인
  '국물',            // 비음화: 궁물
  '먹는다',          // 멍는다
  '아버지',          // 유성음화: アボジ
  '음악',            // 연음: 으막
  '같이',            // 구개음화: 가치
  '좋다',            // 격음화: 조타
  '신라',            // 유음화: 실라
  '설날',            // 유음화: 설랄
  '밥',              // 어말 파열음 받침(촉음)
  '서울특별시',
];

console.log('── 변환 결과 ──');
for (const s of samples) console.log(`${s}  →  ${koreanToKatakana(s).kana}`);

console.log('\n── AquesTalk 합성 테스트 ──');
const aq = await load('f1');
let ok = 0, fail = 0;
for (const s of samples) {
  const { kana } = koreanToKatakana(s);
  try { const wav = aq.run(kana, 100); console.log(`OK   ${kana}  → ${wav.length}B`); ok++; }
  catch (e) { console.log(`FAIL ${s} (${kana}) → ${e.message}`); fail++; }
}
await aq.destroy();
console.log(`\n성공 ${ok} / 실패 ${fail}`);
