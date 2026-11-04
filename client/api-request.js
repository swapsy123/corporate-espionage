// Retry only reads from our stored library. Some GET routes (profile search)
// spend provider credits, and mutations must never be replayed automatically.
const storedReads=new Set(['/api/items','/api/status','/api/competitors']);
const gatewayStatuses=new Set([502,503,504]);
export class ApiRequestError extends Error{
 constructor(message,{status=0,retryable=false}={}){super(message);this.name='ApiRequestError';this.status=status;this.retryable=retryable;}
}
function describe(path){
 const url=new URL(path,'https://app.invalid');
 const labels={'/api/status':'Workspace status','/api/competitors':'Competitor list','/api/refresh':'Competitor refresh','/api/profile-candidates':'Meta Page search'};
 return {pathname:url.pathname,label:url.pathname==='/api/items'?(url.searchParams.get('kind')==='paid'?'Paid ad library':url.searchParams.get('kind')==='organic'?'Organic library':'Intelligence library'):labels[url.pathname]||'Request'};
}
function unreadable(response,label,read){
 const status=response.status;
 if(gatewayStatuses.has(status))return new ApiRequestError(`${label}: the server is temporarily unavailable (HTTP ${status}). ${read?'Try loading again shortly.':'Check whether the action completed before trying again.'}`,{status,retryable:true});
 if(status===401)return new ApiRequestError('Your session has expired. Sign in again.',{status});
 return new ApiRequestError(`${label}: the server returned unreadable data (HTTP ${status}). Reload the page; if this continues, contact Levr.`,{status});
}
export async function requestJson(path,options={}, {fetchImpl=globalThis.fetch,isCurrent=()=>true,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const {pathname,label}=describe(path),read=(options.method||'GET').toUpperCase()==='GET',canRetry=read&&storedReads.has(pathname),delays=[750,1750];
 const check=()=>{if(!isCurrent())throw new ApiRequestError('Workspace changed.')};
 for(let attempt=0;;attempt++){
  check();
  try{
   let response;
   try{response=await fetchImpl(path,options)}catch{throw new ApiRequestError(`${label}: the connection to the server was interrupted. Check your connection and try again.`,{retryable:true})}
   let data;try{data=await response.json()}catch{throw unreadable(response,label,read)}
   check();
   if(!response.ok){
    // Preserve the app's actionable JSON errors, rather than retrying rejected
    // credentials, permissions, missing settings or provider limits.
    if(typeof data?.error==='string'&&data.error)throw new ApiRequestError(data.error,{status:response.status});
    throw unreadable(response,label,read);
   }
   if(!data||typeof data!=='object')throw unreadable(response,label,read);
   if(pathname==='/api/items'&&!Array.isArray(data))throw unreadable(response,label,read);
   return data;
  }catch(error){
   check();
   if(!canRetry||!error.retryable||attempt>=delays.length)throw error;
   await wait(delays[attempt]);
  }
 }
}
