import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import express from 'express';
import {openDatabase} from '../server/db.js';
import {auth,digest} from '../server/auth.js';

async function fixture(t,{ownerConfigured=true,production=false}={}){
 const db=openDatabase(':memory:'),ownerPassword=randomBytes(24).toString('hex');
 const a=auth(db,{password:ownerConfigured?ownerPassword:'',production,ownerEmail:'owner@example.com'});
 const app=express();app.use(express.json());
 app.post('/auth/login',a.login);app.post('/auth/accept-invite',a.acceptInvite);app.post('/auth/reset-password',a.resetPassword);app.post('/auth/logout',a.requireAuth,a.logout);
 app.use('/api',a.requireAuth);app.get('/api/session',(req,res)=>res.json(a.sessionPayload(req)));a.registerManagementRoutes(app);
 app.use((err,req,res,next)=>res.status(500).json({error:'Internal error'}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 function session(){
  let cookie='',csrf='';
  return {
   async request(path,{method='GET',body,authenticated=true,token=true}={}){
    const headers={};if(authenticated&&cookie)headers.Cookie=cookie;if(token&&csrf)headers['X-CSRF-Token']=csrf;if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();
    const issued=response.headers.get('set-cookie');if(issued)cookie=issued.split(';')[0];if(data.csrf)csrf=data.csrf;
    return {status:response.status,data,headers:response.headers};
   },
   login(email,password){return this.request('/auth/login',{method:'POST',body:{email,password}});},
   accept(invite,email,password){return this.request('/auth/accept-invite',{method:'POST',body:{token:invite.token,email,password}});},
   reset(link,email,password){return this.request('/auth/reset-password',{method:'POST',body:{token:link.token,email,password}});}
  };
 }
 const owner=session();if(ownerConfigured)assert.equal((await owner.login('owner@example.com',ownerPassword)).status,200);
 async function workspace(name='Client workspace'){const result=await owner.request('/api/workspaces',{method:'POST',body:{name}});assert.equal(result.status,201);return result.data;}
 async function invite(workspace,email='client@example.com'){const result=await owner.request(`/api/workspaces/${workspace.id}/invites`,{method:'POST',body:{email}});assert.equal(result.status,201);return result.data;}
 return {db,a,owner,ownerPassword,session,workspace,invite};
}

test('owner manages client workspaces; invite-only client receives only assigned workspace',async t=>{
 const s=await fixture(t);const clientWorkspace=await s.workspace('Client A'),otherWorkspace=await s.workspace('Client B');
 assert.equal((await s.owner.request('/api/workspaces')).data.length,3);
 const invitation=await s.invite(clientWorkspace);const client=s.session(),password=randomBytes(24).toString('hex');
 const accepted=await client.accept(invitation,' CLIENT@EXAMPLE.COM ',password);assert.equal(accepted.status,200);assert.equal(accepted.data.user.role,'client');assert.equal(accepted.data.defaultWorkspaceId,clientWorkspace.id);assert.deepEqual(accepted.data.workspaces.map(w=>w.id),[clientWorkspace.id]);
 assert.equal(JSON.stringify(accepted.data).includes('owner@example.com'),false);assert.equal(JSON.stringify(accepted.data).includes(password),false);
 assert.deepEqual((await client.request('/api/workspaces')).data.map(w=>w.id),[clientWorkspace.id]);
 for(const [method,path,body] of [
  ['POST','/api/workspaces',{name:'Unapproved'}],['PATCH',`/api/workspaces/${clientWorkspace.id}`,{name:'Changed'}],
  ['GET',`/api/workspaces/${clientWorkspace.id}/members`],['GET',`/api/workspaces/${otherWorkspace.id}/invites`],
  ['POST',`/api/workspaces/${clientWorkspace.id}/invites`,{email:'third@example.com'}],['DELETE',`/api/invites/${invitation.id}`],
  ['DELETE',`/api/workspaces/${clientWorkspace.id}/members/${accepted.data.user.id}`]
 ])assert.equal((await client.request(path,{method,body})).status,403,`${method} ${path}`);
 const stored=s.db.prepare('SELECT * FROM users WHERE email=?').get('client@example.com');assert.notEqual(stored.password_hash,password);assert.match(stored.password_hash,/^scrypt\$/);
 const storedInvite=s.db.prepare('SELECT * FROM invites WHERE id=?').get(invitation.id);assert.equal(storedInvite.token_hash,digest(invitation.token));assert.equal(Object.values(storedInvite).includes(invitation.token),false);
 const list=(await s.owner.request(`/api/workspaces/${clientWorkspace.id}/invites`)).data;assert.equal(JSON.stringify(list).includes(invitation.token),false);assert.equal('token_hash' in list[0],false);
 const members=(await s.owner.request(`/api/workspaces/${clientWorkspace.id}/members`)).data;assert.equal(members[0].email,'client@example.com');assert.equal('password_hash' in members[0],false);
 assert.equal((await client.request('/auth/logout',{method:'POST',body:{}})).status,200);assert.equal((await client.request('/api/session')).status,401);
 assert.equal((await client.login('client@example.com',password)).status,200);
});

test('invites are single-use, expire, revoke, require email match, and cannot enter owner workspace',async t=>{
 const s=await fixture(t),w=await s.workspace(),client=s.session(),password=randomBytes(24).toString('hex');
 assert.equal((await s.owner.request('/api/workspaces/levr/invites',{method:'POST',body:{email:'client@example.com'}})).status,400);
 assert.equal((await s.owner.request(`/api/workspaces/${w.id}/invites`,{method:'POST',body:{email:'owner@example.com'}})).status,400);
 const invitation=await s.invite(w);
 assert.equal((await client.accept(invitation,'wrong@example.com',password)).status,400);
 assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,0);
 assert.equal((await client.accept(invitation,'client@example.com',password)).status,200);
 assert.equal((await s.session().accept(invitation,'client@example.com',password)).status,400);
 const expired=await s.invite(w,'expired@example.com');s.db.prepare('UPDATE invites SET expires_at=? WHERE id=?').run(Date.now()-1,expired.id);
 assert.equal((await s.session().accept(expired,'expired@example.com',password)).status,400);
 const revoked=await s.invite(w,'revoked@example.com');assert.equal((await s.owner.request(`/api/invites/${revoked.id}`,{method:'DELETE'})).status,200);
 assert.equal((await s.session().accept(revoked,'revoked@example.com',password)).status,400);
 assert.equal(s.db.prepare('SELECT count(*) n FROM memberships').get().n,1);
});

test('existing accounts must prove their password to accept another workspace invitation',async t=>{
 const s=await fixture(t),a=await s.workspace('A'),b=await s.workspace('B');
 const password=randomBytes(24).toString('hex'),newPassword=randomBytes(24).toString('hex'),client=s.session();
 const first=await s.invite(a);assert.equal((await client.accept(first,'client@example.com',password)).status,200);
 const second=await s.invite(b);
 assert.equal((await s.session().accept(second,'client@example.com',newPassword)).status,400);
 assert.equal(s.db.prepare('SELECT accepted_at FROM invites WHERE id=?').get(second.id).accepted_at,null);
 assert.equal((await s.session().login('client@example.com',newPassword)).status,401);
 const accepted=await client.accept(second,'client@example.com',password);assert.equal(accepted.status,200);assert.equal(accepted.data.workspaces.length,2);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,1);
});

test('revoked membership invalidates sessions without deleting research or other memberships',async t=>{
 const s=await fixture(t),a=await s.workspace('A'),b=await s.workspace('B'),client=s.session(),password=randomBytes(24).toString('hex');
 const first=await s.invite(a);let accepted=await client.accept(first,'client@example.com',password);const userId=accepted.data.user.id;
 await client.accept(await s.invite(b),'client@example.com',password);
 assert.equal((await s.owner.request(`/api/workspaces/${a.id}/members/${userId}`,{method:'DELETE'})).status,200);
 assert.equal((await client.request('/api/session')).status,401);
 const logged=await client.login('client@example.com',password);assert.equal(logged.status,200);assert.deepEqual(logged.data.workspaces.map(w=>w.id),[b.id]);
 assert.equal((await s.owner.request(`/api/workspaces/${b.id}/members/${userId}`,{method:'DELETE'})).status,200);
 assert.equal((await client.login('client@example.com',password)).status,401);
 assert.equal(s.db.prepare('SELECT count(*) n FROM workspaces').get().n,3);
});

test('invitation replacement revokes old link and mutations retain CSRF enforcement',async t=>{
 const s=await fixture(t),w=await s.workspace(),password=randomBytes(24).toString('hex');
 assert.equal((await s.owner.request(`/api/workspaces/${w.id}/invites`,{method:'POST',body:{email:'client@example.com'},token:false})).status,403);
 const old=await s.invite(w),replacement=await s.invite(w);
 assert.equal((await s.session().accept(old,'client@example.com',password)).status,400);
 assert.equal((await s.session().accept(replacement,'client@example.com',password)).status,200);
 assert.notEqual(s.db.prepare('SELECT revoked_at FROM invites WHERE id=?').get(old.id).revoked_at,null);
});

test('client sessions remain available when owner environment password is not configured',async t=>{
 const s=await fixture(t),w=await s.workspace(),client=s.session(),password=randomBytes(24).toString('hex');
 await client.accept(await s.invite(w),'client@example.com',password);
 const replacement=auth(s.db,{password:'',ownerEmail:'owner@example.com',production:false});
 // Use the replacement auth directly to demonstrate client authentication is not gated by ownerHash.
 let result;const req={ip:'test',body:{email:'client@example.com',password}};const res={cookie(){},status(status){this.code=status;return this;},json(data){result=data;return this;}};
 replacement.login(req,res);assert.equal(result.user.role,'client');assert.equal(result.defaultWorkspaceId,w.id);
});

test('acceptance and login share throttling; disabled client cannot create or use sessions',async t=>{
 const s=await fixture(t),w=await s.workspace(),client=s.session(),password=randomBytes(24).toString('hex');
 const accepted=await client.accept(await s.invite(w),'client@example.com',password);
 s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(accepted.data.user.id);
 assert.equal((await client.request('/api/session')).status,401);
 assert.equal((await client.login('client@example.com',password)).status,401);
 for(let n=0;n<7;n++)assert.equal((await s.session().accept({token:'x'.repeat(43)},'client@example.com',password)).status,400);
 assert.equal((await client.login('client@example.com',password)).status,429);
 assert.equal((await s.session().reset({token:'x'.repeat(43)},'client@example.com',password)).status,429,'recovery shares the same throttle');
});

test('owner-issued password reset is purpose-bound, one-use, and revokes old client sessions without changing memberships',async t=>{
 const s=await fixture(t),w=await s.workspace(),client=s.session(),otherSession=s.session();
 const oldPassword=randomBytes(24).toString('hex'),newPassword=randomBytes(24).toString('hex');
 const invitation=await s.invite(w),accepted=await client.accept(invitation,'client@example.com',oldPassword),userId=accepted.data.user.id;
 await otherSession.login('client@example.com',oldPassword);
 const before=s.db.prepare('SELECT * FROM memberships ORDER BY workspace_id,user_id').all();
 const issued=await s.owner.request(`/api/workspaces/${w.id}/members/${userId}/reset`,{method:'POST',body:{}});
 assert.equal(issued.status,201);const link=issued.data;assert.equal(link.purpose,'password_reset');assert.ok(Date.parse(link.expiresAt)-Date.now()<=3600000);
 assert.equal((await s.session().accept(link,'client@example.com',newPassword)).status,400,'reset links must not enroll or invite accounts');
 const unused=await s.invite(w,'unused@example.com');
 assert.equal((await s.session().reset(unused,'unused@example.com',newPassword)).status,400,'ordinary invitations cannot reset passwords');
 const replacement=s.session(),reset=await replacement.reset(link,'client@example.com',newPassword);
 assert.equal(reset.status,200);assert.equal(reset.data.user.id,userId);assert.equal(reset.data.user.role,'client');
 assert.equal((await client.request('/api/session')).status,401);assert.equal((await otherSession.request('/api/session')).status,401);
 assert.equal((await replacement.request('/api/session')).status,200);
 assert.equal((await s.session().reset(link,'client@example.com',oldPassword)).status,400,'reset token is consumed');
 assert.equal((await s.session().login('client@example.com',oldPassword)).status,401);
 assert.equal((await s.session().login('client@example.com',newPassword)).status,200);
 assert.deepEqual(s.db.prepare('SELECT * FROM memberships ORDER BY workspace_id,user_id').all(),before);
 const listed=(await s.owner.request(`/api/workspaces/${w.id}/invites`)).data.find(i=>i.id===link.id);assert.equal(listed.purpose,'password_reset');assert.ok(listed.acceptedAt);assert.equal(JSON.stringify(listed).includes(link.token),false);
});

test('password recovery is owner-only, needs membership and CSRF, and does not revoke sessions before use',async t=>{
 const s=await fixture(t),w=await s.workspace(),other=await s.workspace('Other'),client=s.session(),password=randomBytes(24).toString('hex');
 const accepted=await client.accept(await s.invite(w),'client@example.com',password),userId=accepted.data.user.id;
 assert.equal((await client.request(`/api/workspaces/${w.id}/members/${userId}/reset`,{method:'POST',body:{}})).status,403);
 assert.equal((await s.owner.request(`/api/workspaces/${w.id}/members/${userId}/reset`,{method:'POST',body:{},token:false})).status,403);
 assert.equal((await s.owner.request(`/api/workspaces/${other.id}/members/${userId}/reset`,{method:'POST',body:{}})).status,404);
 const issued=await s.owner.request(`/api/workspaces/${w.id}/members/${userId}/reset`,{method:'POST',body:{}});assert.equal(issued.status,201);
 assert.equal((await client.request('/api/session')).status,200,'issuing a link alone does not change the account');
 const before=s.db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash;
 assert.equal((await s.session().reset(issued.data,'wrong@example.com',password)).status,400);
 s.db.prepare('UPDATE invites SET expires_at=? WHERE id=?').run(Date.now()-1,issued.data.id);
 assert.equal((await s.session().reset(issued.data,'client@example.com',password)).status,400);
 const revoked=(await s.owner.request(`/api/workspaces/${w.id}/members/${userId}/reset`,{method:'POST',body:{}})).data;
 assert.equal((await s.owner.request(`/api/invites/${revoked.id}`,{method:'DELETE'})).status,200);
 assert.equal((await s.session().reset(revoked,'client@example.com',password)).status,400);
 assert.equal(s.db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash,before);
});

test('issuing password recovery supersedes reset links globally and lost membership cannot be restored by a reset',async t=>{
 const s=await fixture(t),a=await s.workspace('A'),b=await s.workspace('B'),client=s.session(),password=randomBytes(24).toString('hex');
 const accepted=await client.accept(await s.invite(a),'client@example.com',password),userId=accepted.data.user.id;
 await client.accept(await s.invite(b),'client@example.com',password);
 const first=(await s.owner.request(`/api/workspaces/${a.id}/members/${userId}/reset`,{method:'POST',body:{}})).data;
 const second=(await s.owner.request(`/api/workspaces/${b.id}/members/${userId}/reset`,{method:'POST',body:{}})).data;
 assert.ok(s.db.prepare('SELECT revoked_at FROM invites WHERE id=?').get(first.id).revoked_at);
 assert.equal((await s.session().reset(first,'client@example.com',password)).status,400);
 assert.equal((await s.owner.request(`/api/workspaces/${b.id}/members/${userId}`,{method:'DELETE'})).status,200);
 const before=s.db.prepare('SELECT * FROM memberships ORDER BY workspace_id').all();
 assert.equal((await s.session().reset(second,'client@example.com',password)).status,400);
 assert.deepEqual(s.db.prepare('SELECT * FROM memberships ORDER BY workspace_id').all(),before);
 assert.equal(before.length,1);assert.equal(before[0].workspace_id,a.id);
});

test('membership removal permanently revokes reset links even if the client later rejoins',async t=>{
 const s=await fixture(t),w=await s.workspace(),client=s.session(),password=randomBytes(24).toString('hex'),replacementPassword=randomBytes(24).toString('hex');
 const accepted=await client.accept(await s.invite(w),'client@example.com',password),userId=accepted.data.user.id;
 const link=(await s.owner.request(`/api/workspaces/${w.id}/members/${userId}/reset`,{method:'POST',body:{}})).data;
 const hashBefore=s.db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash;
 assert.equal((await s.owner.request(`/api/workspaces/${w.id}/members/${userId}`,{method:'DELETE'})).status,200);
 assert.ok(s.db.prepare('SELECT revoked_at FROM invites WHERE id=?').get(link.id).revoked_at);
 const reinvitation=await s.invite(w);
 assert.equal((await client.accept(reinvitation,'client@example.com',password)).status,200);
 assert.equal((await s.session().reset(link,'client@example.com',replacementPassword)).status,400,'rejoining must not revive a previously revoked reset link');
 assert.equal(s.db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId).password_hash,hashBefore);
 assert.equal((await s.session().login('client@example.com',password)).status,200);
 assert.equal((await s.session().login('client@example.com',replacementPassword)).status,401);
});
