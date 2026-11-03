import {createHash,randomUUID} from 'node:crypto';

const now=()=>new Date().toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const reasons={owner_request:'owner',self_service:'client',meta_request:'meta',setup_cleanup:'maintenance'};
export class AccountDeletionError extends Error{
 constructor(message,status=400){super(message);this.name='AccountDeletionError';this.status=status;this.safeMessage=message}
}
export function createAccountDeletion(db,{manager,vault,leadDelivery,ownerEmail=process.env.OWNER_EMAIL||'fraser@wearelevr.com',logger=console}={}){
 // Clear deleted payloads from database pages as SQLite frees them. Hosting
 // snapshots/backups are separate and must follow the operator's retention policy.
 db.exec('PRAGMA secure_delete=ON');
 function assertClientId(userId){
  if(typeof userId!=='string'||!uuid.test(userId))throw new AccountDeletionError('Only a client account can be deleted. Owner access is protected.');
 }
 function targets(userId){
  return db.prepare(`SELECT DISTINCT w.id,w.name,
   (SELECT count(*) FROM memberships m WHERE m.workspace_id=w.id AND m.user_id<>?) other_members,
   (SELECT count(*) FROM signup_leads l WHERE l.workspace_id=w.id AND l.user_id<>?) other_leads
   FROM workspaces w WHERE w.id IN (SELECT workspace_id FROM memberships WHERE user_id=? UNION SELECT workspace_id FROM signup_leads WHERE user_id=?)`).all(userId,userId,userId,userId)
   .map(w=>({id:w.id,name:w.name,willDelete:w.id!=='levr'&&!w.other_members&&!w.other_leads}));
 }
 function preview(userId){
  assertClientId(userId);
  const user=db.prepare('SELECT id,email FROM users WHERE id=?').get(userId);
  if(!user)return null;
  if(user.email.toLowerCase()===ownerEmail.toLowerCase())throw new AccountDeletionError('The owner cannot be deleted.',403);
  return {...user,workspaces:targets(userId)};
 }
 function result(audit){
  return {ok:true,deletionId:audit?.id||null,cleanupPending:audit?.cleanup_status==='pending',crmFollowUpRequired:!!audit?.crm_follow_up_required};
 }
 function retryCleanup(deletionId){
  let audit=db.prepare('SELECT * FROM account_deletions WHERE id=?').get(deletionId);
  if(!audit)throw new AccountDeletionError('Deletion record not found.',404);
  for(const task of db.prepare('SELECT * FROM account_deletion_files WHERE deletion_id=? AND completed_at IS NULL').all(deletionId)){
   db.prepare('UPDATE account_deletion_files SET attempts=attempts+1 WHERE deletion_id=? AND workspace_id=?').run(deletionId,task.workspace_id);
   try{
    if(manager.isActive(task.workspace_id))throw new Error('Workspace still exists.');
    // Close cached SQLite handles before unlinking the database and its sidecars.
    manager.deleteFiles(task.workspace_id);
    vault.delete(task.workspace_id);
    db.prepare('UPDATE account_deletion_files SET completed_at=?,last_error=NULL WHERE deletion_id=? AND workspace_id=?').run(now(),deletionId,task.workspace_id);
   }catch{
    const message='File cleanup needs retry. Check workspace and secret storage permissions, then retry this deletion.';
    db.prepare('UPDATE account_deletion_files SET last_error=? WHERE deletion_id=? AND workspace_id=?').run(message,deletionId,task.workspace_id);
    logger.warn?.('Account deletion file cleanup needs retry.',{deletionId});
   }
  }
  if(!db.prepare('SELECT 1 FROM account_deletion_files WHERE deletion_id=? AND completed_at IS NULL').get(deletionId))
   db.prepare("UPDATE account_deletions SET cleanup_status='completed',completed_at=coalesce(completed_at,?) WHERE id=?").run(now(),deletionId);
  audit=db.prepare('SELECT * FROM account_deletions WHERE id=?').get(deletionId);
  return result(audit);
 }
 function deleteAccount(userId,{reason,actorId=null}={}){
  assertClientId(userId);
  if(!Object.hasOwn(reasons,reason))throw new AccountDeletionError('Choose a supported deletion reason.');
  if(actorId!==null&&!uuid.test(actorId))throw new AccountDeletionError('Invalid deletion actor.');
  if(reason==='self_service'&&actorId!==userId)throw new AccountDeletionError('Clients can only delete their own account.',403);
  const user=preview(userId);
  if(!user){
   const prior=db.prepare('SELECT * FROM account_deletions WHERE user_id=?').get(userId);
   return prior?retryCleanup(prior.id):result(null);
  }
  const lead=db.prepare('SELECT id,attempts FROM signup_leads WHERE user_id=?').get(userId);
  const workspaces=user.workspaces.filter(w=>w.willDelete),deletionId=randomUUID(),timestamp=now();
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare(`INSERT INTO account_deletions(id,user_id,email_hash,deleted_at,actor_type,actor_id,reason,lead_event_id,crm_follow_up_required)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(deletionId,userId,hash(user.email.toLowerCase()),timestamp,reasons[reason],actorId,reason,lead?.id||null,lead?.attempts>0?1:0);
   for(const identity of db.prepare('SELECT provider,subject FROM social_identities WHERE user_id=?').all(userId))
    db.prepare('INSERT INTO deleted_social_identities VALUES (?,?,?,?) ON CONFLICT(provider,subject_hash) DO UPDATE SET deleted_at=excluded.deleted_at,deletion_id=excluded.deletion_id').run(identity.provider,hash(identity.subject),Date.now(),deletionId);
   // Remove pending identities and deletion challenges, including identities that
   // returned no email and tickets issued before this account was registered.
   db.prepare(`DELETE FROM pending_social_signups WHERE lower(email)=? OR EXISTS
    (SELECT 1 FROM social_identities i WHERE i.user_id=? AND i.provider=pending_social_signups.provider AND i.subject=pending_social_signups.subject)`).run(user.email.toLowerCase(),userId);
   db.prepare('DELETE FROM signup_oauth_states WHERE state_hash IN (SELECT state_hash FROM account_deletion_challenges WHERE user_id=?)').run(userId);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM account_deletion_reauth WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM memberships WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM social_identities WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM signup_leads WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM invites WHERE lower(email)=?').run(user.email.toLowerCase());
   db.prepare('DELETE FROM users WHERE id=?').run(userId);
   for(const workspace of workspaces){
    // Invitations to a deleted workspace must not keep the row alive or permit
    // later enrollment. Shared workspaces and their invitations remain intact.
    db.prepare('DELETE FROM invites WHERE workspace_id=?').run(workspace.id);
    db.prepare('DELETE FROM workspaces WHERE id=?').run(workspace.id);
    db.prepare('INSERT INTO account_deletion_files(deletion_id,workspace_id) VALUES (?,?)').run(deletionId,workspace.id);
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  // Cancellation cannot recall a request already received by GHL. The audit
  // retains only its event ID for a separate CRM erasure follow-up.
  if(lead)leadDelivery?.cancel(lead.id);
  return retryCleanup(deletionId);
 }
 return {deleteAccount,retryCleanup,preview};
}
