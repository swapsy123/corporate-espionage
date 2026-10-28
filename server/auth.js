import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
export const digest = v=>createHash('sha256').update(v).digest('hex');
const SESSION_AGE=12*60*60*1000;
const INVITE_AGE=7*24*60*60*1000;
const RESET_AGE=60*60*1000;
const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validEmail=value=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword=value=>typeof value==='string'&&value.length>=16&&value.length<=1024;
const currentTime=()=>new Date().toISOString();
function passwordHash(password){const salt=randomBytes(32).toString('hex');return `scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;}
function passwordMatches(password,encoded){
 if(typeof password!=='string'||password.length>1024)return false;
 const [algorithm,salt,expected]=String(encoded||'').split('$');
 if(algorithm!=='scrypt'||!/^[a-f0-9]{64}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(expected||''))return false;
 return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(expected,'hex'));
}
export function auth(db,options={}){
 // A restart revokes sessions, including after owner-password rotation.
 db.prepare('DELETE FROM sessions').run();
 const password=options.password??process.env.LEVR_OWNER_PASSWORD;
 const ownerEmail=normalizeEmail(options.ownerEmail??process.env.OWNER_EMAIL??'fraser@wearelevr.com');
 const production=options.production??process.env.NODE_ENV==='production';
 const ownerHash=validPassword(password)?passwordHash(password):null;
 const dummyHash=passwordHash(randomBytes(32).toString('hex'));
 const cookieName=production?'__Host-levr_beta_session':'levr_beta_session';
 function cookie(res,token,maxAge){res.cookie(cookieName,token,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge});}
 function allowedWorkspaces(user){
  const rows=user.role==='owner'?db.prepare('SELECT id,name,created_at FROM workspaces ORDER BY CASE WHEN id=\'levr\' THEN 0 ELSE 1 END,created_at,id').all():db.prepare('SELECT w.id,w.name,w.created_at FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY m.created_at,w.id').all(user.id);
  return rows.map(row=>({id:row.id,name:row.name,createdAt:row.created_at}));
 }
 function sessionPayload(req){const workspaces=allowedWorkspaces(req.user);return {user:req.user,csrf:req.session.csrf,workspaces,defaultWorkspaceId:req.user.role==='owner'?'levr':workspaces[0]?.id??null};}
 function issueSession(req,res,user){
  const time=Date.now();db.prepare('DELETE FROM sessions WHERE expires_at<?').run(time);
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  const tokenHash=digest(token);
  db.prepare('INSERT INTO sessions(token_hash,csrf,expires_at,user_id) VALUES (?,?,?,?)').run(tokenHash,csrf,time+SESSION_AGE,user.id);
  req.user=user;req.session={token_hash:tokenHash,csrf,expires_at:time+SESSION_AGE,user_id:user.id};
  cookie(res,token,SESSION_AGE);return sessionPayload(req);
 }
 // Throttle owner/client logins and invitation acceptance through the same IP bucket.
 function rateLimit(req,res){
  const key=digest(req.ip||'unknown'),time=Date.now();
  db.prepare('DELETE FROM login_attempts WHERE expires_at<?').run(time);
  const attempts=db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);
  if(attempts?.count>=8){res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});return null;}
  return {key,time};
 }
 function recordFailure(rate){db.prepare('INSERT INTO login_attempts(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(rate.key,rate.time+900000);}
 function login(req,res){
  const rate=rateLimit(req,res);if(!rate)return;
  const email=normalizeEmail(req.body?.email),input=req.body?.password;
  if(email===ownerEmail&&!ownerHash)return res.status(503).json({error:'Owner access is not configured. Set LEVR_OWNER_PASSWORD to a unique password of at least 16 characters in secure environment settings.'});
  const row=email===ownerEmail?null:db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const encoded=email===ownerEmail?ownerHash:row?.password_hash||dummyHash;
  const matches=passwordMatches(input,encoded);
  const enabled=row&&!row.disabled&&db.prepare('SELECT 1 FROM memberships WHERE user_id=?').get(row.id);
  if(!validEmail(email)||!matches||(email!==ownerEmail&&!enabled)){recordFailure(rate);return res.status(401).json({error:'Email or password is incorrect.'});}
  const user=email===ownerEmail?{id:null,email:ownerEmail,role:'owner'}:{id:row.id,email:row.email,role:'client'};
  res.json(issueSession(req,res,user));
 }
 function requireAuth(req,res,next){
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));
  const token=cookies[cookieName];
  const session=typeof token==='string'?db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()):null;
  if(!session)return res.status(401).json({error:'Sign in to access your private intelligence library.'});
  let user;
  if(session.user_id===null)user={id:null,email:ownerEmail,role:'owner'};
  else {
   const row=db.prepare('SELECT id,email,disabled FROM users WHERE id=?').get(session.user_id);
   if(!row||row.disabled||!db.prepare('SELECT 1 FROM memberships WHERE user_id=?').get(row.id)){
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
    return res.status(401).json({error:'Your access has changed. Sign in again or contact the workspace owner.'});
   }
   user={id:row.id,email:row.email,role:'client'};
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==session.csrf)return res.status(403).json({error:'Your session security token is missing or expired. Reload and try again.'});
  req.user=user;req.session=session;next();
 }
 function logout(req,res){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);cookie(res,'',0);res.json({ok:true});}
 function acceptInvite(req,res){
  const rate=rateLimit(req,res);if(!rate)return;
  const token=req.body?.token,email=normalizeEmail(req.body?.email),input=req.body?.password;
  const fail=()=>{recordFailure(rate);return res.status(400).json({error:'Unable to accept this invitation. Check the invitation, email, and password. Existing accounts must use their current password.'});};
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!validEmail(email)||email===ownerEmail||!validPassword(input))return fail();
  const invite=db.prepare('SELECT * FROM invites WHERE token_hash=? AND email=? AND purpose=\'invite\' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(digest(token),email,Date.now());
  if(!invite)return fail();
  const existing=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(existing&&(existing.disabled||!passwordMatches(input,existing.password_hash)))return fail();
  const userId=existing?.id||randomUUID();
  const timestamp=currentTime();
  const encoded=existing?.password_hash||passwordHash(input);
  db.exec('BEGIN IMMEDIATE');
  try{
   const consumed=db.prepare('UPDATE invites SET accepted_at=? WHERE id=? AND purpose=\'invite\' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?').run(timestamp,invite.id,Date.now());
   if(consumed.changes!==1){db.exec('ROLLBACK');return fail();}
   if(!existing)db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES (?,?,?,?)').run(userId,email,encoded,timestamp);
   db.prepare('INSERT INTO memberships(workspace_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING').run(invite.workspace_id,userId,timestamp);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  res.json({...issueSession(req,res,{id:userId,email,role:'client'}),defaultWorkspaceId:invite.workspace_id});
 }
 function resetPassword(req,res){
  const rate=rateLimit(req,res);if(!rate)return;
  const token=req.body?.token,email=normalizeEmail(req.body?.email),input=req.body?.password;
  const fail=()=>{recordFailure(rate);return res.status(400).json({error:'Unable to reset the password. Check the reset link and email, or ask Levr for a new link.'});};
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!validEmail(email)||email===ownerEmail||!validPassword(input))return fail();
  const invite=db.prepare("SELECT * FROM invites WHERE token_hash=? AND email=? AND purpose='password_reset' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?").get(digest(token),email,Date.now());
  if(!invite)return fail();
  const user=db.prepare('SELECT id,email,disabled FROM users WHERE email=?').get(email);
  if(!user||user.disabled||!db.prepare('SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?').get(invite.workspace_id,user.id))return fail();
  const encoded=passwordHash(input),timestamp=currentTime();
  db.exec('BEGIN IMMEDIATE');
  try{
   const consumed=db.prepare("UPDATE invites SET accepted_at=? WHERE id=? AND purpose='password_reset' AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?").run(timestamp,invite.id,Date.now());
   if(consumed.changes!==1){db.exec('ROLLBACK');return fail();}
   db.prepare('UPDATE users SET password_hash=? WHERE id=? AND disabled=0').run(encoded,user.id);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
   db.prepare("UPDATE invites SET revoked_at=? WHERE email=? AND purpose='password_reset' AND accepted_at IS NULL AND revoked_at IS NULL").run(timestamp,email);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  res.json(issueSession(req,res,{id:user.id,email:user.email,role:'client'}));
 }
 function requireOwner(req,res,next){if(req.user.role!=='owner')return res.status(403).json({error:'Only the Levr owner can manage clients and invitations.'});next();}
 function findWorkspace(req,res){const workspace=db.prepare('SELECT * FROM workspaces WHERE id=?').get(req.params.id);if(!workspace){res.status(404).json({error:'Workspace not found.'});return null;}return workspace;}
 function registerManagementRoutes(app){
  app.get('/api/workspaces',(req,res)=>res.json(allowedWorkspaces(req.user)));
  app.post('/api/workspaces',requireOwner,(req,res)=>{
   const name=typeof req.body?.name==='string'?req.body.name.trim():'';
   if(!name||name.length>160)return res.status(400).json({error:'Enter a workspace name between 1 and 160 characters.'});
   const id=randomUUID(),createdAt=currentTime();db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(id,name,createdAt);res.status(201).json({id,name,createdAt});
  });
  app.patch('/api/workspaces/:id',requireOwner,(req,res)=>{
   if(!findWorkspace(req,res))return;
   const name=typeof req.body?.name==='string'?req.body.name.trim():'';
   if(!name||name.length>160)return res.status(400).json({error:'Enter a workspace name between 1 and 160 characters.'});
   db.prepare('UPDATE workspaces SET name=? WHERE id=?').run(name,req.params.id);
   const row=db.prepare('SELECT * FROM workspaces WHERE id=?').get(req.params.id);res.json({id:row.id,name:row.name,createdAt:row.created_at});
  });
  app.get('/api/workspaces/:id/members',requireOwner,(req,res)=>{
   if(!findWorkspace(req,res))return;
   res.json(db.prepare('SELECT u.id,u.email,m.created_at FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? ORDER BY m.created_at,u.id').all(req.params.id).map(row=>({id:row.id,email:row.email,createdAt:row.created_at})));
  });
  app.delete('/api/workspaces/:id/members/:userId',requireOwner,(req,res)=>{
   if(!findWorkspace(req,res))return;
   const membership=db.prepare('SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?').get(req.params.id,req.params.userId);
   if(!membership)return res.status(404).json({error:'Workspace member not found.'});
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?').run(req.params.id,req.params.userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.userId);
    db.prepare("UPDATE invites SET revoked_at=? WHERE workspace_id=? AND email=(SELECT email FROM users WHERE id=?) AND purpose='password_reset' AND accepted_at IS NULL AND revoked_at IS NULL").run(currentTime(),req.params.id,req.params.userId);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   res.json({ok:true});
  });
  app.post('/api/workspaces/:id/members/:userId/reset',requireOwner,(req,res)=>{
   if(!findWorkspace(req,res))return;
   const user=db.prepare('SELECT u.id,u.email,u.disabled FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? AND u.id=?').get(req.params.id,req.params.userId);
   if(!user)return res.status(404).json({error:'Workspace member not found.'});
   if(user.disabled)return res.status(409).json({error:'This account has been disabled.'});
   const id=randomUUID(),token=randomBytes(32).toString('base64url'),timestamp=currentTime(),expiresAt=Date.now()+RESET_AGE;
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare("UPDATE invites SET revoked_at=? WHERE email=? AND purpose='password_reset' AND accepted_at IS NULL AND revoked_at IS NULL").run(timestamp,user.email);
    db.prepare("INSERT INTO invites(id,workspace_id,email,token_hash,purpose,expires_at,created_at) VALUES (?,?,?,?,'password_reset',?,?)").run(id,req.params.id,user.email,digest(token),expiresAt,timestamp);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   res.status(201).json({id,email:user.email,token,expiresAt:new Date(expiresAt).toISOString(),purpose:'password_reset'});
  });
  app.get('/api/workspaces/:id/invites',requireOwner,(req,res)=>{
   if(!findWorkspace(req,res))return;
   res.json(db.prepare('SELECT id,email,purpose,expires_at,created_at,accepted_at,revoked_at FROM invites WHERE workspace_id=? ORDER BY created_at DESC,id').all(req.params.id).map(row=>({id:row.id,email:row.email,purpose:row.purpose,expiresAt:new Date(row.expires_at).toISOString(),createdAt:row.created_at,acceptedAt:row.accepted_at,revokedAt:row.revoked_at})));
  });
  app.post('/api/workspaces/:id/invites',requireOwner,(req,res)=>{
   if(!findWorkspace(req,res))return;
   if(req.params.id==='levr')return res.status(400).json({error:'The Levr workspace is reserved for its owner. Create a separate client workspace first.'});
   const email=normalizeEmail(req.body?.email);
   if(!validEmail(email))return res.status(400).json({error:'Enter a valid client email address.'});
   if(email===ownerEmail)return res.status(400).json({error:'The Levr owner already has access to every workspace.'});
   const existing=db.prepare('SELECT id,disabled FROM users WHERE email=?').get(email);
   if(existing?.disabled)return res.status(409).json({error:'This account has been disabled.'});
   if(existing&&db.prepare('SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?').get(req.params.id,existing.id))return res.status(409).json({error:'This person already has access to the workspace.'});
   const id=randomUUID(),token=randomBytes(32).toString('base64url'),timestamp=currentTime(),expiresAt=Date.now()+INVITE_AGE;
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('UPDATE invites SET revoked_at=? WHERE workspace_id=? AND email=? AND purpose=\'invite\' AND accepted_at IS NULL AND revoked_at IS NULL').run(timestamp,req.params.id,email);
    db.prepare('INSERT INTO invites(id,workspace_id,email,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)').run(id,req.params.id,email,digest(token),expiresAt,timestamp);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   res.status(201).json({id,email,token,expiresAt:new Date(expiresAt).toISOString()});
  });
  app.delete('/api/invites/:id',requireOwner,(req,res)=>{
   const invite=db.prepare('SELECT id,accepted_at,revoked_at FROM invites WHERE id=?').get(req.params.id);
   if(!invite)return res.status(404).json({error:'Invitation not found.'});
   if(invite.accepted_at)return res.status(409).json({error:'This invitation has already been accepted. Remove the member to revoke access.'});
   db.prepare('UPDATE invites SET revoked_at=coalesce(revoked_at,?) WHERE id=?').run(currentTime(),invite.id);res.json({ok:true});
  });
 }
 return {login,requireAuth,logout,ownerEmail,sessionPayload,registerManagementRoutes,acceptInvite,resetPassword};
}
