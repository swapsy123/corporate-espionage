// Synthetic media failures, isolated SQLite, no live CDN or provider requests.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdirSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
import {persistProfileItems} from '../server/store.js';

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const artwork=await browser.newPage({viewport:{width:360,height:450}});
await artwork.setContent('<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="360" height="450"><rect width="360" height="450" fill="#f4f2ee"/><rect x="32" y="32" width="296" height="386" fill="none" stroke="#121212"/><text x="55" y="185" font-size="28" font-family="Arial">Creative image</text><text x="55" y="225" font-size="28" font-family="Arial">loads here.</text><path d="M55 265 H210" stroke="#b4442e" stroke-width="3"/><text x="55" y="375" font-size="14" font-family="Arial">Synthetic test fixture</text></svg></body>');
const png=await artwork.screenshot();await artwork.close();
const db=openDatabase(':memory:'),password=randomBytes(24).toString('hex'),calls=[],errors=[],direct=[];
let recover=false,renewFail=false;
const renewed=[];
const created=createApp({db,seed:false,password,production:false,providerKey:'synthetic-provider-key',refreshMedia:async item=>{
 renewed.push(item.externalId);if(renewFail)throw Object.assign(Error('Private upstream detail'),{safeMessage:'Instagram media is unavailable. Existing media was preserved.'});
 return {thumbnail:cdn('fresh'),media:[{type:'image',url:cdn('fresh')}]};
},fetchImage:async(url)=>{
 calls.push(url);if(url.includes('expired')&&!recover)throw Error('Synthetic expired image');
 return {type:'image/png',body:png};
}});
db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('fixture','Preview test creator');
db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run('ig','fixture','instagram','fixture');
const cdn=file=>`https://scontent.test.cdninstagram.com/${file}.jpg`;
const item=(id,format,thumbnail,media=[])=>({externalId:id,kind:'organic',format,title:`Preview fixture ${id}`,caption:'Research text remains available when media expires.',thumbnail,media,sourceUrl:`https://www.instagram.com/p/${id}/`,publishedAt:'2026-11-01',views:500,likes:20,transcriptStatus:'unavailable'});
persistProfileItems(db,{id:'ig',competitorId:'fixture',platform:'instagram'},[
 item('blocked','instagram_reel',cdn('browser-blocked')),
 item('expired','instagram_reel',cdn('expired')),
 item('carousel','instagram_carousel',cdn('expired'),[{type:'image',url:cdn('expired')},{type:'image',url:cdn('second-slide')}]),
],true);
const server=created.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
const directory='/tmp/levr-media-previews';mkdirSync(directory,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://scontent.test.cdninstagram.com/**',route=>{direct.push(route.request());return route.fulfill({status:403,body:'Synthetic CDN denial'})});
 await page.goto(base+'/organic');await page.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter workspace'}).click();
 const good=page.getByRole('button',{name:/Preview fixture blocked/}),bad=page.getByRole('button',{name:/Preview fixture expired/});
 await good.waitFor();await page.waitForFunction(()=>document.querySelector('.creative-card img')?.naturalWidth>0);
 await bad.getByText('Preview unavailable',{exact:true}).waitFor();
 assert.deepEqual(renewed,[],'viewing the library makes no paid provider requests');
 assert.equal(await good.locator('img').evaluate(img=>new URL(img.src).origin),base,'blocked CDN image is displayed through the app');
 assert.equal(direct.some(request=>request.url().includes('browser-blocked')),false,'successful relayed images do not make direct CDN requests');
 assert.ok(direct.every(request=>!request.headers().referer),'fallback requests omit the app referrer');
 assert.equal(await bad.locator('img').count(),0,'failed images are removed rather than showing broken-image icons');
 await page.screenshot({path:directory+'/desktop.png',fullPage:true});

 await bad.click();await page.locator('.media-viewer').getByText('Preview unavailable',{exact:true}).waitFor();
 const original=page.getByRole('link',{name:'View original',exact:true});assert.equal(await original.getAttribute('href'),'https://www.instagram.com/p/expired/');
 assert.equal(await page.getByText('Research text remains available when media expires.',{exact:true}).count(),1);
 const rect=await page.locator('.media-viewer').boundingBox();assert.ok(Math.abs(rect.width/rect.height-9/16)<.01);
 recover=true;await page.getByRole('button',{name:'Retry loading',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-viewer img')?.naturalWidth>0);
 await page.getByRole('button',{name:'Close creative details'}).click();recover=false;

 await page.getByRole('tab',{name:'Instagram carousels'}).click();const carousel=page.getByRole('button',{name:/Preview fixture carousel/});await carousel.locator('img').waitFor();
 await page.waitForFunction(()=>document.querySelector('.creative-card img')?.naturalWidth>0);
 assert.match(await carousel.locator('img').getAttribute('src'),/slide-1$/,'card tries another available slide when its cover expires');
 await carousel.click();await page.getByText('Slide 1 of 2').waitFor();await page.locator('.media-viewer').getByText('Preview unavailable',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Next slide'}).click();await page.getByText('Slide 2 of 2').waitFor();await page.waitForFunction(()=>document.querySelector('.media-viewer img')?.naturalWidth>0);
 await page.getByRole('button',{name:'Previous slide'}).click();await page.locator('.media-viewer').getByText('Preview unavailable',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Save opportunity',exact:true}).click();await page.getByRole('button',{name:'Close creative details'}).click();
 await page.goto(base+'/opportunities');await page.waitForFunction(()=>document.querySelector('.opportunity-title img')?.naturalWidth>0);

 for(const width of [390,487]){
  await page.setViewportSize({width,height:844});await page.goto(base+'/organic');await bad.getByText('Preview unavailable',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.creative-card img')?.naturalWidth>0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await good.screenshot({path:`${directory}/working-${width}.png`});await bad.screenshot({path:`${directory}/unavailable-${width}.png`});
  await bad.click();await page.locator('.media-viewer').getByText('Preview unavailable',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.detail-panel img')].some(img=>img.complete&&!img.naturalWidth)),false);
  await page.screenshot({path:`${directory}/detail-${width}.png`,fullPage:true});await page.getByRole('button',{name:'Close creative details'}).click();
 }
 await bad.click();await page.locator('.media-viewer').getByText('Preview unavailable',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Refresh media links',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.media-viewer img')?.naturalWidth>0);
 assert.deepEqual(renewed,['expired']);assert.ok(calls.some(url=>url.includes('/fresh.jpg')),'fresh provider links are used by the image relay');
 assert.equal(await page.getByText('Research text remains available when media expires.',{exact:true}).count(),1);
 renewFail=true;await page.getByRole('button',{name:'Refresh media links',exact:true}).click();await page.getByText('Instagram media is unavailable. Existing media was preserved.',{exact:true}).waitFor();
 assert.equal(await page.locator('.media-viewer img').evaluate(img=>img.naturalWidth>0),true,'a failed renewal keeps the working creative');
 await page.screenshot({path:directory+'/renewed-mobile.png',fullPage:true});await page.locator('.media-refresh-controls').screenshot({path:directory+'/renewal-controls-mobile.png'});
 await page.getByRole('button',{name:'Close creative details'}).click();await page.reload();await bad.locator('img').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.creative-card')].find(card=>card.textContent.includes('Preview fixture expired'))?.querySelector('img')?.naturalWidth>0);
 assert.deepEqual(errors,[]);assert.ok(calls.length>0);
 console.log('Media browser regression passed: authenticated previews, carousel navigation, manual retry and provider renewal, durable fresh links, failure preservation, original links, saved opportunities and desktop/mobile layout.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));created.closeWorkspaceDatabases();db.close()}
