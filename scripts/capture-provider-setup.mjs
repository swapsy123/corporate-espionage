// Capture the real Levr interface using an isolated database and synthetic
// provider verification. These illustrate UI states, not a live provider account.
// Run npm run build first, then CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-provider-setup.mjs.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';

const secretDirectory=mkdtempSync(join(tmpdir(),'levr-setup-capture-'));
const db=openDatabase(':memory:'),password=randomBytes(24).toString('hex');
const created=createApp({db,seed:false,production:false,ownerEmail:'owner@example.test',password,providerKey:'',secretDirectory,secretEncryptionKey:randomBytes(32).toString('hex'),verifyProvider:async()=>({creditCount:100})});
const server=created.app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const errors=[];
try{
 const signedIn=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password})});
 assert.equal(signedIn.status,200);const owner=await signedIn.json(),cookie=signedIn.headers.get('set-cookie').split(';')[0];
 const headers={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':owner.csrf};
 const workspaceResponse=await fetch(base+'/api/workspaces',{method:'POST',headers,body:JSON.stringify({name:'Your workspace'})});assert.equal(workspaceResponse.status,201);const workspace=await workspaceResponse.json();
 const inviteResponse=await fetch(base+`/api/workspaces/${workspace.id}/invites`,{method:'POST',headers,body:JSON.stringify({email:'client@example.test'})});assert.equal(inviteResponse.status,201);const invite=await inviteResponse.json();
 const clientPassword=randomBytes(24).toString('hex');
 const accepted=await fetch(base+'/auth/accept-invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:invite.token,email:'client@example.test',password:clientPassword})});assert.equal(accepted.status,200);
 const [cookieName,cookieValue]=accepted.headers.get('set-cookie').split(';')[0].split('=');
 const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1});
 await context.addCookies([{name:cookieName,value:cookieValue,url:base,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/settings');await page.getByRole('heading',{name:'Connect your research account',exact:true}).waitFor();
 await page.getByRole('button',{name:'Connect ScrapeCreators',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
 const card=page.locator('#research-account');assert.equal(await card.getByLabel('ScrapeCreators API key',{exact:true}).inputValue(),'');
 mkdirSync('public/setup',{recursive:true});
 await card.screenshot({path:'public/setup/paste-key.png'});
 const syntheticKey='synthetic-capture-'+randomBytes(16).toString('hex');
 await card.getByLabel('ScrapeCreators API key',{exact:true}).fill(syntheticKey);
 await card.getByRole('button',{name:'Connect ScrapeCreators',exact:true}).click();
 await card.getByText('Connected',{exact:true}).waitFor();assert.equal(await page.locator('.setup-guide').count(),0);
 assert.equal(await card.getByLabel('Replacement API key',{exact:true}).inputValue(),'');assert.equal((await page.content()).includes(syntheticKey),false);
 await page.locator('.toast').waitFor({state:'hidden'});
 await card.screenshot({path:'public/setup/connected.png'});
 // Supply the freshly captured assets to this isolated built app for a complete
 // mobile review. The production build copies these files automatically later.
 mkdirSync('dist/setup',{recursive:true});
 for(const filename of ['paste-key.png','connected.png'])copyFileSync(`public/setup/${filename}`,`dist/setup/${filename}`);
 await card.getByRole('button',{name:'Remove saved key',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Remove saved key',exact:true}).click();
 await page.getByRole('heading',{name:'Connect your research account',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.locator('.setup-screenshot img').last().scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('.setup-screenshot img')].every(img=>img.complete&&img.naturalWidth>0));
 await page.evaluate(()=>scrollTo(0,0));await page.locator('.toast').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Setup guide should fit a mobile viewport');
 await page.screenshot({path:'/tmp/levr-provider-setup-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,assets:['public/setup/paste-key.png','public/setup/connected.png'],mobileReview:'/tmp/levr-provider-setup-mobile.png',errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));created.closeWorkspaceDatabases();db.close();rmSync(secretDirectory,{recursive:true,force:true});}
