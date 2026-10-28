// Isolated multi-workspace workflow: no production accounts, keys or databases.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
const secretDirectory=mkdtempSync(join(tmpdir(),'levr-ui-vault-'));
const db=openDatabase(':memory:'),password=randomBytes(24).toString('hex'),clientPassword=randomBytes(24).toString('hex');
const created=createApp({db,seed:false,password,production:false,secretDirectory,secretEncryptionKey:randomBytes(32).toString('hex'),verifyProvider:async({apiKey})=>{if(apiKey==='invalid-browser-key')throw new Error('Synthetic rejection');return {creditCount:100};}});
db.prepare('INSERT INTO competitors(id,name) VALUES (?,?)').run('owner-record','Levr private competitor');
const server=created.app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const errors=[];
try {
 const owner=await browser.newPage({viewport:{width:1440,height:1000}});owner.on('pageerror',e=>errors.push(e.message));
 await owner.goto(base+'/clients');
 await owner.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await owner.getByLabel('Password',{exact:true}).fill(password);await owner.getByRole('button',{name:'Enter workspace'}).click();
 await owner.getByRole('heading',{name:'A private space for every client.'}).waitFor();
 await owner.getByRole('button',{name:'Create workspace',exact:true}).click();await owner.getByLabel('Workspace name').fill('Client Alpha');await owner.getByRole('button',{name:'Save workspace',exact:true}).click();
 await owner.getByRole('heading',{name:'Client Alpha',exact:true}).waitFor();
 await owner.getByRole('button',{name:'Invite client',exact:true}).click();await owner.getByLabel('Client email address').fill('alpha@example.test');await owner.getByRole('button',{name:'Create invitation',exact:true}).click();
 await owner.getByRole('heading',{name:'Your invitation is ready'}).waitFor();const inviteUrl=await owner.getByLabel('Private invitation link').inputValue();assert.ok(inviteUrl.startsWith(base+'/invite#token='));
 await owner.getByRole('button',{name:'Close dialog',exact:true}).click();
 await owner.getByRole('button',{name:'Create workspace',exact:true}).click();await owner.getByLabel('Workspace name').fill('Client Beta');await owner.getByRole('button',{name:'Save workspace',exact:true}).click();await owner.getByRole('heading',{name:'Client Beta',exact:true}).waitFor();
 await owner.screenshot({path:'/tmp/levr-client-admin-desktop.png',fullPage:true});await owner.setViewportSize({width:390,height:844});assert.equal(await owner.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'client administration fits mobile');await owner.screenshot({path:'/tmp/levr-client-admin-mobile.png',fullPage:true});await owner.setViewportSize({width:1440,height:1000});
 const client=await browser.newPage({viewport:{width:390,height:844}});client.on('pageerror',e=>errors.push(e.message));
 const inviteRequests=[];client.on('request',r=>{if(new URL(r.url()).pathname==='/invite')inviteRequests.push(r.url())});
 await client.goto(inviteUrl);await client.getByRole('heading',{name:'Your research starts here.'}).waitFor();assert.equal(new URL(client.url()).hash,'');assert.ok(inviteRequests.every(url=>!url.includes('token')));
 await client.getByLabel('Invited email address').fill('alpha@example.test');await client.getByLabel('Password',{exact:true}).fill(clientPassword);await client.getByLabel('Confirm password',{exact:true}).fill(clientPassword);await client.getByRole('button',{name:'Accept invitation',exact:true}).click();await client.getByRole('heading',{name:'Getting started.'}).waitFor();assert.equal(new URL(client.url()).pathname,'/launch','signup opens onboarding and research settings');
 assert.equal(await client.getByRole('link',{name:'Client workspaces',exact:true}).count(),0);
 assert.equal(await client.getByText('fraser@wearelevr.com',{exact:true}).count(),0);
 assert.equal(await client.getByLabel('Current workspace').locator('option').count(),1);
 assert.equal(await client.getByLabel('Current workspace').locator('option').textContent(),'Client Alpha');
 await client.getByRole('heading',{name:'Connect your research account',exact:true}).waitFor();
 assert.equal(await client.getByRole('link',{name:'Sign in to ScrapeCreators',exact:true}).getAttribute('href'),'https://app.scrapecreators.com');
 const screenshots=client.locator('.setup-screenshot img');assert.equal(await screenshots.count(),2);for(const img of await screenshots.all()){await img.scrollIntoViewIfNeeded();await img.evaluate(async element=>{await element.decode()});assert.ok(await img.evaluate(element=>element.naturalWidth)>0)}
 assert.equal(await client.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'setup guide fits mobile');await client.screenshot({path:'/tmp/levr-setup-guide-mobile.png',fullPage:true});
 await client.getByLabel('ScrapeCreators API key',{exact:true}).fill('invalid-browser-key');await client.getByRole('button',{name:'Connect ScrapeCreators',exact:true}).click();await client.getByRole('alert').waitFor();assert.equal(await client.getByRole('heading',{name:'Connect your research account',exact:true}).count(),1,'rejected key keeps setup guide');assert.equal(await client.getByLabel('ScrapeCreators API key',{exact:true}).inputValue(),'');
 const apiKey='synthetic-browser-key-'+randomBytes(10).toString('hex');
 await client.getByLabel('ScrapeCreators API key',{exact:true}).fill(apiKey);await client.getByRole('button',{name:'Connect ScrapeCreators',exact:true}).click();
 await client.getByText('Connected',{exact:true}).waitFor();assert.equal(await client.getByLabel('Replacement API key',{exact:true}).inputValue(),'');assert.equal((await client.content()).includes(apiKey),false);assert.equal(await client.locator('.setup-guide').count(),0,'verified connection hides setup');
 await client.reload();await client.getByText('Connected',{exact:true}).waitFor();assert.equal(await client.locator('.setup-guide').count(),0,'setup stays hidden after reload');
 await client.getByRole('button',{name:'Remove saved key',exact:true}).click();await client.getByRole('button',{name:'Remove saved key',exact:true}).last().click();await client.getByRole('heading',{name:'Connect your research account',exact:true}).waitFor();
 await client.getByLabel('ScrapeCreators API key',{exact:true}).fill(apiKey);await client.getByRole('button',{name:'Connect ScrapeCreators',exact:true}).click();await client.getByText('Connected',{exact:true}).waitFor();
 assert.equal(await client.evaluate(()=>localStorage.length),0);assert.equal(await client.evaluate(()=>sessionStorage.length),0);
 assert.equal(await client.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'workspace settings fits mobile');await client.screenshot({path:'/tmp/levr-client-settings-mobile.png',fullPage:true});
 await client.getByRole('button',{name:'Set up competitors',exact:true}).click();await client.getByRole('button',{name:'Add competitor',exact:true}).click();await client.getByLabel('Competitor name',{exact:true}).fill('Alpha private competitor');await client.getByRole('button',{name:'Save competitor',exact:true}).click();await client.getByRole('heading',{name:'Alpha private competitor',exact:true}).waitFor();assert.equal(await client.getByText('Levr private competitor',{exact:true}).count(),0);
 const spaces=await owner.evaluate(async()=>await(await fetch('/api/workspaces')).json());const alpha=spaces.find(w=>w.name==='Client Alpha'),beta=spaces.find(w=>w.name==='Client Beta');
 await owner.getByLabel('Current workspace').selectOption(alpha.id);await owner.goto(base+'/competitors');
 // Session defaults on full reload are Levr; select Alpha again to enter its research.
 await owner.getByLabel('Current workspace').selectOption(alpha.id);await owner.getByRole('heading',{name:'Alpha private competitor',exact:true}).waitFor();assert.equal(await owner.getByText('Levr private competitor',{exact:true}).count(),0);
 await owner.getByLabel('Current workspace').selectOption(beta.id);await owner.getByRole('heading',{name:'Start with a competitor',exact:true}).waitFor();assert.equal(await owner.getByText('Alpha private competitor',{exact:true}).count(),0);
 let releaseOldResponse,reportOldRequest,reportOldDelivery;const oldDelivery=new Promise(resolve=>{reportOldDelivery=resolve});const oldRequestSeen=new Promise(resolve=>{reportOldRequest=resolve});const oldResponseGate=new Promise(resolve=>{releaseOldResponse=resolve});let holdOldResponse=true;
 await owner.route('**/api/competitors',async route=>{if(holdOldResponse&&route.request().method()==='GET'&&route.request().headers()['x-workspace-id']===alpha.id){const response=await route.fetch();reportOldRequest();await oldResponseGate;await route.fulfill({response});reportOldDelivery();return;}return route.continue()});
 await owner.getByLabel('Current workspace').selectOption(alpha.id);await oldRequestSeen;await owner.getByLabel('Current workspace').selectOption(beta.id);await owner.getByRole('heading',{name:'Start with a competitor',exact:true}).waitFor();holdOldResponse=false;releaseOldResponse();await oldDelivery;await owner.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await owner.getByText('Alpha private competitor',{exact:true}).count(),0,'a delayed previous-workspace response must not render after switching');

 await owner.getByLabel('Current workspace').selectOption('levr');await owner.getByRole('heading',{name:'Levr private competitor',exact:true}).waitFor();assert.equal(await owner.getByText('Alpha private competitor',{exact:true}).count(),0);
 const foreign=await client.evaluate(async id=>{const r=await fetch('/api/competitors',{headers:{'X-Workspace-Id':id}});return r.status},beta.id);assert.equal(foreign,404);
 await owner.goto(base+'/clients');await owner.getByRole('button',{name:/Client Alpha Private client workspace/}).click();await owner.getByText('alpha@example.test',{exact:true}).first().waitFor();
 await owner.getByRole('button',{name:'Create password reset link',exact:true}).click();await owner.getByRole('heading',{name:'Password reset link ready',exact:true}).waitFor();
 const resetUrl=await owner.getByLabel('Private password reset link',{exact:true}).inputValue();assert.ok(resetUrl.startsWith(base+'/reset#token='));await owner.getByRole('button',{name:'Close dialog',exact:true}).click();
 const recovered=await browser.newPage({viewport:{width:390,height:844}});recovered.on('pageerror',e=>errors.push(e.message));
 await recovered.goto(resetUrl);await recovered.getByRole('heading',{name:'Choose a new password.',exact:true}).waitFor();assert.equal(new URL(recovered.url()).hash,'');
 const resetPassword=randomBytes(24).toString('hex');await recovered.getByLabel('Account email address', {exact:true}).fill('alpha@example.test');await recovered.getByLabel('New password',{exact:true}).fill(resetPassword);await recovered.getByLabel('Confirm password',{exact:true}).fill(resetPassword);await recovered.getByRole('button',{name:'Save new password',exact:true}).click();await recovered.getByRole('heading',{name:'Your market, in focus.',exact:true}).waitFor();
 await client.getByRole('button',{name:'Add competitor',exact:true}).click();await client.getByLabel('Competitor name',{exact:true}).fill('Old session must not save');await client.getByRole('button',{name:'Save competitor',exact:true}).click();await client.getByRole('heading',{name:'Welcome back.',exact:true}).waitFor();
 await recovered.goto(base+'/competitors');await recovered.getByRole('heading',{name:'Alpha private competitor',exact:true}).waitFor();
 await owner.getByRole('button',{name:'Remove access',exact:true}).click();await owner.getByRole('button',{name:'Revoke access',exact:true}).click();
 await recovered.getByRole('button',{name:'Add competitor',exact:true}).click();await recovered.getByLabel('Competitor name',{exact:true}).fill('Must not be saved');await recovered.getByRole('button',{name:'Save competitor',exact:true}).click();await recovered.getByRole('heading',{name:'Welcome back.',exact:true}).waitFor();
 assert.equal(await recovered.getByText('Alpha private competitor',{exact:true}).count(),0);

 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,checks:['owner creates private workspace and invite','invitation fragment is not sent to server','signup opens onboarding and research settings','setup link and screenshot assets work','invalid key retains guide','verified connection hides guide across reload','disconnect restores guide','client has only assigned workspace and no owner controls','masked key save and no browser storage','owner can manage all isolated research','delayed prior-workspace response discarded','foreign workspace denied','owner-issued password recovery revokes old sessions','revocation signs out and clears private UI'],errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));created.closeWorkspaceDatabases();db.close();rmSync(secretDirectory,{recursive:true,force:true});}
