import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const migrations = fileURLToPath(new URL('./migrations/', import.meta.url));
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function openDatabase(path = process.env.DATABASE_PATH || './data/levr-beta.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), {recursive:true,mode:0o700});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT 1 FROM migrations WHERE version=?').get(file)) continue;
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(readFileSync(resolve(migrations,file),'utf8')); db.prepare('INSERT INTO migrations VALUES (?,?)').run(file,now()); db.exec('COMMIT'); }
    catch(e) {db.exec('ROLLBACK');throw e;}
  }
  // A process does not survive a deployment. Preserve items, mark unfinished work honestly.
  db.prepare("UPDATE refreshes SET status='failed',finished_at=?,error='Refresh interrupted by a server restart. Run manual refresh again.' WHERE status='running'").run(now());
  db.prepare("UPDATE sync_runs SET status='failed',finished_at=?,error='Import interrupted by restart. Retry manually; previous records are preserved.' WHERE status='running'").run(now());
  return db;
}
export function seedCompetitors(db) {
  if (db.prepare('SELECT count(*) n FROM competitors').get().n) return;
  const names=['Closers.io / Remote Closing Academy','Sales.io','7th Level','Coaching Sales','Sales Sniper','WFS Group','Pineda Partners','NexGrowth','Closing Consulting','Scaling Partners','Nomadic Closer','CloserOnDemand','Dial A Closer','HyperHired','PrimeClosers / High-Ticket Closing Academy','Adam Cerra / Cerra Closer Academy','Dan Lok — High Ticket Closer','High Ticket Sales Academy','Delta Closers','Closer Cartel','Elite Closers','Inbound Closer','Kaizen Closing','Revenue Growth','Adspend','99 Robots','Leads Now AI'];
  const handles=['growth.operators','growth_operators','highstakesai','intelliclose','cfx_media_hub','backendoperators','mikedundongrowth','maathu.ops','jervis.francisco','growthpartner.laura','danielconsults_','realbilals','louka_mahdaoui','inticify','thecloserconnect','thecloserden','capitalcloser','highcloserofficial','digitalclosers.io','salestalentagency','theremoteclosersblueprint','james_harpa','connorwestern_','lucas.bennett.sales','sljivic.pifs','remoteclosersblueprint'];
  db.exec('BEGIN');
  try {
    for(const name of names) db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run(id(),name);
    for(const handle of handles){const cid=id();db.prepare('INSERT INTO competitors(id,name,notes) VALUES (?,?,?)').run(cid,'@'+handle,'Profile supplied during setup; review identity before confirming.');db.prepare('INSERT INTO profiles(id,competitor_id,platform,identifier,label) VALUES (?,?,?,?,?)').run(id(),cid,'instagram',handle,'@'+handle);}
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
