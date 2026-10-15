import {VideoPlaybackAbrRequest} from './vendor/sabr.js';
const KEY='youtubeSessions',TTL=30*60*1000;
let writes=Promise.resolve();
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const streamId=url=>{try{return new URL(url).searchParams.get('id');}catch{return null;}};
// Observe only requests the page already makes. Never block, replay, or modify them.
chrome.webRequest.onBeforeRequest.addListener(details=>{
 if(details.tabId<0||details.method!=='POST'||new URL(details.url).pathname!=='/videoplayback')return;
 const parts=(details.requestBody?.raw || []).filter(p=>p.bytes).map(p=>new Uint8Array(p.bytes)),length=parts.reduce((n,p)=>n+p.length,0);
 if(!length||length>65536)return;
 const body=new Uint8Array(length);let at=0;for(const part of parts){body.set(part,at);at+=part.length;}
 let seed;try{seed=VideoPlaybackAbrRequest.decode(body);}catch{return;}
 if(!seed.videoPlaybackUstreamerConfig?.length||!seed.streamerContext?.clientInfo)return;
 const entry={tabId:details.tabId,documentId:details.documentId,frameId:details.frameId,url:details.url,streamId:streamId(details.url),body:base64(body),poLength:seed.streamerContext.poToken?.length || 0,createdAt:Date.now()};
 writes=writes.catch(()=>{}).then(async()=>{
  const {[KEY]:old=[]}=await chrome.storage.session.get(KEY),now=Date.now();
  const match=s=>s.tabId===entry.tabId&&s.documentId===entry.documentId&&s.streamId===entry.streamId;
  const previous=old.find(match);if(previous&&previous.poLength>entry.poLength)return;
  await chrome.storage.session.set({[KEY]:[entry,...old.filter(s=>!match(s)&&now-s.createdAt<TTL)].slice(0,20)});
 });
},{urls:['https://*.googlevideo.com/videoplayback*']},['requestBody']);
export async function youtubeSession(descriptor){
 await writes;const {[KEY]:sessions=[]}=await chrome.storage.session.get(KEY),id=streamId(descriptor.platform?.streamingData?.serverAbrStreamingUrl);
 return sessions.find(s=>s.tabId===descriptor.tabId&&(!descriptor.documentId||s.documentId===descriptor.documentId)&&id&&s.streamId===id&&Date.now()-s.createdAt<TTL) || null;
}
