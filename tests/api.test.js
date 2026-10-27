import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {itemRows} from '../server/store.js';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

// Synthetic records are isolated to an in-memory test database. Production seed
// data contains competitor candidates only, never invented posts or ads.
const publishedAt = '2026-08-01T00:00:00.000Z';
function organic(platform, format, externalId, views, likes = 4) {
  return { platform, externalId, kind: 'organic', format,
    title: `Test ${format} ${externalId}`, caption: 'Stop chasing leads. Build a repeatable client acquisition system. Book a call.',
    sourceUrl: platform === 'instagram' ? `https://www.instagram.com/p/${externalId}/` : `https://www.youtube.com/watch?v=${externalId}`,
    media: format.includes('carousel') ? [{type:'image',url:'https://example.com/slide-1.jpg'},{type:'image',url:'https://example.com/slide-2.jpg'}] : [],
    transcript: format.includes('image') || format.includes('carousel') ? null : 'Stop chasing leads. Here are three ways to build a repeatable client acquisition system. Book a call.',
    transcriptStatus: format.includes('image') || format.includes('carousel') ? 'unavailable' : 'available',
    publishedAt, views, likes, comments: 0, shares: 0,
  };
}
function ad(externalId, days) {
 return {platform:'meta',externalId,kind:'paid',format:'ad_video',title:`Test ad ${externalId}`,
  caption:'Stop chasing leads. Build a repeatable client acquisition system.',headline:'Build a client acquisition system',cta:'Book a call',
  landingUrl:'https://example.com/offer',sourceUrl:`https://www.facebook.com/ads/library/?id=${externalId}`,
  startDate:new Date(Date.now()-days*86400000).toISOString(),active:true,media:[{type:'video',url:'https://example.com/test-ad.mp4'}],
  transcript:'Stop chasing leads. Get a repeatable client acquisition system. Book a call.',transcriptStatus:'available',publishedAt};
}
const initial = {
 meta:[ad('90001',90),ad('90002',10)],
 instagram:[...['instagram_reel','instagram_carousel','instagram_image'].flatMap(format=>[0,1,2,3].map(n=>organic('instagram',format,`${format}_${n}`,format==='instagram_reel'?(n===3?800:100):null,n===3?20:4)))],
 youtube:[...['youtube_short','youtube_video'].flatMap(format=>[0,1,2,3].map(n=>organic('youtube',format,`${format}_${n}`,format==='youtube_short'?(n===3?50:10):(n===3?30000:10000))))],
};

async function setup(t,dbPath=':memory:') {
 const password=randomBytes(24).toString('base64url');
 const state={calls:[],failure:false,invalid:false,hold:null,records:structuredClone(initial)};
 const collector=async profile=>{
  state.calls.push(profile);
  if(state.hold)await state.hold;
  if(state.failure)throw Object.assign(new Error('Private provider detail must not be exposed'),{safeMessage:'Provider quota exhausted; add credits and retry.'});
  const items=structuredClone(state.records[profile.platform]||[]);
  if(state.invalid)items.push({externalId:'broken-record',kind:'paid'});
  return {items,complete:true};
 };
 const db=openDatabase(dbPath);
 const created=createApp({db,seed:false,password,production:false,collector,ownerEmail:'fraser@wearelevr.com'});
 const server=created.app.listen(0,'127.0.0.1');
 await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='',csrf='';
 async function req(path,{method='GET',body,auth=true,token=true,origin}={}) {
  const headers={};
  if(auth&&cookie)headers.Cookie=cookie;
  if(token&&csrf)headers['X-CSRF-Token']=csrf;
  if(body!==undefined)headers['Content-Type']='application/json';
  if(origin)headers.Origin=origin;
  const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await response.json();}catch{data=null;}
  return {status:response.status,data,headers:response.headers};
 }
 async function login(){const r=await req('/auth/login',{method:'POST',auth:false,body:{email:'fraser@wearelevr.com',password}});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=r.data.csrf;return r;}
 async function competitor(name='Fixture Growth Co'){const r=await req('/api/competitors',{method:'POST',body:{name}});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
 async function profile(c,platform,confirmed=true){const identifier=platform==='meta'?'123456':platform==='instagram'?'fixture_growth':'@fixturegrowth';const r=await req(`/api/competitors/${c.id}/profiles`,{method:'POST',body:{platform,identifier,confirmed:true}});assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.confirmed,false,'new identities always require review');if(confirmed){const accepted=await req(`/api/profiles/${r.data.id}`,{method:'PATCH',body:{confirmed:true}});assert.equal(accepted.status,200);assert.equal(accepted.data.confirmed,true);return accepted.data;}return r.data;}
 async function refresh(c){const result=await req('/api/refresh',{method:'POST',body:c?{competitorId:c.id}:{}});assert.equal(result.status,202,JSON.stringify(result.data));await created.waitForRefresh();return result;}
 let closed=false;async function close(){if(closed)return;closed=true;await created.waitForRefresh();await new Promise(resolve=>server.close(resolve));db.close();}
 t.after(close);
 return {req,login,competitor,profile,refresh,state,db,password,close,...created};
}

test('owner-only access protects all data and mutation routes, CSRF, sessions and errors',async t=>{
 const s=await setup(t);
 const routes=['/api/session','/api/status','/api/competitors','/api/items','/api/boards','/api/opportunities','/api/refreshes','/api/patterns','/api/briefs'];
 for(const route of routes)assert.equal((await s.req(route,{auth:false})).status,401,route);
 for(const route of ['/api/competitors','/api/refresh','/api/opportunities','/api/briefs','/api/ask'])assert.equal((await s.req(route,{method:'POST',auth:false,body:{}})).status,401,route);
 assert.equal((await s.req('/auth/login',{method:'POST',body:{email:'other@example.com',password:s.password}})).status,401);
 assert.equal((await s.req('/auth/login',{method:'POST',body:{email:'fraser@wearelevr.com',password:s.password},origin:'https://attacker.example'})).status,403);
 const logged=await s.login();
 assert.match(logged.headers.get('set-cookie'),/HttpOnly/);assert.match(logged.headers.get('set-cookie'),/SameSite=Strict/i);
 assert.equal((await s.req('/api/session')).data.user.email,'fraser@wearelevr.com');
 assert.equal((await s.req('/api/competitors',{method:'POST',body:{name:'No token'},token:false})).status,403);
 assert.equal((await s.req('/api/competitors',{method:'POST',body:{name:'Cross site'},origin:'https://attacker.example'})).status,403);
 const status=await s.req('/api/status');assert.equal(status.status,200);assert.equal(JSON.stringify(status.data).includes(s.password),false);
 assert.equal((await s.req('/auth/logout',{method:'POST',body:{}})).status,200);
 assert.equal((await s.req('/api/items')).status,401);
});

test('competitors and profiles require confirmation; pause, edit and archive retain prior research',async t=>{
 const s=await setup(t);await s.login();const c=await s.competitor();
 const p=await s.profile(c,'instagram',false);await s.refresh(c);assert.equal(s.state.calls.length,0);
 let history=(await s.req('/api/refreshes')).data;assert.equal(history[0].status,'failed');assert.match(history[0].error,/Confirm/);
 await s.req(`/api/profiles/${p.id}`,{method:'PATCH',body:{confirmed:true}});await s.refresh(c);assert.equal(s.state.calls.length,1);
 assert.equal((await s.req('/api/items')).data.length,12);
 const changed=await s.req(`/api/profiles/${p.id}`,{method:'PATCH',body:{identifier:'new_fixture_growth',confirmed:true}});assert.equal(changed.data.confirmed,false);
 const edited=await s.req(`/api/competitors/${c.id}`,{method:'PATCH',body:{name:'Renamed fixture',notes:'Client acquisition',paused:true}});assert.equal(edited.data.name,'Renamed fixture');assert.equal(edited.data.paused,true);
 assert.equal((await s.req('/api/refresh',{method:'POST',body:{competitorId:c.id}})).status,400);
 assert.equal((await s.req(`/api/competitors/${c.id}`,{method:'DELETE'})).status,200);
 assert.equal((await s.req('/api/competitors')).data.length,0);assert.equal((await s.req('/api/items')).data.length,12);
});

test('manual refresh deduplicates ads, keeps first-seen dates and preserves records after failures',async t=>{
 const s=await setup(t);await s.login();const c=await s.competitor();await s.profile(c,'meta');
 assert.equal(s.state.calls.length,0,'adding or confirming a source never auto-refreshes');
 await s.refresh(c);const first=(await s.req('/api/items?kind=paid')).data;
 assert.equal(first.length,2);assert.equal(first[0].externalId,'90001');assert.ok(first[0].activeDays>=90);
 await s.refresh(c);const second=(await s.req('/api/items?kind=paid')).data;
 assert.equal(second.length,2);assert.equal(second[0].id,first[0].id);assert.equal(second[0].firstSeen,first[0].firstSeen);
 const previousRefresh=(await s.req('/api/competitors')).data[0].lastRefresh;
 s.state.failure=true;await s.refresh(c);assert.deepEqual((await s.req('/api/items?kind=paid')).data,second);
 const failed=(await s.req('/api/competitors')).data[0];assert.equal(failed.lastRefresh,previousRefresh);assert.match(failed.lastError,/quota exhausted/);assert.doesNotMatch(failed.lastError,/Private provider/);
 assert.equal((await s.req('/api/refreshes')).data[0].status,'failed');
 s.state.failure=false;s.state.invalid=true;s.state.records.meta[0].caption='This changed content must roll back.';await s.refresh(c);
 assert.deepEqual((await s.req('/api/items?kind=paid')).data,second,'malformed batch is transactional');
 s.state.invalid=false;s.state.records.meta=[s.state.records.meta[0]];await s.refresh(c);
 assert.equal((await s.req('/api/items?kind=paid')).data.length,1);assert.equal((await s.req('/api/items?kind=paid&includeInactive=true')).data.length,2,'inactive ads remain saved');
});

test('refresh-all is manual, concurrent duplicates are rejected, and paused competitors are excluded',async t=>{
 const s=await setup(t);await s.login();const c=await s.competitor();await s.profile(c,'meta');const paused=await s.competitor('Paused fixture');await s.req(`/api/competitors/${paused.id}`,{method:'PATCH',body:{paused:true}});
 let release;s.state.hold=new Promise(resolve=>{release=resolve;});
 const initial=await s.req('/api/refresh',{method:'POST',body:{}});assert.equal(initial.status,202);
 assert.equal((await s.req('/api/status')).data.refreshing,true);
 assert.equal((await s.req('/api/refresh',{method:'POST',body:{competitorId:c.id}})).status,409);
 release();await s.waitForRefresh();assert.equal((await s.req('/api/status')).data.refreshing,false);assert.equal(s.state.calls.length,1);
});

test('outlier rankings isolate creator/platform/format and missing transcripts remain unavailable',async t=>{
 const s=await setup(t);await s.login();const c=await s.competitor();await s.profile(c,'instagram');await s.profile(c,'youtube');await s.refresh(c);
 for(const [format,expected] of [['instagram_reel',8],['instagram_carousel',5],['instagram_image',5],['youtube_short',5],['youtube_video',3]]){
  const rows=(await s.req(`/api/items?kind=organic&format=${format}`)).data;
  assert.equal(rows.length,4);assert.ok(rows.every(i=>i.format===format));assert.equal(rows[0].outlierScore,expected,format);assert.equal(rows[0].baselineCount,3);
 }
 const missing=(await s.req('/api/items?kind=organic&transcript=unavailable')).data;assert.equal(missing.length,8);assert.ok(missing.every(i=>i.transcript===null&&i.transcriptStatus==='unavailable'));
 const carousel=(await s.req('/api/items?format=instagram_carousel')).data[0];assert.equal(carousel.media.length,2);assert.equal(carousel.media[1].url,'https://example.com/slide-2.jpg');
 const shorts=(await s.req('/api/items?format=youtube_short')).data;assert.ok(shorts.every(i=>i.sourceUrl.startsWith('https://www.youtube.com/watch?v=')));
 const filtered=(await s.req(`/api/items?competitorId=${c.id}&q=client%20acquisition`)).data;assert.equal(filtered.length,20);
});

test('paid and organic opportunities, stage workflow, patterns, persisted brief and grounded citations',async t=>{
 const s=await setup(t);await s.login();const c=await s.competitor();for(const platform of ['meta','instagram','youtube'])await s.profile(c,platform);await s.refresh(c);
 const all=(await s.req('/api/items')).data;const paid=all.find(i=>i.kind==='paid'),organicPost=all.find(i=>i.format==='instagram_reel');
 let opportunity=(await s.req('/api/opportunities',{method:'POST',body:{itemId:paid.id}})).data;
 assert.equal(opportunity.boardId,'inbox');assert.equal(opportunity.stage,'Saved');
 await s.req('/api/opportunities',{method:'POST',body:{itemId:paid.id}});assert.equal((await s.req('/api/opportunities')).data.length,1,'duplicate save is idempotent');
 const board=(await s.req('/api/boards',{method:'POST',body:{name:'Acquisition references',description:'Client content research'}})).data;
 const organicSave=await s.req('/api/opportunities',{method:'POST',body:{itemId:organicPost.id,boardId:board.id}});assert.equal(organicSave.status,201);
 opportunity=(await s.req(`/api/opportunities/${opportunity.id}`,{method:'PATCH',body:{boardId:board.id,notes:'Use the mechanism, write an original execution.',tags:['acquisition','proof'],rating:5}})).data;
 assert.equal(opportunity.notes,'Use the mechanism, write an original execution.');assert.deepEqual(opportunity.tags,['acquisition','proof']);assert.equal(opportunity.rating,5);
 for(const stage of ['Briefing','Creating','Launched','Winner'])assert.equal((await s.req(`/api/opportunities/${opportunity.id}`,{method:'PATCH',body:{stage}})).data.stage,stage);
 assert.equal((await s.req(`/api/opportunities/${opportunity.id}`,{method:'PATCH',body:{stage:'Imaginary'}})).status,400);
 const libraryPatterns=(await s.req('/api/patterns')).data;const boardPatterns=(await s.req(`/api/patterns?boardId=${board.id}`)).data;
 assert.equal(libraryPatterns.itemCount,22);assert.equal(boardPatterns.itemCount,2);assert.ok(libraryPatterns.patterns.length>0);assert.ok(boardPatterns.patterns.length>0);
 const selectedIds=new Set([paid.id,organicPost.id]);for(const pattern of boardPatterns.patterns)assert.ok(pattern.sourceIds.every(id=>selectedIds.has(id)));
 const briefResult=await s.req('/api/briefs',{method:'POST',body:{boardId:board.id,format:'short',audience:'Founders seeking better client acquisition content',offer:'Levr content research',objective:'Generate original content ideas'}});
 assert.equal(briefResult.status,201,JSON.stringify(briefResult.data));const brief=briefResult.data;
 assert.ok(brief.sourceEvidence.length>0);assert.ok(brief.adaptation.hook);assert.ok(brief.adaptation.structure.length>0);assert.ok(brief.references.length>0);assert.ok(brief.references.every(r=>selectedIds.has(r.itemId)));
 assert.deepEqual((await s.req(`/api/briefs/${brief.id}`)).data,brief);assert.equal((await s.req('/api/briefs')).data.length,1);
 const answer=await s.req('/api/ask',{method:'POST',body:{question:'Show me every ad running for more than 60 days.'}});
 assert.equal(answer.status,200);assert.ok(answer.data.answer);assert.ok(answer.data.citations.length>0);for(const cite of answer.data.citations){const source=await s.req(`/api/items/${cite.itemId}`);assert.equal(source.status,200);assert.equal(cite.url,source.data.sourceUrl);assert.ok(source.data.activeDays>60);}
 const noEvidence=await s.req('/api/ask',{method:'POST',body:{question:'What hooks keep appearing?',boardId:'inbox'}});assert.equal(noEvidence.data.insufficient,true);
 assert.equal((await s.req('/api/boards/inbox',{method:'DELETE'})).status,400);
 const beforeDelete=(await s.req(`/api/opportunities?boardId=${board.id}`)).data;
 assert.equal((await s.req(`/api/boards/${board.id}`,{method:'DELETE'})).status,409,'nonempty board deletion requires explicit moves or removal');
 assert.deepEqual((await s.req(`/api/opportunities?boardId=${board.id}`)).data,beforeDelete,'blocked deletion preserves exact notes and metadata');
 for(const saved of beforeDelete)assert.equal((await s.req(`/api/opportunities/${saved.id}`,{method:'PATCH',body:{boardId:'inbox'}})).status,200);
 assert.equal((await s.req(`/api/boards/${board.id}`,{method:'DELETE'})).status,200);
 const retainedBrief=await s.req(`/api/briefs/${brief.id}`);assert.equal(retainedBrief.status,200,'brief survives deletion of its empty board');assert.equal(retainedBrief.data.boardId,null);
 const retained=(await s.req('/api/opportunities?boardId=inbox')).data;assert.equal(retained.length,2);assert.equal(retained.find(o=>o.itemId===paid.id).notes,opportunity.notes);
});

test('unknown engagement does not become zero or a fabricated baseline; inactive duration freezes',async t=>{
 const s=await setup(t);await s.login();const c=await s.competitor();await s.profile(c,'instagram');await s.profile(c,'meta');
 s.state.records.instagram=[
  ...[0,1,2].map(n=>({...organic('instagram','instagram_image',`known_${n}`,null,10),comments:null,shares:null})),
  ...[0,1,2,3,4].map(n=>({...organic('instagram','instagram_image',`unknown_${n}`,null,null),comments:null,shares:null})),
 ];
 await s.refresh(c);
 const images=(await s.req('/api/items?format=instagram_image')).data;
 for(const known of images.filter(i=>i.externalId.startsWith('known'))){assert.equal(known.baselineCount,2);assert.equal(known.outlierScore,null,'requires three known peers');}
 for(const unknown of images.filter(i=>i.externalId.startsWith('unknown'))){assert.equal(unknown.totalEngagement,null);assert.equal(unknown.outlierScore,null);assert.equal(unknown.baselineCount,3);}
 // Simulate an ad last observed active on a past date, then no longer returned.
 const old=s.db.prepare("SELECT * FROM items WHERE external_id='90001'").get();
 const record=JSON.parse(old.data);record.startDate='2026-01-01T00:00:00.000Z';record.active=false;
 s.db.prepare('UPDATE items SET last_seen=?,data=? WHERE id=?').run('2026-01-11T00:00:00.000Z',JSON.stringify(record),old.id);
 const inactive=(await s.req('/api/items?kind=paid&includeInactive=true')).data.find(i=>i.id===old.id);
 assert.equal(inactive.activeDays,10,'inactive duration stops at last observation instead of today');
});

test('SQLite migrations are repeatable and research, notes, brief, and refresh history survive reopen',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'levr-durability-'));const path=join(directory,'research.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const s=await setup(t,path);await s.login();const c=await s.competitor();await s.profile(c,'meta');await s.refresh(c);
 const item=(await s.req('/api/items?kind=paid')).data[0];
 const opportunity=(await s.req('/api/opportunities',{method:'POST',body:{itemId:item.id}})).data;
 await s.req(`/api/opportunities/${opportunity.id}`,{method:'PATCH',body:{notes:'Durable research note',tags:['persisted'],rating:4,stage:'Briefing'}});
 const brief=(await s.req('/api/briefs',{method:'POST',body:{boardId:'inbox',format:'paid_ad',audience:'Business owners',offer:'Content research',objective:'Develop an original client acquisition concept'}})).data;
 assert.ok(brief.id);
 const counts=s.db.prepare('SELECT count(*) n FROM migrations').get().n;
 await s.close();
 const reopened=openDatabase(path);
 try{
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(reopened.prepare('SELECT count(*) n FROM migrations').get().n,counts,'migration replay does not reapply schema changes');
  assert.equal(reopened.prepare('SELECT name FROM competitors WHERE id=?').get(c.id).name,c.name);
  assert.equal(itemRows(reopened).length,2);
  const saved=reopened.prepare('SELECT * FROM opportunities WHERE id=?').get(opportunity.id);assert.equal(saved.notes,'Durable research note');assert.equal(saved.stage,'Briefing');assert.equal(saved.rating,4);assert.deepEqual(JSON.parse(saved.tags),['persisted']);
  const storedBrief=reopened.prepare('SELECT data FROM briefs WHERE id=?').get(brief.id);assert.equal(JSON.parse(storedBrief.data).adaptation.hook,brief.adaptation.hook);
  const refresh=reopened.prepare('SELECT * FROM refreshes').get();assert.equal(refresh.status,'success');assert.equal(refresh.item_count,2);assert.deepEqual(JSON.parse(refresh.warnings),[]);
 }finally{reopened.close();}
});
