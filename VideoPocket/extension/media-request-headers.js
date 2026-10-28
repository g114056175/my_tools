import {isTikTokMediaRequest} from './media-credentials.js';

// DNR bypasses the browser's normal Referer sanitization. Mirror its default
// strict-origin-when-cross-origin policy and never send credentials or fragments.
export function mediaRequestHeaders(rawUrl,rawReferer){
 const url=new URL(rawUrl),referer=new URL(rawReferer);
 const tiktok=isTikTokMediaRequest(rawUrl,rawReferer);
 referer.username='';referer.password='';referer.hash='';
 const downgrade=referer.protocol==='https:'&&url.protocol==='http:';
 const headers=[downgrade?{header:'Referer',operation:'remove'}:{header:'Referer',operation:'set',value:tiktok||url.origin!==referer.origin?referer.origin+'/':referer.href}];
 if(tiktok&&url.origin!==referer.origin)headers.push({header:'Origin',operation:'set',value:referer.origin});
 if(referer.origin==='https://ani.gamer.com.tw'&&url.protocol==='https:'&&url.hostname==='bahamut.akamaized.net')headers.push({header:'Origin',operation:'set',value:referer.origin});
 return headers;
}
