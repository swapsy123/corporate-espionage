import {z} from 'zod';
import {id,now} from './db.js';
import {itemRows} from './store.js';
import {refreshCreativeMedia} from './provider.js';

export function registerMediaRefresh(app,{db,manager,vault,refreshMedia=refreshCreativeMedia,warmMedia}){
 const running=new Set(),tasks=new Set(),batches=new Map();
 const safeError=error=>error.safeMessage||'Media refresh failed. Existing media and research were preserved. Try again later.';
 const supported=row=>row&&(row.platform==='instagram'||row.platform==='meta'&&row.kind==='paid');
 const rowFor=itemId=>db.prepare('SELECT * FROM items WHERE id=?').get(itemId);
 function track(task){tasks.add(task);task.finally(()=>tasks.delete(task)).catch(()=>{});return task}
 function jobFor(row){
  const job=id();
  db.prepare('INSERT INTO refreshes(id,competitor_id,status,started_at,warnings) VALUES (?,?,?,?,?)').run(job,row.competitor_id,'running',now(),JSON.stringify([row.platform==='meta'?'Manual Meta ad media refresh.':'Manual Instagram media refresh.']));
  return job;
 }
 async function retain(req,item,job){
  if(!warmMedia||!manager.canAccess(req))return false;
  let result;try{result=await warmMedia(req,item)}catch{result={failed:1}}
  if(result?.failed&&manager.canAccess(req))db.prepare('UPDATE refreshes SET warnings=? WHERE id=?').run(JSON.stringify(['Media links refreshed. Some files could not be saved for later playback; those previews may need refreshing again.']),job);
  return !result?.failed;
 }
 async function refreshOne(req,row,apiKey,job){
  try{
   if(!manager.canAccess(req))throw Error('Access removed');
   const result=await refreshMedia({...JSON.parse(row.data),platform:row.platform,kind:row.kind,externalId:row.external_id},{apiKey});
   if(!manager.canAccess(req))throw Error('Access removed');
   const latest=rowFor(row.id);
   if(!latest)throw Error('Creative removed');
   if(!Array.isArray(result?.media)||!result.media.length)throw Error('Missing media');
   const updated={...JSON.parse(latest.data),media:result.media,thumbnail:result.thumbnail,mediaRefreshedAt:now(),mediaRefreshError:null,mediaWarning:null};
   // Read again after the provider call so concurrent metric/transcript edits survive.
   db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify(updated),row.id);
   db.prepare('UPDATE refreshes SET status=?,finished_at=?,item_count=? WHERE id=?').run('success',now(),1,job);
   return itemRows(db).find(item=>item.id===row.id);
  }catch(error){
   const message=safeError(error);
   if(manager.canAccess(req)){
    const latest=rowFor(row.id);
    if(latest)db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(latest.data),mediaRefreshError:message}),row.id);
    db.prepare('UPDATE refreshes SET status=?,finished_at=?,error=? WHERE id=?').run('failed',now(),message,job);
   }
   throw error;
  }finally{
   if(manager.isActive(req.workspaceId))manager.run(req.workspaceDatabase,req.workspaceId,()=>{
    db.prepare("UPDATE refreshes SET status='failed',finished_at=?,error=? WHERE id=? AND status='running'").run(now(),'Media refresh interrupted. Existing research was preserved.',job);
   });
  }
 }
 function providerKey(req,res){
  const key=vault.get(req.workspaceId);
  if(!key)res.status(503).json({error:'Connect this workspace’s ScrapeCreators account in Settings before refreshing media.'});
  return key;
 }
 app.get('/api/media-repair',(req,res)=>res.json(batches.get(req.workspaceId)||{running:false,total:0,completed:0,repaired:0,saved:0,errors:[]}));
 app.post('/api/media-repair',(req,res)=>{
  const {itemIds}=z.object({itemIds:z.array(z.string().min(1).max(100)).min(1).max(50)}).parse(req.body);
  const rows=[...new Set(itemIds)].map(rowFor);
  if(rows.some(r=>!supported(r)))return res.status(404).json({error:'Select Instagram posts or Meta ads from this workspace.'});
  if(batches.get(req.workspaceId)?.running||[...running].some(key=>key.startsWith(req.workspaceId+':')))return res.status(409).json({error:'Wait for this workspace’s current media refresh to finish.'});
  const apiKey=providerKey(req,res);if(!apiKey)return;
  const batch={id:id(),running:true,total:rows.length,completed:0,repaired:0,saved:0,errors:[],startedAt:now()},jobs=rows.map(row=>({row,job:jobFor(row)}));
  const workspaceId=req.workspaceId;
  batches.set(workspaceId,batch);
  for(const {row} of jobs)running.add(`${workspaceId}:${row.id}`);
  res.status(202).json({...batch});
  // An explicitly requested batch, processed serially. No cron, automatic
  // provider refresh or cross-workspace provider credentials are involved.
  track(manager.run(req.workspaceDatabase,workspaceId,async()=>{
   try{
    for(const {row,job} of jobs){
     if(!manager.canAccess(req)){batch.interrupted=true;break}
     try{
      const item=await refreshOne(req,row,apiKey,job);batch.repaired++;
      if(await retain(req,item,job))batch.saved++;
     }catch(error){batch.errors.push({itemId:row.id,error:safeError(error)})}
     finally{batch.completed++;running.delete(`${workspaceId}:${row.id}`)}
    }
   }finally{
    for(const {row,job} of jobs){running.delete(`${workspaceId}:${row.id}`);if(manager.isActive(workspaceId))db.prepare("UPDATE refreshes SET status='failed',finished_at=?,error=? WHERE id=? AND status='running'").run(now(),'Media repair interrupted. Run manual repair again.',job)}
    batch.running=false;batch.finishedAt=now();
   }
  }));
 });
 app.post('/api/items/:id/media-refresh',async(req,res)=>{
  const row=rowFor(req.params.id);
  if(!row)return res.status(404).json({error:'Creative not found.'});
  if(!supported(row))return res.status(400).json({error:'Refresh this competitor to update media for this platform.'});
  const apiKey=providerKey(req,res);if(!apiKey)return;
  const key=`${req.workspaceId}:${row.id}`;
  if(running.has(key))return res.status(409).json({error:'This creative’s media is already refreshing.'});
  if([...running].filter(key=>key.startsWith(`${req.workspaceId}:`)).length>=2)return res.status(429).json({error:'Wait for the current media refreshes to finish.'});
  const job=jobFor(row);running.add(key);
  try{
   const item=await refreshOne(req,row,apiKey,job);
   // Return usable fresh links immediately; save full files in the background
   // as part of this manual action so video downloads do not hold the HTTP request.
   track(retain(req,item,job));res.json(item);
  }catch(error){
   if(!manager.canAccess(req))res.status(404).json({error:'Workspace access has been removed.'});
   else res.status(502).json({error:safeError(error)});
  }finally{running.delete(key)}
 });
 return {wait:()=>Promise.all([...tasks])};
}
