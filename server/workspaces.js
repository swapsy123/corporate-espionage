import { AsyncLocalStorage } from 'node:async_hooks';
import {dirname,join,resolve,parse} from 'node:path';
import {lstatSync,unlinkSync} from 'node:fs';
import {openDatabase} from './db.js';

// Each client's research lives in its own database. The catalog connection is
// used only for identity and membership; research queries must have a scope.
export function createWorkspaceManager(catalog,{directory}={}) {
 const rootFile=catalog.prepare('PRAGMA database_list').all().find(x=>x.name==='main')?.file;
 const workspaceDirectory=directory|| (rootFile?join(dirname(rootFile),'workspaces'):null);
 const context=new AsyncLocalStorage(),connections=new Map();
 const isActive=workspaceId=>!!catalog.prepare('SELECT 1 FROM workspaces WHERE id=?').get(workspaceId);
 const canAccess=req=>isActive(req.workspaceId)&&!!catalog.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(req.session.token_hash,Date.now())&&
  (req.user.role==='owner'||!!catalog.prepare('SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND u.disabled=0').get(req.workspaceId,req.user.id));
 const facade=new Proxy({}, {get(_,property){
  const scope=context.getStore(),connection=scope?.database;
  if(!connection)throw new Error('Research database requested without workspace authorization.');
  if(!isActive(scope.workspaceId)||(scope.authorize&&!scope.authorize()))throw new Error('Workspace access has been removed.');
  const value=connection[property];return typeof value==='function'?value.bind(connection):value;
 }});
 function database(workspaceId){
  if(!isActive(workspaceId))throw new Error('Workspace has been deleted.');
  if(workspaceId==='levr')return catalog;
  if(!/^[0-9a-f-]{36}$/i.test(workspaceId))throw new Error('Invalid workspace identifier.');
  if(!connections.has(workspaceId))connections.set(workspaceId,openDatabase(workspaceDirectory?resolve(workspaceDirectory,`${workspaceId}.sqlite`):':memory:'));
  return connections.get(workspaceId);
 }
 function middleware(req,res,next){
  const requested=req.get('X-Workspace-Id');
  const workspaceId=requested||(req.user.role==='owner'?'levr':catalog.prepare('SELECT workspace_id FROM memberships WHERE user_id=? ORDER BY created_at,workspace_id LIMIT 1').get(req.user.id)?.workspace_id);
  if(!workspaceId||workspaceId.length>100)return res.status(404).json({error:'Workspace not found or access has been removed.'});
  const workspace=catalog.prepare('SELECT id,name,created_at FROM workspaces WHERE id=?').get(workspaceId);
  if(!workspace||(req.user.role!=='owner'&&!catalog.prepare('SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?').get(workspaceId,req.user.id)))return res.status(404).json({error:'Workspace not found or access has been removed.'});
  req.workspaceId=workspaceId;req.workspace={id:workspace.id,name:workspace.name};
  const connection=database(workspaceId);req.workspaceDatabase=connection;
  context.run({database:connection,workspaceId,authorize:()=>canAccess(req)},next);
 }
 function deleteFiles(workspaceId){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(workspaceId)||isActive(workspaceId))throw new Error('Refusing to remove an active or invalid workspace.');
  const connection=connections.get(workspaceId);
  if(connection){connection.close();connections.delete(workspaceId)}
  if(!workspaceDirectory)return;
  // Do not traverse a substituted directory or follow symlinks while deleting.
  const directory=resolve(workspaceDirectory);let cursor=parse(directory).root;
  for(const part of directory.slice(cursor.length).split('/').filter(Boolean)){
   cursor=join(cursor,part);let stat;
   try{stat=lstatSync(cursor)}catch(error){if(error.code==='ENOENT')return;throw error}
   if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe workspace storage.');
  }
  for(const suffix of ['','-wal','-shm','-journal']){
   const path=join(directory,`${workspaceId}.sqlite${suffix}`);let stat;
   try{stat=lstatSync(path)}catch(error){if(error.code==='ENOENT')continue;throw error}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('Unsafe workspace file.');
   unlinkSync(path);
  }
 }
 return {db:facade,middleware,isActive,canAccess,deleteFiles,run:(connection,workspaceId,callback)=>context.run({database:connection,workspaceId},callback),close(){for(const connection of connections.values())connection.close();connections.clear();},mediaCacheDirectory:rootFile?join(dirname(rootFile),'media-cache'):null,secretDirectory:rootFile?join(dirname(rootFile),'secrets'):null};
}
