import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyProviderAccount,ProviderConnectionError} from '../server/provider-connection.js';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';

test('account verification uses the documented balance endpoint and accepts a zero balance',async()=>{
 let calls=0;
 const result=await verifyProviderAccount({apiKey:'test-account-key',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.scrapecreators.com/v1/account/credit-balance');assert.equal(options.method,'GET');assert.equal(options.headers['x-api-key'],'test-account-key');assert.equal(options.redirect,'error');assert.ok(options.signal);
  return Response.json({creditCount:0});
 }});
 assert.equal(calls,1);assert.deepEqual(result,{creditCount:0});
});

test('account verification rejects bad responses without reflecting upstream bodies or secrets',async()=>{
 const secret='synthetic-secret-do-not-echo';
 for(const response of [
  ()=>new Response(secret,{status:401}),()=>new Response(secret,{status:403}),()=>new Response(secret,{status:429}),()=>new Response(secret,{status:500}),
  ()=>Response.json({creditCount:secret}),()=>Response.json({creditCount:2,success:false}),()=>Response.json({creditCount:2,error:secret}),()=>Response.json({creditCount:-1}),
  ()=>new Response('not-json '+secret),()=>new Response('x'.repeat(65537)),()=>Response.json({creditCount:2},{headers:{'content-length':'65537'}}),
 ])await assert.rejects(verifyProviderAccount({apiKey:secret,fetchImpl:async()=>response()}),e=>e instanceof ProviderConnectionError&&!e.message.includes(secret));
 await assert.rejects(verifyProviderAccount({apiKey:secret,fetchImpl:async()=>{throw Error(secret)}}),e=>e instanceof ProviderConnectionError&&!e.message.includes(secret));
 let called=false;await assert.rejects(verifyProviderAccount({apiKey:'invalid key',fetchImpl:async()=>{called=true}}),e=>e.status===400);assert.equal(called,false);
});

async function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'levr-connect-test-')),db=openDatabase(':memory:'),password=randomBytes(24).toString('hex');
 let mode='success',calls=0;const seen=[];
 const created=createApp({db,seed:false,password,production:false,ownerEmail:'owner@example.com',providerKey:'owner-synthetic-key',secretDirectory:directory,secretEncryptionKey:randomBytes(32).toString('hex'),verifyProvider:async({apiKey})=>{
  calls++;seen.push(apiKey);if(mode==='invalid')throw new ProviderConnectionError('Rejected test key',400);if(mode==='unreachable')throw new ProviderConnectionError('Unable to contact test provider',502);return {creditCount:0};
 }});
 const server=created.app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));created.closeWorkspaceDatabases();db.close();rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 function actor(){let cookie='',csrf='';return {async request(path,{method='GET',body,workspace,token=true}={}){const headers={};if(cookie)headers.cookie=cookie;if(csrf&&token)headers['x-csrf-token']=csrf;if(workspace)headers['x-workspace-id']=workspace;if(body!==undefined)headers['content-type']='application/json';const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),data=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrf)csrf=data.csrf;return {status:response.status,data};}};}
 const owner=actor();assert.equal((await owner.request('/auth/login',{method:'POST',body:{email:'owner@example.com',password}})).status,200);
 async function client(name){const w=await owner.request('/api/workspaces',{method:'POST',body:{name}});const email=`${name}@example.com`;const invite=await owner.request(`/api/workspaces/${w.data.id}/invites`,{method:'POST',body:{email}});const c=actor();assert.equal((await c.request('/auth/accept-invite',{method:'POST',body:{token:invite.data.token,email,password:randomBytes(24).toString('hex')}})).status,200);return {actor:c,id:w.data.id};}
 return {owner,client,anonymous:actor(),mode(value){mode=value},calls:()=>calls,seen};
}

test('workspace keys are verified before saving; rejected replacements preserve the verified connection',async t=>{
 const f=await fixture(t),client=await f.client('alpha'),key='synthetic-alpha-key',next='synthetic-replacement-key';
 const first=await client.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:key}});assert.equal(first.status,200);assert.equal(first.data.verified,true);assert.ok(first.data.verifiedAt);assert.equal(first.data.currentCredits,0);assert.equal(JSON.stringify(first.data).includes(key),false);
 const original=(await client.actor.request('/api/settings/provider')).data;
 for(const [mode,status] of [['invalid',400],['unreachable',502]]){f.mode(mode);assert.equal((await client.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:next}})).status,status);assert.deepEqual((await client.actor.request('/api/settings/provider')).data,original);}
 f.mode('success');assert.equal((await client.actor.request('/api/settings/provider/verify',{method:'POST'})).status,200);assert.equal(f.seen.at(-1),key,'verification uses the unchanged original key');
 const count=f.calls();await client.actor.request('/api/settings/provider');await client.actor.request('/api/status');assert.equal(f.calls(),count,'polling never checks provider automatically');
 assert.equal((await client.actor.request('/api/settings/provider',{method:'DELETE'})).data.verified,false);
 assert.equal((await client.actor.request('/api/settings/provider/verify',{method:'POST'})).status,400);assert.equal(f.calls(),count);
});

test('connection checks require authentication, CSRF and current workspace membership',async t=>{
 const f=await fixture(t),a=await f.client('alpha'),b=await f.client('beta');
 assert.equal((await f.anonymous.request('/api/settings/provider/verify',{method:'POST'})).status,401);
 assert.equal((await a.actor.request('/api/settings/provider/verify',{method:'POST',token:false})).status,403);
 assert.equal((await a.actor.request('/api/settings/provider/verify',{method:'POST',workspace:b.id})).status,404);
 assert.equal((await a.actor.request('/api/settings/provider',{method:'PUT',workspace:b.id,body:{apiKey:'forbidden-test-key'}})).status,404);
 assert.equal((await a.actor.request('/api/settings/provider/verify',{method:'POST'})).status,400);
 assert.equal(f.calls(),0,'missing client key never uses owner account');
 const owner=await f.owner.request('/api/settings/provider/verify',{method:'POST'});assert.equal(owner.status,200);assert.equal(owner.data.verified,true);assert.equal(owner.data.source,'environment');assert.equal(f.seen.at(-1),'owner-synthetic-key');
});
