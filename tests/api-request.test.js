import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson} from '../client/api-request.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const gateway=status=>new Response('<html>Private upstream response must not be displayed</html>',{status,headers:{'content-type':'text/html'}});
test('stored paid reads recover from a temporary gateway without replaying any mutations',async()=>{
 const calls=[],waits=[],responses=[gateway(502),json([{id:'stored-ad'}])];
 const data=await requestJson('/api/items?kind=paid',{}, {fetchImpl:async(path,options)=>{calls.push({path,options});return responses.shift()},wait:async ms=>waits.push(ms)});
 assert.deepEqual(data,[{id:'stored-ad'}]);assert.equal(calls.length,2);assert.deepEqual(waits,[750]);assert.ok(calls.every(call=>call.path==='/api/items?kind=paid'&&!call.options.method));
});
test('persistent gateways produce a bounded, labeled HTTP error without leaking response bodies or query values',async()=>{
 let calls=0;
 await assert.rejects(requestJson('/api/items?kind=paid&q=private-search',{}, {fetchImpl:async()=>{calls++;return gateway(504)},wait:async()=>{}}),error=>error.status===504&&/Paid ad library.*HTTP 504/.test(error.message)&&!/private-search|Private upstream|<html>/.test(error.message));
 assert.equal(calls,3);
});
test('refresh mutations, provider-backed GETs and auth requests never retry automatically',async()=>{
 for(const [path,options]of [['/api/refresh',{method:'POST'}],['/api/profile-candidates?q=test',{}],['/api/items/abc/media-refresh',{method:'POST'}],['/auth/signup',{method:'POST'}],['/api/items',{method:'DELETE'}]]){
  let calls=0;await assert.rejects(requestJson(path,options,{fetchImpl:async()=>{calls++;return gateway(502)},wait:async()=>{throw Error('Unexpected retry')}}),/HTTP 502/);assert.equal(calls,1);
 }
});
test('non-JSON success and unexpected library payloads reject instead of masquerading as an empty library',async()=>{
 for(const response of [gateway(200),json(null),json('not data'),json({error:'wrong response'})]){
  await assert.rejects(requestJson('/api/items?kind=paid',{}, {fetchImpl:async()=>response}),error=>error.status===200&&/Paid ad library.*HTTP 200/.test(error.message));
 }
});
test('structured errors and unauthorized responses retain their status without retrying',async()=>{
 for(const status of [400,401,403,429,500,502,503]){
  let calls=0;await assert.rejects(requestJson('/api/status',{}, {fetchImpl:async()=>{calls++;return json({error:'Actionable application error'},status)},wait:async()=>{throw Error('Unexpected retry')}}),error=>error.status===status&&error.message==='Actionable application error');assert.equal(calls,1);
 }
 await assert.rejects(requestJson('/api/status',{}, {fetchImpl:async()=>gateway(401)}),error=>error.status===401&&/session has expired/.test(error.message));
});
test('workspace switches stop pending retries and discard late errors and successes',async()=>{
 let current=true,calls=0;
 await assert.rejects(requestJson('/api/items?kind=paid',{}, {isCurrent:()=>current,fetchImpl:async()=>{calls++;return gateway(502)},wait:async()=>{current=false}}),/Workspace changed/);assert.equal(calls,1);
 for(const response of [json([]),json({error:'old workspace'},401)]){
  current=true;await assert.rejects(requestJson('/api/items',{}, {isCurrent:()=>current,fetchImpl:async()=>{current=false;return response}}),/Workspace changed/);
 }
});
test('interrupted stored reads can recover, while mutation network failures stay single-attempt',async()=>{
 let calls=0;const fetchImpl=async()=>{if(++calls===1)throw Error('Private network detail');return json([])};
 assert.deepEqual(await requestJson('/api/items',{}, {fetchImpl,wait:async()=>{}}),[]);assert.equal(calls,2);
 calls=0;await assert.rejects(requestJson('/api/refresh',{method:'POST'},{fetchImpl,wait:async()=>{}}),error=>/connection to the server was interrupted/.test(error.message)&&!/Private network/.test(error.message));assert.equal(calls,1);
});
