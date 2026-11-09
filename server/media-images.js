import {mediaError,mediaFailure,mediaReport,upstreamMediaError} from './media-diagnostics.js';
import {request as httpsRequest} from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {mediaImageUrl,imageCandidates} from '../shared/media-images.js';
import {mediaQueue} from './media-queue.js';

const MAX_BYTES=8*1024*1024;
const types=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const blocked4=new BlockList(),blocked6=new BlockList();
for(const [network,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked4.addSubnet(network,prefix,'ipv4');
for(const [network,prefix]of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',23],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]])blocked6.addSubnet(network,prefix,'ipv6');
const publicAddress=address=>isIP(address)===4?!blocked4.check(address,'ipv4'):isIP(address)===6&&!blocked6.check(address,'ipv6');

export function imageLookup(resolve=dnsLookup) {
 return (hostname,options,callback)=>{
  resolve(hostname,{all:true,verbatim:true}).then(addresses=>{
   if(!addresses.length||addresses.some(({address})=>!publicAddress(address)))throw Error('Image address unavailable.');
   // HTTPS uses the checked addresses directly, including on redirected requests.
   if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
  }).catch(()=>callback(mediaError('dns')));
 };
}
function matchesImage(type,body){
 if(type==='image/jpeg')return body[0]===255&&body[1]===216&&body[2]===255;
 if(type==='image/png')return body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(type==='image/gif')return /^GIF8[79]a$/.test(body.subarray(0,6).toString());
 if(type==='image/webp')return body.subarray(0,4).toString()==='RIFF'&&body.subarray(8,12).toString()==='WEBP';
 return body.subarray(4,8).toString()==='ftyp'&&/avif|avis/.test(body.subarray(8,32).toString());
}
export async function fetchCdnImage(value,{signal,request=httpsRequest,lookup=imageLookup()}={}) {
 const timeout=AbortSignal.timeout(15000),abort=signal?AbortSignal.any([signal,timeout]):timeout;
 async function read(value,redirects=0){
  abort.throwIfAborted();
  const target=mediaImageUrl(value);if(!target)throw mediaError('unsupported_source');
  const result=await new Promise((resolve,reject)=>{
   const req=request(target,{method:'GET',lookup,signal:abort,headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,image/gif','User-Agent':'Levr-Image-Viewer/1.0'}},response=>{
    response.on('error',reject);
    if([301,302,303,307,308].includes(response.statusCode)){
     const location=response.headers.location;response.destroy();
     try{if(!location||redirects>=3)throw Error();resolve({redirect:new URL(location,target).href})}catch{reject(mediaError('redirect'))}return;
    }
    const type=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(response.statusCode!==200){response.destroy();reject(upstreamMediaError(response.statusCode));return}
    if(!types.has(type)||Number(response.headers['content-length'])>MAX_BYTES){response.destroy();reject(mediaError(!types.has(type)?'unsupported_type':'oversized'));return}
    let size=0;const chunks=[];
    response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy();reject(mediaError('oversized'))}else chunks.push(Buffer.from(chunk))});
    response.on('end',()=>{const body=Buffer.concat(chunks);if(!body.length||!matchesImage(type,body))reject(mediaError('invalid_media'));else resolve({type,body})});
    response.on('aborted',()=>reject(Error('Image interrupted.')));
   });
   req.on('error',reject);req.end();
  });
  return result.redirect?read(result.redirect,redirects+1):result;
 }
 return read(value);
}

export function registerImageRoutes(app,{db,manager,fetchImage=fetchCdnImage,cache}){
 const take=mediaQueue();
 app.get('/api/workspaces/:workspaceId/:collection/:itemId/image/:slot',(req,res,next)=>{
  if(!['items'].includes(req.params.collection))return res.status(404).end();
  // An <img> cannot set X-Workspace-Id. Apply the same membership guard using
  // the explicit workspace in its URL; never fall back to the owner's library.
  req.headers['x-workspace-id']=req.params.workspaceId;
  manager.middleware(req,res,next);
 },async(req,res)=>{
  const row=db.prepare('SELECT data FROM items WHERE id=?').get(req.params.itemId);
  if(!row)return mediaFailure(req,res,mediaError('missing'),404);
  const item=JSON.parse(row.data),candidate=imageCandidates(item,req.params.slot)[0];
  const target=mediaImageUrl(candidate?.url);
  if(!target)return mediaFailure(req,res,mediaError('unsupported_source'),404);
  // Bound concurrent buffering, do not retain images in a shared public cache.
  const controller=new AbortController();let release;const disconnected=()=>controller.abort();res.on('close',disconnected);
  try{
   const cacheKey=`${req.params.collection}:${req.params.itemId}`;
   let image=await cache?.getImage(req.workspaceId,cacheKey,req.params.slot,target);const cached=!!image;
   if(!image){release=await take(controller.signal);if(!manager.canAccess(req))return res.status(404).end();image=await fetchImage(target,{signal:controller.signal});await cache?.putImage(req.workspaceId,cacheKey,req.params.slot,target,image,()=>manager.canAccess(req))}
   if(res.destroyed)return;
   if(!manager.canAccess(req))return res.status(404).end();
   if(req.query.check==='1')return res.json(mediaReport(null,{source:cached?'private copy':'media host',type:image.type,bytes:image.body.length}));
   res.set({'Content-Type':image.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
   res.send(image.body);
  }catch(error){if(!res.destroyed)mediaFailure(req,res,error)}
  finally{release?.();res.off('close',disconnected)}
 });
}
