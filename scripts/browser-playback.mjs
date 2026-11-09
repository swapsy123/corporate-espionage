// Real generated media bytes with a simulated expiring CDN; no paid provider calls.
import {chromium} from '@playwright/test';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
import {persistProfileItems} from '../server/store.js';
import {mediaError} from '../server/media-diagnostics.js';
const dir=mkdtempSync(join(tmpdir(),'levr-playback-'));
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=180x320:rate=15','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(dir,'test.mp4')]);
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0xb4442e:s=320x400','-frames:v','1',join(dir,'test.png')]);
const video=readFileSync(join(dir,'test.mp4')),png=readFileSync(join(dir,'test.png')),cdn='https://scontent.test.fbcdn.net/',password=randomBytes(24).toString('hex'),db=openDatabase(':memory:'),errors=[];
let available=true,refreshes=0;
const made=createApp({db,seed:false,password,production:false,providerKey:'fixture-only',mediaCacheDirectory:join(dir,'cache'),
 refreshMedia:async()=>{refreshes++;return {thumbnail:cdn+'fresh.png',media:[{type:'video',url:cdn+'fresh.mp4',thumbnail:cdn+'fresh.png'}]}},
 fetchImage:async url=>{if(!available||url.includes('expired'))throw mediaError('upstream_denied',403);return {type:'image/png',body:png}},
 openVideo:async(url,{range})=>{
  if(!available||url.includes('expired'))throw mediaError('upstream_denied',403);
  let start=0,end=video.length-1;if(range){const [a,b]=range.slice(6).split('-');if(a){start=Number(a);if(b)end=Math.min(end,Number(b))}else start=Math.max(0,video.length-Number(b))}
  return {status:range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${video.length}`}:{})},stream:Readable.from([video.subarray(start,end+1)])};
 }});
db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('fixture','Playback creator');
for(const [id,platform]of [['ig','instagram'],['ad','meta'],['yt','youtube']])db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run(id,'fixture',platform,'fixture');
persistProfileItems(db,{id:'ig',competitorId:'fixture',platform:'instagram'},[
 ...['one','two'].map(id=>({externalId:id,kind:'organic',format:'instagram_reel',title:`Reel ${id}`,sourceUrl:`https://www.instagram.com/reel/${id}/`,thumbnail:cdn+'expired.png',media:[{type:'video',url:cdn+'expired.mp4'}]})),
 {externalId:'slides',kind:'organic',format:'instagram_carousel',title:'Carousel fixture',thumbnail:cdn+'cover.png',media:[{type:'image',url:cdn+'first.png'},{type:'image',url:cdn+'second.png'}]}
],true);
persistProfileItems(db,{id:'ad',competitorId:'fixture',platform:'meta'},[{externalId:'paid',kind:'paid',format:'ad_video',title:'Paid fixture',active:true,thumbnail:cdn+'cover.png',media:[{type:'video',url:cdn+'paid.mp4'}]}],true);
persistProfileItems(db,{id:'yt',competitorId:'fixture',platform:'youtube'},[{externalId:'abc123def45',kind:'organic',format:'youtube_short',title:'YouTube fixture',sourceUrl:'https://www.youtube.com/shorts/abc123def45',media:[{type:'video',url:'https://www.youtube.com/shorts/abc123def45'}]}],true);
const server=made.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',route=>route.abort());
 await page.goto(base+'/organic');await page.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter workspace'}).click();
 await page.getByRole('button',{name:/Reel one/}).click();await page.locator('.media-viewer').getByText('Preview unavailable',{exact:true}).waitFor();
 assert.equal(refreshes,0);await page.getByRole('button',{name:'Check media',exact:true}).click();await page.locator('.media-diagnostics').getByText(/upstream_denied, HTTP 403/).first().waitFor();assert.equal(refreshes,0);
 await page.getByRole('button',{name:'Refresh media links',exact:true}).click();
 async function play(){await page.waitForFunction(()=>document.querySelector('.media-viewer video')?.readyState>=2);await page.locator('.media-viewer video').evaluate(v=>{v.muted=true;return v.play()});await page.waitForFunction(()=>document.querySelector('.media-viewer video').currentTime>.25);await page.locator('.media-viewer video').evaluate(v=>{v.pause();v.currentTime=2});await page.waitForFunction(()=>Math.abs(document.querySelector('.media-viewer video').currentTime-2)<.1)}
 await play();assert.equal(refreshes,1);let rect=await page.locator('.media-viewer').boundingBox();assert.ok(Math.abs(rect.width/rect.height-9/16)<.01);
 await page.getByRole('button',{name:'Close creative details'}).click();await page.getByRole('button',{name:'Repair 1 failed preview',exact:true}).click();await page.getByText('1 of 1 posts refreshed',{exact:false}).waitFor();assert.equal(refreshes,2);
 await page.getByRole('tab',{name:'Instagram carousels'}).click();await page.getByRole('button',{name:/Carousel fixture/}).click();await page.waitForFunction(()=>document.querySelector('.media-viewer img')?.naturalWidth>0);const first=await page.locator('.media-viewer img').getAttribute('src');await page.getByRole('button',{name:'Next slide'}).click();await page.getByText('Slide 2 of 2').waitFor();await page.waitForFunction(()=>document.querySelector('.media-viewer img')?.naturalWidth>0);assert.notEqual(await page.locator('.media-viewer img').getAttribute('src'),first);await page.getByRole('button',{name:'Close creative details'}).click();
 await page.getByRole('tab',{name:'YouTube Shorts'}).click();await page.getByRole('button',{name:/YouTube fixture/}).click();assert.equal(await page.locator('.media-viewer iframe').getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');await page.getByRole('button',{name:'Close creative details'}).click();
 await page.goto(base+'/paid');await page.getByRole('button',{name:/Paid fixture/}).click();await play();await page.getByRole('button',{name:'Close creative details'}).click();await made.waitForRefresh();available=false;
 await page.goto(base+'/organic');await page.getByRole('button',{name:/Reel two/}).click();await play();await page.getByRole('button',{name:'Check media',exact:true}).click();await page.locator('.media-diagnostics').getByText('File accessible from private copy.',{exact:false}).first().waitFor();assert.equal(refreshes,2,'private copies play without additional provider refreshes');
 await page.setViewportSize({width:390,height:844});await page.locator('.media-diagnostics summary').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/levr-playback-check-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Playback passed: real MP4 play/seek, manual single and batch repair, private copies after CDN expiry, carousel pixels, YouTube referrer, safe diagnostics and mobile layout.');
}finally{await browser.close();await made.waitForRefresh();await new Promise(resolve=>server.close(resolve));made.closeWorkspaceDatabases();db.close();rmSync(dir,{recursive:true,force:true})}
