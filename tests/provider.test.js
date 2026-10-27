import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProfile, normalizeMetaAd, normalizeInstagram, normalizeYouTube, searchMetaCompanies } from '../server/provider.js';
// Shapes and field names from the official @scrapecreators/cli 1.0.87 API examples.
const ad = (id='1162496978867592', extra={}) => ({ad_archive_id:id,is_active:true,page_id:'367152833370567',page_name:'Example advertiser',start_date:1740643200,snapshot:{body:{text:'A sourced ad caption'},title:'Headline',cta_text:'Learn more',link_url:'https://example.com/offer',display_format:'IMAGE',images:[{original_image_url:'https://cdn.example.com/ad.jpg'}]},...extra});
const ig = (id='3600545900919030401',extra={}) => ({pk:id,id:`${id}_260462810`,code:'ExamplePost',media_type:2,product_type:'clips',created_at:'2025-03-31T16:29:30.000Z',taken_at:1743438570,caption:{text:'Actual caption'},like_count:14,comment_count:2,ig_play_count:1000,play_count:1200,image_versions2:{candidates:[{url:'https://cdn.example.com/cover.jpg'}]},video_versions:[{url:'https://cdn.example.com/video.mp4'}],...extra});
const video = (id='5EWaxmWgQMI',extra={}) => ({id,type:'video',url:`https://www.youtube.com/watch?v=${id}`,title:'Public video title',thumbnail:'https://i.ytimg.com/vi/5EWaxmWgQMI/hqdefault.jpg',viewCountInt:110447,publishedTime:'2025-01-23T22:48:53.914Z',...extra});
function mock(responses){const calls=[];return {calls,fetchImpl:async (target,options)=>{const u=new URL(target);const body=options.body ? JSON.parse(options.body):Object.fromEntries(u.searchParams);calls.push({path:u.pathname,params:body,options});const response=responses.shift();assert.ok(response,'Unexpected extra API request');if(typeof response==='function')return response(u,options);return new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}});}};}
const options = fetchImpl => ({apiKey:'test-only-provider-key',fetchImpl});

test('Meta active ads exhaust pagination, deduplicate by archive ID, preserve copy and canonical source',async()=>{
 const m=mock([{results:[ad(),ad('222')],cursor:'page2'},{results:[ad('222'),ad('333',{is_active:false})],cursor:null}]);
 const result=await collectProfile({platform:'meta',identifier:'367152833370567',confirmed:true},options(m.fetchImpl));
 assert.equal(result.items.length,2);assert.equal(result.complete,true);assert.equal(result.paginationExhausted,true);
 assert.equal(m.calls[0].options.method,'POST');assert.equal(m.calls[1].params.cursor,'page2');assert.equal(m.calls[0].params.status,'ACTIVE');
 assert.equal(result.items[0].sourceUrl,'https://www.facebook.com/ads/library/?id=1162496978867592');
 assert.equal(result.items[0].startDate,'2025-02-27T08:00:00.000Z');assert.equal(result.items[0].caption,'A sourced ad caption');
 assert.equal(result.items[0].views,null);assert.equal(result.items[0].transcript,null);
});

test('Meta missing reported start date remains null, carousel preserves creative variants',()=>{
 const item=normalizeMetaAd(ad('123',{start_date:null,snapshot:{display_format:'CAROUSEL',cards:[{original_image_url:'https://example.com/a.jpg',title:'First',body:'First copy',link_url:'https://example.com/a'},{original_image_url:'https://example.com/b.jpg',title:'Second'}]}}));
 assert.equal(item.startDate,null);assert.equal(item.format,'ad_carousel');assert.equal(item.media.length,2);assert.equal(item.creativeVariants[0].caption,'First copy');
});

test('Meta video transcript uses documented nested data response',async()=>{
 const m=mock([{results:[ad('123',{snapshot:{display_format:'VIDEO',videos:[{video_hd_url:'https://example.com/a.mp4',video_preview_image_url:'https://example.com/a.jpg'}]}})],cursor:null},{success:true,data:{ad_id:'123',transcript:'Spoken words exactly.'}}]);
 const r=await collectProfile({platform:'meta',identifier:'123',confirmed:true},options(m.fetchImpl));
 assert.equal(r.items[0].transcript,'Spoken words exactly.');assert.equal(r.items[0].transcriptStatus,'available');assert.equal(m.calls[1].path,'/v1/facebook/adLibrary/ad/transcript');assert.equal(m.calls[1].params.id,'123');
});

test('Instagram separates Reels, carousel slides and single images; metrics stay unknown when unavailable',()=>{
 const reel=normalizeInstagram(ig());assert.equal(reel.format,'instagram_reel');assert.equal(reel.views,1000);assert.equal(reel.shares,null);assert.equal(reel.totalEngagement,16);assert.match(reel.sourceUrl,/\/reel\/ExamplePost\/$/);
 const carousel=normalizeInstagram(ig('1',{media_type:8,carousel_media:[{image_versions2:{candidates:[{url:'https://example.com/1.jpg'}]}},{image_versions2:{candidates:[{url:'https://example.com/2.jpg'}]}}]}));
 assert.equal(carousel.format,'instagram_carousel');assert.equal(carousel.media.length,2);assert.match(carousel.sourceUrl,/\/p\//);
 const photo=normalizeInstagram(ig('2',{media_type:1,product_type:'feed',video_versions:[],like_count:null,comment_count:null,play_count:null,ig_play_count:null}));assert.equal(photo.format,'instagram_image');assert.equal(photo.totalEngagement,null);assert.equal(photo.views,null);
});

test('Instagram fetches bounded recent pages and retains unavailable transcript without inventing text',async()=>{
 const m=mock([{items:[ig()],next_max_id:'next',more_available:true},()=>new Response('Unavailable',{status:404})]);
 const r=await collectProfile({platform:'instagram',identifier:'@example',confirmed:true},{...options(m.fetchImpl),organicPageLimit:1});
 assert.equal(r.complete,true);assert.equal(r.paginationExhausted,false);assert.equal(r.items[0].transcript,null);assert.equal(r.items[0].transcriptStatus,'unavailable');assert.equal(r.warnings.length,1);assert.equal(m.calls[0].params.handle,'example');
});

test('Instagram transcript keeps returned provider words',async()=>{
 const m=mock([{items:[ig()],next_max_id:null,more_available:false},{success:true,transcripts:[{id:'3600545900919030401',text:'Real opening hook.'}]}]);
 const r=await collectProfile({platform:'instagram',identifier:'https://www.instagram.com/example/',confirmed:true},options(m.fetchImpl));assert.equal(r.items[0].transcript,'Real opening hook.');
});

test('YouTube Shorts and long-form use separate endpoints and explicit formats independent of duration',async()=>{
 const m=mock([{shorts:[video('VREVC0wXPfs')],continuationToken:null},video('VREVC0wXPfs',{likeCountInt:10,commentCountInt:2,publishDate:'2026-04-22T10:44:35-07:00',durationMs:180000}),{videos:[video()],continuationToken:null},video('5EWaxmWgQMI',{durationMs:30000}),{transcript_only_text:'Short transcript.'},{transcript:null,transcript_only_text:null}]);
 const r=await collectProfile({platform:'youtube',identifier:'https://www.youtube.com/@example',confirmed:true},options(m.fetchImpl));
 assert.equal(r.items[0].format,'youtube_short');assert.equal(r.items[1].format,'youtube_video');
 assert.equal(r.items[0].media[0].url,'https://www.youtube-nocookie.com/embed/VREVC0wXPfs');assert.equal(r.items[0].sourceUrl,'https://www.youtube.com/shorts/VREVC0wXPfs');
 assert.equal(r.items[0].totalEngagement,12);assert.equal(r.items[1].transcriptStatus,'unavailable');assert.equal(r.items[1].likes,null);
 assert.equal(m.calls[0].path,'/v1/youtube/channel/shorts');assert.equal(m.calls[2].path,'/v1/youtube/channel-videos');
});

test('YouTube missing publication date is unknown',()=>assert.equal(normalizeYouTube(video('5EWaxmWgQMI',{publishedTime:null}),'youtube_video').publishedAt,null));

test('Repeated cursors fail rather than return misleading complete data',async()=>{
 const m=mock([{results:[ad()],cursor:'again'},{results:[ad()],cursor:'again'}]);
 await assert.rejects(collectProfile({platform:'meta',identifier:'123',confirmed:true},options(m.fetchImpl)),/repeated a pagination cursor/);
});

test('Failed second page does not return partial results and errors do not leak credential or provider body',async()=>{
 const m=mock([{results:[ad()],cursor:'again'},()=>new Response('test-only-provider-key sensitive upstream response',{status:500})]);
 await assert.rejects(collectProfile({platform:'meta',identifier:'123',confirmed:true},options(m.fetchImpl)),error=>/HTTP 500/.test(error.message)&&!error.message.includes('test-only-provider-key')&&!error.message.includes('sensitive'));
 assert.equal(m.calls[0].options.redirect,'error');assert.equal(new URL('https://api.scrapecreators.com'+m.calls[0].path).hostname,'api.scrapecreators.com');
});

test('Unexpected collection shape fails safely instead of claiming an empty account',async()=>{
 const m=mock([{success:true,unexpected:[]}]);await assert.rejects(collectProfile({platform:'instagram',identifier:'example',confirmed:true},options(m.fetchImpl)),/response format changed/);
});

test('Unconfirmed matches and non-platform URLs never trigger requests',async()=>{
 let calls=0;const opts=options(async()=>{calls++;throw new Error();});
 await assert.rejects(collectProfile({platform:'instagram',identifier:'example',confirmed:false},opts),/Review and confirm/);
 await assert.rejects(collectProfile({platform:'instagram',identifier:'https://evil.example/user',confirmed:true},opts),/selected platform/);
 await assert.rejects(collectProfile({platform:'meta',identifier:'brand name',confirmed:true},opts),/numeric Meta Page ID/);assert.equal(calls,0);
});

test('Meta company search returns candidates that still need confirmation',async()=>{
 const m=mock([{searchResults:[{page_id:'51212153078',name:'Candidate brand'}]}]);const r=await searchMetaCompanies('Candidate',options(m.fetchImpl));assert.equal(r[0].confirmed,false);assert.equal(r[0].identifier,'51212153078');assert.equal(m.calls[0].params.query,'Candidate');
});

test('Unreported active state fails instead of silently deactivating stored ads',async()=>{
 const m=mock([{results:[ad('123',{is_active:undefined})],cursor:null}]);
 await assert.rejects(collectProfile({platform:'meta',identifier:'123',confirmed:true},options(m.fetchImpl)),error=>/did not report/.test(error.safeMessage));
});

test('Dedicated Shorts identity wins if a video also appears in the ordinary feed',async()=>{
 const m=mock([{shorts:[video()],continuationToken:null},video(),{videos:[video()],continuationToken:null},video(),{transcript_only_text:null}]);
 const r=await collectProfile({platform:'youtube',identifier:'example',confirmed:true},options(m.fetchImpl));assert.equal(r.items.length,1);assert.equal(r.items[0].format,'youtube_short');
});
