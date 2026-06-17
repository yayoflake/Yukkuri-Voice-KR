import http from 'http'; import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path'; import puppeteer from 'puppeteer-core';
const ROOT = process.cwd();
const MIME={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.zip':'application/zip','.css':'text/css'};
const server=http.createServer(async(req,res)=>{try{const p=decodeURIComponent(req.url.split('?')[0]);const fp=normalize(join(ROOT,p==='/'?'/index.html':p));if(!fp.startsWith(ROOT))return res.writeHead(403).end();res.writeHead(200,{'Content-Type':MIME[extname(fp)]||'application/octet-stream'});res.end(await readFile(fp));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,r));
const base=`http://localhost:${server.address().port}/`;
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'shell',args:['--no-sandbox']});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('  [pageerror]',e.message));
await page.goto(base,{waitUntil:'load'});
let fail=false; const check=(c,m)=>{console.log((c?'  OK  ':'  FAIL')+' '+m);if(!c)fail=true;};
const kana=()=>page.$eval('#kana',e=>e.value);

const k0=await kana(); console.log('초기 가나:',k0);
check(/[ァ-ヶ]/.test(k0)&&!/[ぁ-ゖ]/.test(k0),'초기 = 가타카나로 채워짐');

await page.click('#script button[data-script="hira"]');
const kh=await kana(); console.log('히라가나:',kh);
check(/[ぁ-ゖ]/.test(kh)&&!/[ァ-ヶ]/.test(kh),'히라가나 토글 시 히라가나로 변환');

await page.click('#script button[data-script="kata"]');
check(/[ァ-ヶ]/.test(await kana())&&!/[ぁ-ゖ]/.test(await kana()),'가타카나로 복귀');

await page.$eval('#text',e=>{e.value='';});
await page.type('#text','과자');
const kn=await kana(); console.log('"과자" 입력 후:',kn);
check(kn==='カジャ','한국어 바꾸면 칸 갱신 (과자→カジャ, ERROR105 회피)');

await browser.close(); server.close();
console.log(fail?'\n실패':'\n통과'); process.exit(fail?1:0);
