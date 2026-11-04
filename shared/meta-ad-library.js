// Review advertiser identity across countries and active/inactive ads.
// Apply when opening older stored links as well, without rewriting research.
export function metaAdLibraryReviewUrl(value) {
 if(typeof value!=='string')return value;
 let url;
 try{url=new URL(value)}catch{return value}
 if(!['https:','http:'].includes(url.protocol)||
    !['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname)||
    !/^\/ads\/library\/?$/.test(url.pathname)||url.username||url.password)return value;
 url.searchParams.set('country','ALL');
 url.searchParams.set('ad_type','all');
 url.searchParams.set('active_status','all');
 return url.href;
}

export function metaPageIdentifier(value){
 const message='Use the advertiser’s numeric Meta Page ID or its Ad Library page link containing view_all_page_id. An individual ad link is not a Page ID.';
 let id=typeof value==='string'?value.trim():'';
 if(!/^\d+$/.test(id)){
  let u;try{u=new URL(id)}catch{throw Error(message)}
  if(!['http:','https:'].includes(u.protocol)||!['facebook.com','www.facebook.com','m.facebook.com'].includes(u.hostname)||u.username||u.password)throw Error(message);
  if(u.searchParams.has('view_all_page_id'))id=u.searchParams.get('view_all_page_id');
  else if(/^\/ads\/library\/?$/.test(u.pathname))throw Error(message);
  else if(u.pathname==='/profile.php')id=u.searchParams.get('id');
  else id=u.pathname.split('/').filter(Boolean).at(-1)||'';
 }
 if(!/^\d+$/.test(id||''))throw Error(message);
 return id;
}
