import React,{useEffect,useState} from 'react';

const labels={pending:'Waiting',sending:'Sending',delivered:'Webhook accepted',failed:'Needs retry',unconfigured:'Connection needed'};
export default function SignupLeads({api}) {
 const [page,setPage]=useState(1),[version,setVersion]=useState(0),[data,setData]=useState(null),[status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
 useEffect(()=>{let alive=true;setError('');Promise.all([api(`/api/signup-leads?page=${page}`),api('/api/signup-leads/status')]).then(([rows,connection])=>{if(alive){setData(rows);setStatus(connection)}}).catch(e=>alive&&setError(e.message));return()=>{alive=false}},[page,version]);
 useEffect(()=>{if(!data?.leads.some(lead=>['sending','pending'].includes(lead.deliveryStatus))||!status?.configured)return;const timer=setInterval(()=>setVersion(v=>v+1),2500);return()=>clearInterval(timer)},[data,status]);
 async function retry(id){setBusy(id);setError('');try{await api(`/api/signup-leads/${id}/retry`,{method:'POST',body:{}});setVersion(v=>v+1)}catch(e){setError(e.message)}finally{setBusy('')}}
 return <>
  <header className="page-header"><div><div className="eyebrow">Owner administration</div><h1 className="page-title">Your next conversations.</h1><p className="page-description">Free signups and their handoff to GoHighLevel. Each person receives a private workspace immediately.</p></div><button className="button" onClick={()=>setVersion(v=>v+1)}>Refresh list</button></header>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  <section className="card signup-connection"><h2>GoHighLevel lead capture</h2>
   <p>{status?.configured?`${status.provider} webhook configured.`:'Connect your GHL inbound webhook to start sending signup details.'}</p>
   {status?.error&&<p className="caption">{status.error}</p>}
   <ol><li>In your Levr GHL subaccount, create a workflow with an <strong>Inbound Webhook</strong> trigger.</li><li>Save its URL as <code>LEVR_SIGNUP_WEBHOOK_URL</code> in this free app’s Render environment, then deploy.</li><li>Complete a test signup, capture its payload in GHL, and map the fields in a <strong>Create/Update Contact</strong> action.</li></ol>
   <p className="caption">Map first_name → first name, last_name → last name, email → email, company_name → company, website → website, and phone → phone. Preserve full_name in a custom field if needed. Use event_id for deduplication and email to match contacts. Keep existing opt-outs. Marketing follow-up requires marketing_email_opt_in to be true; this form does not collect SMS permission.</p>
   <p className="caption">“Webhook accepted” confirms the handoff. Check GHL’s workflow history to confirm the contact action completed. Failed deliveries stay saved here for manual retry.</p>
   <p className="caption">Campaign tracking: map utm_source, utm_medium, utm_campaign, utm_content and utm_term to the matching GHL custom fields. These follow the visitor from their landing page through signup. Open “Captured fields” on a lead to inspect them.</p>
  </section>
  {!data?<p role="status">Loading signups…</p>:<>
   <div className="section-heading"><h2>Signup leads</h2><span className="caption">{data.total} total</span></div>
   {data.leads.length?<div className="signup-lead-list">{data.leads.map(lead=><article className="card signup-lead" key={lead.id}>
    <div><h3>{lead.details.full_name}</h3><p>{lead.email}</p><p className="caption">{lead.details.company_name} · {new Date(lead.createdAt).toLocaleString()}</p><p className="caption">{lead.details.signup_method==='password'?'Email signup':`${lead.details.signup_method} signup`} · Email marketing {lead.details.marketing_email_opt_in?'opted in':'not selected'}</p>
     {(lead.details.phone||lead.details.website)&&<p className="caption">{[lead.details.phone,lead.details.website].filter(Boolean).join(' · ')}</p>}
     <details><summary>Captured fields</summary><dl className="definition-list">{Object.entries(lead.details).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{value===null?'Not supplied':String(value)}</dd></React.Fragment>)}</dl></details>
    </div><div className="signup-delivery"><span className="badge">{labels[lead.deliveryStatus]}</span><span className="caption">{lead.attempts} delivery attempts</span>{lead.error&&<p className="caption">{lead.error}</p>}{['failed','unconfigured','pending'].includes(lead.deliveryStatus)&&<button className="button" disabled={!status?.configured||!!busy} onClick={()=>retry(lead.id)}>{busy===lead.id?'Queueing…':'Retry delivery'}</button>}</div>
   </article>)}</div>:<div className="empty-state"><h3>Your first signup starts here.</h3><p>Share <a href="/signup" target="_blank" rel="noopener noreferrer">the free signup page</a> to collect leads and create their workspaces.</p></div>}
   <div className="signup-pagination"><button className="button" disabled={page<=1} onClick={()=>{setData(null);setPage(p=>p-1)}}>Previous</button><span className="caption">Page {page}</span><button className="button" disabled={!data.hasMore} onClick={()=>{setData(null);setPage(p=>p+1)}}>Next</button></div>
  </>}
 </>;
}
