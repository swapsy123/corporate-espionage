// Isolated synthetic accounts and provider responses. No live credentials/data.
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {openDatabase} from '../server/db.js';
import {createApp} from '../server/app.js';
import {createSecretVault} from '../server/secret-vault.js';
const directory=mkdtempSync(join(tmpdir(),'levr-deletion-browser-')),db=openDatabase(join(directory,'catalog.sqlite'));
const outer=express(),server=outer.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
const ownerPassword=randomBytes(24).toString('hex'),clientPassword=randomBytes(24).toString('hex');
const actualVault=createSecretVault({directory:join(directory,'secrets'),masterKey:randomBytes(32).toString('hex')});let failFiles=false;
const app=createApp({db,seed:false,password:ownerPassword,production:false,verifyProvider:async()=>({creditCount:20}),vault:{...actualVault,delete(id){if(failFiles)throw Error('Fixture file cleanup failure');return actualVault.delete(id)}},deletionLogger:{warn(){}},
 socialSignupOptions:{publicBaseUrl:base,googleClientId:'browser-google',googleClientSecret:'browser-secret',facebookAppId:'browser-facebook',facebookAppSecret:'browser-secret',fetchImpl:async url=>new Response(JSON.stringify(url.includes('token')?{access_token:'browser-token'}:url.includes('googleapis')?{sub:'deletion-google',name:'Google Client',email:'google.delete@example.test',email_verified:true}:{id:'567890123',name:'Facebook Client',email:'facebook.delete@example.test'}),{headers:{'content-type':'application/json'}})}
});outer.use(app.app);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[],screenshots='/tmp/levr-deletion-previews';mkdirSync(screenshots,{recursive:true});
async function page(width=1440){const result=await browser.newPage({viewport:{width,height:1000}});result.on('pageerror',e=>errors.push(e.message));return result}
async function apiSignup(email){const context=await browser.newContext();try{const response=await context.request.post(base+'/auth/signup',{data:{fullName:'Browser Client',companyName:'Deletion client',email,password:clientPassword}});assert.equal(response.status(),201);return response.json()}finally{await context.close()}}

try{
 const client=await page();await client.goto(base+'/signup');await client.locator('[name="fullName"]').fill('Password Client');await client.locator('[name="email"]').fill('password.delete@example.test');await client.locator('[name="companyName"]').fill('Password client');await client.locator('[name="password"]').fill(clientPassword);await client.locator('[name="confirmation"]').fill(clientPassword);await client.getByRole('button',{name:'Create free workspace'}).click();await client.waitForURL('**/settings');
 const section=client.locator('.account-deletion');await section.getByRole('heading',{name:'Delete your account',exact:true}).waitFor();await section.locator('[name="confirmationEmail"]').fill('password.delete@example.test');await section.locator('[name="deletionPassword"]').fill('an-incorrect-password');await section.getByRole('button',{name:'Permanently delete my account'}).click();await section.getByRole('alert').waitFor();assert.equal((await client.request.get(base+'/api/session')).status(),200);
 await section.locator('[name="deletionPassword"]').fill(clientPassword);await section.screenshot({path:join(screenshots,'self-service-desktop.png')});await section.getByRole('button',{name:'Permanently delete my account'}).click();await client.waitForURL('**/account-deleted?cleanup=complete');
 const managed=await apiSignup('owner.delete@example.test');actualVault.set(managed.defaultWorkspaceId,randomBytes(24).toString('hex'));
 const owner=await page();await owner.goto(base+'/clients');await owner.getByLabel('Email address',{exact:true}).fill('fraser@wearelevr.com');await owner.getByLabel('Password',{exact:true}).fill(ownerPassword);await owner.getByRole('button',{name:'Enter workspace'}).click();
 await owner.getByLabel('Current workspace').selectOption(managed.defaultWorkspaceId);const row=owner.locator('.account-row').filter({hasText:'owner.delete@example.test'});await row.getByRole('button',{name:'Delete account',exact:true}).click();
 const dialog=owner.getByRole('dialog');await dialog.locator('[name="confirmationEmail"]').fill('wrong@example.test');assert.equal(await dialog.getByRole('button',{name:'Permanently delete account'}).isDisabled(),true);
 await dialog.locator('[name="confirmationEmail"]').fill('owner.delete@example.test');await dialog.screenshot({path:join(screenshots,'owner-confirmation-desktop.png')});failFiles=true;await dialog.getByRole('button',{name:'Permanently delete account'}).click();await owner.getByText('File cleanup needed',{exact:true}).waitFor();assert.equal(await owner.getByLabel('Current workspace').inputValue(),'levr');
 failFiles=false;await owner.getByRole('button',{name:'Retry file cleanup'}).click();await owner.getByText('File cleanup completed.',{exact:true}).waitFor();assert.equal(existsSync(join(directory,'secrets',managed.defaultWorkspaceId+'.json')),false);
 await owner.screenshot({path:join(screenshots,'owner-audit-desktop.png'),fullPage:true});
 const mobileAccount=await apiSignup('mobile.delete@example.test');await owner.setViewportSize({width:390,height:844});await owner.getByRole('button',{name:'Refresh accounts',exact:true}).click();await owner.locator('.account-row').filter({hasText:'mobile.delete@example.test'}).getByRole('button',{name:'Delete account',exact:true}).click();await owner.getByRole('dialog').locator('[name="confirmationEmail"]').fill('mobile.delete@example.test');await owner.getByRole('dialog').screenshot({path:join(screenshots,'owner-confirmation-mobile.png')});assert.equal(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await owner.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(db.prepare('SELECT 1 FROM users WHERE id=?').get(mobileAccount.user.id));
 assert.equal(await client.getByRole('button',{name:/Confirm with Google|Confirm with Facebook/}).count(),0);assert.deepEqual(errors,[]);
 console.log('Browser deletion passed: password confirmation, owner typed email, cancellation, cleanup retry, workspace switching, desktop/mobile layout and revoked sessions.');
}finally{await browser.close();await app.waitForLeadDelivery();await app.waitForRefresh();await new Promise(resolve=>server.close(resolve));app.closeWorkspaceDatabases();db.close();rmSync(directory,{recursive:true,force:true})}
