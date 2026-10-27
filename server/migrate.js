import {openDatabase} from './db.js';
const db=openDatabase();
console.log('Applied migrations:',db.prepare('SELECT version FROM migrations ORDER BY version').all().map(x=>x.version).join(', '));
console.log('Integrity:',db.prepare('PRAGMA integrity_check').get().integrity_check);
db.close();
