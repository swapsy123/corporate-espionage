// Regression checks use an isolated database and collector; no provider credentials or live data.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
const db=openDatabase(':memory:');
const password=randomBytes(24).toString('hex');
let finishCollection;
const collectionGate=new Promise(resolve=>{finishCollection=resolve});
const collected=[];
const {app,waitForRefresh}=createApp({db,password,seed:false,production:false,collector:async profile=>{
  collected.push(profile.identifier);
  await collectionGate;
  return {items:[{externalId:'refresh-fixture',kind:'organic',format:'instagram_reel',title:'Collected confirmed profile',caption:'A browser regression fixture.',sourceUrl:'https://www.instagram.com/reel/refresh-fixture/',media:[],transcriptStatus:'unavailable'}],complete:true};
}});
db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('confirmed','A confirmed competitor');
db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,?)').run('confirmed-profile','confirmed','instagram','confirmed_fixture',1);
for(let i=0;i<20;i++){
  db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run(`candidate-${i}`,`Candidate ${String(i).padStart(2,'0')}`);
  db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,?)').run(`candidate-profile-${i}`,`candidate-${i}`,'instagram',`candidate_${i}`,0);
}
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let competitorReads=0,finishPollCheck;
  const pollingObserved=new Promise(resolve=>{finishPollCheck=resolve});
  await page.route('**/api/competitors',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const response=await route.fetch();
    competitorReads++;
    if(competitorReads>1)await new Promise(resolve=>setTimeout(resolve,250));
    await route.fulfill({response});
    if(competitorReads>=3)finishPollCheck();
  });
  await page.goto(`${base}/competitors`);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Enter workspace'}).click();
  await page.getByRole('heading',{name:'A confirmed competitor',exact:true}).waitFor();
  const card=await page.locator('.competitor-card').first().elementHandle();
  await page.getByRole('button',{name:'Refresh confirmed competitors',exact:true}).click();
  await page.getByText('1 competitor refreshing.',{exact:false}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,900));
  const originalScroll=await page.evaluate(()=>scrollY);
  await Promise.race([pollingObserved,new Promise((_,reject)=>setTimeout(()=>reject(Error('Progress polling did not occur')),12000))]);
  assert.equal(await card.evaluate(element=>element.isConnected),true,'polling must retain the original competitor DOM');
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-originalScroll)<5,'polling must not move the scroll position');
  assert.equal(await page.getByText('Loading your intelligence…',{exact:true}).count(),0,'background polling must not replace the list');
  assert.equal(await page.locator('.competitor-card').first().getByRole('button',{name:'Refreshing…',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.toolbar').getByRole('button',{name:'Refreshing…',exact:true}).isDisabled(),true);
  finishCollection();
  await waitForRefresh();
  await page.getByText('1 competitor ready to refresh.',{exact:false}).waitFor();
  assert.deepEqual(collected,['confirmed_fixture']);
  assert.equal(db.prepare('SELECT count(*) n FROM refreshes').get().n,1);
  assert.equal(db.prepare('SELECT status FROM refreshes').get().status,'success');
  assert.equal(await page.getByText('Confirm at least one profile before refreshing this competitor.',{exact:true}).count(),0);
  await page.goto(`${base}/organic`);
  await page.getByRole('button',{name:/Collected confirmed profile/}).waitFor();
  let finishScopeRequest;
  const scopeGate=new Promise(resolve=>{finishScopeRequest=resolve});
  await page.route('**/api/items?**',async route=>{
    if(new URL(route.request().url()).searchParams.get('format')==='instagram_image')await scopeGate;
    await route.continue();
  });
  await page.getByRole('tab',{name:'Instagram single posts',exact:true}).click();
  await page.getByText('Loading your intelligence…',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Collected confirmed profile/}).count(),0,'different query scope must not retain stale prior-format data');
  finishScopeRequest();
  await page.getByRole('heading',{name:'Your library is ready to grow',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['confirmed-only bulk collection','stable competitor DOM and scroll during polling','duplicate refresh controls disabled','successful completion updates','no stale content across format changes'],errors}));
} finally {
  finishCollection();
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
