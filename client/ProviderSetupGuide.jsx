import React from 'react';
import {ArrowUpRight} from 'lucide-react';

function Screenshot({src,alt,caption,height}){
 return <figure className="setup-screenshot"><a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Enlarge screenshot: ${caption}`}><img src={src} alt={alt} width="760" height={height} loading="lazy"/></a><figcaption>{caption} <a href={src} target="_blank" rel="noopener noreferrer">Enlarge screenshot</a></figcaption></figure>;
}

export default function ProviderSetupGuide(){
 return <section className="setup-guide" aria-labelledby="setup-guide-title"><div className="section-heading"><div><h2 id="setup-guide-title">Connect your research account</h2><p className="caption">Follow these steps once. This guide disappears after your connection is verified.</p></div><span className="badge">Getting started</span></div><ol className="setup-steps">
  <li><span className="setup-number" aria-hidden="true">01</span><div><h3>Open your ScrapeCreators account</h3><p>Sign in, or create your own account if you’re new. Keep Levr open in this tab.</p><a className="button" href="https://app.scrapecreators.com" target="_blank" rel="noopener noreferrer">Sign in to ScrapeCreators<ArrowUpRight size={16}/></a></div></li>
  <li><span className="setup-number" aria-hidden="true">02</span><div><h3>Copy your API key</h3><p>Find the API key in your ScrapeCreators account and copy it. Use your own account’s key and make sure you have credits available to collect content.</p><p className="caption">Your ScrapeCreators password is not your API key. Paste the key only into the secure field below.</p></div></li>
  <li><span className="setup-number" aria-hidden="true">03</span><div><h3>Paste the key into Levr</h3><p>In the connection form below, paste your key into <strong>ScrapeCreators API key</strong>, then select <strong>Connect ScrapeCreators</strong>. Levr checks it before saving.</p><Screenshot src="/setup/paste-key.png" height={478} alt="Levr’s connection form with a blank, masked API-key field and the Connect ScrapeCreators button." caption="In Levr: paste your key into the secure connection form."/><a className="source-link" href="#research-account">Go to the connection form<ArrowUpRight size={14}/></a></div></li>
  <li><span className="setup-number" aria-hidden="true">04</span><div><h3>Start your competitor research</h3><p>When you see <strong>Connected</strong>, this guide disappears. Select <strong>Set up competitors</strong>, add and confirm their profiles, then run a manual refresh.</p><Screenshot src="/setup/connected.png" height={716} alt="Levr showing a verified Connected status and the Set up competitors button." caption="In Levr: a verified account is ready for competitor setup."/></div></li>
 </ol></section>;
}
