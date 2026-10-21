import {pageSnapshot,pageSubtitles} from './page.js';
import {waitForMediaSource} from './media-readiness.js';
import {mediaTime} from './media-time.js';
import {normalizeRange} from './media-range.js';
import {createBilibiliClient,bilibiliRoute} from './bilibili-api.js';
import {normalizeCues,parseSubtitles} from './subtitles.js';
import {ACTIVE_STATES} from './jobs.js';
import {youtubeSession} from './youtube-session.js';
import {youtubeCaptionRequest} from './youtube-captions.js';
import {classifyFailure,ERROR_RETENTION_MS} from './diagnostics.js';
import {CAPTURE_PREFIX,CAPTURE_VERSION,createSubtitleCaptureManager} from './subtitle-captures.js';
import {loadBilibiliSubtitle} from './bilibili-subtitles.js';
import {fileStem,createFilenameRecorder} from './filenames.js';
import {downloadKey,createDownloadClaims,stableHash} from './download-identity.js';
import {mediaRequestHeaders} from './media-request-headers.js';
import {createNetworkMediaObserver} from './network-observer.js';
import {attachNetworkSources} from './network-source.js';
import {attachSocialSources} from './social-source.js';
import {socialPageFetch} from './social-page-fetch.js';
import {createMediaSelectionController,selectionStorageKey,selectedMediaIndex,collapseBilibiliPlayers,recoverBilibiliRoute} from './media-selection-controller.js';
import {createPopupMarkerController} from './popup-marker.js';
import './destinations.js';
const mediaPicker=createMediaSelectionController(chrome);
const popupMarkers=createPopupMarkerController(chrome);
const networkMedia=createNetworkMediaObserver(chrome);
let creating,jobUpdates=Promise.resolve(),runningJob=null,headerWrites=Promise.resolve(),ruleId=100;
const work=new Map(),queue=[],popupViews=new Set(),downloads=new Map(),headerRules=new Map();
const downloadClaims=createDownloadClaims();
const sourceMeta=new Map();let failureWrites=Promise.resolve();
function sourceInActiveJob(sourceId){return [...work.values()].some(job=>!job.cancelled&&job.data?.sourceId===sourceId&&ACTIVE_STATES.has(job.state || (job===runningJob?'running':'queued')));}
function trimSourceMeta(){
 while(sourceMeta.size>100){const removable=[...sourceMeta.entries()].find(([id])=>!sourceInActiveJob(id));if(!removable)break;sourceMeta.delete(removable[0]);}
}
const rememberFilename=createFilenameRecorder(chrome.storage.local);
function failureTask(fn){const task=failureWrites.catch(()=>{}).then(fn);failureWrites=task.catch(()=>{});return task;}
function recordFailure(error,context={}){const failure=classifyFailure(error,context.stage);if(failure.code==='CANCELLED')return failure;const record={id:crypto.randomUUID(),time:Date.now(),code:failure.code,...(failure.processingReason?{processingReason:failure.processingReason}:{}),...(failure.ffmpegExitCode!==undefined?{ffmpegExitCode:failure.ffmpegExitCode}:{}),...(failure.httpStatus?{httpStatus:failure.httpStatus}:{}),...(failure.apiCode!==undefined?{apiCode:failure.apiCode}:{}),...(failure.subtitleStage?{subtitleStage:failure.subtitleStage}:{}),...(failure.sourceStage?{sourceStage:failure.sourceStage}:{}),...(failure.requestMethod?{requestMethod:failure.requestMethod}:{}),...(failure.requestHost?{requestHost:failure.requestHost}:{}),...(['download','merge','save','inspect','subtitle'].includes(context.stage)?{stage:context.stage}:{})};void failureTask(()=>chrome.storage.session.set({lastError:record}));setTimeout(()=>void failureTask(async()=>{const {lastError}=await chrome.storage.session.get('lastError');if(lastError?.id===record.id)await chrome.storage.session.remove('lastError');}),ERROR_RETENTION_MS);return failure;}
// Keep one bounded, allowlisted failure; never store raw messages or URLs.
void chrome.storage.local.remove('diagnostics');
// Keep the queue alive while a direct-file Save As dialog is still open.
setInterval(()=>{if(work.size)void chrome.storage.session.get('jobs');},20000);
headerWrites=chrome.declarativeNetRequest.getSessionRules().then(rules=>chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(r=>r.id)}));
function updateJob(id,patch){jobUpdates=jobUpdates.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.session.get('jobs');const entry=jobs.find(j=>j.id===id);if(entry)Object.assign(entry,patch);else jobs.unshift({id,...patch});await chrome.storage.session.set({jobs:[...jobs.filter(j=>ACTIVE_STATES.has(j.state)),...(popupViews.size?jobs.filter(j=>!ACTIVE_STATES.has(j.state)).slice(0,10):[])]});});return jobUpdates;}
function dismissFinished(){jobUpdates=jobUpdates.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.session.get('jobs');await chrome.storage.session.set({jobs:jobs.filter(j=>ACTIVE_STATES.has(j.state))});});return jobUpdates;}
chrome.runtime.onConnect.addListener(view=>{if(view.name!=='popup')return;popupMarkers.attach(view);popupViews.add(view);void dismissFinished();view.onDisconnect.addListener(()=>{popupViews.delete(view);if(!popupViews.size){void dismissFinished();}for(const job of work.values())if(job.picking&&job.owner===view.sender?.documentId)job.pickDeadline=Date.now()+3000;});});
async function engine(action,data={}){
 if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]})).length){creating ||= chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS','WORKERS','DOM_PARSER'],justification:'下載原始影音，在瀏覽器合併與抽取音訊'}).finally(()=>creating=null);await creating;}
 const r=await chrome.runtime.sendMessage({target:'offscreen',action,...data});if(!r?.ok)throw Object.assign(new Error(r?.error || '瀏覽器處理失敗'),r?.failure || {});return r.result;
}
async function assetHeaders(url,referer){
 const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw new Error('來源網址無效');if(!referer)return;
 const r=new URL(referer);if(!/^https?:$/.test(r.protocol))return;
 headerWrites=headerWrites.catch(()=>{}).then(async()=>{
  const key=u.origin+u.pathname;if(headerRules.get(key)?.referer===referer)return;
  const existing=headerRules.get(key),id=existing?.id || ++ruleId;
  const rule={id,priority:1,action:{type:'modifyHeaders',requestHeaders:mediaRequestHeaders(url,referer)},condition:{urlFilter:'|'+u.origin+u.pathname,initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest','media','other']}};
  const removeRuleIds=existing?[existing.id]:[];
  if(headerRules.size>=80&&!existing){const oldest=headerRules.keys().next().value;removeRuleIds.push(headerRules.get(oldest).id);headerRules.delete(oldest);}
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds,addRules:[rule]});headerRules.set(key,{id,referer});
 });await headerWrites;
}
async function finishJob(job,state,message){
 if(!work.has(job.id))return;
 work.delete(job.id);downloadClaims.release(job.data.downloadKey,job.id);
 await engine('forget',{sourceId:job.data.sourceId}).catch(()=>{});
 if(job.data.destinationId)await VideoPocketDestinations.remove(job.data.destinationId).catch(()=>{});
 // The popup can reuse an inspected source for another interval or after a
 // cancelled Save As. Job completion releases its lock, not source metadata;
 // the bounded source cache is trimmed independently when sources are added.
 await updateJob(job.id,{state,message,finishedAt:Date.now(),progress:null});
}
async function waitDownload(downloadId,job){
 const [existing]=await chrome.downloads.search({id:downloadId});if(existing?.state==='complete')return;
 return new Promise((resolve,reject)=>{const active={job,resolve,reject,downloadId,retries:0};downloads.set(downloadId,active);if(existing?.state==='interrupted')void interruptedDownload(active,existing);});
}
async function interruptedDownload(active,item){
 if(active.job.cancelled){downloads.delete(active.downloadId);active.reject(new Error('已取消'));return;}if(active.handling||active.job.paused)return;active.handling=true;
 try{if(active.job.cancelled||!item?.canResume||!/NETWORK_|SERVER_FAILED|SERVER_UNREACHABLE/.test(item.error || '')){downloads.delete(active.downloadId);active.reject(new Error(item?.error || '下載中斷'));return;}
  if(active.retries++<3){await updateJob(active.job.id,{state:'retrying'});await new Promise(resolve=>setTimeout(resolve,Math.min(5000,500*2**(active.retries-1))));if(!active.job.cancelled&&!active.job.paused)await chrome.downloads.resume(active.downloadId);}
  else{active.job.paused=true;active.job.pauseState='interrupted';await updateJob(active.job.id,{state:'interrupted'});}
 }catch{active.job.paused=true;active.job.pauseState='interrupted';await updateJob(active.job.id,{state:'interrupted'});}finally{active.handling=false;}
}
chrome.downloads.onChanged.addListener(async delta=>{
 const active=downloads.get(delta.id);if(!active)return;
 if(delta.state?.current==='complete'){downloads.delete(delta.id);active.resolve();}
 else if(delta.state?.current==='interrupted'){const [item]=await chrome.downloads.search({id:delta.id});void interruptedDownload(active,item);}
 else if(delta.bytesReceived){const [item]=await chrome.downloads.search({id:delta.id});if(item?.totalBytes>0)void updateJob(active.job.id,{state:active.job.paused?'paused':'running',progress:item.bytesReceived/item.totalBytes*100});}
});
setInterval(async()=>{if(!downloads.size)return;for(const [id,active] of downloads){const [item]=await chrome.downloads.search({id});if(item?.state==='complete'){downloads.delete(id);active.resolve();}else if(item?.state==='interrupted')void interruptedDownload(active,item);else if(item?.totalBytes>0)void updateJob(active.job.id,{state:active.job.paused?'paused':'running',progress:Math.min(99,item.bytesReceived/item.totalBytes*100)});}},1000);
async function pump(){
 if(runningJob)return;
 while(queue.length){const next=queue.findIndex(j=>!j.paused);if(next<0)return;const job=queue.splice(next,1)[0];if(!work.has(job.id))continue;runningJob=job;let result;
  try{
   job.startedAt=Date.now();job.stage='download';await updateJob(job.id,{state:'running',progress:null});result=await engine('download',{...job.data,id:job.id,filename:job.filename});if(job.cancelled)throw new Error('已取消');
   if(result.saved){await finishJob(job,'done','下載完成');continue;}if(result.referer)await assetHeaders(result.url,result.referer);
   job.stage='save';await updateJob(job.id,{state:'choosing',progress:null});const downloadId=await chrome.downloads.download({url:result.url,filename:result.filename,saveAs:true,conflictAction:'uniquify'});job.downloadId=downloadId;
   if(job.cancelled){await chrome.downloads.cancel(downloadId);throw new Error('已取消');}
   await updateJob(job.id,{state:'running',progress:null});await waitDownload(downloadId,job);await finishJob(job,'done','下載完成');
  }catch(e){const failure=classifyFailure(job.cancelled?{code:'CANCELLED'}:e,job.stage);if(failure.code!=='CANCELLED')recordFailure(e,{stage:job.stage,platform:job.meta?.platform,action:job.data.kind,height:job.data.height,elapsedMs:Date.now()-job.startedAt,storageMode:result?.blobId?'disk':undefined});await updateJob(job.id,{errorCode:failure.code});await finishJob(job,failure.code==='CANCELLED'?'cancelled':'error',failure.message);}
  finally{if(result?.blobId)await engine('release',{blobId:result.blobId}).catch(()=>{});runningJob=null;}
 }
}
async function script(tabId,func,args=[],documentId,world='MAIN'){const results=await chrome.scripting.executeScript({target:{tabId,...(documentId?{documentIds:[documentId]}:{})},world,func,args});const result=results[0]?.result;if(!result)throw new Error('無法讀取目前影片，請更新影片資訊');if(result.error)throw Object.assign(new Error(result.error),{code:result.errorCode,status:result.errorStatus,apiCode:result.errorApiCode,subtitleStage:result.subtitleStage,retryable:result.retryable});return result;}
const bilibiliClient=createBilibiliClient({headers:url=>assetHeaders(url,'https://www.bilibili.com/')});
const biliDiscoveries=new Map();
function discoverBilibili(tabId,context,documentId){
 const key=JSON.stringify([tabId,documentId,context.bvid,context.page||1,context.expectedCid||context.bootstrap?.cid||0]),previous=biliDiscoveries.get(key);
 if(previous&&(!previous.finished||Date.now()-previous.finished<2500))return previous;
 const task={};task.promise=bilibiliCaptions(tabId,context,documentId).then(result=>{task.result=result;return result;},error=>{task.error=error;throw error;}).finally(()=>{task.finished=Date.now();});
 // Snapshot warms discovery without waiting; a later popup request awaits the
 // same task. A closed popup must not leave an unhandled rejection.
 void task.promise.catch(()=>{});biliDiscoveries.delete(key);biliDiscoveries.set(key,task);if(biliDiscoveries.size>32)biliDiscoveries.delete(biliDiscoveries.keys().next().value);return task;
}
async function verifyBilibiliRoute(tabId,bvid,page,documentId){
 let route;try{route=await script(tabId,bilibiliRoute,[],documentId,'ISOLATED');}catch{throw Object.assign(new Error('BILI_CONTEXT_LOST'),{code:'BILI_CONTEXT_LOST',subtitleStage:'context'});}
 if(route.bvid!==bvid||route.page!==Number(page||1))throw Object.assign(new Error('SOURCE_CHANGED'),{code:'SOURCE_CHANGED',subtitleStage:'verify'});return {verified:true};
}
async function bilibiliCaptions(tabId,context,documentId){
 await verifyBilibiliRoute(tabId,context.bvid,context.page,documentId);
 const result=await bilibiliClient.inventory(context);
 await verifyBilibiliRoute(tabId,context.bvid,context.page,documentId);
 return result;
}
async function loadPageSubtitle(tabId,selector,language,automatic,localMediaIndex,documentId){
 if(selector.pageSource==='bilibili-api'){
  return loadBilibiliSubtitle({selector,prepare:async selection=>{await verifyBilibiliRoute(tabId,selection.expectedBvid,selection.expectedPage,documentId);return bilibiliClient.prepare(selection);},verify:caption=>verifyBilibiliRoute(tabId,caption.bvid,caption.page,documentId),headers:url=>assetHeaders(url,'https://www.bilibili.com/')});
 }
 const data=await script(tabId,pageSubtitles,[language,true,localMediaIndex,automatic,selector],documentId);
 try{data.cues=data.raw?parseSubtitles(data.raw):normalizeCues(data.cues);}catch(error){if(selector.pageSource==='youtube-page')throw Object.assign(new Error('YT_FILE_INVALID'),{code:'YT_FILE_INVALID'});throw error;}delete data.raw;
 if(!data.cues.length)throw Object.assign(new Error('沒有可用字幕'),{code:selector.pageSource==='youtube-page'?'YT_FILE_EMPTY':'SUBTITLE_UNAVAILABLE'});return data;
}
async function readPageSubtitle(request){
 const selector={...request.selector};
 if(selector.pageSource==='youtube-page'){const captionUrl=await youtubeCaptionRequest(request.tabId,selector,request.language,!!request.automatic);if(captionUrl)selector.captionUrl=captionUrl;}
 const localMediaIndex=selector.localMediaIndex ?? request.mediaIndex ?? 0;
 return loadPageSubtitle(request.tabId,selector,request.language,!!request.automatic,localMediaIndex,request.documentId || selector.documentId);
}
async function readCapturedSubtitle(request){
 if(request.selector?.pageSource==='browser'){
  if(!request.sourceId)throw Object.assign(new Error('字幕來源已失效，請重新整理'),{code:'SUBTITLE_UNAVAILABLE'});
  const value=await engine('subtitle',{sourceId:request.sourceId,index:request.index}),data={...value,cues:value.raw?parseSubtitles(value.raw):normalizeCues(value.cues),trackId:request.track.trackId};delete data.raw;
  if(!data.cues.length)throw Object.assign(new Error('SUBTITLE_UNAVAILABLE'),{code:'SUBTITLE_UNAVAILABLE'});return data;
 }
 const value=await readPageSubtitle(request);return {...value,trackId:request.track.trackId};
}
const subtitleCaptures=createSubtitleCaptureManager({storage:chrome.storage.session,read:readCapturedSubtitle});
const captureRecoveryReady=chrome.storage.session.get(null).then(async all=>{
 const updates={},remove=[];for(const [key,record] of Object.entries(all))if(key.startsWith(CAPTURE_PREFIX)){if(record?.version!==CAPTURE_VERSION){remove.push(key);continue;}if(record.state==='running')updates[key]={...record,state:'failed',finishedAt:Date.now(),failureCode:'SUBTITLE_UNAVAILABLE'};}
 if(remove.length)await chrome.storage.session.remove(remove);
 if(Object.keys(updates).length)await chrome.storage.session.set(updates);
}).catch(()=>{});
async function snapshot(tabId,index=0,preferPicked=true,expectedTarget){
  if(!preferPicked)await mediaPicker.clear(tabId);
  await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',files:['media-observer.js']}).catch(()=>{});
  const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:pageSnapshot,args:[0]});
  frames.sort((a,b)=>a.frameId-b.frameId);
  const top=frames.find(f=>f.frameId===0)?.result;if(!top)throw new Error('無法讀取目前網頁');
  const collectVideos=()=>{const items=recoverBilibiliRoute(collapseBilibiliPlayers(frames.flatMap(f=>(f.result?.videos || []).map((v,i)=>({...v,frameId:f.frameId,documentId:f.documentId,localMediaIndex:i})))),top,frames.find(f=>f.frameId===0));const mains=items.filter(v=>v.dailymotionMain);if(mains.length===1&&top.dailymotionContext?.id)mains[0].mediaContentId=top.dailymotionContext.id;return items;};
  let videos=collectVideos();
  if(expectedTarget){
   const target=expectedTarget,contentId=String(target.mediaContentId||target.linkedMedia?.id||target.mediaIdentity||'');
   const scoped=videos.filter(video=>Number(video.frameId)===Number(target.frameId)&&String(video.documentId||'')===String(target.documentId||''));
   const contentMatches=contentId?scoped.filter(video=>String(video.mediaContentId||video.linkedMedia?.id||video.mediaIdentity||'')===contentId):[];
   const keyMatches=scoped.filter(video=>String(video.mediaKey??'')===String(target.mediaKey??''));
   const matches=contentId?(contentMatches.length===1?contentMatches:[]):keyMatches;
   if(matches.length!==1)throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
   index=videos.indexOf(matches[0]);
  }
  const key=selectionStorageKey(tabId),remembered=(await chrome.storage.session.get(key))[key];let selectionExpired=false;
  if(remembered&&preferPicked&&!expectedTarget){const rememberedIndex=selectedMediaIndex(videos,remembered,top.url);if(rememberedIndex>=0)index=rememberedIndex;else{const oldDocumentAlive=frames.some(frame=>Number(frame.frameId)===Number(remembered.frameId)&&String(frame.documentId||'')===String(remembered.documentId||''));selectionExpired=oldDocumentAlive&&remembered.pageToken===stableHash(top.url);if(!selectionExpired)await chrome.storage.session.remove(key);}}
  if(!preferPicked&&remembered)await chrome.storage.session.remove(key);
  index=Math.max(0,Math.min(Number(index)||0,videos.length-1));let selected=videos[index];
  let page=selected?frames.find(f=>f.frameId===selected.frameId)?.result:top;
  if(selected?.localMediaIndex){
   const previous=selected,frame=frames.find(f=>f.frameId===selected.frameId&&String(f.documentId||'')===String(selected.documentId||''));
   page=await script(tabId,pageSnapshot,[selected.localMediaIndex],selected.documentId);
   // A player can replace/reorder its <video> between the all-frame scan and
   // this selected-frame read. Keep the page metadata, media list, and marker
   // key from one DOM generation; never combine the second scan's player data
   // with the first scan's element identity.
   if(frame){frame.result=page;videos=collectVideos();
    const sameContent=(current)=>{
      if(!current||current.frameId!==previous.frameId||String(current.documentId||'')!==String(previous.documentId||'')||String(current.mediaKey??'')!==String(previous.mediaKey??''))return false;
      const oldIdentity=String(previous.mediaContentId||previous.linkedMedia?.id||previous.mediaIdentity||''),newIdentity=String(current.mediaContentId||current.linkedMedia?.id||current.mediaIdentity||''),oldUrl=String(previous.url||''),newUrl=String(current.url||'');
      if(oldIdentity&&newIdentity)return oldIdentity===newIdentity;
      if(oldIdentity!==newIdentity)return false;
      return !oldUrl||!newUrl||oldUrl===newUrl;
    };
    const exactIndex=videos.findIndex(sameContent);
    const slotIndex=videos.findIndex(v=>v.frameId===previous.frameId&&String(v.documentId||'')===String(previous.documentId||'')&&Number(v.localMediaIndex)===Number(previous.localMediaIndex));
    if(page.media?.mediaKey===previous.mediaKey&&exactIndex>=0){index=exactIndex;selected=videos[index];}
    else if(remembered&&preferPicked){selectionExpired=true;index=slotIndex>=0?slotIndex:Math.max(0,index);selected=videos[index];}
    else if(slotIndex>=0){selectionExpired=true;index=slotIndex;selected=videos[index];}
    else{selectionExpired=true;index=Math.max(0,Math.min(index,videos.length-1));selected=videos[index];}
   }
  }
  if(selected?.routeOnly&&top.bilibiliContext)page={...page,platform:top.bilibiliContext,title:top.bilibiliContext.title,captionStatus:'unavailable',media:{url:top.url,mediaKey:selected.mediaKey,duration:top.bilibiliContext.duration}};
  if(page.platform?.site==='bilibili'){
   page.captionInventory=true;page.tracks=[];
   const platform=page.platform;
   const discovery=discoverBilibili(tabId,{bvid:platform.bvid,page:platform.page,bootstrap:platform},selected?.documentId),captions=discovery.result;
   if(captions){page.tracks=captions.tracks;page.captionStatus=captions.captionStatus;Object.assign(platform,{aid:captions.aid,cid:captions.cid,duration:captions.duration||platform.duration});}
   else if(discovery.error){page.captionStatus='unavailable';page.captionFailure=classifyFailure(discovery.error,'subtitle');}
   else page.captionStatus='loading';
  }
  // A playlist's active ID belongs to the top page, while its main <video>
  // lives in one geo.dailymotion.com iframe. Do not apply it to ad players.
  if(!selectionExpired&&selected?.dailymotionMain&&!page.platform&&top.dailymotionContext?.id&&videos.filter(v=>v.dailymotionMain).length===1){
    const context=top.dailymotionContext;
    page={...page,platform:{...context,site:'dailymotion',...(selected.observedSource?{observedSource:selected.observedSource}:{})},title:context.title || page.title};
    selected=videos[index]={...selected,title:context.title || selected.title,mediaIdentity:'dailymotion:'+context.id};
  }
  const result={...page,tabId,url:top.url,videos,mediaIndex:index,selectionExpired,frameId:selected?.frameId,documentId:selected?.documentId,localMediaIndex:selected?.localMediaIndex,preferredLanguages:top.preferredLanguages,language:top.language};
  const records=networkMedia.candidates({tabId,pageUrl:top.url}),attached=attachNetworkSources(attachSocialSources(result,records),records);
  if(attached.media){
    const local=records.filter(record=>(!selected?.documentId||record.documentId===selected.documentId)&&(selected?.frameId==null||record.frameId===selected.frameId));
    attached.media={...attached.media,discoveryDiagnostics:{...attached.media.discoveryDiagnostics,playerCount:videos.length,localNetworkCandidates:local.length,unboundFallbackBlocked:!attached.platform&&!selected?.downloadUrl&&videos.length>1&&Number(attached.media.duration)>0&&local.length>0}};
  }
  return attached;
}

const sessionReady=(async()=>{const {runSession}=await chrome.storage.session.get('runSession');if(!runSession){await chrome.storage.session.set({runSession:crypto.randomUUID()});await engine('cleanup');await VideoPocketDestinations.clear();}})().catch(()=>{});
async function handle(message,sender){
 if(!['assetHeaders','progress','heartbeat','youtubeSession','socialPageFetch','observedManifest'].includes(message.action))await Promise.all([sessionReady,captureRecoveryReady]);
 switch(message.action){
  case 'observedManifest':{
   if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');
   const context=message.context;
   if(!Number.isInteger(context?.tabId)||typeof context.documentId!=='string'||typeof message.url!=='string'||message.url.length>16384)throw new Error('清單讀取目標無效');
   return script(context.tabId,(raw,referer)=>{
    try{
     const current=new URL(location.href),page=new URL(referer),url=new URL(raw);
     const service=value=>value.protocol==='https:'&&!value.username&&!value.password&&/(^|\.)(?:dailymotion\.com|dmcdn\.net)$/.test(value.hostname);
     if(current.origin!==page.origin||!/(^|\.)dailymotion\.com$/.test(current.hostname)||!service(current)||!service(url))return null;
     const cached=globalThis[Symbol.for('video-pocket.mediaObserver')]?.manifestFor?.(url.href);
     if(!cached||typeof cached.text!=='string'||cached.text.length>512*1024||!service(new URL(cached.url)))return null;
     return cached;
    }catch{return null;}
   },[message.url,context.referer],context.documentId);
  }
  case 'socialPageFetch':{
   if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');
   const context=message.context;
   if(!Number.isInteger(context?.tabId)||typeof context.documentId!=='string'||!['open','read','cancel'].includes(message.operation))throw new Error('網頁下載通道無效');
   return script(context.tabId,socialPageFetch,[message.operation,{...message.options,referer:context.referer}],context.documentId);
  }
  case 'rememberFilename':if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');await rememberFilename(message.name);return {};
  case 'pickMedia':if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');return mediaPicker.begin(message.tabId);
  case 'snapshot':return snapshot(message.tabId,message.mediaIndex || 0,message.preferPicked!==false,message.expectedTarget);
  case 'waitMediaSource':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw Object.assign(new Error('來源未授權'),{code:'UNAUTHORIZED'});
   if(!Number.isInteger(message.tabId)||typeof message.documentId!=='string')throw Object.assign(new Error('媒體等待目標無效'),{code:'SOURCE_CHANGED'});
   const timeoutMs=Math.min(3000,Math.max(0,Number(message.timeoutMs)||3000));
   const results=await chrome.scripting.executeScript({target:{tabId:message.tabId,documentIds:[message.documentId]},world:'MAIN',func:waitForMediaSource,args:[{mediaKey:message.mediaKey,contentId:message.contentId,timeoutMs,settleMs:message.settleMs}]});
   return results[0]?.result || {ready:false,changed:false};
  }
  case 'mediaTime':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw Object.assign(new Error('來源未授權'),{code:'UNAUTHORIZED'});
   if(!Number.isInteger(message.tabId)||typeof message.documentId!=='string'||message.mediaKey==null)throw Object.assign(new Error('影片已變更，請重新整理'),{code:'SOURCE_CHANGED'});
   return script(message.tabId,mediaTime,[{mediaKey:message.mediaKey,contentId:message.contentId,sourceUrl:message.sourceUrl,...(message.time!==undefined?{time:message.time}:{})}],message.documentId);
  }
  case 'bilibiliCaptions':return discoverBilibili(message.tabId,{bvid:message.expectedBvid,page:Number(message.expectedPage)||1,expectedCid:Number(message.expectedCid)||0},message.documentId).promise;
  case 'cancelInspect':if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');return engine('cancelInspect',{inspectionId:message.inspectionId});
  case 'inspect':{
   const descriptor={...message.descriptor,downloadKey:downloadKey(message.descriptor)},key=descriptor.downloadKey;
   const active=[...work.values()].find(job=>!job.cancelled&&ACTIVE_STATES.has(job.state || (job===runningJob?'running':'queued'))&&job.data?.downloadKey===key);
   const cached=active&&sourceMeta.get(active.data.sourceId)?.result;
   if(cached){const result={...cached,downloadKey:key};sourceMeta.get(active.data.sourceId).lastUsed=Date.now();return result;}
   const result=await engine('inspect',{descriptor,inspectionId:message.inspectionId});result.downloadKey=key;sourceMeta.set(result.id,{platform:result.platform || descriptor.platform?.site || 'unknown',downloadKey:key,result,lastUsed:Date.now()});trimSourceMeta();return result;}
  case 'browserSubtitle':return engine('subtitle',{sourceId:message.sourceId,index:message.index});
  case 'pageSubtitle':return readPageSubtitle(message);
  case 'captureSubtitle':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw Object.assign(new Error('字幕擷取來源未授權'),{code:'SUBTITLE_UNAVAILABLE'});
   return subtitleCaptures.start({...message});
  }
  case 'prepareDownload':
  case 'download':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw Object.assign(new Error('來源未授權'),{code:'UNAUTHORIZED'});
   if(work.size>=20)throw new Error('等待中的下載過多，請等候完成');if(!message.sourceId)throw new Error('請重新整理來源');
   const meta=sourceMeta.get(message.sourceId),range=normalizeRange(message.range,meta?.result?.duration);
   if(range&&!meta?.result?.range?.supported)throw Object.assign(new Error('此來源暫不支援區間下載'),{code:'RANGE_UNSUPPORTED'});
   const id=crypto.randomUUID(),key=sourceMeta.get(message.sourceId)?.downloadKey || message.downloadKey || `source:${message.sourceId}`;
   const claim=downloadClaims.claim(key,id);if(!claim.claimed)return {duplicate:true,id:claim.id};
   let retained;try{retained=await engine('retain',{sourceId:message.sourceId});
    const titleCandidates=[retained.title,message.title].map(value=>String(value || '').trim()).filter(value=>value&&!/^影片\s*\d+$/i.test(value)),platform=message.platform || sourceMeta.get(message.sourceId)?.platform;
    if(platform==='youtube'&&!titleCandidates.length)throw Object.assign(new Error('未取得 YouTube 影片標題，請重新整理影片資訊'),{code:'SOURCE_UNAVAILABLE'});
    const title=String(titleCandidates[0] || '影片').slice(0,300),filename=fileStem(title);
    const job={id,title,filename,meta:sourceMeta.get(message.sourceId),data:{sourceId:message.sourceId,downloadKey:key,kind:message.kind,height:Number(message.height)||0,audioQuality:message.audioQuality || 'best',destinationId:message.destinationId,...(range?{range:{start:range.start,end:range.end}}:{})}};work.set(id,job);job.picking=message.action==='prepareDownload';job.owner=sender.documentId;job.pickDeadline=Date.now()+15*60*1000;if(!job.picking)queue.push(job);await updateJob(id,{state:job.picking?'choosing':'queued',title,kind:message.kind,downloadKey:key,createdAt:Date.now(),progress:null});void pump();return {id};
   }catch(error){const job=work.get(id);work.delete(id);if(job?.data?.destinationId)await VideoPocketDestinations.remove(job.data.destinationId).catch(()=>{});downloadClaims.release(key,id);await engine('forget',{sourceId:message.sourceId}).catch(()=>{});throw error;}
  }
  case 'cancel':{const job=work.get(message.id);if(!job)return {};job.cancelled=true;await engine('cancel',{id:job.id});if(job.downloadId)await chrome.downloads.cancel(job.downloadId).catch(()=>{});if(job!==runningJob)await finishJob(job,'cancelled','已取消');return {};}
  case 'pause':{const job=work.get(message.id);if(!job||job.stage==='merge'||job.stage==='save'&&!job.downloadId)return {};if(job.downloadId)await chrome.downloads.pause(job.downloadId);job.paused=true;if(!job.downloadId&&job===runningJob)await engine('pause',{id:job.id});await updateJob(job.id,{state:'paused'});return {};}
  case 'resume':{const job=work.get(message.id);if(!job)return {};if(job.downloadId)await chrome.downloads.resume(job.downloadId);job.paused=false;job.pauseState=null;if(!job.downloadId&&job===runningJob)await engine('resume',{id:job.id});await updateJob(job.id,{state:job===runningJob?'running':'queued'});void pump();return {};}
  case 'assetHeaders':if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');return assetHeaders(message.url,message.referer);
  case 'progress':if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');if(work.has(message.id)){const job=work.get(message.id);if(message.state==='processing')job.stage='merge';if(message.state==='saving')job.stage='save';if(['paused','interrupted'].includes(message.state)){job.paused=true;job.pauseState=message.state;}const state=job.paused?(job.pauseState || 'paused'):message.state;return updateJob(message.id,{state,...(message.progress!==undefined?{progress:message.progress}:{})});}return {};
  case 'reportFailure':{if(message.failure?.code!=='CANCELLED')recordFailure(message.failure,{stage:message.stage,platform:message.platform,action:message.kind,elapsedMs:message.elapsedMs});return {};}
  case 'lastError':return failureTask(async()=>{const {lastError}=await chrome.storage.session.get('lastError');return lastError&&Date.now()-lastError.time<ERROR_RETENTION_MS?lastError:null;});
  case 'dismissError':return failureTask(async()=>{const {lastError}=await chrome.storage.session.get('lastError');if(!message.id||lastError?.id===message.id)await chrome.storage.session.remove('lastError');return {};});
  case 'heartbeat':return {};
  case 'youtubeSession':if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');return youtubeSession(message.descriptor);
  default:throw new Error('未知操作');
 }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message.target==='offscreen'||sender.id!==chrome.runtime.id)return;handle(message,sender).then(result=>respond({ok:true,result})).catch(error=>{const stage=/Subtitle$/.test(message.action)?'subtitle':message.action==='snapshot'?'detect':'inspect';const failure=classifyFailure(error,stage);if(['pageSubtitle','browserSubtitle','download','prepareDownload'].includes(message.action)&&failure.code!=='CANCELLED')recordFailure(error,{stage,action:stage==='subtitle'?'subtitle':message.action==='snapshot'?'snapshot':'inspect',platform:message.platform || message.descriptor?.platform?.site || sourceMeta.get(message.sourceId)?.platform});respond({ok:false,error:failure.message,failure});});return true;});
chrome.tabs.onRemoved.addListener(tabId=>{void mediaPicker.stop(tabId).catch(()=>{});void chrome.storage.session.remove([selectionStorageKey(tabId),'rangeDraft:'+tabId]).catch(()=>{});for(const key of biliDiscoveries.keys())if(JSON.parse(key)[0]===tabId)biliDiscoveries.delete(key);void subtitleCaptures.removeTab(tabId).catch(()=>{});});
chrome.tabs.onUpdated.addListener((tabId,changeInfo)=>{if(changeInfo.status==='loading')void chrome.storage.session.remove(selectionStorageKey(tabId)).catch(()=>{});});
// Chrome restarts cannot resume in-memory signed sources or WebAssembly work.
void chrome.storage.session.get('jobs').then(({jobs=[]})=>{if(jobs.some(j=>ACTIVE_STATES.has(j.state)))return chrome.storage.session.set({jobs:jobs.map(j=>ACTIVE_STATES.has(j.state)?{...j,state:'error',message:'擴充功能已重新載入，請重新下載',finishedAt:Date.now()}:j)});});
void chrome.action.setBadgeText({text:''});

// Best effort when the last browser window closes. Forced process termination
// cannot run cleanup; the next offscreen creation removes those abandoned files.
chrome.windows.onRemoved.addListener(()=>{void (async()=>{if((await chrome.windows.getAll()).length)return;for(const job of work.values()){job.cancelled=true;if(job.downloadId)await chrome.downloads.cancel(job.downloadId).catch(()=>{});}queue.length=0;const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});if(contexts.length)await engine('cleanup').catch(()=>{});work.clear();downloadClaims.clear();await VideoPocketDestinations.clear();await subtitleCaptures.clearAll();await chrome.storage.session.remove(['jobs','subtitleCache','youtubeSessions','youtubeCaptionRequests','lastError']);})().catch(()=>{});});

let checkingDestinations=false;
setInterval(async()=>{if(checkingDestinations)return;checkingDestinations=true;try{for(const job of work.values()){if(!job.picking||job.cancelled)continue;if(await VideoPocketDestinations.get(job.data.destinationId)){job.picking=false;queue.push(job);await updateJob(job.id,{state:'queued'});void pump();}else if(Date.now()>job.pickDeadline){job.cancelled=true;await finishJob(job,'cancelled','已取消');}}}finally{checkingDestinations=false;}},200);
