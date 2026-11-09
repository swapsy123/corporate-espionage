// New session + service restart + expired CDN; no repair action or provider call on return.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
const dir=mkdtempSync(join(tmpdir(),'media-return-browser-')),password=randomBytes(24).toString('hex');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=180x320:rate=15','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(dir,'movie.mp4')]);
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0xb4442e:s=320x400','-frames:v','1',join(dir,'cover.png')]);
const png=readFileSync(join(dir,'cover.png')),video=readFileSync(join(dir,'movie.mp4')),source=file=>`https://scontent.one.fbcdn.net/${file}?oh=one&oe=1`;
let app,db,server,base,upstream=true,providerCalls=0,repairCalls=0,imageCalls=0,videoCalls=0;
async function boot(){
 db=openDatabase(join(dir,'catalog.sqlite'));
 app=createApp({db,seed:false,password,production:false,providerKey:'fixture-only',
  collector:async profile=>{providerCalls++;assert.ok(upstream,'Returning must not fetch the provider');return {complete:true,items:[{externalId:'123',kind:profile.platform==='meta'?'paid':'organic',format:profile.platform==='meta'?'ad_video':'instagram_reel',title:profile.platform==='meta'?'Returning ad':'Returning reel',active:true,thumbnail:source('cover.png'),media:[{type:'video',url:source('movie.mp4'),thumbnail:source('cover.png')}]}]}},
  refreshMedia:async()=>{repairCalls++;throw Error('No repair expected')},
  fetchImage:async()=>{imageCalls++;assert.ok(upstream,'Image must be retained');return {type:'image/png',body:png}},
  openVideo:async()=>{videoCalls++;assert.ok(upstream,'Video must be retained');return {status:200,headers:{'Content-Type':'video/mp4','Content-Length':String(video.length)},stream:Readable.from([video])}}
 });
 server=app.app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
}
async function stop(){await app.waitForRefresh();await new Promise(r=>server.close(r));app.closeWorkspaceDatabases();db.close();server=null}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 await boot();db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('c','Return visit test');
 for(const platform of ['instagram','meta'])db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run(platform,'c',platform,'123');
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',route=>route.abort());
 async function login(){await page.goto(base+'/organic');await page.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter workspace'}).click();await page.getByRole('heading',{name:'Organic intelligence.'}).waitFor()}
 await login();const csrf=(await (await page.request.get(base+'/api/session')).json()).csrf;
 const started=await page.request.post(base+'/api/refresh',{headers:{'X-CSRF-Token':csrf},data:{competitorId:'c'}});assert.equal(started.status(),202);await app.waitForRefresh();assert.equal(providerCalls,2);
 await page.request.post(base+'/auth/logout',{headers:{'X-CSRF-Token':csrf},data:{}});await stop();upstream=false;await boot();
 // New signatures and CDN edges from a later collection still point to the same asset.
 for(const row of db.prepare('SELECT id,data FROM items').all())db.prepare('UPDATE items SET data=? WHERE id=?').run(row.data.replaceAll('scontent.one','scontent.two').replaceAll('oh=one','oh=two').replaceAll('oe=1','oe=2'),row.id);
 await login();
 async function view(path,title){
  await page.goto(base+path);const card=page.getByRole('button',{name:new RegExp(title)});await card.locator('img').waitFor();assert.ok(await card.locator('img').evaluate(img=>img.naturalWidth>0));await card.click();
  await page.waitForFunction(()=>document.querySelector('.media-viewer video')?.readyState>=2);await page.locator('.media-viewer video').evaluate(v=>{v.muted=true;return v.play()});await page.waitForFunction(()=>document.querySelector('.media-viewer video').currentTime>.25);
  await page.locator('.media-viewer video').evaluate(v=>{v.pause();v.currentTime=2});await page.waitForFunction(()=>Math.abs(document.querySelector('.media-viewer video').currentTime-2)<.1);await page.getByRole('button',{name:'Close creative details'}).click();
 }
 await view('/organic','Returning reel');await view('/paid','Returning ad');
 await page.setViewportSize({width:390,height:844});await view('/organic','Returning reel');await view('/paid','Returning ad');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(providerCalls,2);assert.equal(repairCalls,0);assert.equal(imageCalls,2);assert.equal(videoCalls,2);assert.deepEqual(errors,[]);
 console.log('Return-visit playback passed: normal collection saved unviewed images/videos; logout, process restart, new login, rotated signatures and an unavailable CDN require no repair or new provider calls; desktop/mobile video playback and seeking work.');
}finally{await browser.close();if(server)await stop();rmSync(dir,{recursive:true,force:true})}
