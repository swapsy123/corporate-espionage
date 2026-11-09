import {mediaError} from './media-diagnostics.js';
// Bound upstream work without permanently failing a grid merely because more
// than eight thumbnails became visible at once. Abandoned requests leave the queue.
export function mediaQueue(limit=8,maxPending=128){
 let active=0;const pending=[];
 function next(){
  while(active<limit&&pending.length){
   const waiter=pending.shift();waiter.signal?.removeEventListener('abort',waiter.abort);
   if(waiter.signal?.aborted){waiter.reject(Error('Media request cancelled'));continue}
   active++;let released=false;waiter.resolve(()=>{if(!released){released=true;active--;next()}});
  }
 }
 return signal=>new Promise((resolve,reject)=>{
  if(signal?.aborted||pending.length>=maxPending)return reject(mediaError('queue'));
  const waiter={resolve,reject,signal,abort:()=>{const i=pending.indexOf(waiter);if(i>=0)pending.splice(i,1);reject(Error('Media request cancelled'))}};
  pending.push(waiter);signal?.addEventListener('abort',waiter.abort,{once:true});next();
 });
}
