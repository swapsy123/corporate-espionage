import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {createMediaCache} from '../server/media-cache.js';
import {mediaQueue} from '../server/media-queue.js';
const cdn='https://scontent.test.fbcdn.net/media';
const image={type:'image/png',body:Buffer.from('test-image')};

test('Private cache survives restart, shares identical image slots and isolates records and workspaces',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'arpra-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=createMediaCache({directory});
 assert.equal(await cache.putImage('client-a','items:one','thumbnail',cdn,image,()=>true),true);
 const restarted=createMediaCache({directory});
 assert.deepEqual(await restarted.getImage('client-a','items:one','slide-0',cdn),image);
 assert.equal(await restarted.getImage('client-b','items:one','thumbnail',cdn),null);
 assert.equal(await restarted.getImage('client-a','items:two','thumbnail',cdn),null);
 assert.equal(await restarted.getImage('client-a','items:one','thumbnail',cdn+'new'),null);
 const [folder]=await readdir(directory);assert.equal((await stat(join(directory,folder))).mode&0o777,0o700);
 for(const file of await readdir(join(directory,folder)))assert.equal((await stat(join(directory,folder,file))).mode&0o777,0o600);
});

test('Video cache serves byte ranges and refuses incomplete downloads or revoked access',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'arpra-video-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=createMediaCache({directory}),video=Buffer.from('playable-bytes');let calls=0;
 const openVideo=async()=>{calls++;return {status:200,headers:{'Content-Type':'video/mp4','Content-Length':String(video.length)},stream:Readable.from([video])}};
 assert.equal(await cache.retainVideo('a','items:one',cdn,openVideo,()=>true),true);
 const restarted=createMediaCache({directory}),partial=await restarted.getVideo('a','items:one','video-0',cdn,{range:'bytes=2-5'});
 const chunks=[];for await(const c of partial.stream)chunks.push(c);assert.equal(Buffer.concat(chunks).toString(),video.subarray(2,6).toString());assert.equal(partial.status,206);
 const suffix=await restarted.getVideo('a','items:one','video-0',cdn,{range:'bytes=-3',method:'HEAD'});assert.equal(suffix.headers['Content-Length'],'3');assert.equal(suffix.stream,null);
 const invalid=await restarted.getVideo('a','items:one','video-0',cdn,{range:'bytes=999-'});assert.equal(invalid.status,416);
 assert.equal(await cache.retainVideo('a','items:one',cdn,openVideo,()=>true),true);assert.equal(calls,1);
 assert.equal(await cache.retainVideo('a','items:revoked',cdn,openVideo,()=>false),false);assert.equal(calls,1);
 assert.equal(await cache.retainVideo('a','items:incomplete',cdn,async()=>({status:200,headers:{'Content-Type':'video/mp4','Content-Length':'99'},stream:Readable.from([video])}),()=>true),false);
 assert.equal(await cache.getVideo('a','items:incomplete','video-0',cdn),null);
 for(const folder of await readdir(directory))assert.ok((await readdir(join(directory,folder))).every(name=>!name.endsWith('.tmp')));
});

test('Cache quota evicts only cached files and failed writes keep the prior complete copy',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'arpra-cache-limit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=createMediaCache({directory,maxWorkspaceBytes:image.body.length,maxTotalBytes:image.body.length*2});
 await writeFile(join(directory,'unrelated.txt'),'keep');
 await cache.putImage('a','items:old','thumbnail',cdn,image,()=>true);
 await cache.putImage('a','items:new','thumbnail',cdn,image,()=>true);
 assert.equal(await cache.getImage('a','items:old','thumbnail',cdn),null);assert.deepEqual(await cache.getImage('a','items:new','thumbnail',cdn),image);
 assert.equal(await cache.putImage('a','items:new','thumbnail',cdn,{type:'text/html',body:Buffer.from('wrong')},()=>true),false);assert.deepEqual(await cache.getImage('a','items:new','thumbnail',cdn),image);
 assert.ok((await readdir(directory)).includes('unrelated.txt'));
});

test('Media queue releases capacity and removes cancelled waiters',async()=>{
 const take=mediaQueue(1),release=await take(),controller=new AbortController();
 const cancelled=take(controller.signal);controller.abort();await assert.rejects(cancelled);
 let received=false;const pending=take().then(done=>{received=true;return done});await Promise.resolve();assert.equal(received,false);release();const done=await pending;assert.equal(received,true);done();done();
 const final=await take();final();
});


test('Deleting a workspace removes media and prevents in-flight writes from restoring it',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'levr-deleted-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=createMediaCache({directory}),workspace='11111111-1111-1111-1111-111111111111';
 await cache.putImage(workspace,'items:old','thumbnail',cdn,image);
 let release,started;const gate=new Promise(r=>release=r),opened=new Promise(r=>started=r);
 const pending=cache.retainVideo(workspace,'items:new',cdn,async()=>{started();await gate;return {status:200,headers:{'Content-Type':'video/mp4','Content-Length':'3'},stream:Readable.from([Buffer.from('abc')])}},()=>true);
 await opened;cache.deleteWorkspace(workspace);release();assert.equal(await pending,false);await cache.wait();
 assert.equal(await cache.getImage(workspace,'items:old','thumbnail',cdn),null);
 assert.equal(await cache.putImage(workspace,'items:late','thumbnail',cdn,image),false);
 assert.deepEqual(await readdir(directory),[]);
});

test('Saved assets survive CDN signature/edge changes but never match a different file or transform',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'media-identity-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const old='https://scontent-lhr1.xx.fbcdn.net/v/photo.jpg?stp=crop100&oh=old&oe=1&_nc_cat=8',next='https://scontent-den2.xx.fbcdn.net/v/photo.jpg?oe=2&oh=new&stp=crop100&_nc_cat=9';
 const cache=createMediaCache({directory});await cache.putImage('a','items:one','thumbnail',old,image);
 const restarted=createMediaCache({directory});assert.deepEqual(await restarted.getImage('a','items:one','thumbnail',next),image);
 for(const other of [next.replace('crop100','crop200'),next.replace('photo.jpg','other.jpg'),next+'&asset_revision=2'])assert.equal(await restarted.getImage('a','items:one','thumbnail',other),null);
 assert.equal(await restarted.getImage('b','items:one','thumbnail',next),null);assert.equal(await restarted.getImage('a','items:two','thumbnail',next),null);
});
test('Existing exact-URL cache files are upgraded without another download',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'media-legacy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const url='https://scontent.test.fbcdn.net/photo.jpg?oh=old&oe=1',workspace='a',record='items:one';
 const folder=join(directory,createHash('sha256').update(workspace).digest('hex')),key=createHash('sha256').update(JSON.stringify([record,'image',url])).digest('hex');
 await mkdir(folder,{recursive:true});await writeFile(join(folder,key+'.bin'),image.body);await writeFile(join(folder,key+'.json'),JSON.stringify({type:image.type,size:image.body.length}));
 const cache=createMediaCache({directory});assert.deepEqual(await cache.getImage(workspace,record,'thumbnail',url),image);
 assert.deepEqual(await createMediaCache({directory}).getImage(workspace,record,'thumbnail',url.replace('old','new')),image);
 assert.equal((await readdir(folder)).filter(name=>name.endsWith('.bin')).length,1);
});
test('Video cache pressure retains thumbnail files and reports a copy that cannot fit',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'media-priority-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=createMediaCache({directory,maxWorkspaceBytes:20,maxTotalBytes:20});
 await cache.putImage('a','items:one','thumbnail',cdn,image);
 const retained=await cache.retainVideo('a','items:video',cdn,async()=>({status:200,headers:{'Content-Type':'video/mp4','Content-Length':'20'},stream:Readable.from([Buffer.alloc(20)])}),()=>true);
 assert.equal(retained,false);assert.deepEqual(await cache.getImage('a','items:one','thumbnail',cdn),image);
});
