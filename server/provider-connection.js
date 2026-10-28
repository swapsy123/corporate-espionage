// Account contract: official @scrapecreators/cli 1.0.87 api-config/apis.js,
// Account / Get credit balance. This checks account access without collecting content.
const BALANCE_URL='https://api.scrapecreators.com/v1/account/credit-balance';
const MAX_BYTES=64*1024;
export class ProviderConnectionError extends Error {
 constructor(message,status=502){super(message);this.name='ProviderConnectionError';this.safeMessage=message;this.status=status;}
}
export async function verifyProviderAccount({apiKey,fetchImpl=globalThis.fetch,signal}={}){
 if(typeof apiKey!=='string'||!apiKey.length||apiKey.length>4096||/[^\x21-\x7e]/.test(apiKey))throw new ProviderConnectionError('Enter a valid ScrapeCreators API key without spaces or line breaks.',400);
 let response;
 try{response=await fetchImpl(BALANCE_URL,{method:'GET',headers:{'x-api-key':apiKey,accept:'application/json'},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}
 catch{throw new ProviderConnectionError('ScrapeCreators could not be reached. Try connecting again shortly. Your saved key has not changed.');}
 if(!response.ok){
  const errors={401:['ScrapeCreators rejected that API key. Copy the key from your ScrapeCreators account and try again.',400],403:['ScrapeCreators denied API access. Check the account in ScrapeCreators and try again.',400],402:['ScrapeCreators requires account credits before it can verify access. Check your account and try again.',400],429:['ScrapeCreators is receiving too many requests. Wait briefly and try connecting again.',429]};
  const [message,status]=errors[response.status]||['ScrapeCreators could not verify the connection. Try again shortly. Your saved key has not changed.',502];
  throw new ProviderConnectionError(message,status);
 }
 let data;
 try{
  if(Number(response.headers?.get('content-length'))>MAX_BYTES)throw Error();
  if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  else data=await response.json();
 }catch{throw new ProviderConnectionError('ScrapeCreators returned an unreadable account response. Try again shortly. Your saved key has not changed.');}
 if(!data||Array.isArray(data)||data.success===false||data.error||typeof data.creditCount!=='number'||!Number.isFinite(data.creditCount)||data.creditCount<0)throw new ProviderConnectionError('ScrapeCreators could not confirm this account. Check your API key and try again. Your saved key has not changed.');
 return {creditCount:data.creditCount};
}
