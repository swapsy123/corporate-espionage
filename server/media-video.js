import {mediaError,mediaFailure,mediaReport,upstreamMediaError} from './media-diagnostics.js';
import {request as httpsRequest} from 'node:https';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {mediaQueue} from './media-queue.js';
import {imageLookup} from './media-images.js';
import {mediaImageUrl} from '../shared/media-images.js';

const MAX_BYTES=256*1024*1024;
export function videoRange(value){
 if(value==null)return null;
 if(typeof value!=='string'||value.length>70||!/^bytes=(\d{1,16}-\d{0,16}|-\d{1,16})$/.test(value))throw Error('Unsupported range');
 const [start,end]=value.slice(6).split('-');
 if([start,end].some(n=>n&&!Number.isSafeInteger(Number(n)))||(start&&end&&Number(end)<Number(start))||(!start&&Number(end)===0))throw Error('Unsupported range');
 return value;
}
// Stream rather than buffer entire videos. The browser can seek using a single
// byte range; redirects are revalidated and receive no app/provider credentials.
export async function openCdnVideo(value,{range,method='GET',signal,request=httpsRequest,lookup=imageLookup()}={}){
 const abort=signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
 range=videoRange(range);
 async function open(value,redirects=0){
  const target=mediaImageUrl(value);if(!target)throw mediaError('unsupported_source');
  abort.throwIfAborted();
  const response=await new Promise((resolve,reject)=>{
   const req=request(target,{method,lookup,signal:abort,headers:{Accept:'video/mp4,video/webm','User-Agent':'ARPRA-Media-Viewer/1.0',...(range?{Range:range}:{})}},resolve);
   req.on('error',reject);req.end();
  });
  response.on('error',()=>{});
  if([301,302,303,307,308].includes(response.statusCode)){
   const location=response.headers.location;response.destroy();
   if(!location||redirects>=3)throw mediaError('redirect');
   return open(new URL(location,target).href,redirects+1);
  }
  const type=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  const length=Number(response.headers['content-length']);
  if(![200,206,416].includes(response.statusCode)){response.destroy();throw upstreamMediaError(response.statusCode)}
  if(response.statusCode!==416&&!['video/mp4','video/webm'].includes(type)||Number.isFinite(length)&&length>MAX_BYTES){response.destroy();throw mediaError(!['video/mp4','video/webm'].includes(type)?'unsupported_type':'oversized')}
  const contentRange=response.headers['content-range'];
  if(response.statusCode===206&&(!range||!/^bytes \d+-\d+\/(\d+|\*)$/.test(contentRange||''))){response.destroy();throw Error('Invalid partial video')}
  const headers={'Content-Type':type||'video/mp4','Accept-Ranges':'bytes'};
  if(response.statusCode===416)headers['Content-Length']='0';
  else if(Number.isSafeInteger(length)&&length>=0)headers['Content-Length']=String(length);
  if(contentRange&&/^bytes (\d+-\d+|\*)\/(\d+|\*)$/.test(contentRange))headers['Content-Range']=contentRange;
  return {status:response.statusCode,headers,stream:response};
 }
 return open(value);
}
export function registerVideoRoutes(app,{db,manager,openVideo=openCdnVideo,cache}){
 const take=mediaQueue(4,64);
 app.get('/api/workspaces/:workspaceId/:collection/:itemId/video/:index',(req,res,next)=>{
  if(!['items'].includes(req.params.collection)||!/^\d{1,4}$/.test(req.params.index))return res.status(404).end();
  req.headers['x-workspace-id']=req.params.workspaceId;manager.middleware(req,res,next);
 },async(req,res)=>{
  const row=db.prepare('SELECT data FROM items WHERE id=?').get(req.params.itemId);
  if(!row)return mediaFailure(req,res,mediaError('missing'),404);
  const item=JSON.parse(row.data),entry=item.media?.[Number(req.params.index)];
  const target=entry?.type==='video'&&mediaImageUrl(entry.url);if(!target)return mediaFailure(req,res,mediaError('unsupported_source'),404);
  let range;try{range=req.query.check==='1'?'bytes=0-1023':videoRange(req.headers.range)}catch{return res.status(416).end()}
  let release;const controller=new AbortController(),closed=()=>controller.abort();res.on('close',closed);let source;
  try{
   release=await take(controller.signal);
   if(!manager.canAccess(req))return res.status(404).end();
   source=await cache?.getVideo(req.workspaceId,`${req.params.collection}:${req.params.itemId}`,'video-'+req.params.index,target,{range,method:req.method});const cached=!!source;
   source ||= await openVideo(target,{range,method:req.method==='HEAD'?'HEAD':'GET',signal:controller.signal});
   if(req.query.check!=='1'&&req.method==='GET'&&source.status<300&&cache)cache.retainVideo(req.workspaceId,`${req.params.collection}:${req.params.itemId}`,target,openVideo,()=>manager.canMaintain(req)).catch(()=>{});
   if(res.destroyed)return;
   if(!manager.canAccess(req))return res.status(404).end();
   if(req.query.check==='1'){
    if(source.status===416)throw mediaError('invalid_media');
    let received=false;
    // Verify bytes arrive, not only headers. Closing this small range probe
    // does not retain the movie, even if the host ignores Range.
    for await(const chunk of source.stream){if(chunk.length){received=true;break}}
    if(!received)throw mediaError('invalid_media');
    if(!manager.canAccess(req))return res.status(404).end();
    return res.json(mediaReport(null,{source:cached?'private copy':'media host',type:source.headers['Content-Type'],upstreamStatus:source.status}));
   }
   res.status(source.status).set({...source.headers,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
   if(req.method==='HEAD'||source.status===416)return res.end();
   let size=0;const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>MAX_BYTES||!manager.canAccess(req))callback(Error('Media stream unavailable'));else callback(null,chunk)}});
   await pipeline(source.stream,limit,res,{signal:controller.signal});
  }catch(error){if(!res.destroyed){if(res.headersSent)res.destroy();else mediaFailure(req,res,error)}}
  finally{source?.stream?.destroy();release?.();res.off('close',closed)}
 });
}
