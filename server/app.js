import express from 'express';
import {registerBeta} from './beta/routes.js';
import helmet from 'helmet';
import {z} from 'zod';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {id,now,openDatabase,seedCompetitors} from './db.js';
import {auth} from './auth.js';
import {createWorkspaceManager} from './workspaces.js';
import {createSecretVault} from './secret-vault.js';
import {competitorRows,profileRow,itemRows,persistProfileItems,boardRows,opportunityRows,scopedItems} from './store.js';
import {collectProfile,searchMetaCompanies} from './provider.js';
import {verifyProviderAccount} from './provider-connection.js';
import {findPatterns,generateBrief,askLibrary} from './intelligence.js';
const text=z.string().trim().min(1).max(500);
const stages=z.enum(['Saved','Briefing','Creating','Launched','Winner']);
function normalizeIdentifier(platform,raw){
 let v=raw.trim();
 if(v.includes('://')){
  let u;try{u=new URL(v);}catch{throw new Error('Enter a valid profile URL or identifier.');}
  const host=u.hostname.replace(/^www\./,'');
  if(platform==='instagram'&&host==='instagram.com')v=u.pathname.split('/').filter(Boolean)[0]||'';
  else if(platform==='youtube'&&['youtube.com','m.youtube.com'].includes(host)){const p=u.pathname.split('/').filter(Boolean);v=p[0]==='channel'?p[1]:p[0];}
  else if(platform==='meta'&&['facebook.com','m.facebook.com'].includes(host))v=u.searchParams.get('id')||u.searchParams.get('view_all_page_id')||u.pathname.split('/').filter(Boolean).at(-1)||'';
  else throw new Error('The URL does not match the selected platform.');
 }
 if(platform==='instagram'){v=v.replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_.]{1,30}$/.test(v))throw new Error('Use an Instagram handle, such as growth.operators.');}
 if(platform==='meta'&&!/^\d+$/.test(v))throw new Error('Enter the numeric Meta Page ID shown in Meta Ad Library.');
 if(platform==='youtube'&&!/^(@[\w.-]+|UC[\w-]{20,30})$/.test(v))throw new Error('Enter a YouTube @handle or UC channel ID.');
 return v;
}
export function createApp(options={}){
 const catalog=options.db||openDatabase();if(options.seed===true)seedCompetitors(catalog);
 const manager=createWorkspaceManager(catalog,{directory:options.workspaceDirectory}),db=manager.db;
 const vault=options.vault||createSecretVault({directory:options.secretDirectory||manager.secretDirectory||join(tmpdir(),`levr-test-secrets-${id()}`),masterKey:options.secretEncryptionKey,ownerKey:options.providerKey});
 const app=express(),a=auth(catalog,options),collector=options.collector||collectProfile,verifyProvider=options.verifyProvider||verifyProviderAccount;
 app.disable('x-powered-by');if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],fontSrc:["'self'",'data:'],imgSrc:["'self'",'https:','data:','blob:'],mediaSrc:["'self'",'https:','blob:'],connectSrc:["'self'"],frameSrc:["'self'",'https://www.youtube-nocookie.com','https://www.youtube.com'],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}},crossOriginEmbedderPolicy:false}));
 app.use(express.json({limit:'2mb'}));
 app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin){let origin;try{origin=new URL(req.headers.origin).host;}catch{return res.status(403).json({error:'Invalid request origin.'});}if(origin!==req.get('host'))return res.status(403).json({error:'Cross-site requests are not allowed.'});}next();});
 app.get('/healthz',(req,res)=>res.json({ok:true}));
 app.post('/auth/accept-invite',a.acceptInvite);
 app.post('/auth/reset-password',a.resetPassword);
 app.post('/auth/login',a.login);app.post('/auth/logout',a.requireAuth,a.logout);
 app.use('/api',a.requireAuth);
 app.get('/api/session',(req,res)=>res.json(a.sessionPayload(req)));
 a.registerManagementRoutes(app);
 app.use('/api',manager.middleware);
 const beta=registerBeta(app,{db,catalog,manager,options});
 app.get('/api/settings/provider',(req,res)=>res.json(vault.status(req.workspaceId)));
 app.put('/api/settings/provider',async(req,res)=>{const v=z.object({apiKey:z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/,'Use an API key without spaces or line breaks.')}).parse(req.body);const account=await verifyProvider({apiKey:v.apiKey});res.json({...vault.set(req.workspaceId,v.apiKey,{verifiedAt:now()}),currentCredits:account.creditCount});});
 app.post('/api/settings/provider/verify',async(req,res)=>{const apiKey=vault.get(req.workspaceId);if(!apiKey)return res.status(400).json({error:'Add this workspace’s ScrapeCreators API key before checking the connection.'});const account=await verifyProvider({apiKey});res.json({...vault.markVerified(req.workspaceId,apiKey),currentCredits:account.creditCount});});
 app.delete('/api/settings/provider',(req,res)=>res.json(vault.delete(req.workspaceId)));
 const runningByWorkspace=new Map(),queues=new Map();
 const runningFor=id=>{if(!runningByWorkspace.has(id))runningByWorkspace.set(id,new Set());return runningByWorkspace.get(id);};
 app.get('/api/status',(req,res)=>res.json({providerReady:vault.status(req.workspaceId).configured,aiReady:!!process.env.LEVR_AI_API_KEY,workspace:req.workspace,refreshing:runningFor(req.workspaceId).size>0,refreshingCompetitorIds:[...runningFor(req.workspaceId)],eligibleCompetitorCount:db.prepare('SELECT count(*) n FROM competitors c WHERE c.archived=0 AND c.paused=0 AND EXISTS (SELECT 1 FROM profiles p WHERE p.competitor_id=c.id AND p.confirmed=1)').get().n,ownerEmail:req.user.role==='owner'?a.ownerEmail:undefined,counts:{competitors:db.prepare('SELECT count(*) n FROM competitors WHERE archived=0').get().n,ads:db.prepare("SELECT count(*) n FROM items WHERE kind='paid' AND coalesce(json_extract(data,'$.active'),1)=1").get().n,posts:db.prepare("SELECT count(*) n FROM items WHERE kind='organic'").get().n,opportunities:db.prepare('SELECT count(*) n FROM opportunities').get().n}}));
 app.get('/api/competitors',(req,res)=>res.json(competitorRows(db)));
 app.get('/api/profile-candidates',async(req,res)=>{const query=z.string().trim().min(2).max(200).parse(req.query.q);try{res.json(await searchMetaCompanies(query,{apiKey:vault.get(req.workspaceId)||''}));}catch(e){res.status(502).json({error:e.safeMessage||'Profile search is unavailable. Check the provider settings.'});}});
 app.post('/api/competitors',(req,res)=>{const v=z.object({name:text,notes:z.string().max(5000).optional()}).parse(req.body),cid=id();db.prepare('INSERT INTO competitors(id,name,notes) VALUES (?,?,?)').run(cid,v.name,v.notes||'');res.status(201).json(competitorRows(db).find(c=>c.id===cid));});
 app.patch('/api/competitors/:id',(req,res)=>{const v=z.object({name:text.optional(),notes:z.string().max(5000).optional(),paused:z.boolean().optional()}).parse(req.body);const c=db.prepare('SELECT * FROM competitors WHERE id=? AND archived=0').get(req.params.id);if(!c)return res.status(404).json({error:'Competitor not found.'});db.prepare('UPDATE competitors SET name=?,notes=?,paused=? WHERE id=?').run(v.name??c.name,v.notes??c.notes,v.paused===undefined?c.paused:Number(v.paused),c.id);res.json(competitorRows(db).find(x=>x.id===c.id));});
 app.delete('/api/competitors/:id',(req,res)=>{db.prepare('UPDATE competitors SET archived=1,paused=1 WHERE id=?').run(req.params.id);res.json({ok:true});});
 app.post('/api/competitors/:id/profiles',(req,res)=>{const v=z.object({platform:z.enum(['meta','instagram','youtube']),identifier:text,label:z.string().max(500).optional()}).parse(req.body);if(!db.prepare('SELECT 1 FROM competitors WHERE id=? AND archived=0').get(req.params.id))return res.status(404).json({error:'Competitor not found.'});let identifier;try{identifier=normalizeIdentifier(v.platform,v.identifier);}catch(e){return res.status(400).json({error:e.message});}const pid=id();db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,label) VALUES (?,?,?,?,?)').run(pid,req.params.id,v.platform,identifier,v.label||identifier);res.status(201).json(profileRow(db.prepare('SELECT * FROM profiles WHERE id=?').get(pid)));});
 app.patch('/api/profiles/:id',(req,res)=>{const v=z.object({confirmed:z.boolean().optional(),identifier:text.optional(),label:z.string().max(500).optional()}).parse(req.body);const p=db.prepare('SELECT * FROM profiles WHERE id=?').get(req.params.id);if(!p)return res.status(404).json({error:'Profile not found.'});let identifier;try{identifier=v.identifier?normalizeIdentifier(p.platform,v.identifier):p.identifier;}catch(e){return res.status(400).json({error:e.message});}const changed=identifier!==p.identifier;db.prepare('UPDATE profiles SET identifier=?,label=?,confirmed=? WHERE id=?').run(identifier,v.label??p.label,changed?0:v.confirmed===undefined?p.confirmed:Number(v.confirmed),p.id);res.json(profileRow(db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id)));});
 app.delete('/api/profiles/:id',(req,res)=>{db.prepare('DELETE FROM profiles WHERE id=?').run(req.params.id);res.json({ok:true});});
 async function refreshCompetitor(c,jobId,running,providerKey){
  const errors=[],warnings=[];let count=0;
  const profiles=db.prepare('SELECT * FROM profiles WHERE competitor_id=? AND confirmed=1').all(c.id).map(profileRow);
  if(!profiles.length)errors.push('Confirm at least one profile before refreshing this competitor.');
  for(const p of profiles){
   try{const result=await collector(p,{apiKey:providerKey});if(!Array.isArray(result.items))throw Error('Provider response was incomplete.');persistProfileItems(db,p,result.items,result.complete);count+=result.items.length;warnings.push(...(result.warnings||[]));}
   catch(e){errors.push(`${p.platform}: ${e.safeMessage||'Collection failed. Check provider credits, profile identifier, network access, and API key in secure settings.'}`);}
  }
  const error=errors.length?errors.join(' '):null;
  db.prepare('UPDATE refreshes SET warnings=? WHERE id=?').run(JSON.stringify(warnings),jobId);
  db.prepare('UPDATE refreshes SET status=?,finished_at=?,error=?,item_count=? WHERE id=?').run(error?'failed':'success',now(),error,count,jobId);
  if(!error)db.prepare('UPDATE competitors SET last_refresh=?,last_error=NULL WHERE id=?').run(now(),c.id);else db.prepare('UPDATE competitors SET last_error=? WHERE id=?').run(error,c.id);
  running.delete(c.id);
 }
 app.post('/api/refresh',(req,res)=>{
  const v=z.object({competitorId:z.string().optional()}).parse(req.body||{});
  const providerKey=vault.get(req.workspaceId);
  if(!options.collector&&!providerKey)return res.status(503).json({error:'Connect this workspace’s ScrapeCreators account in Settings before refreshing.'});
  const running=runningFor(req.workspaceId);
  const cs=competitorRows(db).filter(c=>!c.paused&&(!v.competitorId||c.id===v.competitorId));
  if(!cs.length)return res.status(400).json({error:'No active competitors are available to refresh.'});
  const eligible=cs.filter(c=>c.profiles.some(p=>p.confirmed));
  const skippedCount=cs.length-eligible.length;
  if(!eligible.length)return res.status(400).json({error:'Confirm at least one profile before refreshing. Unconfirmed competitors are skipped.'});
  const jobs=[];for(const c of eligible){if(running.has(c.id))continue;const jid=id();running.add(c.id);db.prepare('INSERT INTO refreshes(id,competitor_id,status,started_at) VALUES (?,?,?,?)').run(jid,c.id,'running',now());db.prepare('UPDATE competitors SET last_error=NULL WHERE id=?').run(c.id);jobs.push({c,jid});}
  if(!jobs.length)return res.status(409).json({error:'These competitors are already refreshing.'});
  res.status(202).json({jobId:jobs[0].jid,jobIds:jobs.map(j=>j.jid),queuedCount:jobs.length,skippedCount});
  // A per-workspace queue preserves its database and key across async work.
  const connection=req.workspaceDatabase,workspaceId=req.workspaceId;
  const queue=(queues.get(workspaceId)||Promise.resolve()).then(()=>manager.run(connection,workspaceId,async()=>{for(const {c,jid} of jobs)await refreshCompetitor(c,jid,running,providerKey);})).catch(()=>manager.run(connection,workspaceId,()=>{for(const {c,jid} of jobs){running.delete(c.id);db.prepare("UPDATE refreshes SET status='failed',finished_at=?,error=? WHERE id=? AND status='running'").run(now(),'Refresh interrupted. Retry the manual refresh.',jid);}}));
  queues.set(workspaceId,queue);
 });

 app.get('/api/refreshes',(req,res)=>res.json(db.prepare('SELECT * FROM refreshes ORDER BY started_at DESC LIMIT 200').all().map(r=>({id:r.id,competitorId:r.competitor_id,status:r.status,startedAt:r.started_at,finishedAt:r.finished_at,error:r.error,itemCount:r.item_count,warnings:JSON.parse(r.warnings)}))));
 app.get('/api/items',(req,res)=>{let rows=itemRows(db);const q=req.query;if(q.kind)rows=rows.filter(i=>i.kind===q.kind);if(q.kind==='paid'&&q.includeInactive!=='true')rows=rows.filter(i=>i.active!==false);if(q.format)rows=rows.filter(i=>i.format===q.format);if(q.competitorId)rows=rows.filter(i=>i.competitorId===q.competitorId);if(q.q)rows=rows.filter(i=>[i.title,i.caption,i.transcript,i.competitorName].join(' ').toLowerCase().includes(String(q.q).toLowerCase()));if(q.transcript)rows=rows.filter(i=>q.transcript==='available'?!!i.transcript:!i.transcript);if(q.minDays)rows=rows.filter(i=>i.activeDays>=Number(q.minDays));rows.sort(q.sort==='recent'?(a,b)=>Date.parse(b.publishedAt||b.lastSeen)-Date.parse(a.publishedAt||a.lastSeen):(a,b)=>(b.researchSignal??-1)-(a.researchSignal??-1));res.json(rows);});
 app.get('/api/items/:id',(req,res)=>{const i=itemRows(db).find(i=>i.id===req.params.id);res.status(i?200:404).json(i||{error:'Reference not found.'});});
 app.get('/api/boards',(req,res)=>res.json(boardRows(db)));
 app.post('/api/boards',(req,res)=>{const v=z.object({name:text,description:z.string().max(5000).optional()}).parse(req.body),bid=id();db.prepare('INSERT INTO boards VALUES (?,?,?)').run(bid,v.name,v.description||'');res.status(201).json(boardRows(db).find(b=>b.id===bid));});
 app.patch('/api/boards/:id',(req,res)=>{const v=z.object({name:text,description:z.string().max(5000).optional()}).parse(req.body);db.prepare('UPDATE boards SET name=?,description=? WHERE id=?').run(v.name,v.description||'',req.params.id);res.json(boardRows(db).find(b=>b.id===req.params.id)||{error:'Board not found.'});});
 app.delete('/api/boards/:id',(req,res)=>{if(req.params.id==='inbox')return res.status(400).json({error:'Creative Inbox is the default board and cannot be removed.'});if(db.prepare('SELECT 1 FROM opportunities WHERE board_id=?').get(req.params.id))return res.status(409).json({error:'Move or remove the opportunities on this board before deleting it. Your notes and research are preserved.'});db.prepare('DELETE FROM boards WHERE id=?').run(req.params.id);res.json({ok:true});});
 app.get('/api/opportunities',(req,res)=>res.json(opportunityRows(db,req.query.boardId)));
 app.post('/api/opportunities',(req,res)=>{const v=z.object({itemId:text,boardId:text.optional()}).parse(req.body),oid=id(),bid=v.boardId||'inbox';db.prepare('INSERT INTO opportunities(id,board_id,item_id) VALUES (?,?,?) ON CONFLICT(board_id,item_id) DO NOTHING').run(oid,bid,v.itemId);res.status(201).json(opportunityRows(db,bid).find(o=>o.itemId===v.itemId));});
 app.patch('/api/opportunities/:id',(req,res)=>{const v=z.object({boardId:text.optional(),notes:z.string().max(10000).optional(),tags:z.array(z.string().max(80)).max(30).optional(),rating:z.number().int().min(0).max(5).optional(),stage:stages.optional()}).parse(req.body);const o=db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);if(!o)return res.status(404).json({error:'Opportunity not found.'});db.prepare('UPDATE opportunities SET board_id=?,notes=?,tags=?,rating=?,stage=? WHERE id=?').run(v.boardId??o.board_id,v.notes??o.notes,v.tags?JSON.stringify(v.tags):o.tags,v.rating??o.rating,v.stage??o.stage,o.id);res.json(opportunityRows(db).find(x=>x.id===o.id));});
 app.delete('/api/opportunities/:id',(req,res)=>{db.prepare('DELETE FROM opportunities WHERE id=?').run(req.params.id);res.json({ok:true});});
 app.get('/api/patterns',(req,res)=>{const items=scopedItems(db,req.query.boardId);res.json({...findPatterns(items),scope:req.query.boardId||'library',itemCount:items.length});});
 app.get('/api/briefs',(req,res)=>res.json(db.prepare('SELECT * FROM briefs ORDER BY created_at DESC').all().map(r=>({...JSON.parse(r.data),id:r.id,boardId:r.board_id,format:r.format,createdAt:r.created_at}))));
 app.get('/api/briefs/:id',(req,res)=>{const r=db.prepare('SELECT * FROM briefs WHERE id=?').get(req.params.id);res.status(r?200:404).json(r?{...JSON.parse(r.data),id:r.id,boardId:r.board_id,format:r.format,createdAt:r.created_at}:{error:'Brief not found.'});});
 app.post('/api/briefs',async(req,res)=>{const v=z.object({boardId:text,format:z.enum(['paid_ad','short','carousel','youtube_video']),audience:text,offer:z.string().max(3000).optional(),objective:text}).parse(req.body);const items=scopedItems(db,v.boardId);if(!items.length)return res.status(400).json({error:'Save references to this board before generating a brief.'});const data=await generateBrief({...v,items},{}),bid=id(),createdAt=now();db.prepare('INSERT INTO briefs VALUES (?,?,?,?,?)').run(bid,v.boardId,v.format,createdAt,JSON.stringify(data));res.status(201).json({...data,id:bid,boardId:v.boardId,format:v.format,createdAt});});
 app.post('/api/ask',async(req,res)=>{const v=z.object({question:z.string().trim().min(2).max(4000),boardId:text.optional()}).parse(req.body);res.json(await askLibrary({items:scopedItems(db,v.boardId),question:v.question}));});
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 const dist=resolve('dist');if(existsSync(dist)){app.use(express.static(dist,{index:false}));app.get('/{*path}',(req,res)=>res.sendFile(resolve(dist,'index.html')));}
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(err.name==='ProviderConnectionError')return res.status(err.status||502).json({error:err.safeMessage});if(err.name==='SecretVaultError')return res.status(503).json({error:err.safeMessage||'Workspace credential storage is unavailable. Contact Levr.'});if(err instanceof z.ZodError)return res.status(400).json({error:err.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')});if(err.code?.startsWith('ERR_SQLITE'))return res.status(409).json({error:'This record conflicts with an existing record or a required reference is missing.'});if(err.type==='entity.parse.failed')return res.status(400).json({error:'Request must contain valid JSON.'});res.status(500).json({error:'The operation could not be completed. Previously saved data is preserved.'});});
 return {app,db:catalog,closeWorkspaceDatabases:()=>manager.close(),waitForRefresh:()=>Promise.all([...queues.values(),beta.wait()])};
}
