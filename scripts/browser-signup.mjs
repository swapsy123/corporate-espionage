// Synthetic browser checks only; no real provider traffic, accounts or secrets.
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
const dir=mkdtempSync(join(tmpdir(),'levr-signup-browser-')),db=openDatabase(join(dir,'catalog.sqlite'));
const password=randomBytes(24).toString('hex'),clientPassword=randomBytes(24).toString('hex');
const outer=express(),server=outer.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
let deliveryStatus=500;const deliveries=[];
const app=createApp({db,seed:false,password,production:false,secretDirectory:join(dir,'secrets'),secretEncryptionKey:randomBytes(32).toString('hex'),
 leadDeliveryOptions:{webhookUrl:'https://services.leadconnectorhq.com/hooks/test-location/webhook-trigger/test-hook',fetchImpl:async(url,init)=>{deliveries.push(JSON.parse(init.body));return new Response('',{status:deliveryStatus})}},
 socialSignupOptions:{publicBaseUrl:base,googleClientId:'browser-google',googleClientSecret:'browser-secret',facebookAppId:'browser-facebook',facebookAppSecret:'browser-secret',fetchImpl:async(url)=>new Response(JSON.stringify(url.includes('token')?{access_token:'browser-token'}:url.includes('googleapis')?{sub:'browser-google-person',name:'Social Test',email:'social.test@gmail.com',email_verified:true}:{id:'4567890',name:'Facebook Test'}),{headers:{'content-type':'application/json'}})},
});outer.use(app.app);
db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('owner-only','Owner private competitor');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];const screenshotDir=process.env.SIGNUP_SCREENSHOT_DIR||'/tmp/levr-signup-previews';mkdirSync(screenshotDir,{recursive:true});
function watch(page){page.on('pageerror',error=>errors.push(error.message));}
try{
 const client=await browser.newPage({viewport:{width:1440,height:1100}});watch(client);
 const campaign={utm_source:'instagram',utm_medium:'paid_social',utm_campaign:'free_library',utm_content:'carousel_01',utm_term:'growth operators'};
 await client.goto(base+'/?'+new URLSearchParams(campaign));await client.getByRole('button',{name:'Create a free workspace'}).click();await client.getByRole('heading',{name:'Find your next idea.'}).waitFor();
 await client.getByRole('button',{name:'Continue with Google'}).waitFor();await client.getByRole('button',{name:'Continue with Facebook'}).waitFor();
 assert.equal(await client.getByRole('checkbox').isChecked(),false);
 await client.screenshot({path:join(screenshotDir,'desktop.png'),fullPage:true});
 await client.locator('input[name="fullName"]').fill('Lead Test');await client.locator('input[name="email"]').fill('lead.test@gmail.com');await client.locator('input[name="companyName"]').fill('Test company');
 await client.locator('input[name="password"]').fill(clientPassword);await client.locator('input[name="confirmation"]').fill(clientPassword);
 await client.getByRole('button',{name:'Create free workspace'}).click();await client.waitForURL('**/settings');await client.getByRole('heading',{name:'Your research connection.'}).waitFor();
 assert.equal((await (await client.request.get(base+'/api/competitors')).json()).length,0);
 assert.equal((await client.request.get(base+'/api/signup-leads')).status(),403);await app.waitForLeadDelivery();assert.equal(deliveries[0].email,'lead.test@gmail.com');for(const [key,value]of Object.entries(campaign))assert.equal(deliveries[0][key],value);
 assert.equal(await client.evaluate(()=>sessionStorage.getItem('levr_signup_attribution_v1')),null);
 const owner=await browser.newPage({viewport:{width:1440,height:1100}});watch(owner);await owner.goto(base+'/signup-leads');
 await owner.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await owner.getByLabel('Password',{exact:true}).fill(password);await owner.getByRole('button',{name:'Enter workspace'}).click();
 await owner.getByRole('heading',{name:'Your next conversations.'}).waitFor();await owner.getByText('Needs retry',{exact:true}).waitFor();deliveryStatus=200;
 await owner.getByRole('button',{name:'Retry delivery'}).click();await owner.getByText('Webhook accepted',{exact:true}).waitFor();await owner.screenshot({path:join(screenshotDir,'leads.png'),fullPage:true});
 await owner.getByText('Captured fields',{exact:true}).click();await owner.getByText('free_library',{exact:true}).waitFor();
 const mobile=await browser.newPage({viewport:{width:390,height:844}});watch(mobile);await mobile.goto(base+'/signup?utm_source=newsletter&utm_medium=email&utm_campaign=google_flow');await mobile.getByRole('heading',{name:'Find your next idea.'}).waitFor();
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.screenshot({path:join(screenshotDir,'mobile.png'),fullPage:true});
 await mobile.route('https://accounts.google.com/**',async route=>{const u=new URL(route.request().url());await route.fulfill({status:302,headers:{location:`${base}/auth/oauth/google/callback?state=${u.searchParams.get('state')}&code=browser-code`},body:''})});
 await mobile.getByRole('button',{name:'Continue with Google'}).click();await mobile.getByText('Connected with Google.',{exact:false}).waitFor();
 assert.equal(await mobile.locator('input[name="email"]').inputValue(),'social.test@gmail.com');assert.equal(await mobile.locator('input[name="password"]').count(),0);await mobile.locator('input[name="companyName"]').fill('Social company');await mobile.getByRole('button',{name:'Create free workspace'}).click();await mobile.waitForURL('**/settings');
 await app.waitForLeadDelivery();const googleLead=deliveries.find(lead=>lead.signup_method==='google');assert.equal(googleLead.utm_source,'newsletter');assert.equal(googleLead.utm_campaign,'google_flow');assert.equal(googleLead.utm_medium,'email');
 const facebook=await browser.newPage({viewport:{width:390,height:844}});watch(facebook);await facebook.route('https://www.facebook.com/**',async route=>{const u=new URL(route.request().url());await route.fulfill({status:302,headers:{location:`${base}/auth/oauth/facebook/callback?state=${u.searchParams.get('state')}&code=browser-code`},body:''})});
 await facebook.goto(base+'/signup?utm_source=facebook&utm_medium=paid_social&utm_campaign=facebook_flow');await facebook.getByRole('button',{name:'Continue with Facebook'}).click();await facebook.getByText('Connected with Facebook.',{exact:false}).waitFor();
 await facebook.locator('input[name="email"]').fill('facebook.test@gmail.com');await facebook.locator('input[name="companyName"]').fill('Facebook company');await facebook.getByRole('button',{name:'Create free workspace'}).click();await facebook.waitForURL('**/settings');
 await app.waitForLeadDelivery();assert.equal(deliveries.at(-1).email_verified,false);assert.equal(deliveries.at(-1).utm_source,'facebook');assert.equal(deliveries.at(-1).utm_campaign,'facebook_flow');assert.deepEqual(errors,[]);
 console.log('Browser signup passed: password, Google, Facebook without email, immediate private onboarding, lead retry, desktop/mobile layout, and landing-page UTMs retained through navigation and both OAuth redirects.');
}finally{await browser.close();await app.waitForLeadDelivery();await new Promise(resolve=>server.close(resolve));app.closeWorkspaceDatabases();db.close();rmSync(dir,{recursive:true,force:true})}
