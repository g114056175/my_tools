// Keep only subtitle requests already made by the page. Signed URLs stay in
// session storage and are never included in diagnostics or durable storage.
const KEY='youtubeCaptionRequests',TTL=20*60*1000;
let writes=Promise.resolve();
const activeTabs=new Map(),observationInstance=globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
let observationSequence=0,listening=false;
export function captionIdentity(raw){
 try{const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(u.hostname)||u.pathname!=='/api/timedtext'||u.searchParams.has('tlang'))return null;
  const p=u.searchParams,videoId=p.get('v'),language=p.get('lang');if(!/^[\w-]{11}$/.test(videoId||'')||!language||!p.has('pot'))return null;
  return {videoId,language:language.replace(/_/g,'-').toLowerCase(),automatic:p.get('kind')==='asr',captionName:p.get('name') || ''};
 }catch{return null;}
}
function enqueueWrite(operation){const pending=writes.catch(()=>{}).then(operation);writes=pending;return pending;}
function onBeforeRequest(details){
 if(details.tabId<0||details.method!=='GET')return;
 const observationId=activeTabs.get(details.tabId);if(!observationId)return;
 const identity=captionIdentity(details.url);if(!identity)return;
 const entry={...identity,tabId:details.tabId,documentId:details.documentId,frameId:details.frameId,url:details.url,time:Date.now(),observationId};
 void enqueueWrite(async()=>{
  if(activeTabs.get(entry.tabId)!==observationId)return;
  const {[KEY]:old=[]}=await chrome.storage.session.get(KEY),now=Date.now();
  if(activeTabs.get(entry.tabId)!==observationId)return;
  const same=s=>s.tabId===entry.tabId&&s.documentId===entry.documentId&&s.videoId===entry.videoId&&s.language===entry.language&&s.automatic===entry.automatic&&s.captionName===entry.captionName;
  await chrome.storage.session.set({[KEY]:[entry,...old.filter(s=>!same(s)&&now-s.time<TTL)].slice(0,32)});
 }).catch(()=>{});
}
export function beginYoutubeCaptionObservation(tabId){
 if(!Number.isInteger(tabId)||tabId<0)throw new TypeError('有效的分頁 ID 為必要欄位');
 const current=activeTabs.get(tabId);if(current)return current;
 const observationId=`${observationInstance}:${++observationSequence}`;
 activeTabs.set(tabId,observationId);
 if(!listening){
  try{chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest,{urls:['https://*.youtube.com/api/timedtext*']});listening=true;}
  catch(error){try{chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);}catch{}activeTabs.delete(tabId);throw error;}
 }
 return observationId;
}
export function endYoutubeCaptionObservation(tabId,observationId){
 const current=activeTabs.get(tabId);
 if(!current)return writes.catch(()=>{});
 if(observationId!==undefined&&observationId!==current)return Promise.resolve(false);
 activeTabs.delete(tabId);
 if(!activeTabs.size&&listening){try{chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);}catch{}listening=false;}
 const cleanup=enqueueWrite(async()=>{
  const {[KEY]:old=[]}=await chrome.storage.session.get(KEY);
  await chrome.storage.session.set({[KEY]:old.filter(entry=>entry.tabId!==tabId)});
 });
 void cleanup.catch(()=>{});
 return cleanup;
}
export async function youtubeCaptionRequest(tabId,selector,language,automatic,since=0){
 const observationId=activeTabs.get(tabId);if(!observationId)return undefined;
 await writes;if(activeTabs.get(tabId)!==observationId)return undefined;
 const {[KEY]:items=[]}=await chrome.storage.session.get(KEY);if(activeTabs.get(tabId)!==observationId)return undefined;
 const lang=String(language||'').replace(/_/g,'-').toLowerCase();
 return items.find(s=>s.tabId===tabId&&s.observationId===observationId&&(!selector.documentId||s.documentId===selector.documentId)&&s.videoId===selector.videoId&&s.language===lang&&s.automatic===!!automatic&&s.captionName===(selector.captionName||'')&&s.time>=since&&Date.now()-s.time<TTL)?.url;
}
