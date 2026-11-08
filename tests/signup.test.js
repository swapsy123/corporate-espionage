import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
import {createSocialSignup} from '../server/social-signup.js';

const fields=(email='person@gmail.com')=>({fullName:'Test Person',email,companyName:'Example company',website:'example.test',phone:'',password:randomBytes(24).toString('hex'),marketingConsent:false});
async function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'levr-signup-')),db=openDatabase(join(dir,'catalog.sqlite'));
 const ownerPassword=randomBytes(24).toString('hex'),deliveryCalls=[],socialCalls=[];
 let deliveryStatus=200;
 const app=createApp({db,seed:false,password:ownerPassword,ownerEmail:'owner@example.test',production:false,
  secretEncryptionKey:randomBytes(32).toString('hex'),secretDirectory:join(dir,'secrets'),
  leadDeliveryOptions:{webhookUrl:'https://services.leadconnectorhq.com/hooks/test-location/webhook-trigger/test-hook',fetchImpl:async(url,init)=>{deliveryCalls.push({url,init,payload:JSON.parse(init.body)});return new Response('sensitive provider response',{status:deliveryStatus})}},
  socialSignupOptions:{publicBaseUrl:'https://free.example.test',googleClientId:'fixture-google-id',googleClientSecret:'fixture-google-secret',facebookAppId:'fixture-facebook-id',facebookAppSecret:'fixture-facebook-secret',fetchImpl:async(url,init)=>{
   socialCalls.push({url,init});throw Error('Provider authentication must not be contacted.');
  }},...options});
 const server=app.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await app.waitForLeadDelivery();await app.waitForRefresh();await new Promise(r=>server.close(r));app.closeWorkspaceDatabases();db.close();rmSync(dir,{recursive:true,force:true})});
 function actor(){const cookies=new Map();let csrf='';return{cookies,async request(path,{method='GET',body,headers={}}={}){
  const r=await fetch(base+path,{method,redirect:'manual',headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  for(const cookie of r.headers.getSetCookie()){const part=cookie.split(';')[0],i=part.indexOf('='),key=part.slice(0,i),value=part.slice(i+1);if(value)cookies.set(key,value);else cookies.delete(key)}
  const data=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();if(data?.csrf)csrf=data.csrf;
  return{status:r.status,data,headers:r.headers};
 },async signup(value=fields()){return this.request('/auth/signup',{method:'POST',body:value})}};}
 const owner=actor();await owner.request('/auth/login',{method:'POST',body:{email:'owner@example.test',password:ownerPassword}});
 return{db,app,base,actor,owner,deliveryCalls,socialCalls,setDeliveryStatus:v=>deliveryStatus=v};
}
test('Signup accepts a 12-character password, rejects 11 characters and permits subsequent login',async t=>{
 const s=await fixture(t),client=s.actor(),password=randomBytes(9).toString('base64url'),input={...fields(),password};
 assert.equal(password.length,12);
 const rejected=await client.signup({...input,password:password.slice(0,11)});assert.equal(rejected.status,400);assert.match(rejected.data.error,/at least 12 characters/);
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,0);assert.equal(s.deliveryCalls.length,0);
 assert.equal((await client.signup(input)).status,201);
 assert.equal((await client.request('/auth/logout',{method:'POST',body:{}})).status,200);
 assert.equal((await client.request('/auth/login',{method:'POST',body:{email:input.email,password}})).status,200);
});
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
test('provider settings cannot re-enable removed signup or login routes',async t=>{
 const s=await fixture(t),client=s.actor();
 const config=(await client.request('/auth/signup-config')).data;assert.deepEqual(config.providers,{google:false,facebook:false});assert.equal(config.social,null);
 for(const provider of ['google','facebook']){
  assert.equal((await client.request(`/auth/oauth/${provider}/start`,{method:'POST',body:{}})).status,410);
  assert.equal((await client.request(`/auth/oauth/${provider}/callback?state=old-state&code=old-code`)).headers.get('location'),'/signup?auth_error=social_removed');
 }
 assert.equal(s.socialCalls.length,0);assert.equal((await client.request('/api/session')).status,401);
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM signup_oauth_states').get().n,0);
});
test('retirement clears temporary provider grants while preserving existing accounts and linked identities',async t=>{
 const s=await fixture(t),created=await s.actor().signup(),userId=created.data.user.id;
 s.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run('google','existing-subject',userId,new Date().toISOString());
 s.db.prepare('INSERT INTO pending_social_signups VALUES (?,?,?,?,?,?,?)').run('old-ticket','google','pending-subject','pending@example.test',1,'Pending name',Date.now()+900000);
 s.db.prepare('INSERT INTO signup_oauth_states VALUES (?,?,?,?)').run('old-state','old-browser','google',Date.now()+600000);
 const session=s.db.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get(userId);
 s.db.prepare('INSERT INTO account_deletion_reauth VALUES (?,?,?)').run(session.token_hash,userId,Date.now()+300000);
 createSocialSignup(s.db);
 for(const table of ['pending_social_signups','signup_oauth_states','account_deletion_reauth'])assert.equal(s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
 for(const table of ['users','social_identities','signup_leads'])assert.equal(s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);
 assert.ok(s.db.prepare('SELECT 1 FROM memberships WHERE user_id=?').get(userId));
});
test('a pending social ticket cannot bypass the password requirement or claim a verified email',async t=>{
 const s=await fixture(t),client=s.actor(),ticket=randomBytes(32).toString('base64url');
 client.cookies.set('levr_social_signup',ticket);
 s.db.prepare('INSERT INTO pending_social_signups VALUES (?,?,?,?,?,?,?)').run(createHash('sha256').update(ticket).digest('hex'),'google','historical-subject','pending@gmail.com',1,'Pending test',Date.now()+900000);
 assert.equal((await client.request('/auth/signup-config')).data.social,null);
 assert.equal((await client.signup({...fields('pending@gmail.com'),password:undefined})).status,400);
 const input=fields('pending@gmail.com');const result=await client.signup({...input,provider:'google',emailVerified:true});assert.equal(result.status,201);
 await s.app.waitForLeadDelivery();assert.equal(s.deliveryCalls[0].payload.signup_method,'password');assert.equal(s.deliveryCalls[0].payload.email_verified,false);
 assert.equal(s.db.prepare('SELECT count(*) n FROM social_identities').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM pending_social_signups').get().n,0);
 assert.equal(client.cookies.has('levr_social_signup'),false);
});
test('existing linked accounts retain data and can recover email/password access through an owner reset',async t=>{
 const s=await fixture(t),client=s.actor(),input=fields('legacy@gmail.com'),created=await client.signup(input),userId=created.data.user.id,workspaceId=created.data.defaultWorkspaceId;
 s.db.prepare('INSERT INTO social_identities VALUES (?,?,?,?)').run('google','legacy-google-subject',userId,new Date().toISOString());
 s.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('unusable-legacy-fixture-hash',userId);
 const reset=await s.owner.request(`/api/workspaces/${workspaceId}/members/${userId}/reset`,{method:'POST',body:{}});assert.equal(reset.status,201);
 const password=randomBytes(24).toString('hex'),recovered=s.actor();
 assert.equal((await recovered.request('/auth/reset-password',{method:'POST',body:{token:reset.data.token,email:input.email,password}})).status,200);
 assert.equal(s.db.prepare('SELECT count(*) n FROM social_identities').get().n,1);
 const login=s.actor();assert.equal((await login.request('/auth/login',{method:'POST',body:{email:input.email,password}})).status,200);
 assert.equal((await login.request('/api/session')).data.defaultWorkspaceId,workspaceId);
});
test('Unsafe webhook destinations are never contacted; disabled signup and rate limits are enforced',async t=>{
 let calls=0;const s=await fixture(t,{leadDeliveryOptions:{webhookUrl:'https://127.0.0.1/private',fetchImpl:async()=>{calls++;throw Error()}}});
 await s.actor().signup(fields());await s.app.waitForLeadDelivery();assert.equal(calls,0);assert.equal(s.db.prepare('SELECT delivery_status FROM signup_leads').get().delivery_status,'unconfigured');
 for(let n=0;n<9;n++)await s.actor().signup({...fields('invalid@gmail.com'),password:'short'});
 assert.equal((await s.actor().signup(fields('next@gmail.com'))).status,429);
 const disabled=await fixture(t,{signupEnabled:false});assert.equal((await disabled.actor().signup(fields())).status,403);assert.equal((await disabled.actor().request('/auth/signup-config')).data.enabled,false);
});
