import test from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {videoRange,openCdnVideo} from '../server/media-video.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {imageCandidates,mediaImageUrl} from '../shared/media-images.js';
import {fetchCdnImage,imageLookup} from '../server/media-images.js';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
import {persistProfileItems} from '../server/store.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFQAAAABJRU5ErkJggg==','base64');
const cdn='https://scontent.test.cdninstagram.com/preview.jpg?test=1';
test('Image candidates retain slide identity and limit the server relay to media CDNs',()=>{
 for(const url of [cdn,'https://scontent.test.fbcdn.net/a','https://i.ytimg.com/a'])assert.equal(mediaImageUrl(url),url);
 for(const url of ['http://scontent.test.cdninstagram.com/a','https://cdninstagram.com.evil.test/a','https://user:password@cdninstagram.com/a','https://cdninstagram.com:8443/a','https://localhost/a','https://127.0.0.1/a','https://www.instagram.com/p/test/','file:///tmp/a'])assert.equal(mediaImageUrl(url),null);
 const item={thumbnail:cdn,media:[{type:'video',url:'https://example.test/movie.mp4',thumbnail:cdn},{type:'image',url:'https://scontent.test.fbcdn.net/slide.jpg'}]};
 assert.deepEqual(imageCandidates(item).map(i=>i.slot),['thumbnail','slide-1']);
 assert.deepEqual(imageCandidates(item,'slide-0'),[]);
 assert.equal(imageCandidates(item,'slide-1')[0].url,item.media[1].url);
 assert.deepEqual(imageCandidates(item,'../../a'),[]);
});

test('Image DNS resolution pins public addresses and rejects private, reserved and mixed answers',async()=>{
 async function lookup(addresses,all=true){return new Promise((resolve,reject)=>imageLookup(async()=>addresses)('scontent.test.cdninstagram.com',{all},(error,result,family)=>error?reject(error):resolve({result,family})))}
 const publicResult=[{address:'8.8.8.8',family:4},{address:'2606:4700:4700::1111',family:6}];
 assert.deepEqual((await lookup(publicResult)).result,publicResult);
 assert.deepEqual(await lookup(publicResult,false),{result:'8.8.8.8',family:4});
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])await assert.rejects(lookup([{address,family:address.includes(':')?6:4}]));
 await assert.rejects(lookup([...publicResult,{address:'10.1.1.1',family:4}]));
});

function transport(responses,calls=[]){return (url,options,callback)=>{
 calls.push({url,options});const request=new EventEmitter();
 request.end=()=>queueMicrotask(()=>{
  const next=responses.shift();if(!next)return request.emit('error',Error('Unexpected request'));
  const response=Readable.from(next.chunks||[next.body||png]);response.statusCode=next.status||200;response.headers={'content-type':'image/png',...next.headers};callback(response);
 });return request;
}}
test('Relay validates image bytes, caps downloads and revalidates redirects without forwarding credentials',async()=>{
 const calls=[];const image=await fetchCdnImage(cdn,{request:transport([{}],calls)});
 assert.deepEqual(image,{type:'image/png',body:png});assert.equal(typeof calls[0].options.lookup,'function');assert.equal(calls[0].options.headers.Cookie,undefined);assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.headers.Referer,undefined);
 for(const response of [{status:403},{headers:{'content-type':'text/html'}},{headers:{'content-type':'image/svg+xml'}},{body:Buffer.from('<html>Access denied</html>')},{headers:{'content-length':String(9*1024*1024)}},{chunks:[Buffer.alloc(8*1024*1024),Buffer.alloc(1)]}])await assert.rejects(fetchCdnImage(cdn,{request:transport([response])}));
 const redirected=[];
 await assert.rejects(fetchCdnImage(cdn,{request:transport([{status:302,headers:{location:'https://127.0.0.1/private'}}],redirected)}));assert.equal(redirected.length,1);
 const success=await fetchCdnImage(cdn,{request:transport([{status:302,headers:{location:'https://scontent.test.fbcdn.net/new.png'}},{}])});assert.deepEqual(success.body,png);
 await assert.rejects(fetchCdnImage(cdn,{request:transport(Array.from({length:4},()=>({status:302,headers:{location:cdn}})))}));
});

async function fixture(t,options={}){
 const db=openDatabase(':memory:'),password=randomBytes(24).toString('hex'),state={calls:[],fail:false,gate:null,mediaCalls:[],mediaFail:false,mediaFailures:new Set(),mediaGate:null,keys:new Map(),videoCalls:[],videoGate:null};
 const app=createApp({mediaCacheDirectory:options.mediaCacheDirectory,db,seed:false,password,production:false,vault:{get:workspace=>workspace==='levr'?'owner-test-key':state.keys.get(workspace),status:workspace=>({configured:workspace==='levr'||state.keys.has(workspace)})},refreshMedia:async(item,{apiKey})=>{state.mediaCalls.push({item,apiKey});if(state.mediaGate)await state.mediaGate;if(state.mediaFail||state.mediaFailures.has(item.externalId))throw Object.assign(Error('Private upstream detail'),{safeMessage:'Instagram media is unavailable. Existing media was preserved.'});return {thumbnail:'https://scontent.test.cdninstagram.com/fresh.jpg',media:[{type:'image',url:'https://scontent.test.cdninstagram.com/fresh.jpg'}]}},openVideo:async(target,options)=>{state.videoCalls.push({target,...options});if(state.videoFail)throw Error('Upstream expired');if(state.videoGate)await state.videoGate;return {status:options.range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':'3',...(options.range?{'Content-Range':'bytes 2-4/10'}:{})},stream:Readable.from([Buffer.from('abc')])}},collector:async()=>({items:[{externalId:'client-post',kind:'organic',format:'instagram_image',thumbnail:cdn,media:[{type:'image',url:cdn}]}],complete:true}),fetchImage:async(target)=>{state.calls.push(target);if(state.gate)await state.gate;if(state.fail)throw state.imageError||Error('Private remote URL must not leak');return {type:'image/png',body:png}}});
 db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('fixture','Media fixture');
 db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run('profile','fixture','instagram','fixture');
 persistProfileItems(db,{id:'profile',competitorId:'fixture',platform:'instagram'},[{externalId:'post',kind:'organic',format:'instagram_carousel',thumbnail:cdn,media:[{type:'image',url:'https://scontent.test.fbcdn.net/slide.png'},{type:'video',url:'https://scontent.test.fbcdn.net/video.mp4'}],title:'Preserved caption',sourceUrl:'https://www.instagram.com/p/fixture/'}],true);
 const item=db.prepare('SELECT id,data FROM items').get();
 const server=app.app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 async function actor(path,body){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,path==='/auth/signup'?201:200);return {cookie:response.headers.getSetCookie().find(c=>c.startsWith('levr_session=')).split(';')[0],session:await response.json()}}
 const owner=await actor('/auth/login',{email:'fraser@wearelevr.com',password});
 async function create(path,body){const r=await fetch(base+path,{method:'POST',headers:{Cookie:owner.cookie,'X-CSRF-Token':owner.session.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok);return r.json()}
 const workspace=await create('/api/workspaces',{name:'Media client'});
 const invite=await create(`/api/workspaces/${workspace.id}/invites`,{email:'media@example.test'});
 const client=await actor('/auth/accept-invite',{email:'media@example.test',password,token:invite.token});
 const imagePath=`/api/workspaces/levr/items/${item.id}/image/thumbnail`;
 t.after(async()=>{await app.waitForRefresh();await new Promise(resolve=>server.close(resolve));app.closeWorkspaceDatabases();db.close()});
 return {db,state,app,item,base,owner,client,imagePath,get:(path=imagePath,cookie=owner.cookie)=>fetch(base+path,{headers:cookie?{Cookie:cookie}:{}})};
}
test('Images require workspace access, use stored URLs only and preserve research on failure',async t=>{
 const f=await fixture(t);
 assert.equal((await f.get(f.imagePath,'')).status,401);
 assert.equal((await f.get(f.imagePath,f.client.cookie)).status,404);assert.equal(f.state.calls.length,0);
 const response=await f.get();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);assert.equal(f.state.calls.at(-1),cdn);
 await f.get(f.imagePath+'?url=https://127.0.0.1/private');assert.equal(f.state.calls.at(-1),cdn);
 assert.equal((await f.get(f.imagePath.replace('thumbnail','slide-0'))).status,200);
 const count=f.state.calls.length;
 for(const slot of ['slide-1','slide-99','bad-slot'])assert.equal((await f.get(f.imagePath.replace('thumbnail',slot))).status,404);
 assert.equal(f.state.calls.length,count);
 assert.equal((await f.get(f.imagePath.replace('levr',f.client.session.defaultWorkspaceId))).status,404);
 f.state.fail=true;const failed=await f.get();assert.equal(failed.status,502);assert.equal(await failed.text(),'');assert.equal(f.db.prepare('SELECT data FROM items WHERE id=?').get(f.item.id).data,f.item.data);
});
test('Revoking an initiating session prevents an in-flight image response from being delivered',async t=>{
 const f=await fixture(t);let release;f.state.gate=new Promise(resolve=>{release=resolve});
 const request=f.get();while(!f.state.calls.length)await new Promise(resolve=>setTimeout(resolve,5));
 f.db.prepare('DELETE FROM sessions').run();release();assert.equal((await request).status,404);
});
test('Client images resolve within their explicit workspace and are denied after membership revocation',async t=>{
 const f=await fixture(t),workspace=f.client.session.defaultWorkspaceId;
 async function request(path,method='GET',body){const response=await fetch(f.base+path,{method,headers:{Cookie:f.client.cookie,'X-CSRF-Token':f.client.session.csrf,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(response.ok);return response.json()}
 const competitor=await request('/api/competitors','POST',{name:'Client image competitor'});
 const profile=await request(`/api/competitors/${competitor.id}/profiles`,'POST',{platform:'instagram',identifier:'fixture'});
 await request(`/api/profiles/${profile.id}`,'PATCH',{confirmed:true});
 await request('/api/refresh','POST',{competitorId:competitor.id});await f.app.waitForRefresh();
 const [item]=await request('/api/items');const path=`/api/workspaces/${workspace}/items/${item.id}/image/thumbnail`;
 assert.equal((await f.get(path,f.client.cookie)).status,200);
 assert.equal((await f.get(path,f.owner.cookie)).status,200,'owner can manage the same client media');
 assert.equal((await f.get(path.replace(workspace,'levr'),f.owner.cookie)).status,404,'foreign item IDs cannot use the owner database');
 const renew=()=>fetch(f.base+`/api/items/${item.id}/media-refresh`,{method:'POST',headers:{Cookie:f.client.cookie,'X-CSRF-Token':f.client.session.csrf,'Content-Type':'application/json'},body:'{}'});
 assert.equal((await renew()).status,503,'client cannot use the owner provider key');assert.equal(f.state.mediaCalls.length,0);
 f.state.keys.set(workspace,'client-test-key');assert.equal((await renew()).status,200);assert.equal(f.state.mediaCalls[0].apiKey,'client-test-key');
 f.db.prepare('DELETE FROM memberships WHERE workspace_id=?').run(workspace);
 const count=f.state.calls.length;assert.equal((await f.get(path,f.client.cookie)).status,401);assert.equal(f.state.calls.length,count);
});

test('Manual media renewal is authenticated, preserves research and records failures without losing old links',async t=>{
 const f=await fixture(t),path=`/api/items/${f.item.id}/media-refresh`;
 const post=(actor=f.owner,csrf=actor.session.csrf)=>fetch(f.base+path,{method:'POST',headers:{Cookie:actor.cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'});
 assert.equal((await post(f.owner,'wrong')).status,403);assert.equal(f.state.mediaCalls.length,0);
 assert.equal((await post(f.client)).status,404);assert.equal(f.state.mediaCalls.length,0);
 const response=await post();assert.equal(response.status,200);const updated=await response.json();assert.match(updated.thumbnail,/fresh/);assert.equal(f.state.mediaCalls[0].apiKey,'owner-test-key');
 const previous=JSON.parse(f.item.data),current=JSON.parse(f.db.prepare('SELECT data FROM items WHERE id=?').get(f.item.id).data);
 for(const key of Object.keys(previous).filter(key=>!['media','thumbnail'].includes(key)))assert.deepEqual(current[key],previous[key],key);
 assert.ok(current.mediaRefreshedAt);assert.equal(f.db.prepare('SELECT status FROM refreshes').get().status,'success');
 f.state.mediaFail=true;const failed=await post();assert.equal(failed.status,502);assert.doesNotMatch(JSON.stringify(await failed.json()),/Private upstream|owner-test-key/);
 const preserved=JSON.parse(f.db.prepare('SELECT data FROM items WHERE id=?').get(f.item.id).data);assert.deepEqual(preserved.media,current.media);assert.equal(preserved.thumbnail,current.thumbnail);assert.equal(preserved.caption,previous.caption);assert.match(preserved.mediaRefreshError,/preserved/);
 assert.equal(f.db.prepare("SELECT count(*) n FROM refreshes WHERE status='failed'").get().n,1);
});
test('Media refresh rejects duplicates and discards responses after session revocation',async t=>{
 const f=await fixture(t);let release;f.state.mediaGate=new Promise(resolve=>{release=resolve});
 const post=()=>fetch(f.base+`/api/items/${f.item.id}/media-refresh`,{method:'POST',headers:{Cookie:f.owner.cookie,'X-CSRF-Token':f.owner.session.csrf,'Content-Type':'application/json'},body:'{}'});
 const first=post();while(!f.state.mediaCalls.length)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await post()).status,409);assert.equal(f.state.mediaCalls.length,1);
 f.db.prepare('DELETE FROM sessions').run();release();assert.equal((await first).status,404);assert.equal(f.db.prepare('SELECT data FROM items WHERE id=?').get(f.item.id).data,f.item.data);
 assert.equal(f.db.prepare('SELECT status FROM refreshes').get().status,'failed','revoked requests do not leave a permanent running history entry');
});

test('Video streams use stored URLs, authenticate workspace access and support ranges and HEAD',async t=>{
 const f=await fixture(t),path=f.imagePath.replace('/image/thumbnail','/video/1');
 assert.equal((await f.get(path,'')).status,401);
 assert.equal((await f.get(path,f.client.cookie)).status,404);assert.equal(f.state.videoCalls.length,0);
 const get=(headers={},method='GET')=>fetch(f.base+path,{method,headers:{Cookie:f.owner.cookie,...headers}});
 const partial=await get({Range:'bytes=2-4'});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 2-4/10');assert.equal(partial.headers.get('cache-control'),'private, no-store');assert.equal(await partial.text(),'abc');
 assert.equal(f.state.videoCalls[0].range,'bytes=2-4');assert.match(f.state.videoCalls[0].target,/fbcdn.net\/video.mp4$/);
 const head=await get({},'HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(f.state.videoCalls.at(-1).method,'HEAD');
 const count=f.state.videoCalls.length;assert.equal((await get({Range:'bytes=0-1,4-5'})).status,416);assert.equal(f.state.videoCalls.length,count);
 assert.equal((await f.get(path.replace('/video/1','/video/0'))).status,404);
 let release;f.state.videoGate=new Promise(r=>release=r);const pending=get();while(f.state.videoCalls.length===count)await new Promise(r=>setTimeout(r,5));f.db.prepare('DELETE FROM sessions').run();release();assert.equal((await pending).status,404);
});
test('Video transport bounds ranges, validates responses and rejects unsafe redirects',async()=>{
 for(const range of ['bytes=0-','bytes=0-15','bytes=-32'])assert.equal(videoRange(range),range);
 for(const range of ['bytes=-0','bytes=8-1','bytes=0-1,4-5','bytes=9999999999999999-','items=1-2','bad'])assert.throws(()=>videoRange(range));
 const calls=[],result=await openCdnVideo(cdn,{range:'bytes=2-4',request:transport([{status:206,headers:{'content-type':'video/mp4','content-length':'3','content-range':'bytes 2-4/10'},body:Buffer.from('abc')}],calls)});
 assert.equal(result.status,206);assert.equal(result.headers['Content-Range'],'bytes 2-4/10');result.stream.destroy();
 assert.equal(calls[0].options.headers.Range,'bytes=2-4');for(const key of ['Cookie','Authorization','Referer'])assert.equal(calls[0].options.headers[key],undefined);
 for(const response of [{status:403},{headers:{'content-type':'text/html'}},{headers:{'content-type':'video/mp4','content-length':String(300*1024*1024)}},{status:206,headers:{'content-type':'video/mp4','content-range':'bad'}},{status:302,headers:{location:'https://127.0.0.1/private'}}])await assert.rejects(openCdnVideo(cdn,{range:'bytes=0-',request:transport([response])}));
 const unsatisfied=await openCdnVideo(cdn,{range:'bytes=99-',request:transport([{status:416,headers:{'content-length':'123','content-range':'bytes */10'}}])});assert.equal(unsatisfied.headers['Content-Length'],'0');assert.equal(unsatisfied.headers['Content-Range'],'bytes */10');unsatisfied.stream.destroy();
});

test('A grid with more than eight images waits for available capacity instead of losing previews',async t=>{
 const f=await fixture(t);let release;f.state.gate=new Promise(r=>release=r);
 const requests=Array.from({length:12},()=>f.get());
 while(f.state.calls.length<8)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.state.calls.length,8);release();
 assert.deepEqual((await Promise.all(requests)).map(r=>r.status),Array(12).fill(200));assert.equal(f.state.calls.length,12);
});

test('Saved images and complete videos remain private and playable after the CDN stops working',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'arpra-cache-api-')),f=await fixture(t,{mediaCacheDirectory:directory});
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 assert.equal((await f.get()).status,200);f.state.fail=true;assert.equal((await f.get()).status,200);assert.equal(f.state.calls.length,1,'cached image does not depend on upstream');
 assert.equal((await f.get(f.imagePath,f.client.cookie)).status,404,'cache hits still require workspace membership');
 const path=f.imagePath.replace('/image/thumbnail','/video/1');
 const first=await f.get(path);assert.equal(first.status,200);assert.equal(await first.text(),'abc');await f.app.waitForRefresh();
 const calls=f.state.videoCalls.length;f.state.videoFail=true;
 const cached=await fetch(f.base+path,{headers:{Cookie:f.owner.cookie,Range:'bytes=1-2'}});assert.equal(cached.status,206);assert.equal(cached.headers.get('content-range'),'bytes 1-2/3');assert.equal(await cached.text(),'bc');await f.app.waitForRefresh();assert.equal(f.state.videoCalls.length,calls);
 const head=await fetch(f.base+path,{method:'HEAD',headers:{Cookie:f.owner.cookie}});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'3');assert.equal(await head.text(),'');
 assert.equal((await f.get(path,f.client.cookie)).status,404);
 const changed={...JSON.parse(f.item.data),thumbnail:'https://scontent.test.fbcdn.net/different.jpg'};f.db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify(changed),f.item.id);assert.equal((await f.get()).status,502,'a new source URL must not receive a stale cached picture');
 f.db.prepare('DELETE FROM sessions').run();assert.equal((await f.get(path)).status,401);
});

test('Manual batch repair is scoped, bounded, deduplicated and preserves failed posts',async t=>{
 const f=await fixture(t);
 persistProfileItems(f.db,{id:'profile',competitorId:'fixture',platform:'instagram'},['second','third'].map(externalId=>({externalId,kind:'organic',format:'instagram_image',title:externalId,thumbnail:cdn,media:[{type:'image',url:cdn}],caption:'Retain me'})),true);
 const rows=f.db.prepare('SELECT id,external_id,data FROM items ORDER BY external_id').all(),ids=rows.map(r=>r.id);
 const post=(body,actor=f.owner,csrf=actor.session.csrf)=>fetch(f.base+'/api/media-repair',{method:'POST',headers:{Cookie:actor.cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({itemIds:ids},f.client)).status,404);assert.equal((await post({itemIds:ids},f.owner,'bad')).status,403);assert.equal((await post({itemIds:Array(51).fill(ids[0])})).status,400);assert.equal(f.state.mediaCalls.length,0);
 let release;f.state.mediaGate=new Promise(r=>release=r);f.state.mediaFailures.add('second');
 const started=await post({itemIds:[...ids,ids[0]]});assert.equal(started.status,202);assert.equal((await started.json()).total,3);
 assert.equal((await post({itemIds:ids})).status,409);
 const pending=await f.get('/api/media-repair');assert.equal((await pending.json()).running,true);release();await f.app.waitForRefresh();
 const status=await (await f.get('/api/media-repair')).json();assert.equal(status.running,false);assert.equal(status.completed,3);assert.equal(status.repaired,2);assert.equal(status.errors.length,1);assert.equal(f.state.mediaCalls.length,3);
 const failed=rows.find(r=>r.external_id==='second'),preserved=JSON.parse(f.db.prepare('SELECT data FROM items WHERE id=?').get(failed.id).data);assert.deepEqual(preserved.media,JSON.parse(failed.data).media);assert.equal(preserved.caption,'Retain me');
 assert.equal((await (await f.get('/api/media-repair',f.client.cookie)).json()).total,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM refreshes WHERE status='failed'").get().n,1);
});

test('Media checks identify provider denial without exposing signed links, credentials or upstream bodies',async t=>{
 const f=await fixture(t),path=f.imagePath+'?check=1';
 assert.equal((await f.get(path,'')).status,401);
 assert.equal((await f.get(path,f.client.cookie)).status,404);assert.equal(f.state.calls.length,0);
 const response=await f.get(path),result=await response.json();
 assert.equal(result.ok,true);assert.equal(result.version,'media-check-1');assert.equal(result.type,'image/png');
 assert.equal(f.state.mediaCalls.length,0,'checking saved files uses no provider credits');
 f.state.fail=true;f.state.imageError=Object.assign(Error('Secret signed URL https://cdn.test/token?secret=private'),{mediaCode:'upstream_denied',upstreamStatus:403});
 const failed=await f.get(path),detail=await failed.json();
 assert.equal(failed.status,502);assert.equal(detail.code,'upstream_denied');assert.equal(detail.upstreamStatus,403);
 assert.doesNotMatch(JSON.stringify(detail),/secret|private|https:|cdninstagram|owner-test-key/i);
 const video=await f.get(f.imagePath.replace('/image/thumbnail','/video/1')+'?check=1');
 assert.equal((await video.json()).ok,true);assert.equal(f.state.videoCalls.at(-1).range,'bytes=0-1023');
 assert.equal(f.state.mediaCalls.length,0);
});
test('Real image and video transport errors retain safe reasons for the check',async()=>{
 for(const [status,code]of [[403,'upstream_denied'],[404,'upstream_missing'],[429,'upstream_busy'],[503,'upstream_busy']]){
  for(const load of [fetchCdnImage,openCdnVideo])await assert.rejects(load(cdn,{request:transport([{status}])}),error=>error.mediaCode===code&&error.upstreamStatus===status);
 }
 for(const load of [fetchCdnImage,openCdnVideo])await assert.rejects(load(cdn,{request:transport([{headers:{'content-type':'text/html'}}])}),error=>error.mediaCode==='unsupported_type');
});

test('Paid ad single and batch repairs use the workspace provider, preserve research and reject foreign IDs',async t=>{
 const f=await fixture(t);f.db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run('meta','fixture','meta','123');
 persistProfileItems(f.db,{id:'meta',competitorId:'fixture',platform:'meta'},['901','902'].map(externalId=>({externalId,kind:'paid',format:'ad_video',active:true,startDate:'2026-09-01T00:00:00Z',caption:'Keep original ad copy',transcript:'Keep original transcript',media:[{type:'video',url:'https://scontent.test.fbcdn.net/old.mp4'}]})),true);
 const [one,two]=f.db.prepare("SELECT * FROM items WHERE platform='meta' ORDER BY external_id").all();
 const post=(path,body,actor=f.owner)=>fetch(f.base+path,{method:'POST',headers:{Cookie:actor.cookie,'X-CSRF-Token':actor.session.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post(`/api/items/${one.id}/media-refresh`,{},f.client)).status,404);assert.equal(f.state.mediaCalls.length,0);
 const response=await post(`/api/items/${one.id}/media-refresh`,{});assert.equal(response.status,200);
 assert.equal(f.state.mediaCalls[0].item.platform,'meta');assert.equal(f.state.mediaCalls[0].item.externalId,'901');assert.equal(f.state.mediaCalls[0].apiKey,'owner-test-key');
 const original=JSON.parse(one.data),current=JSON.parse(f.db.prepare('SELECT data FROM items WHERE id=?').get(one.id).data);
 for(const key of ['active','startDate','caption','transcript'])assert.equal(current[key],original[key]);
 assert.equal(f.db.prepare('SELECT first_seen,last_seen FROM items WHERE id=?').get(one.id).first_seen,one.first_seen);
 f.state.mediaFailures.add('902');
 assert.equal((await post('/api/media-repair',{itemIds:[one.id,two.id]})).status,202);await f.app.waitForRefresh();
 const batch=await (await f.get('/api/media-repair')).json();assert.equal(batch.repaired,1);assert.equal(batch.errors.length,1);
 const failed=JSON.parse(f.db.prepare('SELECT data FROM items WHERE id=?').get(two.id).data);assert.deepEqual(failed.media,JSON.parse(two.data).media);assert.equal(failed.caption,'Keep original ad copy');
 assert.ok(f.db.prepare('SELECT warnings FROM refreshes').all().some(row=>row.warnings.includes('Meta ad media refresh')));
});
