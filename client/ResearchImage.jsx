import React,{useState} from 'react';
import {imageCandidates,mediaImageUrl} from '../shared/media-images.js';

export function imageSources(item,workspaceId,slot='thumbnail'){
 return [...new Set(imageCandidates(item,slot).flatMap(candidate=>{
  const relay=workspaceId&&item.id&&mediaImageUrl(candidate.url)
   ?`/api/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(item.id)}/image/${candidate.slot}`:null;
  return relay?[relay,candidate.url]:[candidate.url];
 }))];
}
function ImageAttempt({sources,alt,loading,fallback}){
 const [index,setIndex]=useState(0);
 if(index>=sources.length)return fallback;
 return <img src={sources[index]} alt={alt} loading={loading} decoding="async" referrerPolicy="no-referrer" onError={()=>setIndex(i=>i+1)}/>;
}
export default function ResearchImage({item,workspaceId,slot='thumbnail',alt='',loading='lazy',fallback=null}){
 const sources=imageSources(item,workspaceId,slot);
 // Fresh media URLs from a manual refresh reset failed attempts. Re-renders of
 // the same failed record don't continuously request an expired image.
 return <ImageAttempt key={JSON.stringify(sources)} sources={sources} alt={alt} loading={loading} fallback={fallback}/>;
}
