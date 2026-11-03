import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,existsSync,rmSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {openDatabase} from '../server/db.js';
import {createApp} from '../server/app.js';
import {createSecretVault} from '../server/secret-vault.js';
import {createWorkspaceManager} from '../server/workspaces.js';
import {createAccountDeletion} from '../server/account-deletion.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const secret='synthetic-facebook-app-secret';
const signed=(subject,extra={})=>{const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',issued_at:Math.floor(Date.now()/1000),user_id:subject,...extra})).toString('base64url');return `${createHmac('sha256',secret).update(payload).digest('base64url')}.${payload}`};
async function fixture(t,overrides={}){
 const dir=mkdtempSync(join(tmpdir(),'levr-delete-')),db=openDatabase(join(dir,'catalog.sqlite'));
 const ownerPassword=randomBytes(24).toString('hex'),masterKey=randomBytes(32).toString('hex');
 const state={failFiles:false,deliveries:[],warnings:[],google:{sub:'google-1',name:'Google Test',email:'social@example.test',email_verified:true},facebook:{id:'123456789',name:'Facebook Test',email:'facebook@example.test'},profileGate:null};
 const actualVault=createSecretVault({directory:join(dir,'secrets'),masterKey});
 const vault={...actualVault,delete(id){if(state.failFiles)throw Error('sensitive storage detail');return actualVault.delete(id)}};
 const app=createApp({db,seed:false,password:ownerPassword,ownerEmail:'owner@example.test',production:false,vault,verifyProvider:async()=>({creditCount:10}),
  deletionLogger:{warn:(...args)=>state.warnings.push(args)},
  leadDeliveryOptions:{webhookUrl:'https://services.leadconnectorhq.com/hooks/test/webhook-trigger/test',fetchImpl:async(url,init)=>{state.deliveries.push(JSON.parse(init.body));return new Response('',{status:200})}},
  socialSignupOptions:{publicBaseUrl:'https://free.example.test',googleClientId:'synthetic-client',googleClientSecret:'synthetic-google-secret',facebookAppId:'synthetic-facebook',facebookAppSecret:secret,fetchImpl:async(url)=>{if(url.includes('token'))return json({access_token:'synthetic-access-token'});if(state.profileGate)await state.profileGate;return json(url.includes('googleapis')?state.google:state.facebook)}},...overrides});
 const server=app.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 function actor(){const cookies=new Map();let csrf='';return{cookies,async request(path,{method='GET',body,headers={},security=true}={}){
  const response=await fetch(base+path,{method,redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(security?{'X-CSRF-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  for(const item of response.headers.getSetCookie()){const pair=item.split(';')[0],index=pair.indexOf('='),key=pair.slice(0,index),value=pair.slice(index+1);if(value)cookies.set(key,value);else cookies.delete(key)}
  const data=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();if(data?.csrf)csrf=data.csrf;
  return {status:response.status,data,headers:response.headers};
 },async oauth(provider,reauth=false){const start=await this.request(reauth?`/api/account/deletion/reauth/${provider}`:`/auth/oauth/${provider}/start`,{method:'POST',body:{}});assert.equal(start.status,200,JSON.stringify(start.data));const url=new URL(start.data.url);return {url,callback:`/auth/oauth/${provider}/callback?state=${url.searchParams.get('state')}&code=synthetic-code`}}};}
 const owner=actor();assert.equal((await owner.request('/auth/login',{method:'POST',body:{email:'owner@example.test',password:ownerPassword}})).status,200);
 async function signup(email='client@example.test',person=actor(),password=randomBytes(24).toString('hex')){
  const result=await person.request('/auth/signup',{method:'POST',body:{fullName:'Deletion Test',companyName:'Private client',email,password}});assert.equal(result.status,201,JSON.stringify(result.data));await app.waitForLeadDelivery();
  return {actor:person,email,password,userId:result.data.user.id,workspaceId:result.data.defaultWorkspaceId};
 }
 async function research(person){
  const result=await person.actor.request('/api/competitors',{method:'POST',body:{name:'Private research'}});assert.equal(result.status,201);const competitor=result.data;
  actualVault.set(person.workspaceId,randomBytes(24).toString('hex'));
  return competitor;
 }
 async function meta(value,origin){return fetch(base+'/auth/oauth/facebook/data-deletion',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(origin?{Origin:origin}:{})},body:new URLSearchParams({signed_request:value})})}
 t.after(async()=>{await app.waitForLeadDelivery();await app.waitForRefresh();await new Promise(resolve=>server.close(resolve));app.closeWorkspaceDatabases();db.close();rmSync(dir,{recursive:true,force:true})});
 return {dir,db,state,app,owner,ownerPassword,actor,signup,research,vault,actualVault,base,meta};
}

test('owner deletion removes the full account cascade, exclusive research files and keys, without touching other clients or the owner',async t=>{
 const s=await fixture(t),client=await s.signup(),other=await s.signup('other@example.test');await s.research(client);await s.research(other);
 const temporary=join(s.dir,'secrets',`${client.workspaceId}.${'a'.repeat(24)}.tmp`);copyFileSync(join(s.dir,'secrets',client.workspaceId+'.json'),temporary);
 const otherTemporary=join(s.dir,'secrets',`${other.workspaceId}.${'b'.repeat(24)}.tmp`);copyFileSync(join(s.dir,'secrets',other.workspaceId+'.json'),otherTemporary);
 s.actualVault.set('levr',randomBytes(24).toString('hex'));
 s.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run('facebook','987654321',client.userId,new Date().toISOString());
 s.db.prepare('INSERT INTO pending_social_signups VALUES (?,?,?,?,?,?,?)').run(hash('ticket'),'facebook','987654321',null,0,'Must disappear',Date.now()+900000);
 s.db.prepare('INSERT INTO pending_social_signups VALUES (?,?,?,?,?,?,?)').run(hash('email-ticket'),'google','another-subject',client.email,1,'Must disappear',Date.now()+900000);
 await s.owner.request(`/api/workspaces/${other.workspaceId}/invites`,{method:'POST',body:{email:client.email}});
 await s.owner.request(`/api/workspaces/${client.workspaceId}/invites`,{method:'POST',body:{email:'pending-invite@example.test'}});
 const reauth=await client.actor.oauth('facebook',true);assert.ok(reauth);
 const wrong=await s.owner.request(`/api/accounts/${client.userId}`,{method:'DELETE',body:{confirmationEmail:'wrong@example.test'}});assert.equal(wrong.status,400);
 const result=await s.owner.request(`/api/accounts/${client.userId}`,{method:'DELETE',headers:{'X-Workspace-Id':'invalid-workspace'},body:{confirmationEmail:client.email}});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.cleanupPending,false);
 for(const table of ['users','memberships','sessions','social_identities','signup_leads','account_deletion_reauth','account_deletion_challenges']){
  const column=table==='users'?'id':'user_id';assert.equal(s.db.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`).get(client.userId).n,0,table);
 }
 assert.equal(s.db.prepare('SELECT count(*) n FROM pending_social_signups').get().n,0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM signup_oauth_states').get().n,0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM invites').get().n,0);
 for(const suffix of ['','-wal','-shm','-journal'])assert.equal(existsSync(join(s.dir,'workspaces',client.workspaceId+'.sqlite'+suffix)),false);
 assert.equal(existsSync(join(s.dir,'secrets',client.workspaceId+'.json')),false);
 assert.equal(existsSync(temporary),false);assert.equal(existsSync(otherTemporary),true);
 assert.ok(existsSync(join(s.dir,'workspaces',other.workspaceId+'.sqlite')));assert.ok(existsSync(join(s.dir,'secrets','levr.json')));
 assert.equal((await other.actor.request('/api/competitors')).data.length,1);assert.equal((await s.owner.request('/api/session')).data.user.role,'owner');
 assert.equal((await client.actor.request('/api/session')).status,401);assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
 const audit=s.db.prepare('SELECT * FROM account_deletions').get();assert.equal(audit.email_hash,hash(client.email));assert.equal(audit.actor_type,'owner');assert.equal(audit.reason,'owner_request');assert.equal(audit.crm_follow_up_required,1);
 const retained=JSON.stringify(s.db.prepare('SELECT * FROM account_deletions').all())+JSON.stringify(s.db.prepare('SELECT * FROM deleted_social_identities').all());
 for(const privateValue of [client.email,client.password,'987654321','Must disappear'])assert.equal(retained.includes(privateValue),false);
 assert.equal(s.app.deleteAccount(client.userId,{reason:'owner_request'}).deletionId,audit.id);assert.equal(s.db.prepare('SELECT count(*) n FROM account_deletions').get().n,1);
 const recreated=await s.signup(client.email);assert.notEqual(recreated.userId,client.userId);
});
test('shared workspaces, keys and other members survive until the last account is deleted',async t=>{
 const s=await fixture(t),first=await s.signup(),second=await s.signup('shared@example.test');await s.research(first);await s.research(second);
 s.db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(first.workspaceId,second.userId,new Date().toISOString());
 await s.owner.request(`/api/workspaces/${first.workspaceId}/invites`,{method:'POST',body:{email:'future@example.test'}});
 const preview=(await s.owner.request(`/api/accounts/${first.userId}/deletion`)).data;assert.equal(preview.workspaces[0].willDelete,false);
 s.app.deleteAccount(first.userId,{reason:'owner_request'});
 assert.ok(s.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(first.workspaceId));assert.ok(s.actualVault.get(first.workspaceId));
 assert.equal((await second.actor.request('/api/competitors',{headers:{'X-Workspace-Id':first.workspaceId}})).data.length,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM invites').get().n,1);
 s.app.deleteAccount(second.userId,{reason:'owner_request'});
 assert.equal(existsSync(join(s.dir,'workspaces',first.workspaceId+'.sqlite')),false);assert.equal(existsSync(join(s.dir,'secrets',first.workspaceId+'.json')),false);
 assert.equal(s.db.prepare('SELECT count(*) n FROM workspaces').get().n,1);assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('a failed file cleanup leaves a durable recoverable record and sanitized logs after catalog commit',async t=>{
 const s=await fixture(t),client=await s.signup();await s.research(client);s.state.failFiles=true;
 const removed=s.app.deleteAccount(client.userId,{reason:'owner_request'});assert.equal(removed.cleanupPending,true);
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,0);assert.equal((await client.actor.request('/api/session')).status,401);
 assert.ok(existsSync(join(s.dir,'secrets',client.workspaceId+'.json')));
 const log=JSON.stringify(s.state.warnings)+JSON.stringify(s.db.prepare('SELECT * FROM account_deletion_files').all());
 assert.equal(log.includes(client.email),false);assert.equal(log.includes('sensitive storage detail'),false);
 s.state.failFiles=false;const retried=await s.owner.request(`/api/account-deletions/${removed.deletionId}/retry`,{method:'POST',body:{}});assert.equal(retried.status,200);assert.equal(retried.data.cleanupPending,false);
 assert.equal(existsSync(join(s.dir,'secrets',client.workspaceId+'.json')),false);assert.equal(s.db.prepare('SELECT attempts FROM account_deletion_files').get().attempts,2);
});
test('catalog failure rolls back the complete deletion before any file is removed',async t=>{
 const s=await fixture(t),client=await s.signup();await s.research(client);
 s.db.exec("CREATE TRIGGER prevent_test_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT,'test deletion blocked'); END");
 assert.throws(()=>s.app.deleteAccount(client.userId,{reason:'owner_request'}));
 for(const table of ['users','memberships','signup_leads'])assert.equal(s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM account_deletions').get().n,0);assert.equal((await client.actor.request('/api/session')).status,200);
 assert.ok(existsSync(join(s.dir,'workspaces',client.workspaceId+'.sqlite')));assert.ok(s.actualVault.get(client.workspaceId));
});
test('owner protection, owner-only APIs and session CSRF apply to every deletion entry point',async t=>{
 const s=await fixture(t),client=await s.signup(),other=await s.signup('other@example.test');
 for(const value of [null,undefined,'owner','levr','owner@example.test','../elsewhere'])assert.throws(()=>s.app.deleteAccount(value,{reason:'owner_request'}),/client account/);
 const rogue=randomUUID();s.db.prepare('INSERT INTO users VALUES (?,?,?,?,0)').run(rogue,'owner@example.test','synthetic',new Date().toISOString());assert.throws(()=>s.app.deleteAccount(rogue,{reason:'owner_request'}),/owner cannot/);
 for(const [path,method,body]of [['/api/accounts','GET'],['/api/account-deletions','GET'],[`/api/accounts/${other.userId}/deletion`,'GET'],[`/api/accounts/${other.userId}`,'DELETE',{confirmationEmail:other.email}],['/api/account-deletions/missing/retry','POST',{}]])assert.equal((await client.actor.request(path,{method,body})).status,403);
 assert.equal((await s.owner.request('/api/account',{method:'DELETE',body:{}})).status,403);
 assert.equal((await client.actor.request('/api/account',{method:'DELETE',body:{confirmationEmail:client.email,password:client.password},security:false})).status,403);
 assert.ok(s.db.prepare('SELECT 1 FROM users WHERE id=?').get(client.userId));
});
test('client self-service requires the current password and revokes every session on success',async t=>{
 const s=await fixture(t),client=await s.signup();await s.research(client);const second=s.actor();await second.request('/auth/login',{method:'POST',body:{email:client.email,password:client.password}});
 assert.equal((await client.actor.request('/api/account',{method:'DELETE',body:{confirmationEmail:client.email,password:'incorrect-password'}})).status,403);
 assert.equal((await client.actor.request('/api/session')).status,200);
 const result=await client.actor.request('/api/account',{method:'DELETE',body:{confirmationEmail:client.email,password:client.password,userId:randomUUID()}});
 assert.equal(result.status,200);assert.equal(client.actor.cookies.has('levr_session'),false);assert.equal((await second.request('/api/session')).status,401);
 assert.equal(s.db.prepare('SELECT reason FROM account_deletions').get().reason,'self_service');
});
test('provider deletion reauthentication requires the linked identity and grants only the initiating session for five minutes',async t=>{
 const s=await fixture(t),person=s.actor();let flow=await person.oauth('google');await person.request(flow.callback);const client=await s.signup(s.state.google.email,person,undefined);
 let reauth=await person.oauth('google',true);assert.equal(reauth.url.searchParams.get('max_age'),'0');s.state.google.sub='wrong-identity';assert.equal((await person.request(reauth.callback)).headers.get('location'),'/settings?account_delete_auth=failed');assert.equal(s.db.prepare('SELECT count(*) n FROM account_deletion_reauth').get().n,0);
 s.state.google.sub='google-1';reauth=await person.oauth('google',true);assert.equal((await person.request(reauth.callback)).headers.get('location'),'/settings?account_delete_auth=verified');assert.equal((await person.request('/api/account/deletion')).data.reauthenticated,true);
 const another=s.actor();flow=await another.oauth('google');await another.request(flow.callback);assert.equal((await another.request('/api/account',{method:'DELETE',body:{confirmationEmail:client.email}})).status,403);
 s.db.prepare('UPDATE account_deletion_reauth SET expires_at=?').run(Date.now()-1);assert.equal((await person.request('/api/account',{method:'DELETE',body:{confirmationEmail:client.email}})).status,403);
 reauth=await person.oauth('google',true);await person.request(reauth.callback);assert.equal((await person.request('/api/account',{method:'DELETE',body:{confirmationEmail:client.email}})).status,200);
 assert.equal(s.db.prepare('SELECT count(*) n FROM account_deletion_reauth').get().n,0);
});
test('Meta signed requests reject tampering and return opaque public confirmation for matching and unknown identities',async t=>{
 const s=await fixture(t),client=await s.signup();await s.research(client);s.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run('facebook','123456789',client.userId,new Date().toISOString());
 const good=signed('123456789');
 for(const bad of ['bad',good.slice(0,-1)+(good.endsWith('A')?'B':'A'),signed('123456789',{algorithm:'none'}),signed('123456789',{issued_at:Math.floor(Date.now()/1000)+9999})])assert.equal((await s.meta(bad)).status,400);
 assert.ok(s.db.prepare('SELECT 1 FROM users WHERE id=?').get(client.userId));
 const response=await s.meta(good,'https://www.facebook.com');assert.equal(response.status,200);const data=await response.json();assert.match(data.confirmation_code,/^[A-Za-z0-9_-]{43}$/);assert.equal(data.url,`https://free.example.test/auth/oauth/facebook/data-deletion/${data.confirmation_code}`);
 const page=await fetch(s.base+new URL(data.url).pathname);const html=await page.text();assert.equal(page.status,200);assert.ok(html.includes('App deletion complete.'));assert.equal(html.includes(client.email),false);assert.equal(html.includes('123456789'),false);
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,0);assert.equal(s.db.prepare('SELECT reason FROM account_deletions').get().reason,'meta_request');
 const unknown=await s.meta(signed('9999999'));assert.equal(unknown.status,200);const other=await unknown.json();assert.deepEqual(Object.keys(other),Object.keys(data));assert.equal((await (await fetch(s.base+new URL(other.url).pathname)).text()),html);
 assert.equal((await fetch(s.base+'/auth/oauth/facebook/data-deletion/invalid')).status,404);
 const again=await s.meta(good);assert.equal(again.status,200);assert.equal(s.db.prepare('SELECT count(*) n FROM account_deletions').get().n,1);
});
test('Meta status remains pending after a failed cleanup, including repeated callbacks, and an old callback cannot delete a later signup',async t=>{
 const s=await fixture(t),client=await s.signup();await s.research(client);s.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run('facebook','123456789',client.userId,new Date().toISOString());
 s.state.failFiles=true;const request=signed('123456789');const first=await (await s.meta(request)).json();assert.match(await (await fetch(s.base+new URL(first.url).pathname)).text(),/Deletion is being completed/);
 const second=await (await s.meta(request)).json();assert.match(await (await fetch(s.base+new URL(second.url).pathname)).text(),/Deletion is being completed/);
 s.state.failFiles=false;s.app.retryAccountCleanup(s.db.prepare('SELECT id FROM account_deletions').get().id);
 assert.match(await (await fetch(s.base+new URL(first.url).pathname)).text(),/App deletion complete/);
 const later=await s.signup(client.email);s.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run('facebook','123456789',later.userId,new Date().toISOString());await s.meta(request);assert.ok(s.db.prepare('SELECT 1 FROM users WHERE id=?').get(later.userId));
});
test('Meta also removes incomplete Facebook signup data without revealing account existence',async t=>{
 const s=await fixture(t),person=s.actor();const flow=await person.oauth('facebook');await person.request(flow.callback);
 assert.equal(s.db.prepare('SELECT count(*) n FROM pending_social_signups').get().n,1);assert.equal((await s.meta(signed(s.state.facebook.id))).status,200);
 assert.equal(s.db.prepare('SELECT count(*) n FROM pending_social_signups').get().n,0);assert.equal((await person.request('/auth/signup-config')).data.social,null);
});
test('an OAuth response already in flight cannot restore pending personal data after deletion',async t=>{
 const s=await fixture(t),person=s.actor();let flow=await person.oauth('google');await person.request(flow.callback);const client=await s.signup(s.state.google.email,person);
 let release,entered;const started=new Promise(resolve=>entered=resolve);s.state.profileGate=new Promise(resolve=>release=resolve);
 // Wait until the state has been consumed and the provider fetch is in progress.
 const waiting=s.actor();
 const login=await waiting.oauth('google');const response=waiting.request(login.callback);
 const check=setInterval(()=>{if(!s.db.prepare('SELECT 1 FROM signup_oauth_states WHERE state_hash=?').get(hash(new URL('https://x'+login.callback).searchParams.get('state')))){clearInterval(check);entered()}},5);
 await started;s.app.deleteAccount(client.userId,{reason:'owner_request'});release();
 assert.equal((await response).headers.get('location'),'/signup?auth_error=oauth_failed');assert.equal(s.db.prepare('SELECT count(*) n FROM pending_social_signups').get().n,0);
});
test('queued webhook deliveries are discarded and in-flight requests are aborted when the account is deleted',async t=>{
 const calls=[];const s=await fixture(t,{leadDeliveryOptions:{webhookUrl:'https://services.leadconnectorhq.com/hooks/test/webhook-trigger/test',fetchImpl:async(url,init)=>{calls.push(JSON.parse(init.body));return new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})})}}});
 async function create(email){const response=await s.actor().request('/auth/signup',{method:'POST',body:{fullName:'Queue test',companyName:'Queue',email,password:randomBytes(24).toString('hex')}});assert.equal(response.status,201);return response.data.user.id}
 const first=await create('first@example.test'),second=await create('second@example.test');
 assert.equal(calls.length,1);s.app.deleteAccount(second,{reason:'owner_request'});s.app.deleteAccount(first,{reason:'owner_request'});await s.app.waitForLeadDelivery();
 assert.equal(calls.length,1);assert.equal(s.db.prepare('SELECT count(*) n FROM signup_leads').get().n,0);
 assert.equal(s.db.prepare('SELECT crm_follow_up_required FROM account_deletions WHERE user_id=?').get(first).crm_follow_up_required,1);
 assert.equal(s.db.prepare('SELECT crm_follow_up_required FROM account_deletions WHERE user_id=?').get(second).crm_follow_up_required,0);
});
test('refresh and credential verification responses cannot recreate a deleted workspace or its key',async t=>{
 let releaseRefresh,releaseKey,enteredRefresh,enteredKey;
 const refreshStarted=new Promise(resolve=>enteredRefresh=resolve),keyStarted=new Promise(resolve=>enteredKey=resolve);
 const refreshGate=new Promise(resolve=>releaseRefresh=resolve),keyGate=new Promise(resolve=>releaseKey=resolve);
 const s=await fixture(t,{collector:async()=>{enteredRefresh();await refreshGate;return {items:[],complete:true}},verifyProvider:async()=>{enteredKey();await keyGate;return {creditCount:10}}});
 const client=await s.signup(),competitor=await s.research(client);
 const profile=await client.actor.request(`/api/competitors/${competitor.id}/profiles`,{method:'POST',body:{platform:'instagram',identifier:'testprofile'}});
 await client.actor.request(`/api/profiles/${profile.data.id}`,{method:'PATCH',body:{confirmed:true}});
 assert.equal((await client.actor.request('/api/refresh',{method:'POST',body:{competitorId:competitor.id}})).status,202);await refreshStarted;
 const verification=client.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:randomBytes(24).toString('hex')}});await keyStarted;
 try{s.app.deleteAccount(client.userId,{reason:'owner_request'})}finally{releaseRefresh();releaseKey()}
 assert.equal((await verification).status,410);await s.app.waitForRefresh();
 assert.equal(existsSync(join(s.dir,'workspaces',client.workspaceId+'.sqlite')),false);assert.equal(existsSync(join(s.dir,'secrets',client.workspaceId+'.json')),false);
 assert.equal((await s.owner.request('/api/competitors',{headers:{'X-Workspace-Id':client.workspaceId}})).status,404);
});
test('cleanup can resume from the durable audit after a new service instance opens the catalog',async t=>{
 const s=await fixture(t),client=await s.signup();await s.research(client);s.state.failFiles=true;
 const original=s.app.deleteAccount(client.userId,{reason:'owner_request'});assert.equal(original.cleanupPending,true);
 const reopened=openDatabase(join(s.dir,'catalog.sqlite')),manager=createWorkspaceManager(reopened);
 try{
  const service=createAccountDeletion(reopened,{manager,vault:createSecretVault({directory:join(s.dir,'secrets')}),ownerEmail:'owner@example.test'});
  const result=service.deleteAccount(client.userId,{reason:'owner_request'});assert.equal(result.deletionId,original.deletionId);assert.equal(result.cleanupPending,false);
  assert.equal(existsSync(join(s.dir,'secrets',client.workspaceId+'.json')),false);
 }finally{manager.close();reopened.close()}
});
test('an empty workspace referenced by another account signup is retained until that account is deleted',async t=>{
 const s=await fixture(t),origin=await s.signup(),other=await s.signup('other@example.test');await s.research(origin);
 s.db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(origin.workspaceId,other.userId,new Date().toISOString());
 s.db.prepare('DELETE FROM memberships WHERE user_id=? AND workspace_id=?').run(origin.userId,origin.workspaceId);
 s.app.deleteAccount(other.userId,{reason:'owner_request'});assert.ok(s.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(origin.workspaceId));
 assert.ok(s.db.prepare('SELECT 1 FROM signup_leads WHERE user_id=?').get(origin.userId));
 s.app.deleteAccount(origin.userId,{reason:'owner_request'});assert.equal(existsSync(join(s.dir,'workspaces',origin.workspaceId+'.sqlite')),false);assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('revoked clients cannot finish saving a replacement key into a retained shared workspace',async t=>{
 let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const s=await fixture(t,{verifyProvider:async()=>{entered();await gate;return {creditCount:10}}});
 const first=await s.signup(),other=await s.signup('other@example.test');await s.research(first);const originalKey=s.actualVault.get(first.workspaceId);
 s.db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(first.workspaceId,other.userId,new Date().toISOString());
 const pending=first.actor.request('/api/settings/provider',{method:'PUT',body:{apiKey:randomBytes(24).toString('hex')}});await started;
 try{s.app.deleteAccount(first.userId,{reason:'owner_request'})}finally{release()}
 assert.equal((await pending).status,410);assert.equal(s.actualVault.get(first.workspaceId),originalKey);
});
test('one-off setup cleanup previews first, deletes only the four exact aliases through the service, and is repeatable',async t=>{
 const s=await fixture(t);
 for(let i=1;i<=5;i++)await s.signup(`braceyfraser+levrtest${i}@gmail.com`);
 await s.signup('braceyfraser@gmail.com');
 const run=async args=>promisify(execFile)(process.execPath,['scripts/delete-setup-accounts.mjs',...args],{cwd:process.cwd(),env:{PATH:process.env.PATH,PORT:new URL(s.base).port,OWNER_EMAIL:'owner@example.test',LEVR_OWNER_PASSWORD:s.ownerPassword},timeout:15000});
 const preview=await run([]);assert.match(preview.stdout,/"matchedSetupAccounts":4/);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,6);
 const applied=await run(['--apply']);assert.match(applied.stdout,/"deleted":4/);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,2);assert.equal(s.db.prepare("SELECT count(*) n FROM account_deletions WHERE reason='setup_cleanup'").get().n,4);
 assert.ok(s.db.prepare('SELECT 1 FROM users WHERE email=?').get('braceyfraser@gmail.com'));assert.ok(s.db.prepare('SELECT 1 FROM users WHERE email=?').get('braceyfraser+levrtest5@gmail.com'));
 const repeated=await run(['--apply']);assert.match(repeated.stdout,/"deleted":0/);
 for(const output of [preview,applied,repeated])assert.equal((output.stdout+output.stderr).includes(s.ownerPassword),false);
});
