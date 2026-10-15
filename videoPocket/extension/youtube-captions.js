// Keep only subtitle requests already made by the page. Signed URLs stay in
// session storage and are never included in diagnostics or durable storage.
const KEY='youtubeCaptionRequests',TTL=20*60*1000;
let writes=Promise.resolve();
export function captionIdentity(raw){
 try{const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(u.hostname)||u.pathname!=='/api/timedtext'||u.searchParams.has('tlang'))return null;
  const p=u.searchParams,videoId=p.get('v'),language=p.get('lang');if(!/^[\w-]{11}$/.test(videoId||'')||!language||!p.has('pot'))return null;
  return {videoId,language:language.replace(/_/g,'-').toLowerCase(),automatic:p.get('kind')==='asr',captionName:p.get('name') || ''};
 }catch{return null;}
}
chrome.webRequest.onBeforeRequest.addListener(details=>{
 if(details.tabId<0||details.method!=='GET')return;const identity=captionIdentity(details.url);if(!identity)return;
 const entry={...identity,tabId:details.tabId,documentId:details.documentId,frameId:details.frameId,url:details.url,time:Date.now()};
 writes=writes.catch(()=>{}).then(async()=>{const {[KEY]:old=[]}=await chrome.storage.session.get(KEY),now=Date.now();
  const same=s=>s.tabId===entry.tabId&&s.documentId===entry.documentId&&s.videoId===entry.videoId&&s.language===entry.language&&s.automatic===entry.automatic&&s.captionName===entry.captionName;
  await chrome.storage.session.set({[KEY]:[entry,...old.filter(s=>!same(s)&&now-s.time<TTL)].slice(0,32)});
 });
},{urls:['https://*.youtube.com/api/timedtext*']});
export async function youtubeCaptionRequest(tabId,selector,language,automatic){
 await writes;const {[KEY]:items=[]}=await chrome.storage.session.get(KEY),lang=String(language||'').replace(/_/g,'-').toLowerCase();
 return items.find(s=>s.tabId===tabId&&(!selector.documentId||s.documentId===selector.documentId)&&s.videoId===selector.videoId&&s.language===lang&&s.automatic===!!automatic&&s.captionName===(selector.captionName||'')&&Date.now()-s.time<TTL)?.url;
}
