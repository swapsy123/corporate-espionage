// Gateway fixtures and an isolated database; no live scraping or credentials.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
import {persistProfileItems} from '../server/store.js';

const db=openDatabase(':memory:'),password=randomBytes(24).toString('hex');
const created=createApp({db,password,seed:false,production:false});
db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('fixture','Gateway test advertiser');
db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run('meta','fixture','meta','123');
persistProfileItems(db,{id:'meta',competitorId:'fixture',platform:'meta'},[{externalId:'123',kind:'paid',format:'ad_image',title:'Preserved paid creative',caption:'Stored research survives a gateway error.',media:[],active:true,startDate:'2026-10-01',sourceUrl:'https://www.facebook.com/ads/library/?id=123'}],true);
const server=created.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='once',reads=0,mutations=0;
 page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')mutations++});
 await page.route('**/api/items?**',route=>{
  reads++;
  if(mode==='always'||mode==='once'&&reads===1)return route.fulfill({status:502,contentType:'text/html',body:'<html>Private gateway details</html>'});
  if(mode==='wrong-success')return route.fulfill({status:200,contentType:'text/html',body:'<html>Unexpected app shell</html>'});
  return route.continue();
 });
 await page.goto(base+'/paid');await page.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter workspace'}).click();
 const card=page.getByRole('button',{name:/Preserved paid creative/});
 await card.waitFor();assert.equal(reads,2,'temporary gateway recovers without manual intervention');assert.equal(mutations,0,'loading does not initiate collection');

 mode='always';reads=0;await page.reload();
 await page.getByRole('alert').filter({hasText:'Paid ad library: the server is temporarily unavailable (HTTP 502)'}).waitFor();
 assert.equal(reads,3,'automatic read retries stop');
 await page.getByRole('heading',{name:'Library temporarily unavailable',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Your library is ready to grow'}).count(),0,'request failure is not shown as an empty library');
 await page.getByText('Library count unavailable',{exact:true}).waitFor();
 assert.equal(await page.getByText('Private gateway details',{exact:false}).count(),0);
 mode='ok';await page.getByRole('button',{name:'Retry loading library',exact:true}).click();await card.waitFor();assert.equal(reads,4);

 // A failed status read must leave successfully loaded ad cards visible.
 await page.route('**/api/status',route=>route.fulfill({status:503,contentType:'text/html',body:'<html>Unavailable</html>'}));
 await page.reload();await page.getByRole('alert').filter({hasText:'Workspace status: the server is temporarily unavailable (HTTP 503)'}).waitFor();await card.waitFor();
 mode='always';await page.getByRole('button',{name:'Retry loading library',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Paid ad library: the server is temporarily unavailable (HTTP 502)'}).waitFor();await card.waitFor();
 assert.equal(await page.getByRole('heading',{name:'Library temporarily unavailable',exact:true}).count(),0,'cached cards survive a failed background read');

 await page.unroute('**/api/status');mode='wrong-success';reads=0;await page.reload();
 await page.getByRole('alert').filter({hasText:'Paid ad library: the server returned unreadable data (HTTP 200)'}).waitFor();assert.equal(reads,1);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/levr-library-error-mobile.png',fullPage:true});
 mode='ok';await page.getByRole('button',{name:'Retry loading library',exact:true}).click();await card.waitFor();
 assert.equal(mutations,0);assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,1);assert.deepEqual(errors,[]);
 console.log('Library error browser checks passed: temporary and persistent gateways, request-specific HTTP errors, honest failure state, retained cards, manual read retry, malformed success, mobile layout and no collection requests.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));created.closeWorkspaceDatabases();db.close()}
