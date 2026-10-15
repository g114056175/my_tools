// Only mirror a source origin where the normal player demonstrably requires
// it. Never attach this site context to arbitrary destinations or page fetches.
export function mediaRequestHeaders(rawUrl,rawReferer){
 const url=new URL(rawUrl),referer=new URL(rawReferer);
 const headers=[{header:'Referer',operation:'set',value:referer.href}];
 if(referer.origin==='https://ani.gamer.com.tw'&&url.protocol==='https:'&&url.hostname==='bahamut.akamaized.net')headers.push({header:'Origin',operation:'set',value:referer.origin});
 return headers;
}
