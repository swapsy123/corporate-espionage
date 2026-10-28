import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync,copyFileSync,symlinkSync,mkdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createSecretVault,SecretVaultError} from '../server/secret-vault.js';
function setup(t){const root=mkdtempSync(join(tmpdir(),'levr-vault-')),directory=join(root,'secrets'),masterKey=randomBytes(32).toString('hex');t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,directory,masterKey,vault:createSecretVault({directory,masterKey,ownerKey:'owner-test-key'}),a:randomUUID(),b:randomUUID()};}

test('workspace keys persist only as authenticated ciphertext with private permissions',t=>{
 const {directory,masterKey,vault,a}=setup(t),apiKey='client-test-key-123';
 assert.deepEqual(vault.status(a),{configured:false,storageReady:true,source:null});
 assert.deepEqual(vault.set(a,apiKey),{configured:true,storageReady:true,source:'workspace'});
 assert.equal(vault.get(a),apiKey);
 const file=join(directory,`${a}.json`),first=readFileSync(file,'utf8');
 assert.ok(!first.includes(apiKey));assert.ok(!first.includes(masterKey));assert.equal(statSync(directory).mode&0o777,0o700);assert.equal(statSync(file).mode&0o777,0o600);
 assert.deepEqual(Object.keys(vault.status(a)).sort(),['configured','source','storageReady']);
 assert.ok(!JSON.stringify(vault.status(a)).includes(apiKey));
 vault.set(a,apiKey);assert.notEqual(readFileSync(file,'utf8'),first,'same value receives a fresh random nonce');
 assert.equal(readdirSync(directory).length,1,'atomic writes leave no temporary files');
 assert.equal(createSecretVault({directory,masterKey}).get(a),apiKey,'server restart restores from encrypted file');
});

test('client accounts never fall back to Levr credentials and keys stay isolated',t=>{
 const {vault,a,b}=setup(t);
 assert.equal(vault.get('levr'),'owner-test-key');assert.equal(vault.get(a),null);assert.equal(vault.get(b),null);
 vault.set(a,'client-a');vault.set(b,'client-b');assert.equal(vault.get(a),'client-a');assert.equal(vault.get(b),'client-b');
 vault.delete(a);assert.equal(vault.get(a),null);assert.equal(vault.get(b),'client-b');
 vault.set('levr','owner-replacement');assert.equal(vault.get('levr'),'owner-replacement');
 assert.deepEqual(vault.delete('levr'),{configured:true,storageReady:true,source:'environment'});
 assert.equal(vault.get('levr'),'owner-test-key');
});

test('missing or short master key fails closed without generating replacement secrets',t=>{
 const {directory,a,vault}=setup(t);
 const noMaster=createSecretVault({directory,masterKey:'',ownerKey:'owner-test-key'});
 assert.deepEqual(noMaster.status(a),{configured:false,storageReady:false,source:null});
 assert.equal(noMaster.get('levr'),'owner-test-key');
 assert.throws(()=>noMaster.set(a,'never-persist-plaintext'),SecretVaultError);
 vault.set(a,'protected');assert.throws(()=>noMaster.get(a),/encryption setting/);
 assert.throws(()=>createSecretVault({directory,masterKey:'too-short'}).get(a),SecretVaultError);
});

test('wrong keys, ciphertext tampering and moved files cannot reveal or cross workspace secrets',t=>{
 const {directory,masterKey,vault,a,b}=setup(t);vault.set(a,'private-client-a');
 assert.throws(()=>createSecretVault({directory,masterKey:'wrong-master-key-that-is-long-enough',ownerKey:'fallback'}).get(a),SecretVaultError);
 copyFileSync(join(directory,`${a}.json`),join(directory,`${b}.json`));chmodSync(join(directory,`${b}.json`),0o600);
 assert.throws(()=>vault.get(b),SecretVaultError,'workspace identity authenticates every encrypted file');
 const file=join(directory,`${a}.json`),record=JSON.parse(readFileSync(file,'utf8'));record.ciphertext=Buffer.from('tampered').toString('base64');writeFileSync(file,JSON.stringify(record));
 assert.throws(()=>vault.get(a),error=>error instanceof SecretVaultError&&!error.message.includes('private-client-a')&&!error.message.includes(directory));
 vault.set('levr','private-owner');writeFileSync(join(directory,'levr.json'),'malformed');
 assert.throws(()=>vault.get('levr'),SecretVaultError,'corrupt owner override never falls back silently');
});

test('invalid identifiers and credentials cannot create traversal paths or plaintext artifacts',t=>{
 const {vault,directory,a}=setup(t);
 for(const invalid of ['../levr','',null,'a/b','Levr','00000000-0000-0000-0000-000000000000/extra']){
  assert.throws(()=>vault.set(invalid,'valid-key'),SecretVaultError);assert.throws(()=>vault.get(invalid),SecretVaultError);assert.throws(()=>vault.delete(invalid),SecretVaultError);
 }
 for(const invalid of ['',null,'line\nbreak','has space','x'.repeat(4097)])assert.throws(()=>vault.set(a,invalid),SecretVaultError);
 assert.throws(()=>readdirSync(directory),{code:'ENOENT'});
});

test('symlink storage paths and symlink key files are rejected',t=>{
 const {root,directory,masterKey,vault,a,b}=setup(t),outside=join(root,'outside');mkdirSync(outside,{mode:0o700});
 const alias=join(root,'alias');symlinkSync(outside,alias,'dir');
 assert.throws(()=>createSecretVault({directory:join(alias,'nested'),masterKey}).set(a,'key'),SecretVaultError);
 assert.equal(readdirSync(outside).length,0,'unsafe ancestor is not traversed');
 vault.set(a,'first-key');symlinkSync(join(directory,`${a}.json`),join(directory,`${b}.json`));
 assert.throws(()=>vault.get(b),SecretVaultError);assert.throws(()=>vault.set(b,'second-key'),SecretVaultError);assert.throws(()=>vault.delete(b),SecretVaultError);
 assert.equal(vault.get(a),'first-key');
});


test('invalid replacement preserves the existing credential and delete leaves no credential files',t=>{
 const {vault,a,directory}=setup(t);vault.set(a,'original-client-key');
 assert.throws(()=>vault.set(a,'invalid replacement with spaces'),SecretVaultError);
 assert.equal(vault.get(a),'original-client-key');
 assert.deepEqual(vault.delete(a),{configured:false,storageReady:true,source:null});
 assert.deepEqual(readdirSync(directory),[]);
 assert.deepEqual(vault.delete(a),{configured:false,storageReady:true,source:null});
});
