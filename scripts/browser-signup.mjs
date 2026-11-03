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
 assert.equal(await client.getByRole('button',{name:/Continue with Google|Continue with Facebook/}).count(),0);
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
 const mobile=await browser.newPage({viewport:{width:390,height:844}});watch(mobile);await mobile.goto(base+'/signup?utm_source=newsletter&utm_medium=email&utm_campaign=email_flow');await mobile.getByRole('heading',{name:'Find your next idea.'}).waitFor();
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.screenshot({path:join(screenshotDir,'mobile.png'),fullPage:true});
 assert.equal(await mobile.getByRole('button',{name:/Continue with Google|Continue with Facebook/}).count(),0);
 await mobile.reload();await mobile.locator('input[name="fullName"]').fill('Mobile Email');await mobile.locator('input[name="email"]').fill('mobile.email@gmail.com');await mobile.locator('input[name="companyName"]').fill('Mobile company');await mobile.locator('input[name="password"]').fill(clientPassword);await mobile.locator('input[name="confirmation"]').fill(clientPassword);await mobile.getByRole('button',{name:'Create free workspace'}).click();await mobile.waitForURL('**/settings');
 await app.waitForLeadDelivery();assert.equal(deliveries.at(-1).signup_method,'password');assert.equal(deliveries.at(-1).utm_source,'newsletter');assert.equal(deliveries.at(-1).utm_campaign,'email_flow');
 await mobile.getByRole('button',{name:'Open navigation'}).click();await mobile.getByRole('button',{name:'Sign out',exact:true}).click();await mobile.getByRole('heading',{name:'Welcome back.'}).waitFor();assert.equal(await mobile.getByRole('button',{name:/Continue with Google|Continue with Facebook/}).count(),0);
 await mobile.getByLabel('Email address',{exact:true}).fill('mobile.email@gmail.com');await mobile.getByLabel('Password',{exact:true}).fill(clientPassword);await mobile.getByRole('button',{name:'Enter workspace'}).click();await mobile.getByLabel('Current workspace').waitFor({state:'attached'});
 const expired=await browser.newPage();watch(expired);await expired.goto(base+'/auth/oauth/google/callback?code=old-code');await expired.getByRole('alert').waitFor();assert.equal(await expired.locator('input[name="password"]').count(),1);
 assert.deepEqual(errors,[]);
 console.log('Browser signup passed: email/password only, no provider buttons despite configured test credentials, immediate private onboarding, lead retry, login/logout, desktop/mobile layout, retired callback guidance and retained UTMs through navigation/reload.');
}finally{await browser.close();await app.waitForLeadDelivery();await new Promise(resolve=>server.close(resolve));app.closeWorkspaceDatabases();db.close();rmSync(dir,{recursive:true,force:true})}
