import React,{useEffect,useRef,useState} from 'react';

function Scope({account}){
 return <>
  <p>This permanently removes the account, all its sign-in sessions, signup details, linked identities and invitations.</p>
  {account.workspaces?.length>0&&<ul>{account.workspaces.map(w=><li key={w.id}><strong>{w.name}</strong> — {w.willDelete?'delete its research, boards, briefs, refresh history and saved ScrapeCreators key':'keep this workspace because another account still has membership or signup data linked to it'}</li>)}</ul>}
  <p className="caption">Shared research stays with the remaining accounts. Data already sent to GoHighLevel and hosting backups needs separate handling by Levr. Deletion does not cancel a ScrapeCreators subscription.</p>
 </>;
}
export function ClientAccountDeletion({api}){
 const [account,setAccount]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(''),[password,setPassword]=useState('');
 useEffect(()=>{let alive=true;api('/api/account/deletion').then(value=>alive&&setAccount(value)).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[]);
 async function submit(event){event.preventDefault();setBusy(true);setError('');try{
  const result=await api('/api/account',{method:'DELETE',body:{confirmationEmail:confirm,password}});
  setPassword('');location.replace(`/account-deleted?cleanup=${result.cleanupPending?'pending':'complete'}`);
 }catch(e){setError(e.message);setBusy(false);setPassword('')}}
 return <section className="card account-deletion" aria-labelledby="delete-account-heading">
  <h2 id="delete-account-heading">Delete your account</h2>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {!account?<p>Loading account details…</p>:<>
   <Scope account={account}/>
   {account.hasLegacySocialIdentity&&<p className="caption">If you previously used Google or Facebook and have not set a password, ask Levr for a password reset link before deleting your account.</p>}
   <form onSubmit={submit}>
    <label className="field">Type your email to confirm: {account.email}<input type="email" name="confirmationEmail" autoComplete="off" required value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={busy}/></label>
    <label className="field">Confirm account password<input name="deletionPassword" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/></label>
    <button className="button primary" type="submit" disabled={busy||confirm.trim().toLowerCase()!==account.email||!password}>{busy?'Deleting…':'Permanently delete my account'}</button>
   </form>
  </>}
 </section>;
}
function DeleteDialog({api,userId,onClose,onDeleted}){
 const ref=useRef(null),[account,setAccount]=useState(null),[error,setError]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{ref.current.showModal();let alive=true;api(`/api/accounts/${userId}/deletion`).then(value=>alive&&setAccount(value)).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[userId]);
 async function submit(event){event.preventDefault();setBusy(true);setError('');try{const result=await api(`/api/accounts/${userId}`,{method:'DELETE',body:{confirmationEmail:confirm}});onDeleted(result)}catch(e){setError(e.message);setBusy(false)}}
 return <dialog ref={ref} className="account-delete-dialog" aria-labelledby="owner-delete-title" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
  <h2 id="owner-delete-title">Permanently delete this client account?</h2>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {account?<><Scope account={account}/><form onSubmit={submit}>
   <label className="field">Type {account.email} to confirm<input type="email" name="confirmationEmail" autoComplete="off" value={confirm} required onChange={e=>setConfirm(e.target.value)} disabled={busy}/></label>
   <div className="account-actions"><button className="button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy||confirm.trim().toLowerCase()!==account.email}>{busy?'Deleting…':'Permanently delete account'}</button></div>
  </form></>:<><p>Loading deletion details…</p><button className="button" onClick={onClose}>Cancel</button></>}
 </dialog>;
}
function Pager({data,onChange}){
 return <div className="signup-pagination"><button className="button" disabled={data.page<=1} onClick={()=>onChange(data.page-1)}>Previous</button><span className="caption">Page {data.page}</span><button className="button" disabled={!data.hasMore} onClick={()=>onChange(data.page+1)}>Next</button></div>;
}
export function AccountAdministration({api,onChanged}){
 const [accounts,setAccounts]=useState(null),[history,setHistory]=useState(null),[page,setPage]=useState(1),[historyPage,setHistoryPage]=useState(1),[version,setVersion]=useState(0),[filter,setFilter]=useState(''),[query,setQuery]=useState(''),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 useEffect(()=>{let alive=true;Promise.all([api(`/api/accounts?page=${page}&email=${encodeURIComponent(query)}`),api(`/api/account-deletions?page=${historyPage}`)]).then(([a,h])=>{if(alive){setAccounts(a);setHistory(h)}}).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[page,historyPage,version,query]);
 async function deleted(result){setSelected('');setNotice(result.cleanupPending?'Account access and catalog records removed. File cleanup needs attention below.':'Client account and its exclusively owned workspace files deleted.');setVersion(v=>v+1);await onChanged()}
 async function retry(id){setBusy(id);setError('');try{const result=await api(`/api/account-deletions/${id}/retry`,{method:'POST',body:{}});setNotice(result.cleanupPending?'Some files still need cleanup. Check the recorded error.':'File cleanup completed.');setVersion(v=>v+1)}catch(e){setError(e.message)}finally{setBusy('')}}
 return <section className="account-administration">
  <div className="section-heading"><h2>Client accounts</h2><button className="button" onClick={()=>setVersion(v=>v+1)}>Refresh accounts</button></div>
  <p>Removing workspace access leaves the account saved. Use permanent deletion to remove the account and its signup details.</p>
  {error&&<div className="error-banner" role="alert">{error}</div>}{notice&&<p className="notice" role="status">{notice}</p>}
  <form className="account-search" onSubmit={event=>{event.preventDefault();setPage(1);setQuery(filter.trim())}}><label className="field">Find by exact email<input type="search" value={filter} onChange={e=>setFilter(e.target.value)}/></label><button className="button" type="submit">Find account</button></form>
  {!accounts?<p>Loading accounts…</p>:<><div className="signup-lead-list">{accounts.accounts.map(account=><article className="card account-row" key={account.id}><div><strong>{account.email}</strong><p className="caption">{account.workspaceCount} workspace memberships{account.disabled?' · Disabled':''}</p></div><button className="button" onClick={()=>setSelected(account.id)}>Delete account</button></article>)}{!accounts.accounts.length&&<p>No matching client accounts.</p>}</div><Pager data={accounts} onChange={setPage}/></>}
  <h2>Deletion records</h2><p className="caption">Audit records retain an account ID and email hash, not the email or signup payload. File cleanup retries apply only to deletions already requested. No scheduled purge runs.</p>
  {history&&<><div className="signup-lead-list">{history.deletions.map(record=><article className="card" key={record.id}><div className="section-heading"><strong>{record.cleanupPending?'File cleanup needed':'App deletion complete'}</strong><span className="caption">{new Date(record.deletedAt).toLocaleString()}</span></div><p className="caption">Requested by {record.actor} · {record.reason.replaceAll('_',' ')}</p>{record.crmFollowUpRequired&&<p>Check GoHighLevel separately for the signup event <code className="account-reference">{record.leadEventId}</code>. This app cannot erase a previously delivered CRM contact through its inbound webhook.</p>}<details><summary>Audit details</summary><dl className="definition-list"><dt>Deletion ID</dt><dd>{record.id}</dd><dt>Account ID</dt><dd>{record.userId}</dd><dt>Email hash</dt><dd>{record.emailHash}</dd></dl>{record.files.map(file=><p className="caption" key={file.workspace_id}>{file.workspace_id}: {file.last_error||(file.completed_at?'Files removed':'Cleanup pending')}</p>)}</details>{record.cleanupPending&&<button className="button" disabled={!!busy} onClick={()=>retry(record.id)}>{busy===record.id?'Retrying…':'Retry file cleanup'}</button>}</article>)}</div><Pager data={history} onChange={setHistoryPage}/></>}
  {selected&&<DeleteDialog api={api} userId={selected} onClose={()=>setSelected('')} onDeleted={deleted}/>}
 </section>;
}
