// 번들(vendor/aquestalk.bundle.js) 경유 검증 (Node의 file:// 경로 분기 사용)
import { koreanToKatakana } from '../k2k.js';
import { load } from '../vendor/aquestalk.bundle.js';
import { pathToFileURL } from 'url';

const baseUrl = pathToFileURL(process.cwd() + '/voices/').href;
const aq = await load('f1', { baseUrl });
const { kana } = koreanToKatakana('번들 테스트 안녕하세요');
const wav = aq.run(kana, 100);
console.log('bundle OK:', kana, '→', wav.length, 'bytes');
await aq.destroy();
