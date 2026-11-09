import React,{useState,useEffect,useRef} from 'react';
import {imageCandidates,mediaImageUrl} from '../shared/media-images.js';

export function imageSources(item,workspaceId,slot='thumbnail',collection='items'){
 return [...new Set(imageCandidates(item,slot).flatMap(candidate=>{
  const relay=workspaceId&&item.id&&mediaImageUrl(candidate.url)
   ?`/api/workspaces/${encodeURIComponent(workspaceId)}/${collection}/${encodeURIComponent(item.id)}/image/${candidate.slot}`:null;
  return relay?[relay,candidate.url]:[candidate.url];
 }))];
}
function ImageAttempt({sources,alt,loading,fallback,onUnavailable,onAvailable}){
 const [index,setIndex]=useState(0),callbacks=useRef({onUnavailable,onAvailable});
 callbacks.current={onUnavailable,onAvailable};
 useEffect(()=>{if(index>=sources.length)callbacks.current.onUnavailable?.()},[index,sources.length]);
 if(index>=sources.length)return fallback;
 return <img src={sources[index]} alt={alt} loading={loading} decoding="async" referrerPolicy="no-referrer" onLoad={()=>callbacks.current.onAvailable?.()} onError={()=>setIndex(i=>i+1)}/>;
}
export default function ResearchImage({item,workspaceId,slot='thumbnail',collection='items',alt='',loading='lazy',fallback=null,onUnavailable,onAvailable}){
 const sources=imageSources(item,workspaceId,slot,collection);
 // Fresh media URLs from a manual refresh reset failed attempts. Re-renders of
 // the same failed record don't continuously request an expired image.
 return <ImageAttempt key={JSON.stringify(sources)} sources={sources} alt={alt} loading={loading} fallback={fallback} onUnavailable={onUnavailable} onAvailable={onAvailable}/>;
}
