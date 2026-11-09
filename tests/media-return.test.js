import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFQAAAABJRU5ErkJggg==','base64'),video=Buffer.from('complete-video-fixture');

test('Normal refresh retains files before they are viewed, finishes after sign-out and survives service restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'media-return-')),password=randomBytes(24).toString('hex');
 let api,db,server,base,cookie,csrf,cdnUp=true,signature='one',providerCalls=0,imageCalls=0,videoCalls=0,repairs=0,started,release;
 const opened=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const source=file=>`https://scontent.${signature}.fbcdn.net/${file}?oh=${signature}&oe=123`;
 const options={seed:false,password,production:false,providerKey:'fixture-only',refreshMedia:async()=>{repairs++;throw Error('Repair should not be needed')},
 collector:async profile=>{providerCalls++;return {complete:true,items:[{externalId:'123',kind:'paid',format:'ad_video',thumbnail:source('cover.png'),media:[{type:'video',url:source('movie.mp4'),thumbnail:source('cover.png')}],active:true}]}},
 fetchImage:async()=>{imageCalls++;if(!cdnUp)throw Error('Expired source');return {type:'image/png',body:png}},
 openVideo:async()=>{videoCalls++;started();await gate;if(!cdnUp)throw Error('Expired source');return {status:200,headers:{'Content-Type':'video/mp4','Content-Length':String(video.length)},stream:Readable.from([video])}}
 };
 async function boot(){db=openDatabase(join(dir,'catalog.sqlite'));api=createApp({...options,db});server=api.app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`}
 async function stop(){await api.waitForRefresh();await new Promise(r=>server.close(r));api.closeWorkspaceDatabases();db.close();server=null}
 async function request(path,method='GET',body){return fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)})}
 async function login(){const r=await request('/auth/login','POST',{email:'fraser@wearelevr.com',password});assert.equal(r.status,200);cookie=r.headers.getSetCookie().find(c=>c.includes('_session=')).split(';')[0];csrf=(await r.json()).csrf}
 t.after(async()=>{release();if(server)await stop();await rm(dir,{recursive:true,force:true})});
 await boot();await login();
 const c=await (await request('/api/competitors','POST',{name:'Return visit fixture'})).json();
 const p=await (await request(`/api/competitors/${c.id}/profiles`,'POST',{platform:'meta',identifier:'123'})).json();await request(`/api/profiles/${p.id}`,'PATCH',{confirmed:true});
 assert.equal((await request('/api/refresh','POST',{competitorId:c.id})).status,202);await opened;
 assert.equal((await request('/auth/logout','POST',{})).status,200);cookie=null;csrf=null;release();await api.waitForRefresh();
 const item=db.prepare('SELECT id FROM items').get();assert.equal(imageCalls,1);assert.equal(videoCalls,1);assert.equal(providerCalls,1);
 await stop();cdnUp=false;await boot();await login();
 const path=`/api/workspaces/levr/items/${item.id}`;
 assert.deepEqual(Buffer.from(await (await request(path+'/image/thumbnail')).arrayBuffer()),png);
 assert.deepEqual(Buffer.from(await (await request(path+'/video/0')).arrayBuffer()),video);
 // A later normal collection can rotate CDN signatures without losing the saved copy.
 signature='two';assert.equal((await request('/api/refresh','POST',{competitorId:c.id})).status,202);await api.waitForRefresh();
 assert.deepEqual(Buffer.from(await (await request(path+'/video/0')).arrayBuffer()),video);
 assert.equal(imageCalls,1);assert.equal(videoCalls,1);assert.equal(providerCalls,2);assert.equal(repairs,0);
 assert.ok(db.prepare('SELECT warnings FROM refreshes').all().every(row=>!row.warnings.includes('could not be retained')));
});
