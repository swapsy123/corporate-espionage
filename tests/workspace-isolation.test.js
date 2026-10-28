import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../server/db.js';
import {createApp} from '../server/app.js';

// All credentials below are generated for isolated tests. No live services or
// production databases are used by this suite.
async function setup(t,{withCollector=true,durable=false}={}){
 const directory=durable?mkdtempSync(join(tmpdir(),'levr-workspace-isolation-')):null;
 const db=openDatabase(directory?join(directory,'catalog.sqlite'):':memory:');
 const ownerPassword=randomBytes(24).toString('base64url');
 const keys=new Map(),ownerKey=randomBytes(24).toString('base64url'),labels=new Map([[ownerKey,'Owner private evidence']]);
 const vault={
  get:id=>keys.get(id)||(id==='levr'?ownerKey:null),
  status:id=>({configured:!!vault.get(id),storageReady:true,source:keys.has(id)?'workspace':id==='levr'?'environment':null}),
  set(id,key){keys.set(id,key);return vault.status(id)},
  delete(id){keys.delete(id);return vault.status(id)},
 };
 const state={calls:[],gates:new Map()};
 const collector=async(profile,{apiKey})=>{
  state.calls.push({profile:{...profile},apiKey});
  if(state.gates.has(apiKey))await state.gates.get(apiKey);
  const label=labels.get(apiKey)||'Unconfigured fixture';
  const item={externalId:profile.platform==='meta'?'123456789':'shared-post',kind:profile.platform==='meta'?'paid':'organic',format:profile.platform==='meta'?'ad_video':'instagram_reel',title:label,caption:`Stop wasting content. ${label}. Book a call.`,transcript:`Stop wasting content. ${label}. Book a call.`,transcriptStatus:'available',sourceUrl:profile.platform==='meta'?'https://www.facebook.com/ads/library/?id=123456789':'https://www.instagram.com/reel/shared-post/',media:[],active:true,startDate:'2026-01-01',publishedAt:'2026-01-01',views:100,likes:10,comments:2,shares:1};
  return {items:[item],complete:true};
 };
 const created=createApp({db,seed:false,password:ownerPassword,production:false,ownerEmail:'fraser@wearelevr.com',vault,...(withCollector?{collector}:{})});
 const server=created.app.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 function actor(){
  const current={cookie:'',csrf:'',payload:null};
  current.request=async(path,{method='GET',body,workspace,csrf=true,auth=true}={})=>{
   const headers={};if(current.cookie&&auth)headers.Cookie=current.cookie;if(current.csrf&&csrf)headers['X-CSRF-Token']=current.csrf;if(workspace!==undefined)headers['X-Workspace-Id']=workspace;if(body!==undefined)headers['Content-Type']='application/json';
   const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   let data;try{data=await response.json()}catch{data=null}
   return {status:response.status,data,headers:response.headers};
  };
  current.authenticate=async(path,body)=>{const r=await current.request(path,{method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.data));current.cookie=r.headers.get('set-cookie').split(';')[0];current.csrf=r.data.csrf;current.payload=r.data;return r.data};
  return current;
 }
 const owner=actor();await owner.authenticate('/auth/login',{email:'fraser@wearelevr.com',password:ownerPassword});
 async function client(name,email){
  const made=await owner.request('/api/workspaces',{method:'POST',body:{name}});assert.equal(made.status,201,JSON.stringify(made.data));
  const workspace=made.data;
  const invited=await owner.request(`/api/workspaces/${workspace.id}/invites`,{method:'POST',body:{email}});assert.equal(invited.status,201,JSON.stringify(invited.data));
  const member=actor(),password=randomBytes(24).toString('base64url');
  await member.authenticate('/auth/accept-invite',{token:invited.data.token,email,password});
  const apiKey=randomBytes(24).toString('base64url');labels.set(apiKey,`${name} private evidence`);
  return {actor:member,workspace,email,password,apiKey,invite:invited.data};
 }
 async function research(who,name,workspace){
  const opts=workspace===undefined?{}:{workspace};
  const made=await who.request('/api/competitors',{...opts,method:'POST',body:{name,notes:`${name} private notes`}});assert.equal(made.status,201,JSON.stringify(made.data));const competitor=made.data;
  const profiles=[];
  for(const platform of ['meta','instagram']){
   const p=await who.request(`/api/competitors/${competitor.id}/profiles`,{...opts,method:'POST',body:{platform,identifier:platform==='meta'?'777777':'same_public_handle'}});assert.equal(p.status,201,JSON.stringify(p.data));profiles.push(p.data);
   assert.equal((await who.request(`/api/profiles/${p.data.id}`,{...opts,method:'PATCH',body:{confirmed:true}})).status,200);
  }
  const queued=await who.request('/api/refresh',{...opts,method:'POST',body:{competitorId:competitor.id}});assert.equal(queued.status,202,JSON.stringify(queued.data));await created.waitForRefresh();
  const items=(await who.request('/api/items',opts)).data;assert.equal(items.length,2);
  const board=(await who.request('/api/boards',{...opts,method:'POST',body:{name:`${name} private board`}})).data;
  const opportunities=[];
  for(const item of items){const saved=await who.request('/api/opportunities',{...opts,method:'POST',body:{itemId:item.id,boardId:board.id}});assert.equal(saved.status,201);opportunities.push(saved.data);}
  const updated=await who.request(`/api/opportunities/${opportunities[0].id}`,{...opts,method:'PATCH',body:{notes:`${name} private opportunity note`,tags:[name],stage:'Creating',rating:4}});assert.equal(updated.status,200);
  const brief=await who.request('/api/briefs',{...opts,method:'POST',body:{boardId:board.id,format:'paid_ad',audience:`${name} customers`,offer:'Content planning',objective:`${name} original creative`}});assert.equal(brief.status,201,JSON.stringify(brief.data));
  return {competitor,profiles,items,board,opportunities,brief:brief.data};
 }
 let closed=false;async function close(){if(closed)return;closed=true;await created.waitForRefresh();await new Promise(resolve=>server.close(resolve));created.closeWorkspaceDatabases();db.close();}
 t.after(async()=>{await close();if(directory)rmSync(directory,{recursive:true,force:true})});
 return {owner,actor,client,research,db,state,keys,vault,ownerKey,labels,created,close,directory};
}

function assertCitationsBelong(response,items){
 const ids=new Set(items.map(i=>i.id));assert.ok(response.citations.length>0);
 assert.ok(response.citations.every(c=>ids.has(c.itemId)),'all citations must come from current workspace');
}

test('clients can only select their assigned workspace; owner can manage every workspace',async t=>{
 const s=await setup(t),alpha=await s.client('Alpha','alpha@example.com'),beta=await s.client('Beta','beta@example.com');
 assert.deepEqual(alpha.actor.payload.workspaces.map(w=>w.id),[alpha.workspace.id]);assert.equal(alpha.actor.payload.defaultWorkspaceId,alpha.workspace.id);assert.equal(alpha.actor.payload.user.role,'client');
 assert.equal((await s.owner.request('/api/workspaces')).data.length,3);
 assert.deepEqual((await alpha.actor.request('/api/workspaces')).data.map(w=>w.id),[alpha.workspace.id]);
 for(const workspace of [beta.workspace.id,'levr','../../outside','missing']){
  for(const path of ['/api/status','/api/competitors','/api/items','/api/boards','/api/opportunities','/api/patterns','/api/briefs','/api/refreshes','/api/settings/provider'])assert.equal((await alpha.actor.request(path,{workspace})).status,404,`${path} foreign workspace`);
  assert.equal((await alpha.actor.request('/api/competitors',{workspace,method:'POST',body:{name:'Forbidden'}})).status,404);
 }
 for(const workspace of [alpha.workspace.id,beta.workspace.id,'levr'])assert.equal((await s.owner.request('/api/status',{workspace})).status,200);
 assert.equal((await alpha.actor.request('/api/status')).data.ownerEmail,undefined);
 for(const [path,method,body] of [
  ['/api/workspaces','POST',{name:'Unauthorized'}],
  [`/api/workspaces/${beta.workspace.id}`,'PATCH',{name:'Unauthorized'}],
  [`/api/workspaces/${alpha.workspace.id}/members`,'GET'],
  [`/api/workspaces/${alpha.workspace.id}/invites`,'GET'],
  [`/api/workspaces/${alpha.workspace.id}/invites`,'POST',{email:'outsider@example.com'}],
  [`/api/invites/${beta.invite.id}`,'DELETE'],
  [`/api/workspaces/${beta.workspace.id}/members/${beta.actor.payload.user.id}`,'DELETE'],
 ])assert.equal((await alpha.actor.request(path,{method,body})).status,403,`${method} ${path}`);
 assert.equal((await alpha.actor.request('/api/settings/provider',{method:'PUT',csrf:false,body:{apiKey:alpha.apiKey}})).status,403);
 assert.equal((await alpha.actor.request('/api/competitors',{method:'POST',csrf:false,body:{name:'Missing CSRF'}})).status,403);
 assert.equal((await s.owner.request(`/api/workspaces/${alpha.workspace.id}/members/${alpha.actor.payload.user.id}`,{method:'DELETE'})).status,200);
 assert.equal((await alpha.actor.request('/api/items')).status,401,'revoking membership revokes existing session immediately');
 assert.equal((await beta.actor.request('/api/items')).status,200);
});

test('separate research databases isolate every library, mutation, pattern, brief and citation',async t=>{
 const s=await setup(t);
 // Existing Levr research predates client creation and remains exactly in place.
 const ownerResearch=await s.research(s.owner,'Owner existing research');
 const ownerBefore=(await s.owner.request('/api/items')).data;
 const alpha=await s.client('Alpha','alpha@example.com'),beta=await s.client('Beta','beta@example.com');
 for(const client of [alpha,beta]){
  assert.deepEqual((await client.actor.request('/api/competitors')).data,[]);
  assert.deepEqual((await client.actor.request('/api/items')).data,[]);
  assert.equal((await client.actor.request('/api/boards')).data[0].name,'Creative Inbox');
  const settings=await client.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:client.apiKey}});assert.equal(settings.status,200);assert.equal(JSON.stringify(settings.data).includes(client.apiKey),false);
 }
 const a=await s.research(alpha.actor,'Alpha'),b=await s.research(beta.actor,'Beta');
 assert.notEqual(a.items[0].id,b.items[0].id);
 assert.equal(a.items.find(i=>i.kind==='paid').externalId,b.items.find(i=>i.kind==='paid').externalId,'same public source is independent in each workspace');
 assert.deepEqual((await s.owner.request('/api/items')).data,ownerBefore,'client refresh never modifies Levr research');
 for(const [client,own,foreign] of [[alpha,a,b],[beta,b,a]]){
  const who=client.actor;
  const all=(await who.request('/api/items')).data;assert.ok(all.every(i=>i.competitorId===own.competitor.id));assert.ok(all.every(i=>i.title===`${client.workspace.name} private evidence`));
  assert.equal((await who.request('/api/competitors')).data.length,1);
  const status=(await who.request('/api/status')).data;assert.deepEqual(status.counts,{competitors:1,ads:1,posts:1,opportunities:2});
  assert.equal((await who.request('/api/refreshes')).data.length,1);
  assert.equal((await who.request('/api/briefs')).data.length,1);
  assert.equal((await who.request(`/api/items/${foreign.items[0].id}`)).status,404);
  assert.equal((await who.request(`/api/briefs/${foreign.brief.id}`)).status,404);
  assert.deepEqual((await who.request(`/api/items?competitorId=${foreign.competitor.id}`)).data,[]);
  assert.deepEqual((await who.request(`/api/opportunities?boardId=${foreign.board.id}`)).data,[]);
  const foreignPatterns=(await who.request(`/api/patterns?boardId=${foreign.board.id}`)).data;assert.equal(foreignPatterns.itemCount,0);
  assert.equal((await who.request(`/api/competitors/${foreign.competitor.id}`,{method:'PATCH',body:{name:'Stolen'}})).status,404);
  assert.equal((await who.request(`/api/competitors/${foreign.competitor.id}/profiles`,{method:'POST',body:{platform:'instagram',identifier:'stolen'}})).status,404);
  assert.equal((await who.request(`/api/profiles/${foreign.profiles[0].id}`,{method:'PATCH',body:{confirmed:false}})).status,404);
  // Nonexistent DELETEs can be idempotent successes, but must not touch the foreign database.
  for(const path of [`/api/profiles/${foreign.profiles[0].id}`,`/api/competitors/${foreign.competitor.id}`,`/api/opportunities/${foreign.opportunities[0].id}`])assert.equal((await who.request(path,{method:'DELETE'})).status,200);
  const changedForeignBoard=await who.request(`/api/boards/${foreign.board.id}`,{method:'PATCH',body:{name:'Stolen'}});assert.equal(changedForeignBoard.data.error,'Board not found.');
  assert.equal((await who.request(`/api/boards/${foreign.board.id}`,{method:'DELETE'})).status,200);
  assert.equal((await who.request('/api/opportunities',{method:'POST',body:{itemId:foreign.items[0].id}})).status,409);
  assert.equal((await who.request('/api/opportunities',{method:'POST',body:{itemId:own.items[0].id,boardId:foreign.board.id}})).status,409);
  assert.equal((await who.request(`/api/opportunities/${foreign.opportunities[0].id}`,{method:'PATCH',body:{notes:'Stolen'}})).status,404);
  assert.equal((await who.request(`/api/opportunities/${own.opportunities[0].id}`,{method:'PATCH',body:{boardId:foreign.board.id}})).status,409);
  assert.equal((await who.request('/api/refresh',{method:'POST',body:{competitorId:foreign.competitor.id}})).status,400);
  assert.equal((await who.request('/api/briefs',{method:'POST',body:{boardId:foreign.board.id,format:'paid_ad',audience:'Audience',objective:'Objective'}})).status,400);
  const unknownAsk=(await who.request('/api/ask',{method:'POST',body:{question:'What hooks are recurring?',boardId:foreign.board.id}})).data;assert.equal(unknownAsk.insufficient,true);assert.deepEqual(unknownAsk.citations,[]);
  for(const query of ['',`?boardId=${own.board.id}`]){
   const patterns=(await who.request(`/api/patterns${query}`)).data;assert.equal(patterns.itemCount,2);assert.ok(patterns.patterns.length>0);assert.ok(patterns.patterns.every(p=>p.sourceIds.every(id=>own.items.some(i=>i.id===id))));
  }
  assertCitationsBelong((await who.request('/api/ask',{method:'POST',body:{question:'Show me every ad running more than 60 days.'}})).data,own.items);
  assert.ok(own.brief.references.every(r=>own.items.some(i=>i.id===r.itemId)));
  assert.equal(JSON.stringify(await who.request('/api/session')).includes(s.ownerKey),false);
 }
 assert.equal((await alpha.actor.request('/api/competitors')).data[0].name,'Alpha');
 assert.equal((await beta.actor.request('/api/competitors')).data[0].name,'Beta');
 assert.equal((await beta.actor.request('/api/opportunities')).data.length,2);
 assert.equal((await s.owner.request('/api/items',{workspace:alpha.workspace.id})).data.length,2);
 assert.equal((await s.owner.request('/api/items',{workspace:beta.workspace.id})).data.length,2);
 assert.equal((await s.owner.request(`/api/briefs/${ownerResearch.brief.id}`)).status,200);
 for(const key of [s.ownerKey,alpha.apiKey,beta.apiKey]){
  const rootDump=JSON.stringify(s.db.prepare('SELECT data FROM items').all());assert.equal(rootDump.includes(key),false);
 }
});

test('concurrent refreshes retain workspace database, status, job and provider-key context',async t=>{
 const s=await setup(t),alpha=await s.client('Alpha','alpha@example.com'),beta=await s.client('Beta','beta@example.com');
 const releases=[];
 for(const client of [alpha,beta]){
  await client.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:client.apiKey}});
  const c=(await client.actor.request('/api/competitors',{method:'POST',body:{name:client.workspace.name}})).data;client.competitor=c;
  const p=(await client.actor.request(`/api/competitors/${c.id}/profiles`,{method:'POST',body:{platform:'meta',identifier:'777777'}})).data;
  await client.actor.request(`/api/profiles/${p.id}`,{method:'PATCH',body:{confirmed:true}});
  s.state.gates.set(client.apiKey,new Promise(resolve=>releases.push(resolve)));
 }
 try{
  const ra=await alpha.actor.request('/api/refresh',{method:'POST',body:{}});assert.equal(ra.status,202);
  assert.equal((await beta.actor.request('/api/status')).data.refreshing,false,'another client running does not leak activity');
  const rb=await beta.actor.request('/api/refresh',{method:'POST',body:{}});assert.equal(rb.status,202);
  assert.notEqual(ra.data.jobId,rb.data.jobId);
  for(const client of [alpha,beta]){
   const status=(await client.actor.request('/api/status')).data;assert.deepEqual(status.refreshingCompetitorIds,[client.competitor.id]);
   assert.equal((await client.actor.request('/api/refreshes')).data.length,1);
   assert.equal((await client.actor.request('/api/refresh',{method:'POST',body:{}})).status,409);
  }
  assert.equal((await s.owner.request('/api/status')).data.refreshing,false);
  assert.equal(s.state.calls.length,2,'separate clients can run without joining a global serial queue');
 }finally{for(const release of releases)release();await s.created.waitForRefresh();}
 for(const client of [alpha,beta]){
  const items=(await client.actor.request('/api/items')).data;assert.equal(items.length,1);assert.equal(items[0].title,`${client.workspace.name} private evidence`);
  const history=(await client.actor.request('/api/refreshes')).data;assert.equal(history[0].status,'success');assert.equal(history[0].competitorId,client.competitor.id);
  assert.equal((await client.actor.request('/api/status')).data.refreshing,false);
  assert.equal(s.state.calls.find(c=>c.profile.competitorId===client.competitor.id).apiKey,client.apiKey);
 }
 assert.deepEqual((await s.owner.request('/api/items')).data,[]);
 assert.deepEqual((await s.owner.request('/api/refreshes')).data,[]);
});

test('client refresh cannot fall back to the owner provider account or read another saved key',async t=>{
 const s=await setup(t,{withCollector:false}),alpha=await s.client('Alpha','alpha@example.com'),beta=await s.client('Beta','beta@example.com');
 assert.equal((await s.owner.request('/api/settings/provider')).data.configured,true);
 assert.deepEqual((await alpha.actor.request('/api/settings/provider')).data,{configured:false,storageReady:true,source:null});
 const refresh=await alpha.actor.request('/api/refresh',{method:'POST',body:{}});assert.equal(refresh.status,503);assert.match(refresh.data.error,/this workspace/);
 assert.equal((await alpha.actor.request('/api/refreshes')).data.length,0);
 const stored=await alpha.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:alpha.apiKey}});assert.equal(stored.status,200);assert.equal(stored.data.configured,true);assert.equal(JSON.stringify(stored.data).includes(alpha.apiKey),false);
 assert.equal((await beta.actor.request('/api/settings/provider')).data.configured,false);
 assert.equal((await beta.actor.request('/api/settings/provider',{workspace:alpha.workspace.id})).status,404);
 assert.equal((await beta.actor.request('/api/settings/provider',{workspace:alpha.workspace.id,method:'DELETE'})).status,404);
 assert.equal((await s.owner.request('/api/settings/provider',{workspace:alpha.workspace.id})).data.configured,true);
 assert.equal((await alpha.actor.request('/api/settings/provider',{method:'DELETE'})).data.configured,false);
 assert.equal(s.vault.get(alpha.workspace.id),null);assert.equal(s.vault.get('levr'),s.ownerKey);
});

test('durable workspace databases survive reconnect separately and catalog never contains client research or keys',async t=>{
 const s=await setup(t,{durable:true}),alpha=await s.client('Alpha','alpha@example.com'),beta=await s.client('Beta','beta@example.com');
 for(const client of [alpha,beta])await client.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:client.apiKey}});
 const a=await s.research(alpha.actor,'Alpha'),b=await s.research(beta.actor,'Beta');
 assert.equal(s.db.prepare('SELECT count(*) n FROM items').get().n,0,'catalog research is not a cross-client aggregate');
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,2);
 await s.close();
 const files=readdirSync(join(s.directory,'workspaces')).filter(x=>x.endsWith('.sqlite'));assert.equal(files.length,2);
 for(const [client,data] of [[alpha,a],[beta,b]]){
  const path=join(s.directory,'workspaces',`${client.workspace.id}.sqlite`),db=openDatabase(path);
  try{
   assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   assert.equal(db.prepare('SELECT name FROM competitors').get().name,client.workspace.name);
   assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,2);
   assert.equal(db.prepare('SELECT id FROM briefs').get().id,data.brief.id);
   assert.equal(db.prepare('SELECT stage FROM opportunities WHERE id=?').get(data.opportunities[0].id).stage,'Creating');
  }finally{db.close()}
  const bytes=readFileSync(path);for(const key of [s.ownerKey,alpha.apiKey,beta.apiKey])assert.equal(bytes.includes(Buffer.from(key)),false,'provider keys must never enter SQLite');
 }
});
