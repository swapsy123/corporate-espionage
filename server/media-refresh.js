import {id,now} from './db.js';
import {itemRows} from './store.js';
import {refreshInstagramMedia} from './provider.js';

export function registerMediaRefresh(app,{db,manager,vault,refreshMedia=refreshInstagramMedia}){
 const running=new Set();
 app.post('/api/items/:id/media-refresh',async(req,res)=>{
  const row=db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if(!row)return res.status(404).json({error:'Creative not found.'});
  if(row.platform!=='instagram')return res.status(400).json({error:'Refresh this competitor to update media for this platform.'});
  const apiKey=vault.get(req.workspaceId);
  if(!apiKey)return res.status(503).json({error:'Connect this workspace’s ScrapeCreators account in Settings before refreshing media.'});
  const key=`${req.workspaceId}:${row.id}`;
  if(running.has(key))return res.status(409).json({error:'This creative’s media is already refreshing.'});
  if([...running].filter(key=>key.startsWith(`${req.workspaceId}:`)).length>=2)return res.status(429).json({error:'Wait for the current media refreshes to finish.'});
  const job=id();
  db.prepare('INSERT INTO refreshes(id,competitor_id,status,started_at,warnings) VALUES (?,?,?,?,?)').run(job,row.competitor_id,'running',now(),JSON.stringify(['Manual Instagram media refresh.']));
  running.add(key);
  try{
   const result=await refreshMedia({...JSON.parse(row.data),platform:row.platform,externalId:row.external_id},{apiKey});
   if(!manager.canAccess(req))return res.status(404).json({error:'Workspace access has been removed.'});
   const latest=db.prepare('SELECT * FROM items WHERE id=?').get(row.id);
   if(!latest)return res.status(404).json({error:'Creative is no longer available.'});
   if(!Array.isArray(result?.media)||!result.media.length)throw Error('Missing media');
   const updated={...JSON.parse(latest.data),media:result.media,thumbnail:result.thumbnail,mediaRefreshedAt:now(),mediaRefreshError:null};
   // Read after the provider call so concurrent transcript/metric refreshes survive.
   db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify(updated),row.id);
   db.prepare('UPDATE refreshes SET status=?,finished_at=?,item_count=? WHERE id=?').run('success',now(),1,job);
   res.json(itemRows(db).find(item=>item.id===row.id));
  }catch(error){
   const message=error.safeMessage||'Media refresh failed. Existing media and research were preserved. Try again later.';
   if(manager.canAccess(req)){
    const latest=db.prepare('SELECT data FROM items WHERE id=?').get(row.id);
    if(latest)db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(latest.data),mediaRefreshError:message}),row.id);
    db.prepare('UPDATE refreshes SET status=?,finished_at=?,error=? WHERE id=?').run('failed',now(),message,job);
   }
   res.status(502).json({error:message});
  }finally{
   running.delete(key);
   // Finalize bookkeeping even after revocation, without writing creative data
   // or reopening a deleted workspace. No provider response is retained here.
   if(manager.isActive(req.workspaceId))manager.run(req.workspaceDatabase,req.workspaceId,()=>{
    db.prepare("UPDATE refreshes SET status='failed',finished_at=?,error=? WHERE id=? AND status='running'").run(now(),'Media refresh interrupted. Existing research was preserved.',job);
   });
  }
 });
}
