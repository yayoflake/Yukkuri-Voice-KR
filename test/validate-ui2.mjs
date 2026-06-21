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

check((await kana())==='','초기 가나 칸은 비어 있음');
await page.click('#convert');   // 한국어 → 가나 변환
const k0=await kana(); console.log('변환 후 가나:',k0);
check(/[ァ-ヶ]/.test(k0)&&!/[ぁ-ゖ]/.test(k0),'변환 = 가타카나로 채워짐');
check(/。$/.test(k0),'끝의 명시한 "." → 。 보존');

await page.$eval('#text',e=>{e.value='';});
await page.type('#text','과자');
await page.click('#convert');
const kn=await kana(); console.log('"과자" 변환 후:',kn);
check(kn==='カジャ','한국어 바꿔 변환하면 칸 갱신 (과자→カジャ, ERROR105 회피)');

await browser.close(); server.close();
console.log(fail?'\n실패':'\n통과'); process.exit(fail?1:0);
