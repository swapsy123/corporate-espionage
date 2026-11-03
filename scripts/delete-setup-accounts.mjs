// Run in the Render service Shell so requests reach the running process. This
// avoids unlinking files behind that process's cached SQLite connections.
// Credentials come from the service environment and are never printed.
const targets=Array.from({length:4},(_,i)=>`braceyfraser+levrtest${i+1}@gmail.com`);
const apply=process.argv.includes('--apply');
const retry=process.argv.includes('--retry-cleanup');
if(process.argv.slice(2).some(arg=>!['--apply','--retry-cleanup'].includes(arg)))throw Error('Use --apply to delete the four setup accounts or --retry-cleanup to resume recorded file cleanup.');
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local service port.');
const base=`http://127.0.0.1:${port}`;
let cookie='',csrf='';
async function request(path,{method='GET',body}={}){
 const response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok)throw Error(`Local service returned HTTP ${response.status}. Confirm the latest deployment is running and the owner settings are configured.`);
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();if(data.csrf)csrf=data.csrf;return data;
}
try{
 if(!process.env.LEVR_OWNER_PASSWORD)throw Error('Run in the service Shell with its existing owner environment settings.');
 await request('/auth/login',{method:'POST',body:{email:process.env.OWNER_EMAIL||'fraser@wearelevr.com',password:process.env.LEVR_OWNER_PASSWORD}});
 if(retry){
  const pending=[];let page=1,result;
  do{result=await request(`/api/account-deletions?page=${page++}`);if(!Array.isArray(result.deletions))throw Error('The deletion API is unavailable. Deploy the current code first.');pending.push(...result.deletions.filter(row=>row.cleanupPending));}while(result.hasMore);
  let remaining=0;
  for(const row of pending)if((await request(`/api/account-deletions/${row.id}/retry`,{method:'POST',body:{}})).cleanupPending)remaining++;
  console.log(JSON.stringify({retried:pending.length,cleanupStillPending:remaining}));
 }else{
  let found=0,removed=0,pending=0,crmFollowUps=0;
  for(const email of targets){
   const data=await request(`/api/accounts?email=${encodeURIComponent(email)}`);
   if(!Array.isArray(data.accounts))throw Error('The deletion API is unavailable. Deploy the current code first.');
   const account=data.accounts.find(row=>row.email===email);if(!account)continue;found++;
   if(apply){const result=await request(`/api/accounts/${account.id}`,{method:'DELETE',body:{confirmationEmail:email,reason:'setup_cleanup'}});removed++;pending+=Number(result.cleanupPending);crmFollowUps+=Number(result.crmFollowUpRequired)}
  }
  console.log(JSON.stringify({mode:apply?'delete':'preview',matchedSetupAccounts:found,deleted:removed,cleanupPending:pending,crmFollowUps}));
  if(!apply)console.log('Preview only. Add --apply to delete these four setup accounts through the running account-deletion service.');
 }
}catch(error){console.error(error.message.startsWith('Local service')||error.message.startsWith('Run in')||error.message.startsWith('The deletion API')?error.message:'Cleanup did not finish. Check the running local service and retry; no credentials are printed.');process.exitCode=1}
finally{if(cookie)try{await request('/auth/logout',{method:'POST',body:{}})}catch{}cookie='';csrf=''}
