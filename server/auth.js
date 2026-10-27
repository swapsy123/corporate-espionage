import {randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
export const digest = v=>createHash('sha256').update(v).digest('hex');
export function auth(db,options={}){
 // Restart revokes sessions, including after owner/password rotation.
 db.prepare('DELETE FROM sessions').run();
 const password=options.password??process.env.LEVR_OWNER_PASSWORD;
 const ownerEmail=(options.ownerEmail??process.env.OWNER_EMAIL??'fraser@wearelevr.com').toLowerCase();
 const production=options.production??process.env.NODE_ENV==='production';
 const salt=randomBytes(32);
 const expected=password&&password.length>=16?scryptSync(password,salt,64):null;
 const cookieName=production?'__Host-levr_session':'levr_session';
 function cookie(res,token,maxAge){res.cookie(cookieName,token,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge});}
 function login(req,res){
  if(!expected)return res.status(503).json({error:'Owner access is not configured. Set LEVR_OWNER_PASSWORD to a unique password of at least 16 characters in secure environment settings.'});
  const key=digest(req.ip||'unknown'),time=Date.now();
  db.prepare('DELETE FROM login_attempts WHERE expires_at<?').run(time);
  const attempts=db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);
  if(attempts?.count>=8)return res.status(429).json({error:'Too many sign-in attempts. Try again in 15 minutes.'});
  const {email,password:input}=req.body||{};
  const valid=typeof input==='string'&&input.length<=1024&&timingSafeEqual(scryptSync(input,salt,64),expected)&&typeof email==='string'&&email.toLowerCase()===ownerEmail;
  if(!valid){db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,time+900000);return res.status(401).json({error:'Email or password is incorrect.'});}
  db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(time);
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token),csrf,time+43200000);
  cookie(res,token,43200000);res.json({user:{email:ownerEmail},csrf});
 }
 function requireAuth(req,res,next){
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));
  const token=cookies[cookieName];
  const session=typeof token==='string'?db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()):null;
  if(!session)return res.status(401).json({error:'Sign in to access your private intelligence library.'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==session.csrf)return res.status(403).json({error:'Your session security token is missing or expired. Reload and try again.'});
  req.session=session;next();
 }
 function logout(req,res){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);cookie(res,'',0);res.json({ok:true});}
 return {login,requireAuth,logout,ownerEmail};
}
