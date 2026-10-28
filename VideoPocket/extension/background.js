import {pageSnapshot,pageSubtitles} from './page.js';
import {BUILD_ID} from './build-info.js';
import {pageMediaPresence} from './media-presence.js';
import {waitForMediaSource} from './media-readiness.js';
import {mediaTime} from './media-time.js';
import {normalizeRange} from './media-range.js';
import {createBilibiliClient,bilibiliRoute} from './bilibili-api.js';
import {normalizeCues,parseSubtitles} from './subtitles.js';
import {ACTIVE_STATES} from './jobs.js';
import {youtubeSession,beginYoutubeSessionObservation,endYoutubeSessionObservation} from './youtube-session.js';
import {preferYoutubeSession} from './youtube-source-session.js';
import {youtubeCaptionRequest,beginYoutubeCaptionObservation,endYoutubeCaptionObservation} from './youtube-captions.js';
import {createYoutubeCaptionReader,youtubeCaptionAssist} from './youtube-caption-assist.js';
import {classifyFailure,ERROR_RETENTION_MS} from './diagnostics.js';
import {CAPTURE_PREFIX,CAPTURE_VERSION,createSubtitleCaptureManager} from './subtitle-captures.js';
import {loadBilibiliSubtitle} from './bilibili-subtitles.js';
import {fileStem} from './filenames.js';
import {isGenericMediaTitle} from './media-titles.js';
import {downloadKey,createDownloadClaims,stableHash} from './download-identity.js';
import {createJobAdmission} from './job-admission.js';
import {createDestinationMonitor} from './destination-monitor.js';
import {createDownloadStallGuard} from './download-stall.js';
import {pageMediaLease,createPageMediaGuard} from './page-media-guard.js';
import {isExpiredSourceAuth,matchesRecoverySelection,refreshedSourceDescriptor,sourceRecoveryTarget} from './source-recovery.js';
import {mediaRequestHeaders} from './media-request-headers.js';
import {createNetworkMediaObserver} from './network-observer.js';
import {attachNetworkSources,networkFallbackReason,scopeDocumentCandidates,validateOwnedSourcePlan} from './network-source.js';
import {attachSocialSources} from './social-source.js';
import {socialPageFetch} from './social-page-fetch.js';
import {createMediaSelectionController,selectionStorageKey,selectedMediaIndex,collapseBilibiliPlayers,recoverBilibiliRoute} from './media-selection-controller.js';
import {createPopupMarkerController} from './popup-marker.js';
import {createDiscoveryIntent,existingMediaResources,renewPageObservation,stopPageObservation} from './discovery-intent.js';
import {validateDocumentMediaPlan} from './document-media.js';
import {createGenericFallback,genericFallbackEligible,earlyPlayerEligible,earlyPlayerPlatform,genericPageUrl} from './generic-fallback.js';
import {genericPlayerSnapshot} from './generic-player.js';
import './destinations.js';
// MAIN-world hooks survive an extension reload. A one-time disposal of the
// previous build prevents its always-on observer lingering in already open tabs.
// This only removes hooks; it never enumerates players or reads page sources.
const observationUpgradeReady=(async()=>{
 const key='mediaObservationBuild',stored=await chrome.storage.session.get(key);if(stored[key]===BUILD_ID)return;
 const tabs=await chrome.tabs.query?.({})||[];
 await Promise.allSettled(tabs.filter(tab=>Number.isInteger(tab.id)&&/^https?:\/\//i.test(tab.url||'')).map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},world:'MAIN',func:stopPageObservation,injectImmediately:true})));
 await chrome.storage.session.remove(['youtubeSessions','youtubeCaptionRequests']);await chrome.storage.session.set({[key]:BUILD_ID});
})().catch(()=>{});
chrome.runtime.onInstalled?.addListener(()=>{void observationUpgradeReady;});
const mediaPicker=createMediaSelectionController(chrome,{acquireIntent:tabId=>discoveryIntent.acquire(tabId)});
const popupMarkers=createPopupMarkerController(chrome);
const networkMedia=createNetworkMediaObserver(chrome,{demandOnly:true});
const activeSourceTabs=new Set();
async function syncSourceActivity(){
 const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
 if(contexts.length)await engine('sourceActivity');
}
const discoveryIntent=createDiscoveryIntent({
 start:async tabId=>{activeSourceTabs.add(tabId);await observationUpgradeReady;await syncSourceActivity();networkMedia.enableTab(tabId);beginYoutubeSessionObservation(tabId);await beginYoutubeCaptionObservation(tabId);},
 stop:async tabId=>{
  activeSourceTabs.delete(tabId);
  networkMedia.disableTab(tabId);
  await Promise.allSettled([endYoutubeCaptionObservation(tabId),endYoutubeSessionObservation(tabId),syncSourceActivity(),chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:stopPageObservation,injectImmediately:true})]);
 },
 renew:tabId=>chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:renewPageObservation,injectImmediately:true}),
});
let creating,recoveringMedia,jobUpdates=Promise.resolve(),runningJob=null,headerWrites=Promise.resolve(),ruleId=100;
const work=new Map(),queue=[],popupViews=new Set(),downloads=new Map(),headerRules=new Map();let sourceOwnerRequestOrder=0;
const downloadStalls=createDownloadStallGuard();
const downloadClaims=createDownloadClaims();
const jobAdmission=createJobAdmission(20);
const sourceMeta=new Map();let failureWrites=Promise.resolve();
const closedSourceTabs=new Set();
const destinationMonitor=createDestinationMonitor({pending:()=>[...work.values()].some(job=>job.picking&&!job.cancelled),check:checkDestinations});
const pageMediaGuard=createPageMediaGuard({check:async context=>{
 try{return await script(context.tabId,pageMediaLease,[{mediaKey:context.mediaKey,playerUrl:context.playerUrl,contentId:context.contentId,timeoutMs:2000}],context.documentId);}
 catch{return {valid:false,missing:true};}
}});
function sourceInActiveJob(sourceId){return [...work.values()].some(job=>!job.cancelled&&job.data?.sourceId===sourceId&&ACTIVE_STATES.has(job.state || (job===runningJob?'running':'queued')));}
// Remove the legacy filename history once; actual conflict handling belongs to
// Chrome downloads or the native save picker, which can see the real target.
void chrome.storage.local.remove('savedFilenames');
function failureTask(fn){const task=failureWrites.catch(()=>{}).then(fn);failureWrites=task.catch(()=>{});return task;}
function recordFailure(error,context={}){const failure=classifyFailure(error,context.stage);if(failure.code==='CANCELLED')return failure;const record={id:crypto.randomUUID(),time:Date.now(),code:failure.code,...(failure.saveStage?{saveStage:failure.saveStage}:{}),...(failure.saveReason?{saveReason:failure.saveReason}:{}),...(failure.processingReason?{processingReason:failure.processingReason}:{}),...(failure.processingStage?{processingStage:failure.processingStage}:{}),...(failure.ffmpegExitCode!==undefined?{ffmpegExitCode:failure.ffmpegExitCode}:{}),...(failure.httpStatus?{httpStatus:failure.httpStatus}:{}),...(failure.apiCode!==undefined?{apiCode:failure.apiCode}:{}),...(failure.subtitleStage?{subtitleStage:failure.subtitleStage}:{}),...(failure.sourceStage?{sourceStage:failure.sourceStage}:{}),...(failure.requestMethod?{requestMethod:failure.requestMethod}:{}),...(failure.requestHost?{requestHost:failure.requestHost}:{}),...(['download','merge','save','inspect','subtitle'].includes(context.stage)?{stage:context.stage}:{})};void failureTask(()=>chrome.storage.session.set({lastError:record}));setTimeout(()=>void failureTask(async()=>{const {lastError}=await chrome.storage.session.get('lastError');if(lastError?.id===record.id)await chrome.storage.session.remove('lastError');}),ERROR_RETENTION_MS);return failure;}
// Keep one bounded, allowlisted failure; never store raw messages or URLs.
void chrome.storage.local.remove('diagnostics');
// Keep the queue alive while a direct-file Save As dialog is still open.
setInterval(()=>{if(work.size)void chrome.storage.session.get('jobs');},20000);
headerWrites=chrome.declarativeNetRequest.getSessionRules().then(rules=>chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:rules.map(r=>r.id)}));
function updateJob(id,patch){jobUpdates=jobUpdates.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.session.get('jobs');const entry=jobs.find(j=>j.id===id);if(entry)Object.assign(entry,patch);else jobs.unshift({id,...patch});const finished=jobs.filter(j=>!ACTIVE_STATES.has(j.state));await chrome.storage.session.set({jobs:[...jobs.filter(j=>ACTIVE_STATES.has(j.state)),...finished.filter(j=>j.requiresDismiss),...(popupViews.size?finished.filter(j=>!j.requiresDismiss).slice(0,10):[])]});});return jobUpdates;}
function recordTimings(job,values={}){const allowed=['downloadMs','normalizeMs','convertMs','validateMs','processingMs','saveMs','browserDownloadMs','browserSaveMs'],timings=Object.fromEntries(allowed.filter(key=>Number.isFinite(values[key])&&values[key]>=0&&values[key]<=Number.MAX_SAFE_INTEGER).map(key=>[key,Math.round(values[key])]));job.timings={...job.timings,...timings};return updateJob(job.id,{timings:job.timings});}
function dismissFinished(){jobUpdates=jobUpdates.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.session.get('jobs');await chrome.storage.session.set({jobs:jobs.filter(j=>ACTIVE_STATES.has(j.state)||j.requiresDismiss)});});return jobUpdates;}
async function clearTabSources(tabId){
 pageMediaGuard.clearTab(tabId);
 for(const [id,meta] of sourceMeta)if(meta.descriptor?.tabId===tabId){if(sourceInActiveJob(id))meta.evictOnRelease=true;else sourceMeta.delete(id);}
 const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
 if(contexts.length)await engine('dropTabSources',{tabId});
}
chrome.runtime.onConnect.addListener(view=>{if(view.name!=='popup')return;popupMarkers.attach(view);discoveryIntent.attach(view,chrome.runtime.getURL('popup.html'));popupViews.add(view);void dismissFinished();view.onDisconnect.addListener(()=>{popupViews.delete(view);void releaseSourceOwner(view.sender?.documentId).catch(()=>{});if(!popupViews.size){void dismissFinished();}for(const job of work.values())if(job.picking&&job.owner===view.sender?.documentId)job.pickDeadline=Date.now()+3000;});});
function sourceOwnerOpen(ownerId){return !!ownerId&&[...popupViews].some(view=>view.sender?.documentId===ownerId);}
async function releaseSourceOwner(ownerId){
 if(!ownerId||sourceOwnerOpen(ownerId))return;
 const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
 if(contexts.length)await engine('releaseSourceOwner',{ownerId});
}
async function acceptInspectedSource(sourceId,sender,ownerRequestOrder){
 const ownerId=sourceOwnerOpen(sender?.documentId)?sender.documentId:'';
 try{await engine('acceptSource',{sourceId,ownerId,ownerRequestOrder});}
 finally{if(ownerId&&!sourceOwnerOpen(ownerId))await releaseSourceOwner(ownerId).catch(()=>{});}
}
async function engine(action,data={}){
 if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]})).length){creating ||= chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS','WORKERS','DOM_PARSER'],justification:'下載原始影音，在瀏覽器合併與抽取音訊'}).finally(()=>creating=null);await creating;}
 const r=await chrome.runtime.sendMessage({target:'offscreen',action,...data,activeSourceTabs:[...activeSourceTabs]});if(!r?.ok)throw Object.assign(new Error(r?.error || '瀏覽器處理失敗'),r?.failure || {});return r.result;
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
 work.delete(job.id);destinationMonitor.refresh();job.youtubeCapture=null;downloadClaims.release(job.data.downloadKey,job.id);
 await engine('forget',{sourceId:job.data.sourceId,...(state==='error'||job.inspectionInvalid?{invalidateInspection:true}:{})}).catch(()=>{});
 await job.releaseObservation?.().catch(()=>{});
 if(job.meta?.evictOnRelease||closedSourceTabs.has(job.meta?.descriptor?.tabId))sourceMeta.delete(job.data.sourceId);
 if(job.data.destinationId)await VideoPocketDestinations.remove(job.data.destinationId).catch(()=>{});
 // The popup can reuse an inspected source for another interval or after a
 // cancelled Save As. Job completion releases its lock, not source metadata;
 // the final popup/job release starts the engine's 60 second idle grace.
 await updateJob(job.id,{state,message,finishedAt:Date.now(),progress:null});
}
async function waitDownload(downloadId,job){
 const [existing]=await chrome.downloads.search({id:downloadId});if(existing?.state==='complete')return;
 return new Promise((resolve,reject)=>{const active={job,resolve,reject,downloadId,retries:0};downloads.set(downloadId,active);if(existing?.state==='interrupted')void interruptedDownload(active,existing);});
}
async function startBrowserDownload(result){
 const save=filename=>chrome.downloads.download({url:result.url,filename,saveAs:true,conflictAction:'uniquify'});
 try{return await save(result.filename);}catch(error){
  const failure=classifyFailure(error,'save');
  if(failure.code==='SAVE_FAILED'&&failure.saveReason==='invalid-filename'){
   // The API rejected the name before starting a download. Reuse the finished
   // blob once with a conservative name; never download or process media again.
   const ext=String(result.filename || '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
   try{return await save('VideoPocket'+(ext?'.'+ext:''));}catch(retry){error=retry;}
  }
  throw Object.assign(new Error('檔案儲存失敗'),classifyFailure(error,'save'),{saveStage:'browser-start'});
 }
}
async function interruptedDownload(active,item){
 downloadStalls.reset(active.downloadId);
 if(active.job.cancelled){downloads.delete(active.downloadId);active.reject(new Error('已取消'));return;}if(active.handling||active.job.paused)return;active.handling=true;
 if(item?.error!=='USER_CANCELED')active.job.inspectionInvalid=true;
 try{const authStatus={SERVER_UNAUTHORIZED:401,SERVER_FORBIDDEN:403}[item?.error];
  if(authStatus){downloads.delete(active.downloadId);active.reject(Object.assign(new Error('來源授權失效'),{code:'HTTP_AUTH',httpStatus:authStatus}));return;}
  if(active.job.cancelled||!item?.canResume||!/NETWORK_|SERVER_FAILED|SERVER_UNREACHABLE/.test(item.error || '')){downloads.delete(active.downloadId);active.reject(Object.assign(new Error(item?.error || '下載中斷'),{saveStage:'browser-write'}));return;}
  if(active.retries++<3){await updateJob(active.job.id,{state:'retrying'});await new Promise(resolve=>setTimeout(resolve,Math.min(5000,500*2**(active.retries-1))));if(!active.job.cancelled&&!active.job.paused)await chrome.downloads.resume(active.downloadId);}
  else{active.job.paused=true;active.job.pauseState='interrupted';await updateJob(active.job.id,{state:'interrupted'});}
 }catch{active.job.paused=true;active.job.pauseState='interrupted';await updateJob(active.job.id,{state:'interrupted'});}finally{active.handling=false;}
}
chrome.downloads.onChanged.addListener(async delta=>{
 const active=downloads.get(delta.id);if(!active)return;
 if(delta.state?.current==='complete'){downloads.delete(delta.id);downloadStalls.reset(delta.id);active.resolve();}
 else if(delta.state?.current==='interrupted'){const [item]=await chrome.downloads.search({id:delta.id});void interruptedDownload(active,item);}
 else if(delta.bytesReceived){const [item]=await chrome.downloads.search({id:delta.id});if(item?.totalBytes>0)void updateJob(active.job.id,{state:active.job.paused?'paused':'running',progress:item.bytesReceived/item.totalBytes*100});}
});
async function checkBrowserDownloads(){
 for(const [id,active]of downloads){
  let item;try{[item]=await chrome.downloads.search({id});}catch{continue;}
  if(downloads.get(id)!==active)continue;
  if(item?.state==='complete'){downloads.delete(id);downloadStalls.reset(id);active.resolve();}
  else if(item?.state==='interrupted')void interruptedDownload(active,item);
  else if(downloadStalls.update(item,{paused:active.job.paused,choosing:active.job.picking})){
   downloads.delete(id);downloadStalls.reset(id);active.job.inspectionInvalid=true;
   active.reject(Object.assign(new Error('下載長時間沒有進度'),{code:'NETWORK_TIMEOUT'}));
   void chrome.downloads.cancel(id).catch(()=>{});
  }else if(item?.totalBytes>0)void updateJob(active.job.id,{state:active.job.paused||item.paused?'paused':'running',progress:Math.min(99,item.bytesReceived/item.totalBytes*100)});
 }
}
setInterval(()=>{if(downloads.size)void checkBrowserDownloads();},1000);
async function saveBrowserResult(job,result){
 job.browserResult=result;
 for(;;){
  if(job.cancelled)throw new Error('已取消');
  if(result.saved)return result;
  if(result.referer)await assetHeaders(result.url,result.referer);
  job.stage=result.blobId?'save':'download';await updateJob(job.id,{state:'choosing',progress:null});
  const began=Date.now(),downloadId=await startBrowserDownload(result);job.downloadId=downloadId;
  if(job.cancelled){await chrome.downloads.cancel(downloadId);throw new Error('已取消');}
  await updateJob(job.id,{state:'running',progress:null});
  try{
   await waitDownload(downloadId,job);await recordTimings(job,{[result.blobId?'browserSaveMs':'browserDownloadMs']:Date.now()-began});return result;
  }catch(error){
   if(result.blobId||!await refreshFailedSource(job,error))throw error;
   job.downloadId=null;result=await downloadWithSourceRecovery(job);job.browserResult=result;
  }finally{downloadStalls.reset(downloadId);}
 }
}
async function pump(){
 if(runningJob)return;
 while(queue.length){const next=queue.findIndex(j=>!j.paused);if(next<0)return;const job=queue.splice(next,1)[0];if(!work.has(job.id))continue;runningJob=job;let result;
  try{
   job.startedAt=Date.now();job.stage='download';await updateJob(job.id,{state:'running',progress:null});result=await downloadWithSourceRecovery(job);if(job.cancelled)throw new Error('已取消');
   result=await saveBrowserResult(job,result);await finishJob(job,'done','下載完成');
  }catch(e){const failure=classifyFailure(job.cancelled?{code:'CANCELLED'}:e,job.stage);if(failure.code!=='CANCELLED')recordFailure(e,{stage:job.stage,platform:job.meta?.platform,action:job.data.kind,height:job.data.height,elapsedMs:Date.now()-job.startedAt,storageMode:result?.blobId?'disk':undefined});await updateJob(job.id,{errorCode:failure.code,...(failure.code==='PAGE_MEDIA_GONE'?{requiresDismiss:true,resumable:false}:{})});await finishJob(job,failure.code==='CANCELLED'?'cancelled':'error',failure.message);}
  finally{const finished=job.browserResult||result;if(finished?.blobId)await engine('release',{blobId:finished.blobId}).catch(()=>{});job.browserResult=null;runningJob=null;}
 }
}
async function script(tabId,func,args=[],documentId,world='MAIN'){const results=await chrome.scripting.executeScript({target:{tabId,...(documentId?{documentIds:[documentId]}:{})},world,func,args,...(documentId?{injectImmediately:true}:{})});const result=results[0]?.result;if(!result)throw new Error('無法讀取目前影片，請更新影片資訊');if(result.error)throw Object.assign(new Error(result.error),{code:result.errorCode,status:result.errorStatus,apiCode:result.errorApiCode,subtitleStage:result.subtitleStage,retryable:result.retryable});return result;}
async function genericSnapshot(descriptor,binding,signal,mode){
 signal?.throwIfAborted();
 const result=await script(descriptor.tabId,genericPlayerSnapshot,[{mediaKey:descriptor.mediaKey,pageUrl:descriptor.referer,...(binding?{binding}:{}),...(mode?{mode}:{})}],descriptor.documentId);
 signal?.throwIfAborted();return result;
}
async function verifyGenericPlan(plan){
 if(!plan)return;
 let valid=false;try{valid=(await genericSnapshot(plan.descriptor,plan.binding,undefined,plan.mode)).valid===true;}catch{}
 if(!valid)throw Object.assign(new Error('影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
}
const genericRecovery=createGenericFallback({
 primary:(descriptor,inspectionId,{force=false}={})=>engine('inspect',{descriptor,inspectionId,force}),
 collect:(descriptor,signal)=>genericSnapshot(descriptor,undefined,signal),
 validate:async(descriptor,binding,signal,mode)=>(await genericSnapshot(descriptor,binding,signal,mode)).valid===true,
 forget:sourceId=>engine('forget',{sourceId,discardInspection:true}),cancelPrimary:inspectionId=>engine('cancelInspect',{inspectionId}),
 classify:error=>classifyFailure(error,'inspect'),hash:stableHash,
});
async function verifyMetadataPlan(descriptor){
 const p=descriptor.platform,owned=p?.site==='network-media'&&p.binding==='player-owned';
 if(p?.site!=='metadata-media'&&!owned)return;
 let valid=false;
 if(Number.isInteger(descriptor.tabId)&&descriptor.documentId&&descriptor.mediaKey!=null)try{
  const result=await script(descriptor.tabId,owned?validateOwnedSourcePlan:validateDocumentMediaPlan,[owned?{mediaKey:descriptor.mediaKey,source:p.bindingSource,duration:p.expectedDuration,versions:p.versions}:{token:p.validationToken,mediaKey:descriptor.mediaKey}],descriptor.documentId);
  valid=result.valid===true;
 }catch{}
 if(!valid)throw Object.assign(new Error('目前選取的影片已變更，請重新整理'),{code:'SOURCE_CHANGED'});
}
function sourceDescriptorCopy(descriptor){return JSON.parse(JSON.stringify(descriptor));}
async function youtubeDownloadSession(meta,sourceId){
 if(meta?.platform!=='youtube'||!meta.descriptor?.platform?.streamingData?.serverAbrStreamingUrl)return null;
 const live=await youtubeSession(meta.descriptor);
 const cached=await engine('youtubeSourceSession',{sourceId,...(live?{capture:live}:{})});
 return cached || null;
}
async function inspectSourceDescriptor(descriptor,inspectionId,alreadyVerified=false,force=false){
 if(!alreadyVerified)await verifyMetadataPlan(descriptor);
 let inspected;
 try{inspected=await genericRecovery.inspect(descriptor,inspectionId,{force});}
 catch(error){
  if(descriptor.platform?.binding!=='generic-early'||classifyFailure(error,'inspect').code!=='SOURCE_UNAVAILABLE')throw error;
  const plan=descriptor.platform.earlyPlan;await verifyGenericPlan(plan);
  const refreshed=await snapshot(descriptor.tabId,descriptor.mediaIndex||0,true,{frameId:descriptor.frameId,documentId:descriptor.documentId,mediaKey:descriptor.mediaKey,url:plan.binding.source},true);
  const selected=refreshed.videos[refreshed.mediaIndex];
  descriptor={...descriptor,url:selected.downloadUrl,sourceType:selected.sourceType,referer:selected.referer || refreshed.url,title:selected.title || refreshed.title,duration:refreshed.media?.duration,drm:refreshed.media?.drm,platform:refreshed.platform,linkedMedia:selected.linkedMedia,mediaKey:selected.mediaKey,frameId:selected.frameId,documentId:selected.documentId,localMediaIndex:selected.localMediaIndex,mediaIndex:refreshed.mediaIndex,mediaContentId:selected.mediaContentId,mediaIdentity:selected.mediaIdentity,selectionIdentity:selected.selectionIdentity,playerUrl:selected.url};
  await verifyMetadataPlan(descriptor);
  inspected=await genericRecovery.inspect(descriptor,inspectionId,{skipFallback:true,force});
 }
 try{await verifyMetadataPlan(descriptor);}catch(error){await engine('forget',{sourceId:inspected.result.id,discardInspection:true}).catch(()=>{});throw error;}
 return {descriptor,...inspected};
}
async function assertRecoveryActive(job){while(job.paused&&!job.cancelled)await new Promise(resolve=>{job.recoveryWaiters ||= new Set();job.recoveryWaiters.add(resolve);});if(job.cancelled)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});}
function wakeRecoveryWaiters(job){for(const resolve of job.recoveryWaiters || [])resolve();job.recoveryWaiters?.clear();}
async function recoverSignedSource(job){
 return discoveryIntent.run(job.meta?.descriptor?.tabId,()=>recoverSignedSourceActive(job));
}
async function recoverSignedSourceActive(job){
 const oldSourceId=job.data.sourceId,oldMeta=job.meta,descriptor=oldMeta?.descriptor,target=sourceRecoveryTarget(descriptor);
 if(!oldMeta||!descriptor||!target)return false;
 let newSourceId='',switched=false;
 try{
  await assertRecoveryActive(job);
  if(oldMeta.genericPlan)await verifyGenericPlan(oldMeta.genericPlan);
  const page=await snapshot(descriptor.tabId,descriptor.mediaIndex||0,true,target,true);
  await assertRecoveryActive(job);
  const freshDescriptor=refreshedSourceDescriptor(descriptor,page,target);
  job.recoveryInspectionId='source-recovery:'+job.id;
  let inspected;try{inspected=await inspectSourceDescriptor(freshDescriptor,job.recoveryInspectionId,false,true);}finally{job.recoveryInspectionId=null;}
  newSourceId=inspected.result.id;
  if(!newSourceId||newSourceId===oldSourceId)throw Object.assign(new Error('無法取得新的影片來源'),{code:'SOURCE_CHANGED'});
  await assertRecoveryActive(job);
  const freshTarget=sourceRecoveryTarget(inspected.descriptor);
  if(!freshTarget||freshTarget.documentId!==target.documentId||freshTarget.frameId!==target.frameId||String(freshTarget.mediaKey)!==String(target.mediaKey)||freshTarget.mediaContentId!==target.mediaContentId||freshTarget.selectionIdentity!==target.selectionIdentity)throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
  await engine('validateRecovery',{oldSourceId,newSourceId,selection:{kind:job.data.kind,height:job.data.height,audioQuality:job.data.audioQuality,...(job.data.range?{range:job.data.range}:{})}});
  await assertRecoveryActive(job);
  const ownership=await snapshot(descriptor.tabId,descriptor.mediaIndex||0,true,target,true);
  await assertRecoveryActive(job);
  if(!matchesRecoverySelection(target,ownership))throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
  await verifyMetadataPlan(inspected.descriptor);
  if(inspected.genericPlan)await verifyGenericPlan(inspected.genericPlan);
  await assertRecoveryActive(job);
  await engine('retain',{sourceId:newSourceId});
  await assertRecoveryActive(job);
  const newMeta={platform:inspected.result.platform || inspected.descriptor.platform?.site || oldMeta.platform,downloadKey:oldMeta.downloadKey,result:inspected.result,descriptor:sourceDescriptorCopy(inspected.descriptor),...(inspected.genericPlan?{genericPlan:inspected.genericPlan}:{})};
  const youtubeCapture=await youtubeDownloadSession(newMeta,newSourceId);
  await assertRecoveryActive(job);
  await engine('acceptSource',{sourceId:newSourceId});
  sourceMeta.set(newSourceId,newMeta);
  job.data.sourceId=newSourceId;job.meta=newMeta;if(youtubeCapture)job.youtubeCapture=youtubeCapture;switched=true;
  await engine('forget',{sourceId:oldSourceId}).catch(()=>{});
  return true;
 }catch(error){
  if(newSourceId&&newSourceId!==oldSourceId&&!switched){sourceMeta.delete(newSourceId);await engine('forget',{sourceId:newSourceId}).catch(()=>{});}
  throw error;
 }
}
async function refreshFailedSource(job,error){
 if(!isExpiredSourceAuth(error,job.stage)||job.sourceRecoveryAttempted)return false;
 await assertRecoveryActive(job);if(job.sourceRecoveryAttempted)return false;
 job.sourceRecoveryAttempted=true;return recoverSignedSource(job);
}
async function downloadWithSourceRecovery(job){
 try{return await engine('download',{...job.data,id:job.id,filename:job.filename});}
 catch(error){
  // A later native request may supply the proof missing from the first one.
  // Retry only that exact source, after its failed download has been cleaned.
  if(classifyFailure(error).code==='STREAM_VERIFICATION'&&job.meta?.platform==='youtube'&&!job.youtubeProofRetried){
   await assertRecoveryActive(job);
   const used=job.youtubeCapture,fresh=await youtubeDownloadSession(job.meta,job.data.sourceId).catch(()=>null);
   if(fresh&&Number(fresh.poLength)>Number(used?.poLength||0)){
    job.youtubeProofRetried=true;job.youtubeCapture=fresh;await assertRecoveryActive(job);
    return engine('download',{...job.data,id:job.id,filename:job.filename});
   }
  }
  if(!await refreshFailedSource(job,error))throw error;
  await assertRecoveryActive(job);
  return engine('download',{...job.data,id:job.id,filename:job.filename});
 }
}
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
async function readPageSubtitleDirect(request){
 const selector={...request.selector};
 if(selector.pageSource==='youtube-page'&&!selector.captionUrl){const captionUrl=await youtubeCaptionRequest(request.tabId,selector,request.language,!!request.automatic);if(captionUrl)selector.captionUrl=captionUrl;}
 const localMediaIndex=selector.localMediaIndex ?? request.mediaIndex ?? 0;
 return loadPageSubtitle(request.tabId,selector,request.language,!!request.automatic,localMediaIndex,request.documentId || selector.documentId);
}
const readYoutubeCaption=createYoutubeCaptionReader({
 read:readPageSubtitleDirect,
 command:(request,options)=>script(request.tabId,youtubeCaptionAssist,[options],request.documentId || request.selector?.documentId),
 request:(request,since)=>youtubeCaptionRequest(request.tabId,{...request.selector,documentId:request.documentId || request.selector?.documentId},request.language,!!request.automatic,since),
});
async function preserveSubtitleSession(request){
 const meta=sourceMeta.get(request.sourceId),descriptor=meta?.descriptor,selector=request.selector||{};
 if(meta?.platform!=='youtube'||descriptor?.tabId!==request.tabId||descriptor.documentId!==(request.documentId||selector.documentId)||descriptor.platform?.id!==selector.videoId||(selector.frameId!=null&&(descriptor.frameId??0)!==selector.frameId)||(selector.mediaKey!=null&&descriptor.mediaKey!==selector.mediaKey))return;
 await youtubeDownloadSession(meta,request.sourceId).catch(()=>{});
}
async function readPageSubtitle(request){
 await preserveSubtitleSession(request);
 try{return await readYoutubeCaption(request);}finally{await preserveSubtitleSession(request);}
}
async function readCapturedSubtitle(request){
 return discoveryIntent.run(request.tabId,()=>readCapturedSubtitleActive(request));
}
async function readCapturedSubtitleActive(request){
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
async function snapshot(tabId,index=0,preferPicked=true,expectedTarget,skipEarly=false){
 return discoveryIntent.run(tabId,()=>snapshotActive(tabId,index,preferPicked,expectedTarget,skipEarly));
}
async function snapshotActive(tabId,index=0,preferPicked=true,expectedTarget,skipEarly=false){
  if(!preferPicked)await mediaPicker.clear(tabId);
  // A visible player can be ready while advertising frames keep the page's
  // load event pending. Read unknown pages now; retain original scheduling
  // for known platforms and for an inventory that is still empty.
  let immediate=false;try{immediate=genericPageUrl((await chrome.tabs.get?.(tabId))?.url);}catch{}
  await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',files:['media-observer.js'],...(immediate?{injectImmediately:true}:{})}).catch(()=>{});
  const resources=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:existingMediaResources,injectImmediately:true}).catch(()=>[]);
  networkMedia.seed(tabId,resources.flatMap(frame=>(Array.isArray(frame.result)?frame.result:[]).map(item=>({...item,frameId:frame.frameId,documentId:frame.documentId}))));
  let frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:pageSnapshot,args:[0,'summary'],...(immediate?{injectImmediately:true}:{})});
  if(immediate&&!frames.some(frame=>frame.result?.videos?.length))frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:pageSnapshot,args:[0,'summary']});
  frames.sort((a,b)=>a.frameId-b.frameId);
  const top=frames.find(f=>f.frameId===0)?.result;if(!top)throw new Error('無法讀取目前網頁');
  const collectVideos=()=>{const items=recoverBilibiliRoute(collapseBilibiliPlayers(frames.flatMap(f=>(f.result?.videos || []).map((v,i)=>({...v,frameId:f.frameId,documentId:f.documentId,localMediaIndex:i})))),top,frames.find(f=>f.frameId===0));const mains=items.filter(v=>v.dailymotionMain);if(mains.length===1&&top.dailymotionContext?.id)mains[0].mediaContentId=top.dailymotionContext.id;return items;};
  let videos=collectVideos(),expectedDeepIdentity='';
  if(expectedTarget){
   const target=expectedTarget,contentId=String(target.mediaContentId||target.linkedMedia?.id||target.mediaIdentity||'');
   const scoped=videos.filter(video=>Number(video.frameId)===Number(target.frameId)&&String(video.documentId||'')===String(target.documentId||''));
   const contentMatches=contentId?scoped.filter(video=>String(video.mediaContentId||video.linkedMedia?.id||video.mediaIdentity||'')===contentId):[];
   const keyMatches=scoped.filter(video=>String(video.mediaKey??'')===String(target.mediaKey??''));
   if(keyMatches.length>1)throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
   let matches=contentId?(contentMatches.length===1?contentMatches:contentMatches.filter(video=>keyMatches.includes(video))):keyMatches;
   const stableOwnership=keyMatches.length===1&&!!target.selectionIdentity&&keyMatches[0].selectionIdentity===target.selectionIdentity&&(!target.url||!keyMatches[0].url||target.url===keyMatches[0].url);
   // Summary does not consult models; prefer the same proven DOM owner when
   // discovery has enriched the model ID since the previous snapshot.
   if(stableOwnership){matches=keyMatches;if(contentId&&!contentMatches.includes(keyMatches[0]))expectedDeepIdentity=contentId;}
   else if(target.selectionIdentity&&keyMatches.length===1&&keyMatches[0].selectionIdentity&&keyMatches[0].selectionIdentity!==target.selectionIdentity)matches=[];
   // Summary reads intentionally omit model lookup. A previously selected
   // model ID can be recovered by deep discovery on the same element, but
   // must be checked again before returning any refreshed source.
   if(contentId&&!contentMatches.length&&keyMatches.length===1&&target.mediaKey!=null){
    const candidate=keyMatches[0],identity=String(candidate.mediaContentId||candidate.linkedMedia?.id||candidate.mediaIdentity||'');
    if(!identity&&(!target.url||!candidate.url||target.url===candidate.url)){matches=keyMatches;expectedDeepIdentity=contentId;}
   }
   if(matches.length!==1)throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
   index=videos.indexOf(matches[0]);
  }
  const key=selectionStorageKey(tabId);let remembered=(await chrome.storage.session.get(key))[key],selectionExpired=false,migratedPage;
  if(preferPicked&&!expectedTarget&&!remembered){const preferred=frames.find(f=>f.frameId===0);const chosen=videos.findIndex(v=>v.frameId===preferred?.frameId&&v.localMediaIndex===preferred?.result?.preferredMediaIndex);if(chosen>=0)index=chosen;}
  if(remembered&&preferPicked&&!expectedTarget){
   let rememberedIndex=selectedMediaIndex(videos,remembered,top.url);
   // Build 20 selections have a modelToken but no selectionToken. Summary
   // discovery may expose an evidence key in mediaIdentity, so verify the
   // unique candidate deeply before migrating; never promote by mediaKey alone.
   if(rememberedIndex<0&&!remembered.selectionToken&&remembered.modelToken&&remembered.pageToken===stableHash(top.url)){
    const candidates=videos.filter(video=>Number(video.frameId)===Number(remembered.frameId)&&String(video.documentId||'')===String(remembered.documentId||'')&&String(video.mediaKey??'')===String(remembered.mediaKey??'')&&(!remembered.sourceToken||stableHash(video.url||'')===remembered.sourceToken));
    if(candidates.length===1){
     const candidate=candidates[0],frame=frames.find(item=>item.frameId===candidate.frameId&&String(item.documentId||'')===String(candidate.documentId||''));
     try{
      const deep=await script(tabId,pageSnapshot,[candidate.localMediaIndex,'deep',{maxItems:24,maxMs:1800}],candidate.documentId);
      if(frame){frame.result=deep;videos=collectVideos();const matches=videos.filter(video=>Number(video.frameId)===Number(remembered.frameId)&&String(video.documentId||'')===String(remembered.documentId||'')&&String(video.mediaKey??'')===String(remembered.mediaKey??'')),current=matches.length===1&&String(deep.media?.mediaKey??'')===String(remembered.mediaKey??'')?matches[0]:null;
       const ids=[current?.mediaIdentity,current?.mediaContentId,current?.linkedMedia?.id].map(value=>String(value||'')).filter(Boolean);
       const sourceOk=!!current&&(!remembered.sourceToken||stableHash(current.url||'')===remembered.sourceToken),modelOk=ids.some(value=>stableHash(value)===remembered.modelToken);
       if(sourceOk&&modelOk&&current.selectionIdentity){remembered={...remembered,selectionToken:stableHash(current.selectionIdentity)};await chrome.storage.session.set({[key]:remembered});rememberedIndex=selectedMediaIndex(videos,remembered,top.url);migratedPage=deep;}
      }
     }catch{}
    }
   }
   if(rememberedIndex>=0)index=rememberedIndex;else{const oldDocumentAlive=frames.some(frame=>Number(frame.frameId)===Number(remembered.frameId)&&String(frame.documentId||'')===String(remembered.documentId||''));selectionExpired=oldDocumentAlive&&remembered.pageToken===stableHash(top.url);if(!selectionExpired)await chrome.storage.session.remove(key);}
  }
  if(!preferPicked&&remembered)await chrome.storage.session.remove(key);
  index=Math.max(0,Math.min(Number(index)||0,videos.length-1));let selected=videos[index];
  let page=selected?frames.find(f=>f.frameId===selected.frameId)?.result:top;
  const selectedFrame=selected&&frames.find(f=>f.frameId===selected.frameId&&String(f.documentId||'')===String(selected.documentId||''));
  if(selected?.localMediaIndex != null && (selectedFrame?.result?.discoveryMode==='summary' || selected.localMediaIndex!==0)){
   const previous=selected,frame=frames.find(f=>f.frameId===selected.frameId&&String(f.documentId||'')===String(selected.documentId||''));
   let earlyPlatform;
   const owner={tabId,frameId:selected.frameId,documentId:selected.documentId,mediaKey:selected.mediaKey,referer:selected.referer || page.url,platform:page.platform,linkedMedia:selected.linkedMedia};
   if(!skipEarly&&!migratedPage&&!selectionExpired&&!expectedDeepIdentity&&/^blob:/i.test(selected.url||'')&&earlyPlayerEligible(owner)){
    try{earlyPlatform=earlyPlayerPlatform(owner,await genericSnapshot(owner,undefined,undefined,'early'),stableHash);}catch{}
   }
   page=migratedPage || await script(tabId,pageSnapshot,[selected.localMediaIndex,earlyPlatform?'focused':'deep',{maxItems:24,maxMs:1800,...(earlyPlatform?{earlyPlatform}:{})}],selected.documentId);
   // A player can replace/reorder its <video> between the all-frame scan and
   // this selected-frame read. Keep the page metadata, media list, and marker
   // key from one DOM generation; never combine the second scan's player data
   // with the first scan's element identity.
   if(frame){frame.result=page;videos=collectVideos();
    const sameContent=(current)=>{
      if(!current||current.frameId!==previous.frameId||String(current.documentId||'')!==String(previous.documentId||'')||String(current.mediaKey??'')!==String(previous.mediaKey??''))return false;
      const oldIdentity=String(previous.mediaContentId||previous.linkedMedia?.id||previous.mediaIdentity||''),newIdentity=String(current.mediaContentId||current.linkedMedia?.id||current.mediaIdentity||''),oldUrl=String(previous.url||''),newUrl=String(current.url||'');
      if(previous.selectionIdentity&&current.selectionIdentity)return previous.selectionIdentity===current.selectionIdentity&&(!oldUrl||!newUrl||oldUrl===newUrl);
      if(oldIdentity&&newIdentity)return oldIdentity===newIdentity;
      // Deep discovery can strengthen an anonymous element with a media ID.
      // Its stable element key and source must still agree with the inventory.
      if(oldIdentity&&!newIdentity)return false;
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
  const result=scopeDocumentCandidates({...page,tabId,url:top.url,videos,mediaIndex:index,selectionExpired,frameId:selected?.frameId,documentId:selected?.documentId,localMediaIndex:selected?.localMediaIndex,preferredLanguages:top.preferredLanguages,language:top.language});
  const records=networkMedia.candidates({tabId,pageUrl:top.url}),fallbackReason=networkFallbackReason(result,records),attached=attachNetworkSources(attachSocialSources(result,records),records);
  if(attached.media){
    const local=records.filter(record=>(!selected?.documentId||record.documentId===selected.documentId)&&(selected?.frameId==null||record.frameId===selected.frameId));
    const reason=attached.platform && (!attached.platform.networkFallback || attached.platform.site==='network-media') ? '' : fallbackReason;
    attached.media={...attached.media,discoveryDiagnostics:{...attached.media.discoveryDiagnostics,playerCount:videos.length,localNetworkCandidates:local.length,unboundFallbackBlocked:!!reason,networkFallbackReason:reason || undefined}};
  }
  if(expectedDeepIdentity){
   const current=attached.videos?.[attached.mediaIndex],identity=String(current?.mediaContentId||current?.linkedMedia?.id||current?.mediaIdentity||'');
   if(attached.selectionExpired||identity!==expectedDeepIdentity)throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
  }
  return attached;
}

const sessionReady=(async()=>{const {runSession}=await chrome.storage.session.get('runSession');if(!runSession){await chrome.storage.session.set({runSession:crypto.randomUUID()});const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});if(contexts.length)await engine('cleanup');await VideoPocketDestinations.clear();}})().catch(()=>{});
async function handle(message,sender){
 if(['inspect','genericInspect'].includes(message.action))message={...message,ownerRequestOrder:++sourceOwnerRequestOrder};
 if(['inspect','genericInspect','waitMediaSource','prepareDownload','download'].includes(message.action))return discoveryIntent.run(message.tabId??message.descriptor?.tabId??sourceMeta.get(message.sourceId)?.descriptor?.tabId,()=>handleActive(message,sender));
 return handleActive(message,sender);
}
async function handleActive(message,sender){
 if(!['assetHeaders','progress','heartbeat','youtubeSession','socialPageFetch','observedManifest'].includes(message.action))await Promise.all([sessionReady,captureRecoveryReady]);
 if(recoveringMedia&&['snapshot','inspect','prepareDownload','download'].includes(message.action))await recoveringMedia;
 switch(message.action){
  case 'sourcesExpired':{
   if(sender.url!==chrome.runtime.getURL('offscreen.html')||!Array.isArray(message.sourceIds)||message.sourceIds.some(id=>typeof id!=='string'||id.length>128))throw new Error('來源未授權');
   for(const id of message.sourceIds)if(!sourceInActiveJob(id))sourceMeta.delete(id);
   return {};
  }
  case 'performance':{
   if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');
   const job=work.get(message.id);if(job)await recordTimings(job,message.timings);return {};
  }
  case 'recoverDownloads':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');
   await jobRecoveryReady;
   if(work.size||downloadClaims.size||jobAdmission.reserved)return {active:true};
   // A record is not a resumable manifest. Remove abandoned media even when
   // the popup is opened on a page without any detectable video. With no
   // live jobs, destination entries are orphaned handles from an interrupted
   // save and can be dropped without touching the user's files.
   recoveringMedia ||= Promise.all([engine('recoverMedia'),VideoPocketDestinations.clear()]).finally(()=>recoveringMedia=null);
   await recoveringMedia;return {cleaned:true};
  }
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
   const operation=()=>script(context.tabId,socialPageFetch,[message.operation,{...message.options,referer:context.referer}],context.documentId);
   if(message.operation==='cancel')return operation();
   return pageMediaGuard.run(context,operation,()=>message.options?.handle?script(context.tabId,socialPageFetch,['cancel',{handle:message.options.handle}],context.documentId):Promise.resolve());
  }
  case 'pickMedia':if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');return mediaPicker.begin(message.tabId);
  case 'snapshot':return snapshot(message.tabId,message.mediaIndex || 0,message.preferPicked!==false,message.expectedTarget);
  case 'mediaPresence':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');
   const targets=message.targets;
   if(!Number.isInteger(message.tabId)||!Array.isArray(targets)||targets.length>256||targets.some(target=>!Number.isInteger(target?.frameId)||target.frameId<0||typeof target.documentId!=='string'||!target.documentId||target.documentId.length>128||!['string','number'].includes(typeof target.mediaKey)||String(target.mediaKey).length>256))throw new Error('影片清單無效');
   if(!targets.length)return {checked:true,missing:[]};
   const keys=[...new Set(targets.map(target=>String(target.mediaKey)))];
   const frames=await chrome.scripting.executeScript({target:{tabId:message.tabId,allFrames:true},world:'MAIN',func:pageMediaPresence,args:[keys],injectImmediately:true});
   const missing=targets.filter(target=>{const frame=frames.find(frame=>frame.frameId===target.frameId&&frame.documentId===target.documentId);return !frame||frame.result?.checked===true&&Array.isArray(frame.result.present)&&!frame.result.present.includes(String(target.mediaKey));});
   return {checked:true,missing};
  }
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
  case 'cancelInspect':if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');genericRecovery.cancel(message.inspectionId);return engine('cancelInspect',{inspectionId:message.inspectionId});
  case 'genericInspect':
  case 'inspect':{
   if(message.action==='genericInspect'&&(sender.url!==chrome.runtime.getURL('popup.html')||!genericFallbackEligible(message.descriptor)))throw Object.assign(new Error('尚未取得此影片來源'),{code:'SOURCE_UNAVAILABLE'});
   let descriptor={...message.descriptor,downloadKey:downloadKey(message.descriptor)};const key=descriptor.downloadKey;
   await verifyMetadataPlan(descriptor);
   const active=[...work.values()].find(job=>!job.cancelled&&ACTIVE_STATES.has(job.state || (job===runningJob?'running':'queued'))&&job.data?.downloadKey===key);
   const cached=!message.force&&active&&sourceMeta.get(active.data.sourceId)?.result;
   if(cached){await acceptInspectedSource(active.data.sourceId,sender,message.ownerRequestOrder);return {...cached,downloadKey:key};}
   const inspected=await inspectSourceDescriptor(descriptor,message.inspectionId,true,message.force===true),finalDescriptor=inspected.descriptor,{result,genericPlan}=inspected;
   const resolvedKey=genericPlan?stableHash(['generic-player',key,genericPlan.binding.fingerprint]):key;
   result.downloadKey=resolvedKey;
   const meta={platform:result.platform || finalDescriptor.platform?.site || 'unknown',downloadKey:resolvedKey,result,descriptor:sourceDescriptorCopy(finalDescriptor),...(genericPlan?{genericPlan}:{})};
   const previousMeta=sourceMeta.get(result.id);sourceMeta.set(result.id,meta);
   try{
    // Preserve already observed playback data while the popup still owns its
    // observation, before captions or closing the popup can release that lease.
    if(meta.platform==='youtube')await youtubeDownloadSession(meta,result.id).catch(()=>{});
    if(closedSourceTabs.has(finalDescriptor.tabId)){sourceMeta.delete(result.id);await engine('dropTabSources',{tabId:finalDescriptor.tabId}).catch(()=>{});throw Object.assign(new Error('原影片分頁已關閉'),{code:'PAGE_MEDIA_GONE'});}
    if(sourceMeta.get(result.id)!==meta)throw Object.assign(new Error('目前影片來源已變更，請重新選取'),{code:'SOURCE_CHANGED'});
    await acceptInspectedSource(result.id,sender,message.ownerRequestOrder);
    return result;
   }catch(error){
    if(sourceMeta.get(result.id)===meta){if(previousMeta&&!closedSourceTabs.has(finalDescriptor.tabId))sourceMeta.set(result.id,previousMeta);else sourceMeta.delete(result.id);}
    await engine('forget',{sourceId:result.id,discardInspection:true}).catch(()=>{});throw error;
   }}
  case 'browserSubtitle':return engine('subtitle',{sourceId:message.sourceId,index:message.index});
  case 'pageSubtitle':return discoveryIntent.run(message.tabId,()=>readPageSubtitle(message));
  case 'captureSubtitle':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw Object.assign(new Error('字幕擷取來源未授權'),{code:'SUBTITLE_UNAVAILABLE'});
   return subtitleCaptures.start({...message});
  }
  case 'prepareDownload':
  case 'download':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw Object.assign(new Error('來源未授權'),{code:'UNAUTHORIZED'});
   await jobRecoveryReady;
   const releaseAdmission=jobAdmission.reserve(work.size);if(!releaseAdmission)throw new Error('等待中的下載過多，請等候完成');
   try{
    if(!message.sourceId)throw new Error('請重新整理來源');
    const meta=sourceMeta.get(message.sourceId),range=normalizeRange(message.range,meta?.result?.duration);
    if(range&&!meta?.result?.range?.supported)throw Object.assign(new Error('此來源暫不支援區間下載'),{code:'RANGE_UNSUPPORTED'});
    const id=crypto.randomUUID(),key=sourceMeta.get(message.sourceId)?.downloadKey || message.downloadKey || `source:${message.sourceId}`;
    const claim=downloadClaims.claim(key,id);if(!claim.claimed)return {duplicate:true,id:claim.id};
    let retained,observation;try{retained=await engine('retain',{sourceId:message.sourceId});
    // Pin before asynchronous ownership checks so a successful refresh cannot
    // retire a source that this download is already preparing to use.
    if(meta?.genericPlan)await verifyGenericPlan(meta.genericPlan);
    observation=discoveryIntent.acquire(meta?.descriptor?.tabId);await observation.ready;
    const titleCandidates=[retained.title,message.title].map(value=>String(value || '').trim()).filter(value=>!isGenericMediaTitle(value)),platform=message.platform || sourceMeta.get(message.sourceId)?.platform;
    if(platform==='youtube'&&!titleCandidates.length)throw Object.assign(new Error('未取得 YouTube 影片標題，請重新整理影片資訊'),{code:'SOURCE_UNAVAILABLE'});
     const title=String(titleCandidates[0] || 'Video').slice(0,300),filename=fileStem(title);
     // A queued SABR download owns a bounded copy of its authorized session.
     // Closing the popup can then erase observations without breaking the job.
     const youtubeCapture=await youtubeDownloadSession(meta,message.sourceId);
     const job={id,title,filename,meta,youtubeCapture,releaseObservation:observation.release,data:{sourceId:message.sourceId,downloadKey:key,kind:message.kind,height:Number(message.height)||0,audioQuality:message.audioQuality || 'best',destinationId:message.destinationId,...(range?{range:{start:range.start,end:range.end}}:{})}};work.set(id,job);releaseAdmission();job.picking=message.action==='prepareDownload';job.owner=sender.documentId;job.pickDeadline=Date.now()+15*60*1000;destinationMonitor.refresh();if(!job.picking)queue.push(job);await updateJob(id,{state:job.picking?'choosing':'queued',title,kind:message.kind,downloadKey:key,createdAt:Date.now(),progress:null});void pump();return {id};
    }catch(error){const job=work.get(id);work.delete(id);if(job?.data?.destinationId)await VideoPocketDestinations.remove(job.data.destinationId).catch(()=>{});downloadClaims.release(key,id);if(retained)await engine('forget',{sourceId:message.sourceId}).catch(()=>{});await observation?.release().catch(()=>{});throw error;}
   }finally{releaseAdmission();}
  }
  case 'cancel':{const job=work.get(message.id);if(!job)return {};job.cancelled=true;wakeRecoveryWaiters(job);if(job.recoveryInspectionId){genericRecovery.cancel(job.recoveryInspectionId);await engine('cancelInspect',{inspectionId:job.recoveryInspectionId}).catch(()=>{});}await engine('cancel',{id:job.id});if(job.downloadId)await chrome.downloads.cancel(job.downloadId).catch(()=>{});if(job!==runningJob)await finishJob(job,'cancelled','已取消');return {};}
  case 'dismissJob':{
   if(sender.url!==chrome.runtime.getURL('popup.html'))throw new Error('來源未授權');
   jobUpdates=jobUpdates.catch(()=>{}).then(async()=>{const {jobs=[]}=await chrome.storage.session.get('jobs');await chrome.storage.session.set({jobs:jobs.filter(job=>job.id!==message.id||ACTIVE_STATES.has(job.state))});});await jobUpdates;return {};
  }
  case 'pause':{const job=work.get(message.id);if(!job||job.stage==='merge'||job.stage==='save'&&!job.downloadId)return {};if(job.downloadId)await chrome.downloads.pause(job.downloadId);job.paused=true;if(!job.downloadId&&job===runningJob)await engine('pause',{id:job.id});await updateJob(job.id,{state:'paused'});return {};}
  case 'resume':{const job=work.get(message.id);if(!job)return {};if(job.downloadId)await chrome.downloads.resume(job.downloadId);job.paused=false;job.pauseState=null;if(!job.downloadId&&job===runningJob)await engine('resume',{id:job.id});wakeRecoveryWaiters(job);await updateJob(job.id,{state:job===runningJob?'running':'queued'});void pump();return {};}
  case 'assetHeaders':if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');return assetHeaders(message.url,message.referer);
  case 'progress':if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');if(work.has(message.id)){const job=work.get(message.id);if(message.state==='processing')job.stage='merge';if(message.state==='saving')job.stage='save';if(['paused','interrupted'].includes(message.state)){job.paused=true;job.pauseState=message.state;}const state=job.paused?(job.pauseState || 'paused'):message.state;return updateJob(message.id,{state,...(message.progress!==undefined?{progress:message.progress}:{})});}return {};
  case 'reportFailure':{if(message.failure?.code!=='CANCELLED')recordFailure(message.failure,{stage:message.stage,platform:message.platform,action:message.kind,elapsedMs:message.elapsedMs});return {};}
  case 'lastError':return failureTask(async()=>{const {lastError}=await chrome.storage.session.get('lastError');return lastError&&Date.now()-lastError.time<ERROR_RETENTION_MS?lastError:null;});
  case 'dismissError':return failureTask(async()=>{const {lastError}=await chrome.storage.session.get('lastError');if(!message.id||lastError?.id===message.id)await chrome.storage.session.remove('lastError');return {};});
  case 'heartbeat':return {};
  case 'youtubeSession':{
   if(sender.url!==chrome.runtime.getURL('offscreen.html'))throw new Error('來源未授權');
   const descriptor=message.descriptor,capture=runningJob?.youtubeCapture,original=runningJob?.meta?.descriptor;
   if(runningJob&&!runningJob.cancelled&&original?.platform?.id===descriptor?.platform?.id&&original?.tabId===descriptor?.tabId&&original?.documentId===descriptor?.documentId&&(original?.frameId??0)===(descriptor?.frameId??0)){
    let sameStream=false,streamId;try{streamId=new URL(descriptor.platform.streamingData.serverAbrStreamingUrl).searchParams.get('id');sameStream=!!streamId&&streamId===new URL(original.platform.streamingData.serverAbrStreamingUrl).searchParams.get('id');}catch{}
    if(sameStream){
     const latest=await youtubeDownloadSession(runningJob.meta,runningJob.data.sourceId).catch(()=>null);
     return runningJob.youtubeCapture=preferYoutubeSession(capture?.streamId===streamId?capture:null,latest);
    }
   }
   return youtubeSession(descriptor);
  }
  default:throw new Error('未知操作');
 }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message.target==='offscreen'||sender.id!==chrome.runtime.id)return;handle(message,sender).then(result=>respond({ok:true,result})).catch(error=>{const stage=/Subtitle$/.test(message.action)?'subtitle':message.action==='snapshot'?'detect':'inspect';const failure=classifyFailure(error,stage);if(['pageSubtitle','browserSubtitle','download','prepareDownload'].includes(message.action)&&failure.code!=='CANCELLED')recordFailure(error,{stage,action:stage==='subtitle'?'subtitle':message.action==='snapshot'?'snapshot':'inspect',platform:message.platform || message.descriptor?.platform?.site || sourceMeta.get(message.sourceId)?.platform});respond({ok:false,error:failure.message,failure});});return true;});
chrome.tabs.onRemoved.addListener(tabId=>{closedSourceTabs.add(tabId);while(closedSourceTabs.size>1000)closedSourceTabs.delete(closedSourceTabs.values().next().value);void clearTabSources(tabId).catch(()=>{});void discoveryIntent.clear(tabId).catch(()=>{});void mediaPicker.stop(tabId).catch(()=>{});void chrome.storage.session.remove([selectionStorageKey(tabId),'rangeDraft:'+tabId]).catch(()=>{});for(const key of biliDiscoveries.keys())if(JSON.parse(key)[0]===tabId)biliDiscoveries.delete(key);void subtitleCaptures.removeTab(tabId).catch(()=>{});});
chrome.tabs.onUpdated.addListener((tabId,changeInfo)=>{if(changeInfo.status==='loading'||typeof changeInfo.url==='string'){void clearTabSources(tabId).catch(()=>{});void chrome.storage.session.remove(selectionStorageKey(tabId)).catch(()=>{});void subtitleCaptures.removeTab(tabId).catch(()=>{});}});
// Chrome restarts cannot resume in-memory signed sources or WebAssembly work.
const jobRecoveryReady=chrome.storage.session.get('jobs').then(({jobs=[]})=>{if(jobs.some(j=>ACTIVE_STATES.has(j.state)))return chrome.storage.session.set({jobs:jobs.map(j=>ACTIVE_STATES.has(j.state)?{...j,state:'error',message:'Extension reloaded. Download again.',finishedAt:Date.now()}:j)});}).catch(()=>{});
void chrome.action.setBadgeText({text:''});

// Best effort when the last browser window closes. Forced process termination
// cannot run cleanup; the next offscreen creation removes those abandoned files.
chrome.windows.onRemoved.addListener(()=>{void (async()=>{if((await chrome.windows.getAll()).length)return;for(const job of work.values()){job.cancelled=true;wakeRecoveryWaiters(job);if(job.downloadId)await chrome.downloads.cancel(job.downloadId).catch(()=>{});}queue.length=0;const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]});if(contexts.length)await engine('cleanup').catch(()=>{});work.clear();downloadClaims.clear();sourceMeta.clear();downloadStalls.clear();await discoveryIntent.clearAll();await VideoPocketDestinations.clear();await subtitleCaptures.clearAll();await chrome.storage.session.remove(['jobs','subtitleCache','youtubeSessions','youtubeCaptionRequests','lastError']);})().catch(()=>{});});

async function checkDestinations(){
 for(const job of work.values()){
  if(!job.picking||job.cancelled)continue;
  const destination=await VideoPocketDestinations.get(job.data.destinationId);
  if(!work.has(job.id)||job.cancelled||!job.picking)continue;
  if(destination){job.picking=false;queue.push(job);await updateJob(job.id,{state:'queued'});void pump();}
  else if(Date.now()>job.pickDeadline){job.cancelled=true;await finishJob(job,'cancelled','已取消');}
 }
}
