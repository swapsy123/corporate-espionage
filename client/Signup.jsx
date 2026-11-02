import React,{useState} from 'react';
import {captureSignupAttribution,clearSignupAttribution} from './signup-attribution.js';

export function SocialButtons({api,providers={},onError}) {
 const [busy,setBusy]=useState('');
 async function begin(provider){setBusy(provider);onError('');try{const response=await api(`/auth/oauth/${provider}/start`,{method:'POST',body:{}});location.assign(response.url)}catch(error){onError(error.message);setBusy('')}}
 if(!providers.google&&!providers.facebook)return null;
 return <div className="social-signup-buttons" aria-label="Other sign-in options">
  {providers.google&&<button type="button" className="button" disabled={!!busy} onClick={()=>begin('google')}>{busy==='google'?'Opening Google…':'Continue with Google'}</button>}
  {providers.facebook&&<button type="button" className="button" disabled={!!busy} onClick={()=>begin('facebook')}>{busy==='facebook'?'Opening Facebook…':'Continue with Facebook'}</button>}
 </div>;
}
const oauthErrors={oauth_failed:'Sign-in could not be completed. Try again or use email and password.',oauth_cancelled:'Sign-in was cancelled. You can try again or use email and password.',access_unavailable:'This account does not currently have workspace access. Contact Levr.',signup_disabled:'New account signup is currently closed.'};
export default function Signup({api,config,onLogin,onSignIn}) {
 const [error,setError]=useState(()=>oauthErrors[new URLSearchParams(location.search).get('auth_error')]||'');
 const [busy,setBusy]=useState(false),[social,setSocial]=useState(config.social);
 const [attribution]=useState(()=>captureSignupAttribution());
 async function useEmail(){setBusy(true);setError('');try{await api('/auth/oauth/cancel',{method:'POST',body:{}});setSocial(null)}catch(error){setError(error.message)}finally{setBusy(false)}}
 async function submit(event){
  event.preventDefault();const form=event.currentTarget,values=new FormData(form);setError('');
  if(!social&&values.get('password')!==values.get('confirmation'))return setError('The passwords do not match.');
  setBusy(true);
  try{const session=await api('/auth/signup',{method:'POST',body:{
   fullName:values.get('fullName'),email:values.get('email'),companyName:values.get('companyName'),
   website:values.get('website'),phone:values.get('phone'),marketingConsent:values.get('marketingConsent')==='on',
   password:social?undefined:values.get('password'),contactAddress:values.get('contactAddress')||'',attribution,
  }});clearSignupAttribution();form.reset();onLogin(session)}catch(error){setError(error.message)}finally{setBusy(false)}
 }
 return <div className="signup-shell">
  <div className="brand">Levr<span className="brand-subtitle">Competitor Analysis</span></div>
  <main className="signup-card">
   <p className="caption">Your free research workspace</p><h1>Find your next idea.</h1>
   <p>Research competitors, save useful creative, and turn the patterns into original briefs.</p>
   {error&&<div className="error-banner" role="alert">{error}</div>}
   {!config.enabled?<><p>New account signup is currently closed. Existing members can still sign in.</p><button className="button" onClick={onSignIn}>Sign in</button></>:<>
    {social?<div className="notice"><p>Connected with {social.provider==='google'?'Google':'Facebook'}. Complete your details to create your workspace.</p><button type="button" className="text-button" disabled={busy} onClick={useEmail}>Use email and password instead</button></div>:<SocialButtons api={api} providers={config.providers} onError={setError}/>}
    <form onSubmit={submit} key={`${social?.provider||'password'}:${social?.email||''}`}>
     <div className="signup-fields">
      <label className="field">Full name<input name="fullName" autoComplete="name" required minLength={2} maxLength={160} defaultValue={social?.fullName||''}/></label>
      <label className="field">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={social?.email||''} readOnly={!!social?.email}/><span className="caption">Work email preferred; personal email is welcome.</span></label>
      <label className="field">Company name<input name="companyName" autoComplete="organization" required maxLength={160}/></label>
      <label className="field">Website <span className="caption">Optional</span><input name="website" type="text" inputMode="url" autoComplete="url" maxLength={500} placeholder="example.com"/></label>
      <label className="field signup-full-width">Phone number <span className="caption">Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder="+44 7700 900123"/><span className="caption">Include your country code.</span></label>
      {!social&&<><label className="field">Password<input name="password" type="password" autoComplete="new-password" required minLength={16} maxLength={1024}/><span className="caption">At least 16 characters.</span></label><label className="field">Confirm password<input name="confirmation" type="password" autoComplete="new-password" required minLength={16} maxLength={1024}/></label></>}
     </div>
     <div className="signup-honeypot" aria-hidden="true"><label>Leave this empty<input name="contactAddress" tabIndex={-1} autoComplete="off"/></label></div>
     <label className="signup-consent"><input type="checkbox" name="marketingConsent"/><span>{config.consentText}</span></label>
     <p className="caption">We use your details to create your account and help you get started. Marketing emails are optional.</p>
     <button className="button primary" type="submit" disabled={busy}>{busy?'Creating your workspace…':'Create free workspace'}</button>
    </form>
    <p className="caption signup-provider-note">Your workspace is free. Connect your own ScrapeCreators account to collect competitor content; provider credits are managed separately.</p>
    <p className="caption">Already have an account? <button className="text-button" type="button" onClick={onSignIn}>Sign in</button></p>
   </>}
  </main>
 </div>;
}
