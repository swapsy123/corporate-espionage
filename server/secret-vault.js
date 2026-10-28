import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {constants,openSync,closeSync,lstatSync,fstatSync,mkdirSync,chmodSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,resolve,parse,join} from 'node:path';

const MAX_ENVELOPE_BYTES=16384;
const WORKSPACE_ID=/^(?:levr|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/;
const READ_ERROR='The workspace credential could not be read. Ask Levr to check secure storage and encryption settings.';
const WRITE_ERROR='The workspace credential could not be saved. Ask Levr to check secure storage and encryption settings.';
const CONFIG_ERROR='Secure credential storage is not configured. Ask Levr to configure the encryption setting before saving an API key.';
export class SecretVaultError extends Error {
  constructor(message){super(message);this.name='SecretVaultError';this.safeMessage=message;}
}
function validateWorkspace(value){
  if(typeof value!=='string'||!WORKSPACE_ID.test(value))throw new SecretVaultError('The workspace identifier is invalid.');
}
function validateCredential(value){
  if(typeof value!=='string'||!value.length||value.length>4096||/[^\x21-\x7e]/.test(value))throw new SecretVaultError('Enter a valid API key without spaces or line breaks.');
}
function statIfPresent(path){try{return lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
// Only the configured private directory is writable; neither it nor its ancestors
// may redirect credential operations through a symlink.
function inspectDirectory(path,create=false){
  const root=parse(path).root;
  let cursor=root;
  const parts=path.slice(root.length).split('/').filter(Boolean);
  for(const part of parts){
    cursor=join(cursor,part);
    const stat=statIfPresent(cursor);
    if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()))throw new Error('Unsafe storage path');
    if(!stat){if(!create)return false;mkdirSync(cursor,{mode:0o700});}
  }
  const stat=lstatSync(path);
  if(typeof process.getuid==='function'&&stat.uid!==process.getuid())throw new Error('Unowned storage directory');
  if(create)chmodSync(path,0o700);
  else if((stat.mode&0o077)!==0)throw new Error('Storage directory is not private');
  return true;
}
function inspectFile(path){
  const stat=statIfPresent(path);
  if(stat&&(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid())))throw new Error('Unsafe credential file');
  return stat;
}
function syncDirectory(path){
  const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function decode(value,length){
  if(typeof value!=='string'||!value.length||!(/^[A-Za-z0-9+/]+={0,2}$/).test(value))throw new Error('Invalid encoding');
  const result=Buffer.from(value,'base64');
  if(result.toString('base64')!==value||(length!==undefined&&result.length!==length))throw new Error('Invalid encoding');
  return result;
}
/** Server-only store: ciphertext files are separate from all SQLite databases. */
export function createSecretVault({directory,masterKey=process.env.LEVR_SECRET_ENCRYPTION_KEY,ownerKey=process.env.SCRAPECREATORS_API_KEY}={}){
  const storageDirectory=resolve(directory||join(dirname(resolve(process.env.DATABASE_PATH||'./data/levr.sqlite')),'secrets'));
  const encryptionKey=typeof masterKey==='string'&&masterKey.length>=32?createHash('sha256').update(masterKey).digest():null;
  const fallback=typeof ownerKey==='string'&&ownerKey.length?ownerKey:null;
  const pathFor=workspaceId=>{validateWorkspace(workspaceId);return join(storageDirectory,`${workspaceId}.json`);};
  function read(workspaceId){
    const path=pathFor(workspaceId);
    let fd;
    try{
      if(!inspectDirectory(storageDirectory))return {key:workspaceId==='levr'?fallback:null,source:workspaceId==='levr'&&fallback?'environment':null};
      if(!inspectFile(path))return {key:workspaceId==='levr'?fallback:null,source:workspaceId==='levr'&&fallback?'environment':null};
      if(!encryptionKey)throw new SecretVaultError(CONFIG_ERROR);
      fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_ENVELOPE_BYTES||(stat.mode&0o077)!==0)throw new Error('Invalid credential file');
      const envelope=JSON.parse(readFileSync(fd,'utf8'));
      if(envelope.version!==1)throw new Error('Unsupported credential envelope');
      const iv=decode(envelope.iv,12),tag=decode(envelope.tag,16),ciphertext=decode(envelope.ciphertext);
      const decipher=createDecipheriv('aes-256-gcm',encryptionKey,iv);
      decipher.setAAD(Buffer.from(workspaceId,'utf8'));
      decipher.setAuthTag(tag);
      const value=Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
      validateCredential(value);
      return {key:value,source:'workspace'};
    }catch(error){if(error instanceof SecretVaultError&&error.message===CONFIG_ERROR)throw error;throw new SecretVaultError(READ_ERROR);}
    finally{if(fd!==undefined)closeSync(fd);}
  }
  function status(workspaceId){const value=read(workspaceId);return {configured:!!value.key,storageReady:!!encryptionKey,source:value.source};}
  function set(workspaceId,apiKey){
    const path=pathFor(workspaceId);validateCredential(apiKey);
    if(!encryptionKey)throw new SecretVaultError(CONFIG_ERROR);
    let fd,temp;
    try{
      inspectDirectory(storageDirectory,true);inspectFile(path);
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
      cipher.setAAD(Buffer.from(workspaceId,'utf8'));
      const ciphertext=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
      const envelope=JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});
      temp=join(storageDirectory,`${workspaceId}.${randomBytes(12).toString('hex')}.tmp`);
      fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      writeFileSync(fd,envelope,'utf8');fsyncSync(fd);closeSync(fd);fd=undefined;
      inspectFile(path);renameSync(temp,path);temp=undefined;
      syncDirectory(storageDirectory);
      return {configured:true,storageReady:true,source:'workspace'};
    }catch{throw new SecretVaultError(WRITE_ERROR);}
    finally{
      if(fd!==undefined)closeSync(fd);
      if(temp){try{unlinkSync(temp);}catch{ /* Ciphertext-only temporary artifact; never log a path. */ }}
    }
  }
  function remove(workspaceId){
    const path=pathFor(workspaceId);
    try{
      if(inspectDirectory(storageDirectory)&&inspectFile(path)){unlinkSync(path);syncDirectory(storageDirectory);}
    }catch{throw new SecretVaultError('The workspace credential could not be removed. Ask Levr to check secure storage settings.');}
    return status(workspaceId);
  }
  return {status,get:workspaceId=>read(workspaceId).key,set,delete:remove};
}
