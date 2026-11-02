import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const fields=(email='person@gmail.com')=>({fullName:'Test Person',email,companyName:'Example company',website:'example.test',phone:'',password:randomBytes(24).toString('hex'),marketingConsent:false});
async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'levr-signup-')),db=openDatabase(join(dir,'catalog.sqlite'));
 const ownerPassword=randomBytes(24).toString('hex'),deliveryCalls=[],socialCalls=[];
 let deliveryStatus=200,googleProfile={sub:'google-person',name:'Google Person',email:'google.person@gmail.com',email_verified:true},facebookProfile={id:'1234567',name:'Facebook Person'};
 const app=createApp({db,seed:false,password:ownerPassword,ownerEmail:'owner@example.test',production:false,
  secretEncryptionKey:randomBytes(32).toString('hex'),secretDirectory:join(dir,'secrets'),
  leadDeliveryOptions:{webhookUrl:'https://services.leadconnectorhq.com/hooks/test-location/webhook-trigger/test-hook',fetchImpl:async(url,init)=>{deliveryCalls.push({url,init,payload:JSON.parse(init.body)});return new Response('sensitive provider response',{status:deliveryStatus})}},
  socialSignupOptions:{publicBaseUrl:'https://free.example.test',googleClientId:'fixture-google-id',googleClientSecret:'fixture-google-secret',facebookAppId:'fixture-facebook-id',facebookAppSecret:'fixture-facebook-secret',fetchImpl:async(url,init)=>{
   socialCalls.push({url,init});if(url.includes('token'))return json({access_token:'fixture-access-token'});return json(url.includes('googleapis')?googleProfile:facebookProfile);
  }},...options});
 const server=app.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await app.waitForLeadDelivery();await app.waitForRefresh();await new Promise(r=>server.close(r));app.closeWorkspaceDatabases();db.close();rmSync(dir,{recursive:true,force:true})});
 function actor(){const cookies=new Map();let csrf='';return{cookies,async request(path,{method='GET',body,headers={}}={}){
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  for(const cookie of r.headers.getSetCookie()){const part=cookie.split(';')[0],i=part.indexOf('='),key=part.slice(0,i),value=part.slice(i+1);if(value)cookies.set(key,value);else cookies.delete(key)}
  const data=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();if(data?.csrf)csrf=data.csrf;
  return{status:r.status,data,headers:r.headers};
 },async signup(value=fields()){return this.request('/auth/signup',{method:'POST',body:value})},async oauth(provider){const start=await this.request(`/auth/oauth/${provider}/start`,{method:'POST',body:{}});assert.equal(start.status,200);const url=new URL(start.data.url);return {url,callback:`/auth/oauth/${provider}/callback?state=${url.searchParams.get('state')}&code=fixture-code`}}};}
 const owner=actor();await owner.request('/auth/login',{method:'POST',body:{email:'owner@example.test',password:ownerPassword}});
 return{db,app,base,actor,owner,deliveryCalls,socialCalls,setDeliveryStatus:v=>deliveryStatus=v,setGoogle:v=>googleProfile=v,setFacebook:v=>facebookProfile=v};
}
test('Public signup grants only its own workspace and sends allowed lead fields without a password',async t=>{
 const s=await fixture(t),client=s.actor(),input=fields();input.attribution={utm_source:'instagram',utm_medium:'paid_social',utm_campaign:'free-library',utm_content:'carousel-1',utm_term:'growth operators',access_token:'must-not-be-forwarded'};
 const r=await client.signup({...input,role:'owner',workspaceId:'levr'});assert.equal(r.status,201);assert.equal(r.data.user.role,'client');assert.equal(r.data.workspaces.length,1);assert.notEqual(r.data.defaultWorkspaceId,'levr');
 assert.equal((await client.request('/api/competitors',{headers:{'X-Workspace-Id':'levr'}})).status,404);
 assert.equal((await client.request('/api/signup-leads')).status,403);
 assert.equal((await s.actor().request('/api/signup-leads')).status,401);
 await s.app.waitForLeadDelivery();assert.equal(s.deliveryCalls.length,1);
 const payload=s.deliveryCalls[0].payload;assert.equal(payload.email,input.email);assert.equal(payload.website,'https://example.test/');assert.equal(payload.utm_source,'instagram');assert.equal(payload.marketing_email_opt_in,false);assert.equal(payload.email_verified,false);assert.equal(payload.marketing_consent_at,null);
 assert.equal(JSON.stringify(payload).includes(input.password),false);assert.equal('password' in payload,false);assert.equal(s.deliveryCalls[0].init.redirect,'error');
 for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'])assert.equal(payload[key],input.attribution[key]);
 assert.equal('access_token' in payload,false);
 const lead=s.db.prepare('SELECT * FROM signup_leads').get();assert.equal(lead.delivery_status,'delivered');assert.equal(lead.workspace_id,r.data.defaultWorkspaceId);
 assert.equal((await s.owner.request('/api/signup-leads')).data.leads.length,1);
 assert.equal((await client.request(`/api/signup-leads/${lead.id}/retry`,{method:'POST',body:{}})).status,403);
});
test('Failed handoff preserves access and owner retries reuse the event identity',async t=>{
 const s=await fixture(t),client=s.actor();s.setDeliveryStatus(500);
 const r=await client.signup({...fields(),marketingConsent:true,phone:'+62 812-3456-7890'});assert.equal(r.status,201);await s.app.waitForLeadDelivery();
 const lead=s.db.prepare('SELECT * FROM signup_leads').get();assert.equal(lead.delivery_status,'failed');assert.equal(lead.last_error.includes('sensitive'),false);
 assert.equal((await client.request('/api/session')).status,200);s.setDeliveryStatus(200);
 assert.equal((await s.owner.request(`/api/signup-leads/${lead.id}/retry`,{method:'POST',body:{}})).status,202);await s.app.waitForLeadDelivery();
 assert.equal(s.deliveryCalls.length,2);assert.deepEqual(s.deliveryCalls[1].payload,s.deliveryCalls[0].payload);assert.equal(s.deliveryCalls[0].payload.phone,'+6281234567890');assert.equal(s.deliveryCalls[0].payload.marketing_email_opt_in,true);
 assert.equal(s.db.prepare('SELECT attempts FROM signup_leads').get().attempts,2);
 assert.equal((await s.owner.request(`/api/signup-leads/${lead.id}/retry`,{method:'POST',body:{}})).status,409);
});
test('Duplicate signup, reserved owner email, invalid fields and cross-site registration fail safely',async t=>{
 const s=await fixture(t),a=s.actor();assert.equal((await a.signup(fields())).status,201);
 assert.equal((await s.actor().signup(fields())).status,409);assert.equal((await s.actor().signup(fields('owner@example.test'))).status,409);
 for(const extra of [{website:'javascript:alert(1)'},{phone:'0812'},{contactAddress:'bot'}])assert.equal((await s.actor().signup({...fields('another@gmail.com'),...extra})).status,400);
 assert.equal((await s.actor().request('/auth/signup',{method:'POST',body:fields('other@gmail.com'),headers:{Origin:'https://other.example'}})).status,403);
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,1);
});
test('Google signup is browser-bound, PKCE protected, single-use and finishes without a password',async t=>{
 const s=await fixture(t),client=s.actor(),other=s.actor(),flow=await client.oauth('google');
 assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
 assert.equal((await other.request(flow.callback)).headers.get('location'),'/signup?auth_error=oauth_failed');assert.equal(s.socialCalls.length,0);
 assert.equal((await client.request(flow.callback)).headers.get('location'),'/signup');
 const exchange=new URLSearchParams(s.socialCalls[0].init.body);assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),flow.url.searchParams.get('code_challenge'));
 const context=(await client.request('/auth/signup-config')).data;assert.equal(context.social.email,'google.person@gmail.com');assert.equal(context.social.emailVerified,true);
 const body={...fields('google.person@gmail.com'),password:undefined};
 assert.equal((await client.signup({...body,email:'different@gmail.com'})).status,400);
 const result=await client.signup(body);assert.equal(result.status,201);assert.equal(s.db.prepare('SELECT provider FROM social_identities').get().provider,'google');await s.app.waitForLeadDelivery();assert.equal(s.deliveryCalls[0].payload.email_verified,true);
 assert.equal((await client.request(flow.callback)).headers.get('location'),'/signup?auth_error=oauth_failed');
 const again=s.actor(),login=await again.oauth('google');assert.equal((await again.request(login.callback)).headers.get('location'),'/settings');assert.equal((await again.request('/api/session')).data.user.id,result.data.user.id);
 const stored=JSON.stringify(s.db.prepare('SELECT * FROM pending_social_signups').all())+JSON.stringify(s.db.prepare('SELECT * FROM signup_oauth_states').all())+JSON.stringify(s.db.prepare('SELECT * FROM signup_leads').all());
 for(const secret of ['fixture-google-secret','fixture-access-token',exchange.get('code_verifier')])assert.equal(stored.includes(secret),false);
});
test('Facebook signup without a returned email collects an address and never claims it is verified',async t=>{
 const s=await fixture(t),client=s.actor(),flow=await client.oauth('facebook');assert.equal(flow.url.searchParams.get('scope'),'public_profile,email');
 assert.equal((await client.request(flow.callback)).headers.get('location'),'/signup');assert.equal((await client.request('/auth/signup-config')).data.social.email,null);
 assert.equal((await client.signup({...fields('personal@gmail.com'),password:undefined})).status,201);await s.app.waitForLeadDelivery();assert.equal(s.deliveryCalls[0].payload.signup_method,'facebook');assert.equal(s.deliveryCalls[0].payload.email_verified,false);
});
test('Social email matches never silently link to an existing password account',async t=>{
 const s=await fixture(t);await s.actor().signup(fields('google.person@gmail.com'));
 const client=s.actor(),flow=await client.oauth('google');await client.request(flow.callback);
 assert.equal((await client.signup({...fields('google.person@gmail.com'),password:undefined})).status,409);
 assert.equal((await client.request('/api/session')).status,401);assert.equal(s.db.prepare('SELECT count(*) n FROM social_identities').get().n,0);
});
test('Unverified Google identity is rejected and disabled social users cannot regain access',async t=>{
 const s=await fixture(t),a=s.actor();s.setGoogle({sub:'person',email:'test@gmail.com',email_verified:false});let flow=await a.oauth('google');assert.equal((await a.request(flow.callback)).headers.get('location'),'/signup?auth_error=oauth_failed');
 s.setGoogle({sub:'person',email:'test@gmail.com',email_verified:true});flow=await a.oauth('google');await a.request(flow.callback);await a.signup({...fields('test@gmail.com'),password:undefined});s.db.prepare('UPDATE users SET disabled=1').run();
 const b=s.actor();flow=await b.oauth('google');assert.equal((await b.request(flow.callback)).headers.get('location'),'/signup?auth_error=access_unavailable');
});
test('Unsafe webhook destinations are never contacted; disabled signup and rate limits are enforced',async t=>{
 let calls=0;const s=await fixture(t,{leadDeliveryOptions:{webhookUrl:'https://127.0.0.1/private',fetchImpl:async()=>{calls++;throw Error()}}});
 await s.actor().signup(fields());await s.app.waitForLeadDelivery();assert.equal(calls,0);assert.equal(s.db.prepare('SELECT delivery_status FROM signup_leads').get().delivery_status,'unconfigured');
 for(let n=0;n<9;n++)await s.actor().signup({...fields('invalid@gmail.com'),password:'short'});
 assert.equal((await s.actor().signup(fields('next@gmail.com'))).status,429);
 const disabled=await fixture(t,{signupEnabled:false});assert.equal((await disabled.actor().signup(fields())).status,403);assert.equal((await disabled.actor().request('/auth/signup-config')).data.enabled,false);
});
