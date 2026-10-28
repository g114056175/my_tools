import {VideoPlaybackAbrRequest} from './vendor/sabr.js';

const KEY='youtubeSessions',TTL=30*60*1000;
let writes=Promise.resolve();
const activeTabs=new Map(),observationInstance=globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
let observationSequence=0,listener=null;
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const streamId=url=>{try{return new URL(url).searchParams.get('id');}catch{return null;}};

function enqueueWrite(operation){
 const pending=writes.catch(()=>{}).then(operation);
 writes=pending;
 return pending;
}

function removeListenerIfIdle(){
 if(activeTabs.size||!listener)return;
 const current=listener;
 listener=null;
 try{chrome.webRequest.onBeforeRequest.removeListener(current);}catch{}
}

function onObservedRequest(details,registeredListener){
 if(listener!==registeredListener||details.tabId<0||details.method!=='POST')return;
 let url;try{url=new URL(details.url);}catch{return;}
 if(url.pathname!=='/videoplayback')return;
 const observation=activeTabs.get(details.tabId);if(!observation)return;
 // A tab can stop and restart observation while another tab keeps the shared
 // listener registered. Ignore a queued request from before that restart.
 if(details.timeStamp!=null&&Number.isFinite(Number(details.timeStamp))&&Number(details.timeStamp)<observation.startedAt)return;
 const parts=(details.requestBody?.raw || []).filter(p=>p.bytes).map(p=>new Uint8Array(p.bytes)),length=parts.reduce((n,p)=>n+p.length,0);
 if(!length||length>65536)return;
 const body=new Uint8Array(length);let at=0;for(const part of parts){body.set(part,at);at+=part.length;}
 let seed;try{seed=VideoPlaybackAbrRequest.decode(body);}catch{return;}
 if(!seed.videoPlaybackUstreamerConfig?.length||!seed.streamerContext?.clientInfo)return;
 const entry={tabId:details.tabId,documentId:details.documentId,frameId:details.frameId,url:details.url,streamId:streamId(details.url),body:base64(body),poLength:seed.streamerContext.poToken?.length || 0,createdAt:Date.now(),observationId:observation.id};
 void enqueueWrite(async()=>{
  if(listener!==registeredListener||activeTabs.get(entry.tabId)!==observation)return;
  const {[KEY]:old=[]}=await chrome.storage.session.get(KEY),now=Date.now();
  if(listener!==registeredListener||activeTabs.get(entry.tabId)!==observation)return;
  const match=s=>s.tabId===entry.tabId&&s.observationId===entry.observationId&&s.documentId===entry.documentId&&s.streamId===entry.streamId;
  const previous=old.find(match);if(previous&&previous.poLength>entry.poLength)return;
  await chrome.storage.session.set({[KEY]:[entry,...old.filter(s=>!match(s)&&now-s.createdAt<TTL)].slice(0,20)});
 }).catch(()=>{});
}

function ensureListener(){
 if(listener)return;
 const registeredListener=details=>onObservedRequest(details,registeredListener);
 listener=registeredListener;
 try{chrome.webRequest.onBeforeRequest.addListener(registeredListener,{urls:['https://*.googlevideo.com/videoplayback*']},['requestBody']);}
 catch(error){listener=null;try{chrome.webRequest.onBeforeRequest.removeListener(registeredListener);}catch{}throw error;}
}

export function beginYoutubeSessionObservation(tabId){
 if(!Number.isInteger(tabId)||tabId<0)throw new TypeError('有效的分頁 ID 為必要欄位');
 const current=activeTabs.get(tabId);if(current)return current.id;
 const observation={id:`${observationInstance}:${++observationSequence}`,startedAt:Date.now()};
 activeTabs.set(tabId,observation);
 // Remove captures from earlier observations before accepting new writes.
 // The active check makes a delayed cleanup harmless after stop/reopen.
 void enqueueWrite(async()=>{
  if(activeTabs.get(tabId)!==observation)return;
  const {[KEY]:old=[]}=await chrome.storage.session.get(KEY);
  if(activeTabs.get(tabId)!==observation)return;
  const next=old.filter(entry=>entry.tabId!==tabId||entry.observationId===observation.id);
  if(next.length!==old.length)await chrome.storage.session.set({[KEY]:next});
 }).catch(()=>{});
 try{ensureListener();}
 catch(error){activeTabs.delete(tabId);removeListenerIfIdle();throw error;}
 return observation.id;
}

export function endYoutubeSessionObservation(tabId,observationId){
 const current=activeTabs.get(tabId);
 if(!current)return Promise.resolve(false);
 if(observationId!==undefined&&observationId!==current.id)return Promise.resolve(false);
 activeTabs.delete(tabId);
 removeListenerIfIdle();
 // Queue cleanup after any in-flight write. Scope it to this token so a new
 // observation opened immediately cannot have its capture erased.
 return enqueueWrite(async()=>{
  const {[KEY]:old=[]}=await chrome.storage.session.get(KEY);
  const next=old.filter(entry=>entry.tabId!==tabId||entry.observationId!==current.id);
  if(next.length!==old.length)await chrome.storage.session.set({[KEY]:next});
 });
}

export async function youtubeSession(descriptor){
 const observation=activeTabs.get(descriptor?.tabId);if(!observation)return null;
 await writes;
 if(activeTabs.get(descriptor.tabId)!==observation)return null;
 const {[KEY]:sessions=[]}=await chrome.storage.session.get(KEY);
 if(activeTabs.get(descriptor.tabId)!==observation)return null;
 const id=streamId(descriptor.platform?.streamingData?.serverAbrStreamingUrl);
 return sessions.find(s=>s.tabId===descriptor.tabId&&s.observationId===observation.id&&(!descriptor.documentId||s.documentId===descriptor.documentId)&&id&&s.streamId===id&&Date.now()-s.createdAt<TTL) || null;
}
