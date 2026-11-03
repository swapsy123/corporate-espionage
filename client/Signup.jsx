import React,{useState} from 'react';
import {captureSignupAttribution,clearSignupAttribution} from './signup-attribution.js';

export default function Signup({api,config,onLogin,onSignIn}) {
 const [error,setError]=useState(()=>new URLSearchParams(location.search).get('auth_error')==='social_removed'?'Google and Facebook sign-in are no longer available. Use email and password, or ask Levr for a password reset.':'');
 const [busy,setBusy]=useState(false);
 const [attribution]=useState(()=>captureSignupAttribution());
 async function submit(event){
  event.preventDefault();const form=event.currentTarget,values=new FormData(form);setError('');
  if(values.get('password')!==values.get('confirmation'))return setError('The passwords do not match.');
  setBusy(true);
  try{const session=await api('/auth/signup',{method:'POST',body:{
   fullName:values.get('fullName'),email:values.get('email'),companyName:values.get('companyName'),
   website:values.get('website'),phone:values.get('phone'),marketingConsent:values.get('marketingConsent')==='on',
   password:values.get('password'),contactAddress:values.get('contactAddress')||'',attribution,
  }});clearSignupAttribution();form.reset();onLogin(session)}catch(error){setError(error.message)}finally{setBusy(false)}
 }
 return <div className="signup-shell">
  <div className="brand">Levr<span className="brand-subtitle">Competitor Analysis</span></div>
  <main className="signup-card">
   <p className="caption">Your free research workspace</p><h1>Find your next idea.</h1>
   <p>Research competitors, save useful creative, and turn the patterns into original briefs.</p>
   {error&&<div className="error-banner" role="alert">{error}</div>}
   {!config.enabled?<><p>New account signup is currently closed. Existing members can still sign in.</p><button className="button" onClick={onSignIn}>Sign in</button></>:<>
    <form onSubmit={submit}>
     <div className="signup-fields">
      <label className="field">Full name<input name="fullName" autoComplete="name" required minLength={2} maxLength={160}/></label>
      <label className="field">Email address<input name="email" type="email" autoComplete="email" required maxLength={254}/><span className="caption">Work email preferred; personal email is welcome.</span></label>
      <label className="field">Company name<input name="companyName" autoComplete="organization" required maxLength={160}/></label>
      <label className="field">Website <span className="caption">Optional</span><input name="website" type="text" inputMode="url" autoComplete="url" maxLength={500} placeholder="example.com"/></label>
      <label className="field signup-full-width">Phone number <span className="caption">Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder="+44 7700 900123"/><span className="caption">Include your country code.</span></label>
      <label className="field">Password<input name="password" type="password" autoComplete="new-password" required minLength={16} maxLength={1024}/><span className="caption">At least 16 characters.</span></label><label className="field">Confirm password<input name="confirmation" type="password" autoComplete="new-password" required minLength={16} maxLength={1024}/></label>
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
