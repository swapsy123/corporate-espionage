import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, readdir, rename, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {createWriteStream,lstatSync,rmSync} from 'node:fs';
import {join,resolve,parse} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {imageCandidates, mediaImageUrl} from '../shared/media-images.js';

const MB=1024*1024;
const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const videoTypes=new Set(['video/mp4','video/webm']);
const hash=value=>createHash('sha256').update(value).digest('hex');

// Private files live alongside the durable database, never under the web root.
// Cache keys include workspace, record, media type and asset identity. Known CDN
// signatures can change without replacing the underlying file. Transform parameters
// and paths remain part of the identity, preventing reuse for a different creative.
export function mediaAssetIdentity(value){
 const allowed=mediaImageUrl(value);if(!allowed)return value;
 const u=new URL(allowed);
 const family=['fbcdn.net','cdninstagram.com'].find(host=>u.hostname===host||u.hostname.endsWith('.'+host));
 if(!family)return allowed;
 // Keep image transforms (stp), encoding (efg), asset IDs and unknown parameters.
 // Only known authentication/routing parameters are independent of file content.
 for(const key of ['oh','oe','_nc_ohc','_nc_oc','_nc_gid','_nc_ht','_nc_zt','_nc_cat','_nc_sid','ccb'])u.searchParams.delete(key);
 u.hostname=family;u.searchParams.sort();return u.href;
}
export function createMediaCache({directory,maxWorkspaceBytes=128*MB,maxTotalBytes=384*MB,maxVideoBytes=128*MB}={}){
 if(!directory)return null;
 const writes=new Map(),deleted=new Set();
 function deleteWorkspace(workspace){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(workspace))throw Error('Invalid cache workspace.');
  deleted.add(workspace);
  const root=resolve(directory);let cursor=parse(root).root;
  for(const part of root.slice(cursor.length).split('/').filter(Boolean)){
   cursor=join(cursor,part);let info;try{info=lstatSync(cursor)}catch(e){if(e.code==='ENOENT')return;throw e}
   if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe media cache directory.');
  }
  rmSync(join(root,hash(workspace)),{recursive:true,force:true});
 }
 let pruning=Promise.resolve(),warming=Promise.resolve();
 function paths(workspace,record,slot,url,legacy=false){
  const folder=join(directory,hash(workspace));
  const key=hash(JSON.stringify([record,slot,legacy?url:mediaAssetIdentity(url)]));
  return {folder,key,body:join(folder,key+'.bin'),meta:join(folder,key+'.json')};
 }
 async function entry(workspace,record,slot,url,types){
  const p=paths(workspace,record,slot,url);
  async function read(p){
   try{
    const meta=JSON.parse(await readFile(p.meta,'utf8')),info=await stat(p.body);
    if(!types.has(meta.type)||!Number.isSafeInteger(meta.size)||meta.size<=0||info.size!==meta.size)return null;
    await utimes(p.meta,new Date(),new Date()).catch(()=>{});return {...p,...meta};
   }catch{return null}
  }
  const current=await read(p);if(current)return current;
  // Upgrade existing private copies in place while their current saved URL is
  // available. No provider request or duplicate full video is required.
  const legacy=paths(workspace,record,slot,url,true);
  if(legacy.key===p.key)return null;
  const previous=await read(legacy);if(!previous)return null;
  try{await rename(legacy.body,p.body);await rename(legacy.meta,p.meta)}catch{}
  return await read(p)||await read(legacy);
 }
 async function prune(){
  const rows=[];
  for(const folder of await readdir(directory,{withFileTypes:true}).catch(()=>[])){
   if(!folder.isDirectory()||!/^[a-f0-9]{64}$/.test(folder.name))continue;
   const dir=join(directory,folder.name);
   for(const name of await readdir(dir).catch(()=>[])){
    if(name.endsWith('.tmp')){const file=join(dir,name);try{if(Date.now()-(await stat(file)).mtimeMs>15*60*1000)await rm(file,{force:true})}catch{};continue}
    if(/^[a-f0-9]{64}\.bin$/.test(name)){
     const file=join(dir,name);try{if(Date.now()-(await stat(file)).mtimeMs>15*60*1000&&!await stat(file.replace(/\.bin$/,'.json')).catch(()=>null))await rm(file,{force:true})}catch{}
     continue;
    }
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const meta=join(dir,name),body=join(dir,name.replace('.json','.bin'));
    try{const [m,b]=await Promise.all([stat(meta),stat(body)]);const type=JSON.parse(await readFile(meta,'utf8')).type;rows.push({meta,body,workspace:folder.name,size:b.size,time:m.mtimeMs,video:videoTypes.has(type)})}catch{}
   }
  }
  const totals=new Map();let total=0;
  for(const r of rows){total+=r.size;totals.set(r.workspace,(totals.get(r.workspace)||0)+r.size)}
  for(const r of rows.sort((a,b)=>Number(b.video)-Number(a.video)||a.time-b.time)){
   if(total<=maxTotalBytes&&totals.get(r.workspace)<=maxWorkspaceBytes)continue;
   // Retire videos before images so large movies cannot empty every card preview.
   // Only cache files are evicted; source records and research are untouched.
   await rm(r.meta,{force:true});await rm(r.body,{force:true});
   total-=r.size;totals.set(r.workspace,totals.get(r.workspace)-r.size);
  }
 }
 async function commit(p,temp,type,size,allowed){
  if(!allowed())return;
  const metaTemp=join(p.folder,p.key+'.'+randomUUID()+'.tmp');
  try{
   await writeFile(metaTemp,JSON.stringify({type,size}),{mode:0o600,flag:'wx'});
   if(!allowed())return;
   await rename(temp,p.body);await rename(metaTemp,p.meta);
   pruning=pruning.catch(()=>{}).then(prune);await pruning;return !!await stat(p.meta).catch(()=>null)&&!!await stat(p.body).catch(()=>null);
  }finally{await rm(metaTemp,{force:true}).catch(()=>{})}
 }
 async function put(workspace,record,slot,url,producer,authorize=()=>true){
  const allowed=()=>!deleted.has(workspace)&&authorize();
  if(!mediaImageUrl(url)||!allowed())return false;
  const p=paths(workspace,record,slot,url);
  if(writes.has(p.body))return writes.get(p.body);
  const task=(async()=>{
   const temp=join(p.folder,p.key+'.'+randomUUID()+'.tmp');
   try{
    await mkdir(p.folder,{recursive:true,mode:0o700});
    const {type,size}=await producer(temp);
    if(!size||size>maxWorkspaceBytes||size>maxTotalBytes||!allowed())return false;
    return !!await commit(p,temp,type,size,allowed)&&allowed();
   }catch{return false}
   finally{await rm(temp,{force:true}).catch(()=>{});writes.delete(p.body);if(deleted.has(workspace))deleteWorkspace(workspace)}
  })();
  writes.set(p.body,task);return task;
 }
 async function getImage(workspace,record,slot,url){
  const item=await entry(workspace,record,'image',url,imageTypes);if(!item)return null;
  try{return {type:item.type,body:await readFile(item.body)}}catch{return null}
 }
 async function putImage(workspace,record,slot,url,image,allowed){
  if(!imageTypes.has(image.type)||!Buffer.isBuffer(image.body)||image.body.length>8*MB)return false;
  return put(workspace,record,'image',url,async temp=>{await writeFile(temp,image.body,{mode:0o600,flag:'wx'});return {type:image.type,size:image.body.length}},allowed);
 }
 async function getVideo(workspace,record,slot,url,{range,method='GET'}={}){
  const item=await entry(workspace,record,'video',url,videoTypes);if(!item)return null;
  let handle;
  try{
   handle=await open(item.body,'r');
   let start=0,end=item.size-1;
   if(range){const [a,b]=range.slice(6).split('-');if(a){start=Number(a);if(b)end=Math.min(end,Number(b))}else start=Math.max(0,item.size-Number(b))}
   const headers={'Content-Type':item.type,'Accept-Ranges':'bytes'};
   if(start>=item.size){await handle.close();return {status:416,headers:{...headers,'Content-Length':'0','Content-Range':`bytes */${item.size}`},stream:null}}
   headers['Content-Length']=String(end-start+1);
   if(range)headers['Content-Range']=`bytes ${start}-${end}/${item.size}`;
   const stream=method==='HEAD'?null:handle.createReadStream({start,end,autoClose:true});
   if(method==='HEAD')await handle.close();
   return {status:range?206:200,headers,stream};
  }catch{await handle?.close().catch(()=>{});return null}
 }
 async function putVideo(workspace,record,slot,url,openVideo,allowed){
  if(await entry(workspace,record,'video',url,videoTypes))return true;
  return put(workspace,record,'video',url,async temp=>{
   const source=await openVideo(url,{method:'GET'});
   try{
    const type=source.headers['Content-Type'],expected=Number(source.headers['Content-Length']);
    if(source.status!==200||!videoTypes.has(type)||expected>maxVideoBytes)throw Error('Uncacheable video');
    let size=0;
    const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>maxVideoBytes||!allowed()?Error('Cache download stopped'):null,chunk)}});
    await pipeline(source.stream,limit,createWriteStream(temp,{mode:0o600,flags:'wx'}));
    if(Number.isFinite(expected)&&expected!==size)throw Error('Incomplete video');
    return {type,size};
   }finally{source.stream?.destroy()}
  },allowed);
 }
 async function warmNow(workspace,record,item,{fetchImage,openVideo,allowed=()=>true,imagesOnly=false,videosOnly=false}){
  // Retain files as part of collection or explicit repair. No provider/API requests occur on a cache miss.
  let failed=0;
  for(const candidate of videosOnly?[]:imageCandidates(item)){
   if(!allowed())break;
   const url=mediaImageUrl(candidate.url);if(!url){failed++;continue}
   try{if(!await getImage(workspace,record,candidate.slot,url)&&!await putImage(workspace,record,candidate.slot,url,await fetchImage(url),allowed))failed++}catch{failed++}
  }
  for(const [index,media] of (imagesOnly?[]:item.media||[]).entries()){
   if(!allowed())break;
   if(media.type==='video'&&(!mediaImageUrl(media.url)||!await putVideo(workspace,record,'video-'+index,media.url,openVideo,allowed)))failed++;
  }
  return {failed:allowed()?failed:failed+1};
 }
 function retainVideo(workspace,record,url,openVideo,allowed){const task=warming.catch(()=>{}).then(()=>putVideo(workspace,record,'video',url,openVideo,allowed));warming=task;return task}
 function warm(...args){const task=warming.catch(()=>{}).then(()=>warmNow(...args));warming=task;return task}
 function warmMany(workspace,items,options){
  const task=warming.catch(()=>{}).then(async()=>{
   let failed=0;
   // Save thumbnails/slides for the whole collected page before downloading
   // full movies; a long clip must not delay every other preview until expiry.
   for(const imagesOnly of [true,false]){
    let next=0;
    async function worker(){
     while(next<items.length){
      if(options.allowed&&!options.allowed()){failed++;return}
      const item=items[next++];
      const result=await warmNow(workspace,`items:${item.id}`,item,{...options,imagesOnly,videosOnly:!imagesOnly});failed+=result.failed;
     }
    }
    await Promise.all(Array.from({length:Math.min(items.length,imagesOnly?4:2)},worker));
   }
   return {failed};
  });warming=task;return task;
 }
 return {deleteWorkspace,getImage,putImage,getVideo,retainVideo,warm,warmMany,wait:async()=>{let observed;do{observed=warming;await Promise.all([...writes.values(),pruning,observed])}while(observed!==warming||writes.size)}};
}
