// Reports deliberately contain no signed media URLs, upstream bodies or credentials.
const messages={
 upstream_denied:'The media host denied this saved link. Refresh the media links; if a fresh link is still denied, share this check with Levr.',
 upstream_missing:'The media file is no longer available at the saved link. Refresh the media links.',
 upstream_busy:'The media host is rate limiting requests or is temporarily unavailable. Try again later.',
 upstream_status:'The media host returned an unsuccessful response.',
 unsupported_type:'The media host returned a file type this viewer cannot play.',
 invalid_media:'The media host returned an invalid or empty file.',
 oversized:'The media exceeds the supported download limit.',
 redirect:'The media host redirected to an unavailable or unsupported destination.',
 dns:'The server could not resolve a permitted public media address.',
 timeout:'The media download timed out. Try again later.',
 connection:'The server could not connect to the media host.',
 unsupported_source:'This saved item has no supported media URL for this preview.',
 missing:'This creative is no longer available in this workspace.',
 queue:'Too many previews are loading. Try again after they finish.',
 unavailable:'The media could not be loaded. Share this check with Levr.'
};
export function mediaError(code,status){return Object.assign(new Error('Media request failed'),{mediaCode:code,upstreamStatus:status})}
export function mediaReport(error,details={}){
 let code=error?.mediaCode;
 if(!Object.hasOwn(messages,code||'')){
  if(['ETIMEDOUT','ABORT_ERR'].includes(error?.code)||['TimeoutError','AbortError'].includes(error?.name))code='timeout';
  else if(['ENOTFOUND','EAI_AGAIN'].includes(error?.code))code='dns';
  else if(['ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPROTO','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error?.code))code='connection';
  else code='unavailable';
 }
 const raw=process.env.RAILWAY_GIT_COMMIT_SHA||process.env.RENDER_GIT_COMMIT||'';
 return {version:'media-check-1',release:/^[a-f0-9]{7,40}$/i.test(raw)?raw.slice(0,12):null,checkedAt:new Date().toISOString(),ok:!error,...(!error?details:{code,message:messages[code],...(Number.isInteger(error?.upstreamStatus)?{upstreamStatus:error.upstreamStatus}:{})})};
}
export function upstreamMediaError(status){return mediaError([401,403].includes(status)?'upstream_denied':[404,410].includes(status)?'upstream_missing':status===429||status>=500?'upstream_busy':'upstream_status',status)}
export function mediaFailure(req,res,error,status=502){
 const report=mediaReport(error);res.set('X-Media-Error',report.code);
 return req.query.check==='1'?res.status(status).json(report):res.status(status).end();
}
