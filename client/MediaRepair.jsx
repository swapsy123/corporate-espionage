import React,{useEffect,useRef,useState} from 'react';

export default function MediaRepair({items,kind,failedIds,api,version,changed}){
 const [batch,setBatch]=useState(null),[error,setError]=useState(''),[starting,setStarting]=useState(false),[tick,setTick]=useState(0);
 const wasRunning=useRef(false);
 useEffect(()=>{
  let active=true,timer;
  async function poll(){
   try{
    const next=await api('/api/media-repair');if(!active)return;
    setBatch(next);
    const finished=wasRunning.current&&!next.running;wasRunning.current=next.running;
    if(finished)changed();
    if(next.running)timer=setTimeout(poll,1500);
   }catch(e){if(active)setError(e.message)}
  }
  poll();return()=>{active=false;clearTimeout(timer)};
 },[version,tick]);
 const eligible=items.filter(item=>item.platform==='instagram'||item.platform==='meta'&&item.kind==='paid');
 const noun=kind==='paid'?'ad':'post';
 const failed=eligible.filter(item=>failedIds.has(item.id));
 const selection=(failed.length?failed:eligible).slice(0,50);
 const busy=starting||batch?.running;
 async function repair(){
  setStarting(true);setError('');
  try{const next=await api('/api/media-repair',{method:'POST',body:{itemIds:selection.map(item=>item.id)}});setBatch(next);wasRunning.current=true;setTick(t=>t+1)}catch(e){setError(e.message)}finally{setStarting(false)}
 }
 if(!eligible.length&&!batch?.running)return null;
 return <section className="media-repair" aria-label="Repair media previews">
  <div className="row-actions"><button className="button" disabled={busy||!selection.length} onClick={repair}>{busy?'Repairing media…':failed.length?`Repair ${selection.length} failed ${selection.length===1?'preview':'previews'}`:`Refresh media for ${selection.length} ${selection.length===1?noun:noun+'s'}`}</button><p className="caption">{failed.length?`${failed.length} previews could not load. `:''}Uses this workspace’s ScrapeCreators credits. Up to 50 {noun}s per repair; saved research stays intact.</p></div>
  {batch?.running&&<p role="status">{batch.completed} of {batch.total} items checked · {batch.repaired} repaired. Saving available media for later playback.</p>}
  {batch?.total>0&&!batch.running&&<p role="status">{batch.repaired} of {batch.total} items refreshed · {batch.saved} saved for later playback{batch.errors.length?` · ${batch.errors.length} could not be refreshed`:''}{batch.interrupted?' · Repair interrupted. Run it again to continue.':''}</p>}
  {error&&<p className="error-banner" role="alert">{error}</p>}
  {!!batch?.errors.length&&<details><summary>View repair errors</summary>{batch.errors.map(item=><p className="caption" key={item.itemId}>{items.find(i=>i.id===item.itemId)?.title||'Creative'}: {item.error}</p>)}</details>}
 </section>;
}
