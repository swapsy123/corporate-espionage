import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validEmail = value => typeof value === 'string' && value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const cookieValue = (req,name) => (req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${name}=`))?.slice(name.length+1);
function origin(raw,production) {
  try {
    const url=new URL(raw);
    if (url.username||url.password||url.pathname!=='/'||url.search||url.hash) return null;
    if (url.protocol!=='https:' && !(!production && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
export function createSocialSignup(db,options={}) {
  const production=options.production??process.env.NODE_ENV==='production';
  const base=origin(options.publicBaseUrl??process.env.PUBLIC_BASE_URL??process.env.RENDER_EXTERNAL_URL,production);
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const enabled=options.signupEnabled!==false;
  const providers={
    google:{id:options.googleClientId??process.env.LEVR_GOOGLE_CLIENT_ID,secret:options.googleClientSecret??process.env.LEVR_GOOGLE_CLIENT_SECRET,
      authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',profile:'https://openidconnect.googleapis.com/v1/userinfo'},
    facebook:{id:options.facebookAppId??process.env.LEVR_META_LOGIN_APP_ID,secret:options.facebookAppSecret??process.env.LEVR_META_LOGIN_APP_SECRET,
      authorize:'https://www.facebook.com/v23.0/dialog/oauth',token:'https://graph.facebook.com/v23.0/oauth/access_token',profile:'https://graph.facebook.com/v23.0/me?fields=id,name,email'},
  };
  const bindingCookie=production?'__Host-levr_oauth':'levr_oauth';
  const pendingCookie=production?'__Host-levr_social_signup':'levr_social_signup';
  const cookie=(res,name,value,age,sameSite='lax')=>res.cookie(name,value,{httpOnly:true,secure:production,sameSite,path:'/',maxAge:age});
  const available=()=>Object.fromEntries(Object.entries(providers).map(([name,p])=>[name,!!(base&&p.id&&p.secret)]));
  const pending=req=>{
    const token=cookieValue(req,pendingCookie);
    return validToken(token)?db.prepare('SELECT * FROM pending_social_signups WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()):null;
  };
  const context=req=>{
    const p=pending(req);return p?{provider:p.provider,email:p.email,emailVerified:!!p.email_verified,fullName:p.full_name}:null;
  };
  function consume(req,p) {
    const token=cookieValue(req,pendingCookie);
    if (!validToken(token) || digest(token)!==p.token_hash) throw Error('Social signup expired.');
    const consumed=db.prepare('DELETE FROM pending_social_signups WHERE token_hash=? AND expires_at>?').run(p.token_hash,Date.now());
    if(consumed.changes!==1)throw Error('Social signup expired.');
  }
  const clear=res=>cookie(res,pendingCookie,'',0,'strict');
  async function json(url,init={}) {
    const response=await fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Provider request failed.');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>100000)throw Error('Provider response too large.');chunks.push(Buffer.from(chunk));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function start(req,res,reauth=false){
      const name=req.params.provider,p=Object.hasOwn(providers,name)?providers[name]:null;
      if(!p||!available()[name])return res.status(503).json({error:'This sign-in option is not configured yet. Use email and password.'});
      if(reauth&&(req.user?.role!=='client'||!db.prepare('SELECT 1 FROM social_identities WHERE user_id=? AND provider=?').get(req.user.id,name)))
        return res.status(403).json({error:'Use a sign-in provider already linked to your own client account.'});
      const now=Date.now(),key=digest(`oauth:${req.ip||'unknown'}`);
      db.prepare('DELETE FROM signup_attempts WHERE expires_at<?').run(now);
      if((db.prepare('SELECT count FROM signup_attempts WHERE key=?').get(key)?.count||0)>=30)
        return res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});
      db.prepare('INSERT INTO signup_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);
      db.prepare('DELETE FROM signup_oauth_states WHERE expires_at<?').run(now);
      db.prepare('DELETE FROM pending_social_signups WHERE expires_at<?').run(now);
      const state=randomBytes(32).toString('base64url'),binding=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO signup_oauth_states VALUES (?,?,?,?)').run(digest(state),digest(binding),name,now+600000);
      if(reauth)db.prepare('INSERT INTO account_deletion_challenges VALUES (?,?,?)').run(digest(state),req.user.id,req.session.token_hash);
      cookie(res,bindingCookie,binding,600000);
      const url=new URL(p.authorize);
      const params={client_id:p.id,redirect_uri:`${base}/auth/oauth/${name}/callback`,response_type:'code',state,
        scope:name==='google'?'openid email profile':'public_profile,email'};
      if(name==='google')Object.assign(params,{prompt:'select_account',code_challenge:createHash('sha256').update(binding).digest('base64url'),code_challenge_method:'S256'});
      if(reauth)Object.assign(params,name==='google'?{max_age:'0'}:{auth_type:'reauthenticate'});
      for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
      res.json({url:url.href});
  }
  function registerRoutes(app,{signIn}) {
    app.post('/auth/oauth/:provider/start',(req,res)=>start(req,res));
    app.get('/auth/oauth/:provider/callback',async(req,res)=>{
      const name=req.params.provider,p=Object.hasOwn(providers,name)?providers[name]:null,binding=cookieValue(req,bindingCookie),state=req.query.state;
      let challenge;
      const failed=code=>res.redirect(challenge?'/settings?account_delete_auth=failed':`/signup?auth_error=${code}`);
      if(!p||!available()[name]||!validToken(state)||!validToken(binding))return failed('oauth_failed');
      // Capture the intent before consuming state cascades the challenge row.
      challenge=db.prepare('SELECT * FROM account_deletion_challenges WHERE state_hash=?').get(digest(state));
      const used=db.prepare('DELETE FROM signup_oauth_states WHERE state_hash=? AND browser_hash=? AND provider=? AND expires_at>? RETURNING provider,expires_at')
        .get(digest(state),digest(binding),name,Date.now());
      if(!used)return failed('oauth_failed');
      cookie(res,bindingCookie,'',0);
      if(req.query.error||typeof req.query.code!=='string'||req.query.code.length>4096)return failed('oauth_cancelled');
      try {
        const form=new URLSearchParams({client_id:p.id,client_secret:p.secret,code:req.query.code,
          redirect_uri:`${base}/auth/oauth/${name}/callback`,grant_type:'authorization_code'});
        if(name==='google')form.set('code_verifier',binding);
        const token=await json(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:form.toString()});
        if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>8192)throw Error('Missing provider token.');
        const profile=await json(p.profile,{headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/json'}});
        const subject=name==='google'?profile.sub:profile.id;
        if(typeof subject!=='string'||!subject||subject.length>255)throw Error('Missing provider identity.');
        const email=typeof profile.email==='string'?profile.email.trim().toLowerCase():null;
        if(name==='google'&&(!validEmail(email)||profile.email_verified!==true))throw Error('Verified Google email required.');
        if(name==='facebook'&&!/^\d+$/.test(subject))throw Error('Invalid Facebook identity.');
        const deleted=db.prepare('SELECT deleted_at FROM deleted_social_identities WHERE provider=? AND subject_hash=?').get(name,digest(subject));
        if(deleted&&deleted.deleted_at>=used.expires_at-600000)throw Error('Identity deleted during sign-in.');
        const user=db.prepare('SELECT u.id,u.email,u.disabled FROM social_identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=?').get(name,subject);
        if(challenge){
          const session=db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(challenge.session_hash,challenge.user_id,Date.now());
          if(!session||!user||user.disabled||user.id!==challenge.user_id)throw Error('Reauthentication identity mismatch.');
          db.prepare('INSERT INTO account_deletion_reauth VALUES (?,?,?) ON CONFLICT(session_hash) DO UPDATE SET expires_at=excluded.expires_at,user_id=excluded.user_id')
            .run(challenge.session_hash,challenge.user_id,Date.now()+300000);
          return res.redirect('/settings?account_delete_auth=verified');
        }
        if(user){
          if(user.disabled||!db.prepare('SELECT 1 FROM memberships WHERE user_id=?').get(user.id))return failed('access_unavailable');
          clear(res);signIn(req,res,{id:user.id,email:user.email,role:'client'});return;
        }
        if(!enabled)return failed('signup_disabled');
        const ticket=randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO pending_social_signups VALUES (?,?,?,?,?,?,?)')
          .run(digest(ticket),name,subject,validEmail(email)?email:null,name==='google'?1:0,
            typeof profile.name==='string'?profile.name.trim().slice(0,160):'',Date.now()+900000);
        cookie(res,pendingCookie,ticket,900000,'strict');
        res.redirect('/signup');
      }catch{failed('oauth_failed');}
    });
    app.post('/auth/oauth/cancel',(req,res)=>{
      const p=pending(req);if(p)db.prepare('DELETE FROM pending_social_signups WHERE token_hash=?').run(p.token_hash);
      clear(res);res.json({ok:true});
    });
  }
  function verifyFacebookDeletion(value){
    if(!providers.facebook.secret||!base)return {unconfigured:true};
    try{
      if(typeof value!=='string'||value.length>16000)throw Error();
      const parts=value.split('.');if(parts.length!==2||parts.some(part=>!part||!/^[A-Za-z0-9_-]+$/.test(part)))throw Error();
      const [signature,payload]=parts,received=Buffer.from(signature,'base64url');
      if(received.length!==32||received.toString('base64url')!==signature)throw Error();
      const expected=createHmac('sha256',providers.facebook.secret).update(payload).digest();
      if(!timingSafeEqual(received,expected))throw Error();
      const decoded=Buffer.from(payload,'base64url');if(decoded.toString('base64url')!==payload)throw Error();
      const data=JSON.parse(decoded.toString('utf8'));
      if(data.algorithm!=='HMAC-SHA256'||typeof data.user_id!=='string'||!/^\d{1,255}$/.test(data.user_id))throw Error();
      if(!Number.isSafeInteger(data.issued_at)||data.issued_at<=0||data.issued_at>Math.floor(Date.now()/1000)+300)throw Error();
      return {subject:data.user_id,issuedAt:data.issued_at*1000};
    }catch{return null}
  }
  return {available,pending,context,consume,clear,registerRoutes,startDeletionReauth:(req,res)=>start(req,res,true),verifyFacebookDeletion,publicBaseUrl:base};
}
