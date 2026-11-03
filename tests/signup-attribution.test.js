import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTRIBUTION_KEY,captureSignupAttribution,clearSignupAttribution} from '../client/signup-attribution.js';
const storage=()=>{const values=new Map();return{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
test('Campaign fields survive untagged navigation and reloads, while a new campaign replaces the previous set',()=>{
 const store=storage(),initial={utm_source:'instagram',utm_medium:'paid_social',utm_campaign:'free-library',utm_content:'carousel 1',utm_term:'growth operators'};
 assert.deepEqual(captureSignupAttribution('?'+new URLSearchParams({...initial,access_token:'do-not-save'}),store,1000),initial);
 assert.deepEqual(captureSignupAttribution('',store,2000),initial);
 assert.deepEqual(captureSignupAttribution('?auth_error=oauth_cancelled',store,3000),initial);
 assert.equal(store.getItem(ATTRIBUTION_KEY).includes('do-not-save'),false);
 assert.deepEqual(captureSignupAttribution('?utm_source=newsletter&utm_campaign=november',store,4000),{utm_source:'newsletter',utm_campaign:'november'});
 assert.deepEqual(captureSignupAttribution('',store,5000),{utm_source:'newsletter',utm_campaign:'november'});
 clearSignupAttribution(store);assert.deepEqual(captureSignupAttribution('',store,6000),{});
});
test('Expired, malformed or blocked attribution storage never prevents signup',()=>{
 const store=storage();captureSignupAttribution('?utm_source=instagram',store,1000);
 assert.deepEqual(captureSignupAttribution('',store,1000+24*60*60*1000),{});
 store.setItem(ATTRIBUTION_KEY,'broken');assert.deepEqual(captureSignupAttribution('',store,1000),{});
 const blocked={getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}};
 assert.deepEqual(captureSignupAttribution('?utm_source=instagram',blocked,1000),{utm_source:'instagram'});
 assert.deepEqual(captureSignupAttribution('',blocked,1000),{});
 const long=captureSignupAttribution('?utm_campaign='+encodeURIComponent(' '+ 'a'.repeat(400)+' '),store,1000);
 assert.equal(long.utm_campaign.length,200);
});
