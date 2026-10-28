import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/db.js';

test('deployed single-owner database upgrades without changing existing research or confirmations',()=>{
 const directory=mkdtempSync(join(tmpdir(),'levr-schema-upgrade-')),path=join(directory,'levr.sqlite');
 let oldDb,newDb;
 try{
  oldDb=new DatabaseSync(path);
  for(const file of ['001_initial.sql','002_refresh_warnings.sql','003_clear_ineligible_refresh_errors.sql']){
   oldDb.exec(readFileSync(new URL(`../server/migrations/${file}`,import.meta.url),'utf8'));
   oldDb.prepare('INSERT INTO migrations VALUES (?,?)').run(file,'2026-10-27T00:00:00Z');
  }
  oldDb.prepare("INSERT INTO competitors(id,name,notes) VALUES ('original','Existing Levr competitor','Private note')").run();
  oldDb.prepare("INSERT INTO profiles(id,competitor_id,platform,identifier,confirmed) VALUES ('profile','original','meta','123',1)").run();
  oldDb.prepare("INSERT INTO items VALUES ('source','original','profile','meta','123','paid','ad_image',?,'2026-10-26','2026-10-27')").run(JSON.stringify({caption:'Existing copy',active:true}));
  oldDb.prepare("INSERT INTO opportunities(id,board_id,item_id,notes,tags,rating,stage) VALUES ('saved','inbox','source','Keep this reference','[\"client\"]',5,'Creating')").run();
  oldDb.prepare("INSERT INTO briefs VALUES ('brief','inbox','paid_ad','2026-10-27',?)").run(JSON.stringify({adaptation:{hook:'Existing original hook'}}));
  oldDb.prepare("INSERT INTO refreshes(id,competitor_id,status,started_at,item_count) VALUES ('sync','original','success','2026-10-27',1)").run();
  const tables=['competitors','profiles','items','boards','opportunities','briefs','refreshes'];
  const snapshots=Object.fromEntries(tables.map(table=>[table,oldDb.prepare(`SELECT * FROM ${table}`).all()]));
  oldDb.close();oldDb=null;
  newDb=openDatabase(path);
  for(const table of tables)assert.deepEqual(newDb.prepare(`SELECT * FROM ${table}`).all(),snapshots[table],`${table} must survive upgrade unchanged`);
  assert.equal(newDb.prepare('SELECT id FROM workspaces').get().id,'levr');
  assert.equal(newDb.prepare('SELECT count(*) n FROM users').get().n,0);
  assert.equal(newDb.prepare('SELECT count(*) n FROM migrations').get().n,5);
  assert.ok(newDb.prepare('PRAGMA table_info(invites)').all().some(c=>c.name==='purpose'));
  assert.equal(newDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{oldDb?.close();newDb?.close();rmSync(directory,{recursive:true,force:true});}
});
