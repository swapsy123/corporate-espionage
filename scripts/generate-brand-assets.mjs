// Render static Levr typography with the same local fonts as the app.
// No workspace data or external services are used.
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=root+'public/brand/';
mkdirSync(directory,{recursive:true});
const font=weight=>readFileSync(`${root}node_modules/@fontsource/inter-tight/files/inter-tight-latin-${weight}-normal.woff2`).toString('base64');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
 await page.setContent(`<!doctype html><html lang="en"><head><style>
 @font-face{font-family:InterTight;src:url(data:font/woff2;base64,${font(400)}) format('woff2');font-weight:400}
 @font-face{font-family:InterTight;src:url(data:font/woff2;base64,${font(600)}) format('woff2');font-weight:600}
 *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px}body{background:#fbfaf8;color:#121212;font-family:InterTight,sans-serif;padding:64px;display:flex;flex-direction:column}
 header{display:flex;align-items:center;justify-content:space-between;padding-bottom:24px;border-bottom:1px solid #e3e0da}.wordmark{font-size:36px;font-weight:600;line-height:1}.context{font-size:22px;color:#6b6862}
 main{flex:1;display:flex;flex-direction:column;justify-content:center}h1{font-size:104px;font-weight:600;line-height:1;letter-spacing:-.035em;margin:0}.accent{height:3px;width:96px;background:#b4442e;margin-top:32px}
 footer{font-size:28px;line-height:1.25;color:#6b6862}
 </style></head><body><header><span class="wordmark">Levr</span><span class="context">Your research workspace</span></header><main><h1>Competitor<br/>analysis.</h1><div class="accent"></div></main><footer>Find your next idea.</footer></body></html>`);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:directory+'levr-social-v1.png'});await page.close();
 const icon=readFileSync(directory+'levr-icon-v1.svg').toString('base64');
 for(const size of [32,180]){
  const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  await page.setContent(`<body style="margin:0"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${icon}" alt="Levr"></body>`);
  await page.locator('img').evaluate(img=>img.decode());await page.screenshot({path:`${directory}levr-icon-v1-${size}.png`});await page.close();
 }
 console.log('Generated Levr social preview (1200×630) and PNG icons (32px, 180px).');
}finally{await browser.close()}
