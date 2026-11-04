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
