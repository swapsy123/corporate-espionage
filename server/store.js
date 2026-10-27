import {id,now} from './db.js';
import {analyzeItem} from './intelligence.js';
export function competitorRows(db) {
 return db.prepare('SELECT * FROM competitors WHERE archived=0 ORDER BY name COLLATE NOCASE').all().map(r=>({id:r.id,name:r.name,notes:r.notes,paused:!!r.paused,archived:!!r.archived,lastRefresh:r.last_refresh,lastError:r.last_error,profiles:db.prepare('SELECT * FROM profiles WHERE competitor_id=?').all(r.id).map(profileRow)}));
}
export const profileRow = r=>({id:r.id,competitorId:r.competitor_id,platform:r.platform,identifier:r.identifier,label:r.label,confirmed:!!r.confirmed});
const engagement = p=>{const xs=[p.likes,p.comments,p.shares].filter(x=>typeof x==='number');return xs.length?xs.reduce((a,b)=>a+b,0):null;};
const median = xs=>{const a=[...xs].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
export function itemRows(db) {
 const rows=db.prepare('SELECT items.*,competitors.name competitor_name FROM items JOIN competitors ON competitors.id=items.competitor_id').all().map(r=>({...JSON.parse(r.data),id:r.id,competitorId:r.competitor_id,competitorName:r.competitor_name,platform:r.platform,externalId:r.external_id,kind:r.kind,format:r.format,firstSeen:r.first_seen,lastSeen:r.last_seen}));
 const groups=new Map();
 for(const r of rows){if(r.kind==='organic'){const key=[r.competitorId,r.platform,r.format].join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}}
 for(const r of rows){
  r.activeDays=r.startDate?Math.max(0,Math.floor(((r.active===false?Date.parse(r.lastSeen):Date.now())-Date.parse(r.startDate))/86400000)):null;
  if(!Number.isFinite(r.activeDays))r.activeDays=null;
  const interactions=[r.likes,r.comments,r.shares].filter(x=>typeof x==='number');
  r.totalEngagement=interactions.length?interactions.reduce((a,b)=>a+b,0):null;
  if(r.kind==='organic'){
   const group=groups.get([r.competitorId,r.platform,r.format].join(':'));
   const metric=['instagram_reel','youtube_short','youtube_video'].includes(r.format)?'views':'totalEngagement';
   // Compare with OTHER posts, within exactly the same creator/platform/format.
   const peers=group.filter(p=>p.id!==r.id).map(p=>metric==='totalEngagement'?engagement(p):p[metric]).filter(x=>typeof x==='number'&&x>=0);
   const baseline=peers.length>=3?median(peers):null;
   r.baselineCount=peers.length;r.baselineMetric=metric;r.outlierScore=baseline>0&&typeof r[metric]==='number'?Math.round(r[metric]/baseline*100)/100:null;
   r.researchSignal=r.outlierScore;
  }else r.researchSignal=r.activeDays;
 }
 return rows;
}
const safeUrl = value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function persistProfileItems(db,profile,items,complete) {
 const seen=now();
 db.exec('BEGIN IMMEDIATE');
 try {
  for(const input of items){
   if(!input.externalId||!input.format||!['paid','organic'].includes(input.kind))throw Error('Provider returned an incomplete record; previous data was retained.');
   const old=db.prepare('SELECT * FROM items WHERE platform=? AND external_id=?').get(profile.platform,String(input.externalId));
   if(old&&old.competitor_id!==profile.competitorId)throw Error('This source is already associated with another competitor. Review profile connections.');
   const previous=old?JSON.parse(old.data):{};
   const item={...previous,...input};
   for(const key of ['views','likes','comments','shares'])item[key]=typeof input[key]==='number'&&Number.isFinite(input[key])?Math.max(0,input[key]):previous[key]??null;
   item.transcript=input.transcript||previous.transcript||null;
   item.transcriptStatus=item.transcript?'available':input.transcriptStatus||'unavailable';
   for(const key of ['sourceUrl','landingUrl','thumbnail'])item[key]=safeUrl(item[key]);
   item.media=(item.media||[]).map(m=>({...m,url:safeUrl(m.url),thumbnail:safeUrl(m.thumbnail)})).filter(m=>m.url);
   item.analysis=analyzeItem(item);
   db.prepare('INSERT INTO items(id,competitor_id,profile_id,platform,external_id,kind,format,data,first_seen,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,external_id) DO UPDATE SET data=excluded.data,format=excluded.format,profile_id=excluded.profile_id,last_seen=excluded.last_seen').run(old?.id||id(),profile.competitorId,profile.id,profile.platform,String(item.externalId),item.kind,item.format,JSON.stringify(item),old?.first_seen||seen,seen);
  }
  if(profile.platform==='meta'&&complete){
   const ids=new Set(items.map(i=>String(i.externalId)));
   for(const r of db.prepare("SELECT id,external_id,data FROM items WHERE profile_id=? AND kind='paid'").all(profile.id))if(!ids.has(r.external_id)){const data=JSON.parse(r.data);data.active=false;db.prepare('UPDATE items SET data=? WHERE id=?').run(JSON.stringify(data),r.id);}
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function boardRows(db){return db.prepare('SELECT boards.*,count(opportunities.id) itemCount FROM boards LEFT JOIN opportunities ON opportunities.board_id=boards.id GROUP BY boards.id ORDER BY boards.rowid').all();}
export function opportunityRows(db,boardId){const items=new Map(itemRows(db).map(x=>[x.id,x]));return db.prepare('SELECT * FROM opportunities'+(boardId?' WHERE board_id=?':'')+' ORDER BY rowid DESC').all(...(boardId?[boardId]:[])).map(r=>({id:r.id,boardId:r.board_id,itemId:r.item_id,notes:r.notes,tags:JSON.parse(r.tags),rating:r.rating,stage:r.stage,item:items.get(r.item_id)}));}
export function scopedItems(db,boardId){const all=itemRows(db);if(!boardId)return all;const ids=new Set(db.prepare('SELECT item_id FROM opportunities WHERE board_id=?').all(boardId).map(r=>r.item_id));return all.filter(i=>ids.has(i.id));}
