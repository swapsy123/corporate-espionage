export const UTM_FIELDS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
export const ATTRIBUTION_KEY = 'levr_signup_attribution_v1';
const MAX_AGE = 24*60*60*1000;
function browserStorage(){try{return globalThis.sessionStorage}catch{return null}}
function allowed(values){
 const result={};
 for(const key of UTM_FIELDS)if(typeof values?.[key]==='string')result[key]=values[key].trim().slice(0,200);
 return result;
}
// Retain the latest tagged visit in this tab across navigation and OAuth.
// An untagged page does not overwrite it; a new campaign replaces it as a set.
export function captureSignupAttribution(search=globalThis.location?.search||'',storage=browserStorage(),now=Date.now()){
 const params=new URLSearchParams(search);
 if(UTM_FIELDS.some(key=>params.has(key))){
  const values=allowed(Object.fromEntries(UTM_FIELDS.filter(key=>params.has(key)).map(key=>[key,params.get(key)])));
  try{storage?.setItem(ATTRIBUTION_KEY,JSON.stringify({values,expiresAt:now+MAX_AGE}))}catch{}
  return values;
 }
 try{
  const saved=JSON.parse(storage?.getItem(ATTRIBUTION_KEY)||'null');
  if(saved&&Number.isFinite(saved.expiresAt)&&saved.expiresAt>now&&saved.expiresAt<=now+MAX_AGE)return allowed(saved.values);
 }catch{}
 clearSignupAttribution(storage);
 return {};
}
export function clearSignupAttribution(storage=browserStorage()){
 try{storage?.removeItem(ATTRIBUTION_KEY)}catch{}
}
