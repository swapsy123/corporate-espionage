// Only these public media CDNs can be read by the authenticated image relay.
// Original post/landing URLs are never relay targets.
export function mediaImageUrl(value) {
 try {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return null;
  if(!['cdninstagram.com','fbcdn.net','ytimg.com','ggpht.com'].some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`)))return null;
  return url.href;
 }catch{return null}
}
export function imageCandidates(item,slot='thumbnail') {
 const media=Array.isArray(item.media)?item.media:[];
 let candidates=[];
 if(slot==='thumbnail')candidates=[{url:item.thumbnail,slot},...media.flatMap((m,index)=>[
  {url:m.thumbnail,slot:`poster-${index}`},...(m.type==='image'?[{url:m.url,slot:`slide-${index}`}]:[])
 ])];
 else {
  const match=/^(slide|poster)-(\d{1,4})$/.exec(slot),entry=match&&media[Number(match[2])];
  if(entry)candidates=[{url:match[1]==='poster'?entry.thumbnail:entry.type==='image'?entry.url:null,slot}];
 }
 const seen=new Set();
 return candidates.filter(candidate=>{
  if(typeof candidate.url!=='string'||seen.has(candidate.url))return false;
  try{const u=new URL(candidate.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return false}catch{return false}
  seen.add(candidate.url);return true;
 });
}
