import MediaDiagnostics from './MediaDiagnostics.jsx';
import React,{useEffect,useState,useRef} from 'react';
import ResearchImage,{imageSources} from './ResearchImage.jsx';
import {mediaImageUrl} from '../shared/media-images.js';
const safe=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null}catch{return null}};
function Video({item,entry,index,workspaceId,collection,retry,fallback,onFailure}){
 const relay=mediaImageUrl(entry.url)?`/api/workspaces/${encodeURIComponent(workspaceId)}/${collection}/${encodeURIComponent(item.id)}/video/${index}`:null;
 const sources=[relay,safe(entry.url)].filter(Boolean),[attempt,setAttempt]=useState(0);
 useEffect(()=>setAttempt(0),[entry.url,retry,workspaceId]);
 return attempt<sources.length?<video key={`${sources[attempt]}:${retry}`} controls playsInline preload="metadata" src={sources[attempt]} poster={imageSources(item,workspaceId,`poster-${index}`,collection)[0]||imageSources(item,workspaceId,'thumbnail',collection)[0]} onError={event=>{onFailure({source:relay&&attempt===0?'app relay':'media host',code:event.currentTarget.error?.code||null});setAttempt(i=>i+1)}}/>:fallback;
}
export default function CreativeMedia({item,workspaceId,collection='items',onRefresh}){
 const viewerRef=useRef(null);const [videoFailures,setVideoFailures]=useState([]);
 const [index,setIndex]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>setVideoFailures([]),[item.id,index,item.mediaRefreshedAt,retry]);
 useEffect(()=>{setIndex(0);setRetry(0);setError('')},[item.id]);
 const media=item.media||[],entry=media[index],vertical=['instagram_reel','youtube_short'].includes(item.format);
 let embed=null;
 if(item.platform==='youtube')try{const u=new URL(item.sourceUrl||entry?.url),id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)?u.searchParams.get('v')||u.pathname.split('/').filter(Boolean).at(-1):null;if(id&&/^[\w-]{6,20}$/.test(id))embed=`https://www.youtube-nocookie.com/embed/${id}`}catch{}
 const unavailable=<div className="creative-placeholder"><strong>Preview unavailable</strong><p>{onRefresh?'Refresh the media links below to retrieve this creative again.':'Refresh this source to retrieve newer media links.'}</p><div className="row-actions"><button className="button small" onClick={()=>setRetry(i=>i+1)}>Retry loading</button>{safe(item.sourceUrl)&&<a className="source-link" href={safe(item.sourceUrl)} target="_blank" rel="noopener noreferrer">View original <span aria-hidden="true">↗</span></a>}</div></div>;
 async function renew(){setBusy(true);setError('');try{await onRefresh();setIndex(0);setRetry(i=>i+1)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <><div ref={viewerRef} className={`media-viewer ${vertical?'vertical':item.format==='youtube_video'?'horizontal':'image'}`}>
  {embed?<iframe referrerPolicy="strict-origin-when-cross-origin" src={embed} title={item.title||'YouTube creative'} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/>:entry?.type==='video'&&safe(entry.url)?<Video item={item} entry={entry} index={index} workspaceId={workspaceId} collection={collection} retry={retry} fallback={unavailable} onFailure={failure=>setVideoFailures(previous=>[...previous,failure].slice(-4))}/>:<ResearchImage key={`${index}:${retry}`} item={item} workspaceId={workspaceId} collection={collection} slot={entry?.type==='image'?`slide-${index}`:'thumbnail'} alt={entry?.type==='image'?`Creative slide ${index+1}`:'Creative thumbnail'} loading="eager" fallback={unavailable}/>}
 </div>{media.length>1&&<div className="carousel-controls"><button className="icon-button" aria-label="Previous slide" disabled={index===0} onClick={()=>setIndex(i=>i-1)}>‹</button><span>Slide {index+1} of {media.length}</span><button className="icon-button" aria-label="Next slide" disabled={index===media.length-1} onClick={()=>setIndex(i=>i+1)}>›</button></div>}
 {onRefresh&&<div className="media-refresh-controls"><button className="button" disabled={busy} onClick={renew}>{busy?'Refreshing media…':'Refresh media links'}</button><p className="caption">{collection==='items'?`Retrieves this ${item.kind==='paid'?'ad':'post'} using this workspace’s ScrapeCreators credits.`:'Retrieves this creative from the connected Meta ad account.'} Saved research stays intact.</p></div>}
 {!embed&&<MediaDiagnostics key={`${item.id}:${index}:${workspaceId}:${item.mediaRefreshedAt||''}`} item={item} workspaceId={workspaceId} collection={collection} index={index} viewerRef={viewerRef} videoFailures={videoFailures}/>}
 {(error||item.mediaWarning||item.mediaRefreshError)&&<p className="error-banner" role="alert">{error||item.mediaWarning||item.mediaRefreshError}</p>}
 </>;
}
