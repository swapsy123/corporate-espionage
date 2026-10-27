/** Server-only adapter. API contract checked against official @scrapecreators/cli 1.0.87. */
const API = 'https://api.scrapecreators.com';
export class ProviderError extends Error {
  constructor(message) { super(message); this.name = 'ProviderError'; this.safeMessage = message; }
}
const MAX_BYTES = 25 * 1024 * 1024;
const cleanText = value => typeof value === 'string' ? value.trim() : '';
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const date = value => {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const url = value => {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.toString() : null; } catch { return null; }
};
const first = (...values) => values.find(v => v !== null && v !== undefined && v !== '');
function engagement(likes, comments, shares) {
  const available = [likes, comments, shares].filter(v => v !== null);
  return available.length ? available.reduce((a, b) => a + b, 0) : null;
}
function blank() {
  return { title: '', caption: '', headline: '', cta: '', landingUrl: null, media: [], thumbnail: null,
    transcript: null, transcriptStatus: 'unavailable', publishedAt: null, startDate: null,
    active: null, views: null, likes: null, comments: null, shares: null, totalEngagement: null };
}
function mediaEntry(item) {
  const thumbnail = url(first(item.image_versions2?.candidates?.[0]?.url, item.display_uri, item.display_url, item.thumbnail, item.video_preview_image_url));
  const video = url(first(item.video_versions?.[0]?.url, item.video_url, item.video_hd_url, item.video_sd_url, item.video_hd_handle, item.video_sd_handle));
  const image = url(first(item.original_image_url, item.resized_image_url, item.image_url, item.image, thumbnail));
  return video ? {type:'video', url:video, thumbnail:thumbnail || image} : image ? {type:'image', url:image} : null;
}
export function normalizeMetaAd(raw) {
  const externalId = cleanText(String(raw.ad_archive_id ?? ''));
  if (!externalId || !/^\d+$/.test(externalId)) throw new ProviderError('Meta returned an ad without a valid archive ID. Previous records were preserved.');
  const s = raw.snapshot || {};
  const media = [...(s.cards || []), ...(s.videos || []), ...(s.images || []), ...(s.extra_videos || []), ...(s.extra_images || [])]
    .map(x => mediaEntry(typeof x === 'string' ? {image_url:x} : x)).filter(Boolean);
  const uniqueMedia = [...new Map(media.map(x=>[x.url,x])).values()];
  return {...blank(), externalId, kind:'paid', platform:'meta',
    format:s.cards?.length || s.display_format === 'CAROUSEL' ? 'ad_carousel' : uniqueMedia.some(x=>x.type === 'video') || s.display_format === 'VIDEO' ? 'ad_video' : 'ad_image',
    advertiser:cleanText(raw.page_name || s.page_name), title:cleanText(s.title), headline:cleanText(s.title),
    caption:cleanText(typeof s.body === 'string' ? s.body : s.body?.text),
    cta:cleanText(s.cta_text || s.cta_type), landingUrl:url(s.link_url),
    sourceUrl:`https://www.facebook.com/ads/library/?id=${externalId}`,
    media:uniqueMedia, thumbnail:uniqueMedia[0]?.thumbnail || (uniqueMedia[0]?.type === 'image' ? uniqueMedia[0].url : null),
    startDate:date(first(raw.start_date_string, raw.start_date)), active:raw.is_active === true,
    creativeVariants:(s.cards || []).map(card=>({title:cleanText(card.title),caption:cleanText(card.body),cta:cleanText(card.cta_text),landingUrl:url(card.link_url)})),
  };
}
export function normalizeInstagram(raw) {
  const r = raw.media || raw;
  const externalId = String(first(r.pk, r.id?.split('_')[0], r.code) ?? '');
  if (!externalId || !r.code) throw new ProviderError('Instagram returned a post without its identity or original link. Previous records were preserved.');
  const carousel = r.media_type === 8 || Array.isArray(r.carousel_media);
  const video = r.media_type === 2 || r.product_type === 'clips';
  const media = (carousel ? r.carousel_media || [] : [r]).map(mediaEntry).filter(Boolean);
  const likes = r.like_and_view_counts_disabled ? null : number(r.like_count);
  const comments = number(r.comment_count);
  const shares = r.share_count_disabled ? null : number(r.share_count);
  return {...blank(), externalId, platform:'instagram', kind:'organic',
    format:carousel ? 'instagram_carousel' : video ? 'instagram_reel' : 'instagram_image',
    title:cleanText(r.caption?.text || r.caption).split('\n')[0]?.slice(0,180) || 'Instagram post',
    caption:cleanText(r.caption?.text || r.caption),
    sourceUrl:`https://www.instagram.com/${video && !carousel ? 'reel' : 'p'}/${encodeURIComponent(r.code)}/`,
    media, thumbnail:url(first(r.image_versions2?.candidates?.[0]?.url, r.display_uri)) || media[0]?.thumbnail || (media[0]?.type === 'image' ? media[0].url : null),
    publishedAt:date(first(r.created_at, r.taken_at)), views:number(first(r.ig_play_count,r.play_count,r.video_view_count)),
    likes, comments, shares, totalEngagement:engagement(likes,comments,shares),
    durationSeconds:number(r.video_duration),
  };
}
export function normalizeYouTube(r, format) {
  const externalId = cleanText(r.id);
  if (!externalId || !/^[\w-]{6,20}$/.test(externalId)) throw new ProviderError('YouTube returned a video without a valid identity. Previous records were preserved.');
  const likes = number(r.likeCountInt), comments = number(r.commentCountInt);
  return {...blank(), externalId, platform:'youtube', kind:'organic',format,
    title:cleanText(r.title), caption:cleanText(r.description),
    sourceUrl:format === 'youtube_short' ? `https://www.youtube.com/shorts/${externalId}` : `https://www.youtube.com/watch?v=${externalId}`,
    media:[{type:'embed',url:`https://www.youtube-nocookie.com/embed/${externalId}`,thumbnail:url(r.thumbnail)}],
    thumbnail:url(r.thumbnail), publishedAt:date(first(r.publishDate,r.publishedTime)),
    views:number(r.viewCountInt),likes,comments,totalEngagement:engagement(likes,comments,null),
    durationSeconds:number(first(r.durationMs === undefined ? null : r.durationMs/1000,r.lengthSeconds)),
  };
}
function identifier(profile) {
  let value = cleanText(profile.identifier);
  if (profile.platform === 'meta') {
    if (value.startsWith('http')) {
      const u = new URL(value);
      if (!['facebook.com','www.facebook.com','m.facebook.com'].includes(u.hostname)) throw new ProviderError('Use a confirmed numeric Meta Page ID or Facebook Ad Library page URL.');
      value = u.searchParams.get('view_all_page_id') || u.searchParams.get('id') || u.pathname.split('/').filter(Boolean).find(x=>/^\d+$/.test(x)) || '';
    }
    if (!/^\d+$/.test(value)) throw new ProviderError('Confirm the numeric Meta Page ID from the Ad Library before refreshing. A brand name is not a confirmed page.');
    return {pageId:value};
  }
  if (value.startsWith('http')) {
    const u = new URL(value);
    const hosts = profile.platform === 'instagram' ? ['instagram.com','www.instagram.com'] : ['youtube.com','www.youtube.com'];
    if (!hosts.includes(u.hostname)) throw new ProviderError('The profile URL must belong to the selected platform.');
    const parts = u.pathname.split('/').filter(Boolean);
    value = profile.platform === 'youtube' && parts[0] === 'channel' ? parts[1] : parts[0];
  }
  value = value?.replace(/^@/,'');
  if (!value || !/^[\w.\-]{1,100}$/.test(value)) throw new ProviderError('Enter a valid confirmed profile handle or YouTube channel ID.');
  return profile.platform === 'youtube' && value.startsWith('UC') ? {channelId:value} : {handle:value};
}
function client({apiKey = process.env.SCRAPECREATORS_API_KEY, fetchImpl = globalThis.fetch, signal} = {}) {
  if (!apiKey) throw new ProviderError('ScrapeCreators is not configured. Add SCRAPECREATORS_API_KEY in the server secret settings, then refresh again.');
  return async (path, params={}, method='GET') => {
    const target = new URL(path,API);
    const options = {method,headers:{'x-api-key':apiKey,accept:'application/json'},redirect:'error',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000)};
    if (method === 'GET') for (const [k,v] of Object.entries(params)) {if (v !== undefined && v !== null && v !== '') target.searchParams.set(k,String(v));}
    else {options.headers['content-type']='application/json';options.body=JSON.stringify(params);}
    let response;
    try { response = await fetchImpl(target.toString(),options); }
    catch {throw new ProviderError('ScrapeCreators could not be reached or timed out. Check access to api.scrapecreators.com and retry. Existing records are retained.');}
    if (!response.ok) {
      const messages = {401:'ScrapeCreators rejected its API key. Check the server secret settings.',402:'ScrapeCreators credits are exhausted. Add credits before refreshing.',403:'ScrapeCreators denied access. Check API access, network settings, and whether the profile is public.',404:'The public profile or resource was unavailable. Verify its identifier.',429:'ScrapeCreators rate limit reached. Wait before refreshing again.'};
      throw new ProviderError(messages[response.status] || `ScrapeCreators returned HTTP ${response.status}. Retry the manual refresh later. Existing records are retained.`);
    }
    let data;
    try {
      if (Number(response.headers?.get('content-length')) > MAX_BYTES) throw new ProviderError();
      if (response.body?.getReader) {
        const reader=response.body.getReader();let size=0;const chunks=[];
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new ProviderError();}chunks.push(Buffer.from(value));}} finally {reader.releaseLock();}
        data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } else data=await response.json();
    } catch {throw new ProviderError('ScrapeCreators returned an unreadable or oversized response. Existing records are retained.');}
    if (!data || data.success === false || data.error || data.errorStatus >= 400 || data.status === 'fail') throw new ProviderError('ScrapeCreators could not retrieve this public resource. Check the confirmed profile and provider account, then retry.');
    return data;
  };
}
const transcriptText = payload => {
  const value = payload.transcript_only_text ?? payload.data?.transcript ?? payload.transcript;
  if (typeof value === 'string') return cleanText(value) || null;
  if (Array.isArray(value)) return value.map(v=>cleanText(v.text)).filter(Boolean).join('\n') || null;
  if (Array.isArray(payload.transcripts)) return payload.transcripts.map(v=>cleanText(v?.text)).filter(Boolean).join('\n\n') || null;
  return null;
};
async function enrichTranscript(item,request,warnings) {
  if (!item.media.some(m=>m.type === 'video' || m.type === 'embed')) return item;
  const path = item.platform === 'meta' ? '/v1/facebook/adLibrary/ad/transcript' : item.platform === 'instagram' ? '/v2/instagram/media/transcript' : '/v1/youtube/video/transcript';
  try {
    const response=await request(path,item.platform === 'meta' ? {id:item.externalId} : {url:item.sourceUrl});
    item.transcript=transcriptText(response);
    item.transcriptStatus=item.transcript ? 'available' : 'unavailable';
    item.transcriptSource=item.platform === 'youtube' ? 'Public captions' : 'Provider transcription';
  } catch(error) {
    item.transcriptStatus='unavailable';item.transcriptError=error.message;
    warnings.push(`Transcript unavailable for ${item.externalId}: ${error.message}`);
  }
  return item;
}
async function pages({request,path,params,key,field,method='GET',limit=Infinity,onProgress}) {
  const records=[];const cursors=new Set();let cursor;let page=0;
  do {
    const response=await request(path,{...params,...(cursor ? {[field]:cursor}: {})},method);
    if (!Array.isArray(response[key])) throw new ProviderError('ScrapeCreators response format changed. Refresh stopped without replacing prior records.');
    records.push(...response[key]);page++;
    cursor=response[field];
    if (cursor === 'null' || cursor === '') cursor=null;
    if (response.more_available === true && !cursor) throw new ProviderError('ScrapeCreators reported more content without a continuation cursor. Retry the refresh; previous records are retained.');
    if (cursor && cursors.has(cursor)) throw new ProviderError('ScrapeCreators repeated a pagination cursor. Refresh stopped to prevent an incomplete replacement.');
    if (cursor) cursors.add(cursor);
    await onProgress?.({page,itemCount:records.length});
  } while(cursor && page<limit);
  return {records,exhausted:!cursor};
}
/** Only confirmed public profiles are fetched. Organic window defaults to newest three API pages per format. */
export async function collectProfile(profile,options={}) {
  if (!profile.confirmed) throw new ProviderError('Review and confirm this profile before refreshing.');
  if (!['meta','instagram','youtube'].includes(profile.platform)) throw new ProviderError('Unsupported profile platform.');
  const request=client(options),params=identifier(profile),warnings=[];
  const configured=Number(options.organicPageLimit || process.env.LEVR_ORGANIC_PAGE_LIMIT || 3);
  const limit=Number.isInteger(configured) && configured>0 && configured<=100 ? configured : 3;
  let items=[],exhausted=true;
  if(profile.platform==='meta') {
    const result=await pages({request,path:'/v1/facebook/adLibrary/company/ads',params:{...params,status:'ACTIVE',country:'ALL'},key:'results',field:'cursor',method:'POST',onProgress:options.onProgress});
    if (result.records.some(r => typeof r.is_active !== 'boolean')) throw new ProviderError('Meta did not report whether an ad is active. Refresh stopped without replacing prior records.');
    items=result.records.filter(r=>r.is_active===true).map(normalizeMetaAd);
  } else if(profile.platform==='instagram') {
    const result=await pages({request,path:'/v2/instagram/user/posts',params,key:'items',field:'next_max_id',limit,onProgress:options.onProgress});
    items=result.records.map(normalizeInstagram);exhausted=result.exhausted;
  } else {
    for(const format of ['youtube_short','youtube_video']) {
      const short=format==='youtube_short';
      const result=await pages({request,path:short?'/v1/youtube/channel/shorts':'/v1/youtube/channel-videos',params:{...params,sort:short?'newest':'latest'},key:short?'shorts':'videos',field:'continuationToken',limit,onProgress:options.onProgress});
      exhausted=exhausted&&result.exhausted;
      for(const row of result.records) {
        let merged=row;
        try { const detail=await request('/v1/youtube/video',{url:`https://www.youtube.com/watch?v=${encodeURIComponent(row.id)}`}); merged={...row,...detail}; }
        catch(error) {warnings.push(`Details unavailable for ${row.id}: ${error.message}`);}
        items.push(normalizeYouTube(merged,format));
      }
    }
  }
  // The provider can repeat items between pages. Meta archive ID is the deduplication identity.
  const deduplicated = new Map();
  for (const item of items) {
    const key = `${item.platform}:${item.externalId}`;
    // The dedicated Shorts surface is authoritative if a video also appears in another feed.
    if (deduplicated.get(key)?.format !== 'youtube_short') deduplicated.set(key,item);
  }
  items=[...deduplicated.values()];
  for (const item of items) await enrichTranscript(item,request,warnings);
  return {items,complete:true,paginationExhausted:exhausted,warnings,window:profile.platform==='meta'?'All available active ads':`Newest ${limit} provider pages per stream`};
}
export async function searchMetaCompanies(query,options={}) {
  const q=cleanText(query);if(q.length<2 || q.length>200) throw new ProviderError('Enter a company name between 2 and 200 characters.');
  const data=await client(options)('/v1/facebook/adLibrary/search/companies',{query:q});
  if(!Array.isArray(data.searchResults))throw new ProviderError('ScrapeCreators returned an unexpected company search response.');
  return data.searchResults.map(r=>({platform:'meta',identifier:String(r.page_id),label:cleanText(r.name),confirmed:false,sourceUrl:`https://www.facebook.com/ads/library/?view_all_page_id=${r.page_id}`}));
}
