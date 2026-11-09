import React,{useEffect,useState} from 'react';
import {imageCandidates} from '../shared/media-images.js';

export default function MediaDiagnostics({item,workspaceId,collection,index,viewerRef,videoFailures}){
 const [report,setReport]=useState(null),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
 useEffect(()=>{setReport(null);setCopied(false)},[item.id,index,item.mediaRefreshedAt,workspaceId]);
 async function check(){
  setBusy(true);setCopied(false);
  const base=`/api/workspaces/${encodeURIComponent(workspaceId)}/${collection}/${encodeURIComponent(item.id)}`;
  const entry=item.media?.[index],imageSlot=entry?.type==='image'?`slide-${index}`:imageCandidates(item)[0]?.slot;
  const targets=[...(imageSlot?[['Image',`${base}/image/${imageSlot}`]]:[]),...(entry?.type==='video'?[['Video',`${base}/video/${index}`]]:[])];
  const checks=[];
  for(const [kind,path] of targets){
   try{
    const response=await fetch(`${path}?check=1`,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
    const data=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
    if(data?.version==='media-check-1')checks.push({kind,...data});
    else checks.push({kind,ok:false,code:`http_${response.status}`,message:response.status===401?'Your session has expired. Sign in again.':response.status===404?'This preview or media check is unavailable. Confirm the latest app deployment is live.':'The app could not return a media check. Try again after the service recovers.'});
   }catch{checks.push({kind,ok:false,code:'browser_request_failed',message:'The browser could not complete the media check. Check your connection and try again.'})}
  }
  const image=viewerRef.current?.querySelector('img'),video=viewerRef.current?.querySelector('video');
  setReport({platform:item.platform,format:item.format,slide:index+1,browser:{imageDecoded:!!image?.naturalWidth,videoReadyState:video?.readyState??null,videoError:video?.error?.code??null,videoFailures},checks});setBusy(false);
 }
 async function copy(){try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));setCopied(true)}catch{setCopied(false)}}
 return <section className="media-diagnostics" aria-label="Media check">
  <button className="button small" disabled={busy} onClick={check}>{busy?'Checking media…':'Check media'}</button><p className="caption">Checks this slide’s saved files. No ScrapeCreators credits are used.</p>
  {report&&<div role="status">{!report.checks.length?<p>No media file is saved for this slide. Run a manual source refresh.</p>:report.checks.map(result=><p key={result.kind}><strong>{result.kind}: </strong>{result.ok?`File accessible from ${result.source}.`:result.message}{!result.ok&&<> <span className="caption">({result.code}{result.upstreamStatus?`, HTTP ${result.upstreamStatus}`:''})</span></>}</p>)}
   {report.checks.some(r=>r.ok)&&<p className="caption">If the preview is still blank, copy the check so Levr can inspect the browser playback status.</p>}
   <button className="button small" onClick={copy}>{copied?'Check copied':'Copy media check'}</button><details><summary>Check details</summary><pre>{JSON.stringify(report,null,2)}</pre></details>
  </div>}
 </section>;
}
