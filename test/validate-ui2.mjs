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

// 가나 키보드(탭 그리드 팝오버): 열기 → 청음 입력 → 탁음 탭 입력 → 닫기
check(await page.$eval('#kbd',e=>e.hidden),'키보드는 기본 닫힘');
await page.click('#kbtoggle');
check(!(await page.$eval('#kbd',e=>e.hidden)),'토글 시 키보드 열림');
const before=await kana();
await page.click('#kbd button[data-k="カ"]');
const after=await kana();
check(after.includes('カ')&&after.length===before.length+1,'청음 탭에서 カ 입력');
await page.click('#kbdtabs button[data-tab="1"]');
const beforeD=await kana();
await page.click('#kbd button[data-k="ガ"]');
const afterD=await kana();
check(afterD.includes('ガ')&&afterD.length===beforeD.length+1,'탁음 탭 전환 후 ガ 입력');
await page.click('#kbtoggle');
check(await page.$eval('#kbd',e=>e.hidden),'토글 다시 누르면 닫힘');

await page.$eval('#text',e=>{e.value='';});
await page.type('#text','과자');
const kn=await kana(); console.log('"과자" 입력 후:',kn);
check(kn==='カジャ','한국어 바꾸면 칸 갱신 (과자→カジャ, ERROR105 회피)');

await browser.close(); server.close();
console.log(fail?'\n실패':'\n통과'); process.exit(fail?1:0);
