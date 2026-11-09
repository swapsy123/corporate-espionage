import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.js';
import {persistProfileItems} from '../server/store.js';

test('A refresh without usable creative keeps the prior media, thumbnail, format and record identity',t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('c','Fixture');
 for(const platform of ['meta','instagram']){
  db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES (?,?,?,?,1)').run(platform,'c',platform,'123');
  const profile={id:platform,competitorId:'c',platform},input={externalId:'123',kind:platform==='meta'?'paid':'organic',format:platform==='meta'?'ad_video':'instagram_reel',media:[{type:'video',url:'https://scontent.test.fbcdn.net/source.mp4',thumbnail:'https://scontent.test.fbcdn.net/poster.jpg'}],thumbnail:'https://scontent.test.fbcdn.net/poster.jpg',caption:'Old copy'};
  persistProfileItems(db,profile,[input],true);const original=db.prepare('SELECT * FROM items WHERE platform=?').get(platform);
  persistProfileItems(db,profile,[{...input,format:platform==='meta'?'ad_image':'instagram_image',media:[{url:'invalid'}],thumbnail:null,caption:'Fresh copy'}],true);
  const retained=db.prepare('SELECT * FROM items WHERE platform=?').get(platform),data=JSON.parse(retained.data);
  assert.equal(retained.id,original.id);assert.equal(retained.format,input.format);assert.equal(data.caption,'Fresh copy');assert.deepEqual(data.media,input.media);assert.equal(data.thumbnail,input.thumbnail);assert.match(data.mediaWarning,/retained/);
  persistProfileItems(db,profile,[{...input,media:[{type:'image',url:'https://scontent.test.fbcdn.net/replacement.jpg'}],format:platform==='meta'?'ad_image':'instagram_image',thumbnail:null}],true);
  const changed=db.prepare('SELECT * FROM items WHERE platform=?').get(platform),next=JSON.parse(changed.data);assert.equal(changed.format,platform==='meta'?'ad_image':'instagram_image');assert.equal(next.thumbnail,'https://scontent.test.fbcdn.net/replacement.jpg');assert.equal(next.mediaWarning,null);
 }
});
