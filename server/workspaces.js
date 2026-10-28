import { AsyncLocalStorage } from 'node:async_hooks';
import {dirname,join,resolve} from 'node:path';
import {openDatabase} from './db.js';

// Each client's research lives in its own database. The catalog connection is
// used only for identity and membership; research queries must have a scope.
export function createWorkspaceManager(catalog,{directory}={}) {
 const rootFile=catalog.prepare('PRAGMA database_list').all().find(x=>x.name==='main')?.file;
 const workspaceDirectory=directory|| (rootFile?join(dirname(rootFile),'workspaces'):null);
 const context=new AsyncLocalStorage(),connections=new Map();
 const facade=new Proxy({}, {get(_,property){
  const connection=context.getStore()?.database;
  if(!connection)throw new Error('Research database requested without workspace authorization.');
  const value=connection[property];return typeof value==='function'?value.bind(connection):value;
 }});
 function database(workspaceId){
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
  context.run({database:connection,workspaceId},next);
 }
 return {db:facade,middleware,run:(connection,workspaceId,callback)=>context.run({database:connection,workspaceId},callback),close(){for(const connection of connections.values())connection.close();connections.clear();},secretDirectory:rootFile?join(dirname(rootFile),'secrets'):null};
}
