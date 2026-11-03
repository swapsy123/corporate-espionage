import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const cookieValue=(req,name)=>(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${name}=`))?.slice(name.length+1);
function origin(raw,production) {
  try {
    const url=new URL(raw);
    if (url.username||url.password||url.pathname!=='/'||url.search||url.hash) return null;
    if (url.protocol!=='https:' && !(!production && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
// Google and Facebook authentication have been retired. Keep graceful responses
// for old links/cached clients and the deletion callback for any historical data.
// Existing credentials cannot re-enable provider sign-in.
export function createSocialSignup(db,options={}){
 // These temporary grants can no longer be completed. Invalidate them on
 // startup while retaining accounts, linked identities and deletion records.
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('DELETE FROM pending_social_signups; DELETE FROM signup_oauth_states; DELETE FROM account_deletion_reauth;');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
 const production=options.production??process.env.NODE_ENV==='production';
 const base=origin(options.publicBaseUrl??process.env.PUBLIC_BASE_URL??process.env.RENDER_EXTERNAL_URL,production);
 const facebookSecret=options.facebookAppSecret??process.env.LEVR_META_LOGIN_APP_SECRET;
 const bindingCookie=production?'__Host-levr_oauth':'levr_oauth';
 const pendingCookie=production?'__Host-levr_social_signup':'levr_social_signup';
 const clear=res=>{for(const name of [bindingCookie,pendingCookie])res.cookie(name,'',{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:0})};
 function discard(req,res){
  const ticket=cookieValue(req,pendingCookie),binding=cookieValue(req,bindingCookie);
  if(validToken(ticket))db.prepare('DELETE FROM pending_social_signups WHERE token_hash=?').run(digest(ticket));
  if(validToken(binding))db.prepare('DELETE FROM signup_oauth_states WHERE browser_hash=?').run(digest(binding));
  clear(res);
 }
 const retired=(req,res)=>{discard(req,res);res.status(410).json({error:'Google and Facebook sign-in have been removed. Use email and password. Contact Levr for a password reset if needed.'})};
 function registerRoutes(app){
  app.post('/auth/oauth/:provider/start',retired);
  app.get('/auth/oauth/:provider/callback',(req,res)=>{discard(req,res);res.redirect('/signup?auth_error=social_removed')});
  app.post('/auth/oauth/cancel',(req,res)=>{discard(req,res);res.json({ok:true})});
 }
  function verifyFacebookDeletion(value){
    if(!facebookSecret||!base)return {unconfigured:true};
    try{
      if(typeof value!=='string'||value.length>16000)throw Error();
      const parts=value.split('.');if(parts.length!==2||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))throw Error();
      const [signature,payload]=parts,received=Buffer.from(signature,'base64url');
      if(received.length!==32||received.toString('base64url')!==signature)throw Error();
      const expected=createHmac('sha256',facebookSecret).update(payload).digest();
      if(!timingSafeEqual(received,expected))throw Error();
      const decoded=Buffer.from(payload,'base64url');if(decoded.toString('base64url')!==payload)throw Error();
      const data=JSON.parse(decoded.toString('utf8'));
      if(data.algorithm!=='HMAC-SHA256'||typeof data.user_id!=='string'||!/^\d{1,255}$/.test(data.user_id))throw Error();
      if(!Number.isSafeInteger(data.issued_at)||data.issued_at<=0||data.issued_at>Math.floor(Date.now()/1000)+300)throw Error();
      return {subject:data.user_id,issuedAt:data.issued_at*1000};
    }catch{return null}
  }
 return {available:()=>({google:false,facebook:false}),context:()=>null,clear,discard,registerRoutes,startDeletionReauth:retired,verifyFacebookDeletion,publicBaseUrl:base};
}
