import express from 'express';
import {createHash,randomBytes} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalizedEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const pagination=req=>({page:Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1)),limit:50});

export function registerMetaDeletion(app,{db,deletion,social}){
 // Meta authenticates this endpoint with its signed_request, not a browser
 // session. Register before the browser-only origin/CSRF checks.
 app.post('/auth/oauth/facebook/data-deletion',express.urlencoded({extended:false,limit:'20kb',parameterLimit:2}),(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const verified=social.verifyFacebookDeletion(req.body?.signed_request);
  if(verified?.unconfigured)return res.status(503).json({error:'Facebook data deletion is not configured.'});
  if(!verified)return res.status(400).json({error:'Invalid deletion request.'});
  const {subject,issuedAt}=verified;
  const user=db.prepare("SELECT u.id,u.created_at FROM social_identities i JOIN users u ON u.id=i.user_id WHERE i.provider='facebook' AND i.subject=?").get(subject);
  const previous=db.prepare("SELECT deleted_at,deletion_id FROM deleted_social_identities WHERE provider='facebook' AND subject_hash=?").get(hash(subject));
  // An old callback must not delete an account deliberately registered later.
  const replay=previous&&previous.deleted_at>=issuedAt;
  let deletionId=previous?.deletion_id||null;
  if(user&&!replay&&Math.floor(Date.parse(user.created_at)/1000)<=Math.floor(issuedAt/1000))
   deletionId=deletion.deleteAccount(user.id,{reason:'meta_request'}).deletionId;
  if(!user){
   // Also remove uncompleted Facebook registrations, even if no user exists.
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare("DELETE FROM pending_social_signups WHERE provider='facebook' AND subject=? AND CAST((expires_at-900000)/1000 AS INTEGER)<=?").run(subject,Math.floor(issuedAt/1000));
    if(!replay)db.prepare("INSERT INTO deleted_social_identities VALUES ('facebook',?,?,NULL) ON CONFLICT(provider,subject_hash) DO UPDATE SET deleted_at=excluded.deleted_at").run(hash(subject),Date.now());
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error}
  }
  const code=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO meta_deletion_requests VALUES (?,?,?)').run(hash(code),deletionId,new Date().toISOString());
  res.json({url:`${social.publicBaseUrl}/auth/oauth/facebook/data-deletion/${code}`,confirmation_code:code});
 });
 app.get('/auth/oauth/facebook/data-deletion/:code',(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const code=req.params.code;
  const request=/^[A-Za-z0-9_-]{43}$/.test(code)?db.prepare(`SELECT r.code_hash,a.cleanup_status FROM meta_deletion_requests r
   LEFT JOIN account_deletions a ON a.id=r.deletion_id WHERE r.code_hash=?`).get(hash(code)):null;
  if(!request)return res.status(404).type('text').send('Deletion request not found.');
  const pending=request.cleanup_status==='pending';
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Levr — Data deletion status</title><style>body{background:#fbfaf8;color:#121212;font:18px/1.6 system-ui,sans-serif;margin:0}main{max-width:640px;margin:12vh auto;padding:32px}h1{line-height:1.15}p{color:#6b6862}</style></head><body><main><p>Levr · Data deletion</p><h1>${pending?'Deletion is being completed.':'App deletion complete.'}</h1><p>${pending?'Account access has been removed. Remaining file cleanup is recorded for the owner to retry.':'Any applicable account records and exclusively owned workspace files have been removed from the active app.'}</p><p>Shared workspace research belongs to its remaining members. Separately held CRM records and hosting backups require separate handling under the applicable privacy policy.</p><p>No account identity is disclosed on this page.</p></main></body></html>`);
 });
}

export function registerAccountDeletion(app,{db,deletion,social,auth}){
 const owner=(req,res,next)=>req.user.role==='owner'?next():res.status(403).json({error:'Only the owner can manage client account deletion.'});
 const client=(req,res,next)=>req.user.role==='client'?next():res.status(403).json({error:'The owner account cannot be deleted.'});
 app.get('/api/accounts',owner,(req,res)=>{
  const {page,limit}=pagination(req),email=normalizedEmail(req.query.email);
  const total=db.prepare("SELECT count(*) n FROM users WHERE ?='' OR email=?").get(email,email).n;
  const rows=db.prepare(`SELECT u.id,u.email,u.created_at,u.disabled,(SELECT count(*) FROM memberships m WHERE m.user_id=u.id) workspace_count
   FROM users u WHERE ?='' OR u.email=? ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).all(email,email,limit,(page-1)*limit);
  res.json({page,total,hasMore:page*limit<total,accounts:rows.map(row=>({id:row.id,email:row.email,createdAt:row.created_at,disabled:!!row.disabled,workspaceCount:row.workspace_count}))});
 });
 app.get('/api/accounts/:userId/deletion',owner,(req,res)=>{
  const account=deletion.preview(req.params.userId);
  if(!account)return res.status(404).json({error:'Client account not found.'});
  res.json(account);
 });
 app.delete('/api/accounts/:userId',owner,(req,res)=>{
  const account=deletion.preview(req.params.userId),email=normalizedEmail(req.body?.confirmationEmail);
  const prior=account?null:db.prepare('SELECT email_hash FROM account_deletions WHERE user_id=?').get(req.params.userId);
  if(!email||(account&&email!==account.email)||(prior&&hash(email)!==prior.email_hash))return res.status(400).json({error:'Type the account email exactly to confirm deletion.'});
  // Maintenance is available to the authenticated owner only, not the client.
  const reason=req.body?.reason==='setup_cleanup'?'setup_cleanup':'owner_request';
  res.json(deletion.deleteAccount(req.params.userId,{reason}));
 });
 app.get('/api/account-deletions',owner,(req,res)=>{
  const {page,limit}=pagination(req),total=db.prepare('SELECT count(*) n FROM account_deletions').get().n;
  const rows=db.prepare('SELECT * FROM account_deletions ORDER BY deleted_at DESC,id DESC LIMIT ? OFFSET ?').all(limit,(page-1)*limit);
  res.json({page,total,hasMore:page*limit<total,deletions:rows.map(row=>({id:row.id,userId:row.user_id,emailHash:row.email_hash,deletedAt:row.deleted_at,actor:row.actor_type,actorId:row.actor_id,reason:row.reason,cleanupPending:row.cleanup_status==='pending',crmFollowUpRequired:!!row.crm_follow_up_required,leadEventId:row.lead_event_id,
   files:db.prepare('SELECT workspace_id,attempts,completed_at,last_error FROM account_deletion_files WHERE deletion_id=?').all(row.id)}))});
 });
 app.post('/api/account-deletions/:id/retry',owner,(req,res)=>res.json(deletion.retryCleanup(req.params.id)));
 app.get('/api/account/deletion',client,(req,res)=>{
  const hasLegacySocialIdentity=!!db.prepare('SELECT 1 FROM social_identities WHERE user_id=?').get(req.user.id);
  res.json({...deletion.preview(req.user.id),socialProviders:[],reauthenticated:false,hasLegacySocialIdentity});
 });
 app.post('/api/account/deletion/reauth/:provider',client,social.startDeletionReauth);
 app.delete('/api/account',client,(req,res)=>{
  if(normalizedEmail(req.body?.confirmationEmail)!==req.user.email)return res.status(400).json({error:'Type your account email exactly to confirm deletion.'});
  if(!auth.confirmDeletionPassword(req,res,req.body?.password))return;
  const result=deletion.deleteAccount(req.user.id,{reason:'self_service',actorId:req.user.id});
  auth.clearSession(res);social.clear(res);res.json(result);
 });
}
