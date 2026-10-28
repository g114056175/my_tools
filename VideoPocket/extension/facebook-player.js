// Normalize the selected Facebook player's rendered configuration, including
// the inline DASH manifest that remains after its initial network response.
export function facebookPlayerPayload(value,{pageUrl=''}={}){
 const own=(object,key)=>{try{return Object.getOwnPropertyDescriptor(object,key)?.value;}catch{return undefined;}};
 try{if(!/(^|\.)facebook\.com$/i.test(new URL(pageUrl).hostname))return null;}catch{return null;}
 const metadata=own(value,'coreVideoPlayerMetaData'),rawId=own(metadata,'videoFBID');
 const id=typeof rawId==='string'?rawId:typeof rawId==='number'&&Number.isSafeInteger(rawId)?String(rawId):'';
 if(!/^\d{5,24}$/.test(id))return null;
 const manifest=own(value,'manifest');
 if(typeof manifest==='string'&&manifest.length<=512*1024&&/^\s*(?:<\?xml[^>]*>\s*)?<MPD(?=[\s/>])/i.test(manifest))return {id,videoFBID:id,video_dash_manifest:manifest};
 const rawUrl=own(value,'manifestUrl');if(typeof rawUrl!=='string'||rawUrl.length>16384)return null;
 try{const url=new URL(rawUrl);if(url.protocol!=='https:'||url.username||url.password||!/[.](?:mpd|m3u8)$/i.test(url.pathname))return null;return {id,videoFBID:id,video_dash_manifest_url:url.href};}catch{return null;}
}
