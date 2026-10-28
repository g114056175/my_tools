import {createDownloadStallGuard} from '../extension/download-stall.js';
import {attachNetworkSources,networkFallbackReason,scopeDocumentCandidates,validateOwnedSourcePlan} from '../extension/network-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {classifyFailure} from '../extension/diagnostics.js';
import {ACTIVE_STATES} from '../extension/jobs.js';
import {downloadKey,createDownloadClaims,stableHash} from '../extension/download-identity.js';
import {createJobAdmission} from '../extension/job-admission.js';
import {createDestinationMonitor} from '../extension/destination-monitor.js';
import {pageMediaLease,createPageMediaGuard} from '../extension/page-media-guard.js';
import {BUILD_ID} from '../extension/build-info.js';
import {createYoutubeSourceSessions,preferYoutubeSession} from '../extension/youtube-source-session.js';
import {pageMediaPresence} from '../extension/media-presence.js';
import {createDiscoveryIntent,existingMediaResources,renewPageObservation,stopPageObservation} from '../extension/discovery-intent.js';
import {createPopupMarkerController} from '../extension/popup-marker.js';
import {createMediaSelectionController,selectionStorageKey,selectedMediaIndex,collapseBilibiliPlayers,recoverBilibiliRoute} from '../extension/media-selection-controller.js';
import {attachSocialSources} from '../extension/social-source.js';
import {normalizeRange} from '../extension/media-range.js';
import {mediaTime} from '../extension/media-time.js';
import {isGenericMediaTitle} from '../extension/media-titles.js';
import {validateDocumentMediaPlan} from '../extension/document-media.js';
import {createGenericFallback,genericFallbackEligible,earlyPlayerEligible,earlyPlayerPlatform,genericPageUrl} from '../extension/generic-fallback.js';
import {genericPlayerSnapshot} from '../extension/generic-player.js';
import {createYoutubeCaptionReader,youtubeCaptionAssist} from '../extension/youtube-caption-assist.js';
import {isExpiredSourceAuth,matchesRecoverySelection,refreshedSourceDescriptor,sourceContentIdentity,sourceRecoveryTarget} from '../extension/source-recovery.js';

async function loadBackground({frames=[],frameSnapshots=[],networkCandidates=[],inspectionInfo={},downloadFailure=null,downloadResult=null,metadataValidations=[],browserDownloadState,browserDownloadItem={},browserDownloadItems,browserSaveError,inspectHandler,genericSnapshots=[],tabUrl,recoveryValidation,downloadGate,acceptHandler,initialStorage={},initialTabs=[],destinationHandles=new Map(),getYoutubeSession=async()=>null,captionRead,offscreenPresent=false,leaseResults=[]}={}) {
  const source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');
  const code=source.replace(/^import[^;]+;\s*/gm,'');
  const stored={...initialStorage};let listener,tabUpdateListener,tabRemovedListener,windowRemovedListener,connectListener,inspectNo=0,retainCount=0,retainMode='ok',retainBlocked=false,destinationClearCount=0,destinationMonitor,clockNow=Date.now(),portNo=0,windowCount=1;const retainReleases=[];
  const sources=new Map(),invalidatedSources=new Set(),youtubeSourceSessions=createYoutubeSourceSessions(),engineMessages=[],browserDownloads=[],genericCalls=[],cancelledDownloadIds=[];let downloadChanged;
  let browserItem={id:71,state:browserDownloadState,bytesReceived:0,...browserDownloadItem};
  const RuntimeDate=class extends Date{static now(){return clockNow;}};
  const timedDownloadStallGuard=options=>createDownloadStallGuard({...options,now:()=>clockNow});
  const pageSnapshotMock=()=>({});
  const pageSubtitlesMock=()=>({});
  const session={
    async get(key){if(key===null)return {...stored};if(typeof key==='string')return {[key]:stored[key]};return Object.fromEntries(key.map(k=>[k,stored[k]]));},
    async set(value){Object.assign(stored,value);},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];}
  };
  const chrome={
    runtime:{id:'ext',getURL:path=>`chrome-extension://ext/${path}`,getContexts:async()=>offscreenPresent?[{}]:[],sendMessage:async message=>{
      engineMessages.push(message);
      if(message.action==='acceptSource'&&acceptHandler){const response=await acceptHandler(message);if(response)return response;}
      if(message.action==='download'&&downloadGate){const result=await downloadGate(message);if(result)return result;}
      if(message.action==='inspect'&&inspectHandler){const value=await inspectHandler(message);if(value)return value;}
      if(message.action==='inspect'){const id=`source-${++inspectNo}`,d=message.descriptor;sources.set(id,{title:d.title||'',platform:d.platform?.site||'unknown',descriptor:d});return {ok:true,result:{id,title:d.title||'',platform:d.platform?.site||'unknown',...inspectionInfo}};}
      if(message.action==='youtubeSourceSession'){const d=sources.get(message.sourceId)?.descriptor;if(message.capture)youtubeSourceSessions.remember(d,message.capture);return {ok:true,result:youtubeSourceSessions.get(d)};}
      if(message.action==='dropTabSources'){youtubeSourceSessions.removeTab(message.tabId);return {ok:true,result:{}};}
      if(message.action==='download'&&downloadFailure){const failure=Array.isArray(downloadFailure)?downloadFailure.shift():typeof downloadFailure==='function'?downloadFailure(message):downloadFailure;if(failure)return {ok:false,error:'private CDN response',failure};}
      if(message.action==='download'&&downloadResult){const result=Array.isArray(downloadResult)?downloadResult.shift():typeof downloadResult==='function'?downloadResult(message):downloadResult;if(result)return {ok:true,result};}
      if(message.action==='validateRecovery'&&typeof recoveryValidation==='function'){const result=await recoveryValidation(message);if(result?.ok===false)return result;return {ok:true,result:result?.result||{}};}
      if(message.action==='retain'){retainCount++;if(retainMode==='reject')return {ok:false,error:'retain failed'};if(invalidatedSources.has(message.sourceId))return {ok:false,error:'source expired',failure:{code:'SOURCE_CHANGED'}};const s=sources.get(message.sourceId);if(retainBlocked)return new Promise(resolve=>{retainReleases.push(()=>resolve({ok:true,result:{title:s?.title||''}}))});return {ok:true,result:{title:s?.title||''}};}
      if(message.action==='forget'||message.action==='cancel'||message.action==='cleanup'||message.action==='releaseSourceOwner')return {ok:true,result:{}};
      return {ok:true,result:{}};
    },onMessage:{addListener:fn=>{listener=fn}},onConnect:{addListener:fn=>{connectListener=fn}}},
    storage:{session,onChanged:{addListener:()=>{}},local:{remove:async()=>{},get:async()=>({})}},
    offscreen:{createDocument:async()=>{}},
    declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async()=>{}},
     downloads:{onChanged:{addListener:fn=>{downloadChanged=fn;}},search:async({id}={})=>browserItem.id===id&&browserItem.state?[{...browserItem}]:[],cancel:async id=>{cancelledDownloadIds.push(id);if(browserItem.id===id)browserItem.state='interrupted';},pause:async id=>{if(browserItem.id===id)browserItem.paused=true;},resume:async id=>{if(browserItem.id===id)browserItem.paused=false;},...(browserDownloadState||browserDownloadItem||browserDownloadItems||browserSaveError?{download:async options=>{browserDownloads.push(options);if(browserDownloadItems){const configured=browserDownloadItems[browserDownloads.length-1]||{};browserItem={id:configured.id??70+browserDownloads.length,bytesReceived:0,...configured};}const error=typeof browserSaveError==='function'?browserSaveError(options,browserDownloads.length):browserSaveError;if(error)throw error;return browserItem.id;}}:{})},
    scripting:{executeScript:async request=>{
      scriptRequests.push(request);
      if(request.files)return [];
      if(request.func===pageMediaLease)return [{documentId:request.target.documentIds[0],result:leaseResults.shift() || {valid:true}}];
      if(request.func===genericPlayerSnapshot){genericCalls.push(request);return [{documentId:request.target.documentIds[0],result:genericSnapshots.shift() || {valid:false}}];}
      if(request.func===pageSubtitlesMock&&captionRead)return [{documentId:request.target.documentIds[0],result:await captionRead(request.args)}];
      if(request.func===validateDocumentMediaPlan||request.func===validateOwnedSourcePlan)return [{documentId:request.target.documentIds[0],result:{valid:metadataValidations.shift()===true}}];
      if(request.func===pageSnapshotMock&&request.target?.documentIds){const value=frameSnapshots.shift();return value?[{frameId:request.target.documentIds[0]==='child'?2:0,documentId:request.target.documentIds[0],result:value}]:[];}
      return frames;
    }},
    tabs:{query:async()=>initialTabs,get:async()=>({url:tabUrl}),onRemoved:{addListener:fn=>{tabRemovedListener=fn;}},onUpdated:{addListener:fn=>{tabUpdateListener=fn;}}},
    windows:{onRemoved:{addListener:fn=>{windowRemovedListener=fn;}},getAll:async()=>windowCount?[{}]:[]},
    action:{setBadgeText:async()=>{}}
  };
  const scriptRequests=[];
  const context={createDownloadStallGuard:timedDownloadStallGuard,chrome,BUILD_ID,crypto:webcrypto,URL,URLSearchParams,AbortSignal,TextEncoder,TextDecoder,Date:RuntimeDate,console,setTimeout,clearTimeout,setInterval:()=>0,createDiscoveryIntent:options=>createDiscoveryIntent({...options,setTimer:()=>0,clearTimer:()=>{}}),existingMediaResources,renewPageObservation,stopPageObservation,beginYoutubeSessionObservation:()=>{},endYoutubeSessionObservation:async()=>{},beginYoutubeCaptionObservation:()=>{},endYoutubeCaptionObservation:async()=>{},createGenericFallback,genericFallbackEligible,earlyPlayerEligible,earlyPlayerPlatform,genericPageUrl,genericPlayerSnapshot,createYoutubeCaptionReader,youtubeCaptionAssist,preferYoutubeSession,isExpiredSourceAuth,matchesRecoverySelection,refreshedSourceDescriptor,sourceContentIdentity,sourceRecoveryTarget,
    pageSnapshot:pageSnapshotMock,pageMediaPresence,pageMediaLease,createPageMediaGuard,createDestinationMonitor:options=>{destinationMonitor=createDestinationMonitor({...options,setTimer:()=>0,clearTimer:()=>{}});return destinationMonitor;},pageSubtitles:pageSubtitlesMock,createBilibiliClient:()=>({}),bilibiliRoute:()=>({}),normalizeCues:x=>x,parseSubtitles:x=>x,
    ACTIVE_STATES, normalizeRange,mediaTime,isGenericMediaTitle,validateDocumentMediaPlan,validateOwnedSourcePlan,scopeDocumentCandidates,youtubeSession:getYoutubeSession,youtubeCaptionRequest:async()=>null,classifyFailure:(e,stage)=>({...classifyFailure(e,stage),message:e?.message||String(e)}),ERROR_RETENTION_MS:100,
    CAPTURE_PREFIX:'capture:',CAPTURE_VERSION:1,createSubtitleCaptureManager:()=>({start:async()=>{},removeTab:async()=>{},clearAll:async()=>{}}),loadBilibiliSubtitle:async()=>{},fileStem:s=>s,mediaRequestHeaders:()=>[],
    VideoPocketDestinations:{remove:async id=>destinationHandles.delete(id),clear:async()=>{destinationClearCount++;destinationHandles.clear();},get:async id=>destinationHandles.get(id)||false},
    downloadKey,createDownloadClaims,createJobAdmission,stableHash,createPopupMarkerController,createMediaSelectionController,selectionStorageKey,selectedMediaIndex,collapseBilibiliPlayers,recoverBilibiliRoute,attachSocialSources,waitForMediaSource:async()=>({ready:false,changed:false}),createNetworkMediaObserver:()=>({candidates:()=>networkCandidates,enableTab(){},disableTab(){},seed(){}}),attachNetworkSources,networkFallbackReason,socialPageFetch:()=>{}};
  vm.runInNewContext(code,context,{filename:'background.js'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof listener,'function');
  const call=(message,sender={id:'ext',url:'chrome-extension://ext/popup.html',documentId:'popup-doc'})=>new Promise((resolve,reject)=>listener(message,sender,response=>response?.ok?resolve(response.result):reject(Object.assign(new Error(response?.error||'failed'),response?.failure||{}))));
  return {scriptRequests,connect(){const callbacks=[],messages=[],documentId=`popup-port-${++portNo}`;connectListener({name:'popup',sender:{url:'chrome-extension://ext/popup.html',documentId},onMessage:{addListener:fn=>messages.push(fn)},onDisconnect:{addListener:fn=>callbacks.push(fn)}});let disconnected=false;const close=()=>{if(disconnected)return;disconnected=true;callbacks.forEach(fn=>fn());};close.send=message=>{if(!disconnected)messages.forEach(fn=>fn(message));};close.documentId=documentId;return close;},call,stored,engineMessages,browserDownloads,genericCalls,destinationHandles,cancelledDownloadIds,get browserItem(){return browserItem;},advanceTime(ms){clockNow+=ms;},setTime(value){clockNow=value;},get time(){return clockNow;},async completeDownload(){browserItem.state='complete';await downloadChanged({id:browserItem.id,state:{current:'complete'}});},async interruptDownload(details={}){Object.assign(browserItem,details,{state:'interrupted'});await downloadChanged({id:browserItem.id,state:{current:'interrupted'}});},async setBrowserItem(patch){Object.assign(browserItem,patch);},checkBrowserDownloads:()=>vm.runInContext('checkBrowserDownloads()',context),downloadCount:()=>vm.runInContext('downloads.size',context),activeSourceTabs:()=>vm.runInContext('[...activeSourceTabs]',context),sourceMetaIds:()=>vm.runInContext('[...sourceMeta.keys()]',context),navigate:(tabId,changeInfo)=>tabUpdateListener?.(tabId,changeInfo),closeTab:tabId=>tabRemovedListener?.(tabId),closeLastWindow(){windowCount=0;windowRemovedListener?.(1);},metaIds:()=>vm.runInContext('[...sourceMeta.keys()]',context),async expireSource(sourceId){sources.delete(sourceId);invalidatedSources.add(sourceId);return call({action:'sourcesExpired',sourceIds:[sourceId]},{id:'ext',url:'chrome-extension://ext/offscreen.html'});},checkDestinations:()=>destinationMonitor.check(),get retainCount(){return retainCount;},get destinationClearCount(){return destinationClearCount;},set retainMode(value){retainMode=value;},blockRetain(){retainBlocked=true;},releaseRetain(){retainBlocked=false;for(const release of retainReleases.splice(0))release();},jobs:()=>stored.jobs||[]};
}

async function waitFor(predicate,message='background state did not settle'){
 for(let i=0;i<500;i++){
  if(predicate())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 throw new Error(message);
}
test('popup request ownership order follows request arrival even when an older inspection completes last',async()=>{
 let releaseOlder,startedOlder;const olderStarted=new Promise(resolve=>{startedOlder=resolve;});
 const rt=await loadBackground({initialStorage:{runSession:'owner-order'},inspectHandler:message=>{
  const result={id:message.descriptor.title,title:message.descriptor.title,duration:12};
  if(result.id==='older')return new Promise(resolve=>{releaseOlder=()=>resolve({ok:true,result});startedOlder();});
  return {ok:true,result};
 }});
 const close=rt.connect(),sender={id:'ext',url:'chrome-extension://ext/popup.html',documentId:close.documentId};
 const descriptor={tabId:7,frameId:0,documentId:'player-doc',mediaKey:'player',url:'https://cdn.test/video.mp4'};
 const pending=rt.call({action:'inspect',descriptor:{...descriptor,title:'older'}},sender);await olderStarted;
 await rt.call({action:'inspect',descriptor:{...descriptor,title:'newer'}},sender);releaseOlder();await pending;
 const accepted=rt.engineMessages.filter(message=>message.action==='acceptSource'&&message.ownerId===close.documentId);
 assert.deepEqual(accepted.map(message=>message.sourceId),['newer','older']);
 assert.ok(accepted[0].ownerRequestOrder>accepted[1].ownerRequestOrder,'the late completion keeps its original request order');close();
});
function activitySnapshots(rt){return rt.engineMessages.filter(message=>message.action==='sourceActivity').map(message=>JSON.parse(JSON.stringify(message.activeSourceTabs||[])));}
function popupSender(port){return {id:'ext',url:'chrome-extension://ext/popup.html',documentId:port.documentId};}

test('popup presence checks retain document and frame ownership without starting discovery or the engine',async()=>{
 const targets=[{frameId:0,documentId:'doc',mediaKey:1},{frameId:0,documentId:'doc',mediaKey:2},{frameId:2,documentId:'child',mediaKey:1},{frameId:3,documentId:'gone',mediaKey:1}];
 const rt=await loadBackground({initialStorage:{mediaObservationBuild:BUILD_ID},frames:[{frameId:0,documentId:'doc',result:{checked:true,present:['1']}},{frameId:2,documentId:'child',result:{checked:true,present:[]}}]});
 assert.deepEqual(JSON.parse(JSON.stringify(await rt.call({action:'mediaPresence',tabId:1,targets}))),{checked:true,missing:targets.slice(1)});
 assert.equal(rt.engineMessages.length,0);assert.equal(rt.scriptRequests.length,1);
 const request=rt.scriptRequests[0];assert.equal(request.func,pageMediaPresence);assert.equal(request.world,'MAIN');assert.equal(request.injectImmediately,true);
 assert.deepEqual(JSON.parse(JSON.stringify(request.args)),[['1','2']]);
});

test('lost page transport errors retain a non-resumable job until an authorized explicit dismissal',async()=>{
 const rt=await loadBackground({downloadFailure:{code:'PAGE_MEDIA_GONE'}});
 const source=await rt.call({action:'inspect',descriptor:{title:'Clip',tabId:7,documentId:'doc',url:'https://cdn.test/clip.mp4'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&rt.jobs().find(item=>item.id===job.id)?.state!=='error';i++)await new Promise(resolve=>setImmediate(resolve));
 const record=rt.jobs().find(item=>item.id===job.id);assert.equal(record.errorCode,'PAGE_MEDIA_GONE');assert.equal(record.requiresDismiss,true);assert.equal(record.resumable,false);
 const disconnect=rt.connect();await new Promise(resolve=>setImmediate(resolve));disconnect();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.jobs().some(item=>item.id===job.id&&ACTIVE_STATES.has(item.state)),false,'the interrupted job finishes');
 await assert.rejects(rt.call({action:'dismissJob',id:job.id},{id:'ext',url:'chrome-extension://ext/offscreen.html'}));
 await rt.call({action:'dismissJob',id:job.id});assert.equal(rt.jobs().some(item=>item.id===job.id),false);
});

test('closing a tab drops only its unused source metadata without starting new page work',async()=>{
 const rt=await loadBackground({offscreenPresent:true,initialStorage:{runSession:'live',mediaObservationBuild:BUILD_ID}});
 const first=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'doc-a',title:'First',url:'https://cdn.test/first.mp4'}});
 const second=await rt.call({action:'inspect',descriptor:{tabId:8,documentId:'doc-b',title:'Second',url:'https://cdn.test/second.mp4'}});
 rt.closeTab(7);for(let i=0;i<20&&!rt.engineMessages.some(message=>message.action==='dropTabSources');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.metaIds().includes(first.id),false);assert.equal(rt.metaIds().includes(second.id),true);
 assert.ok(rt.engineMessages.some(message=>message.action==='dropTabSources'&&message.tabId===7));
});

test('a source used by an active download survives tab closure and is removed after the job releases it',async()=>{
 let finish;
 const rt=await loadBackground({offscreenPresent:true,initialStorage:{runSession:'live'},downloadGate:()=>new Promise(resolve=>{finish=()=>resolve({ok:true,result:{saved:true}});})});
 const source=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'doc',title:'Active',url:'https://cdn.test/active.mp4'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!finish;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(finish);
 rt.closeTab(7);await new Promise(resolve=>setImmediate(resolve));assert.equal(rt.metaIds().includes(source.id),true);
 finish();for(let i=0;i<100&&rt.jobs().some(item=>item.id===job.id&&item.state==='running');i++)await new Promise(resolve=>setImmediate(resolve));
 for(let i=0;i<20&&rt.metaIds().includes(source.id);i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.metaIds().includes(source.id),false);assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
});

test('a bound page transport refuses a disappeared player before opening a credentialed fetch',async()=>{
 const rt=await loadBackground({leaseResults:[{valid:false,missing:true}]});
 await assert.rejects(rt.call({action:'socialPageFetch',operation:'open',options:{url:'https://cdn.test/a.mp4'},context:{tabId:7,documentId:'doc',mediaKey:1,playerUrl:'blob:old',contentId:'one'}},{id:'ext',url:'chrome-extension://ext/offscreen.html'}),{code:'PAGE_MEDIA_GONE'});
 assert.equal(rt.scriptRequests.filter(request=>request.func===pageMediaLease).length,1);
});

test('a prepared native destination is queued once when the user selects its file handle',async()=>{
 const destinations=new Map();const rt=await loadBackground({destinationHandles:destinations,downloadResult:{saved:true}});
 const source=await rt.call({action:'inspect',descriptor:{title:'Destination',url:'https://cdn.test/a.mp4'}});
 const job=await rt.call({action:'prepareDownload',sourceId:source.id,kind:'video',destinationId:'chosen'});
 assert.equal(rt.jobs().find(item=>item.id===job.id).state,'choosing');assert.equal(rt.engineMessages.some(message=>message.action==='download'),false);
 destinations.set('chosen',{});await rt.checkDestinations();await rt.checkDestinations();
 for(let i=0;i<20&&!rt.engineMessages.some(message=>message.action==='download');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
});

test('presence checks do not prune unknown or malformed results, and reject untrusted callers before injection',async()=>{
 const targets=[{frameId:0,documentId:'doc',mediaKey:1}];
 for(const result of [{checked:false},{checked:true},null]){
  const rt=await loadBackground({initialStorage:{mediaObservationBuild:BUILD_ID},frames:[{frameId:0,documentId:'doc',result}]});
  assert.deepEqual(JSON.parse(JSON.stringify(await rt.call({action:'mediaPresence',tabId:1,targets}))),{checked:true,missing:[]});
 }
 const rt=await loadBackground({initialStorage:{mediaObservationBuild:BUILD_ID}});
 await assert.rejects(rt.call({action:'mediaPresence',tabId:1,targets},{id:'ext',url:'chrome-extension://ext/offscreen.html'}));
 await assert.rejects(rt.call({action:'mediaPresence',tabId:1,targets:[{frameId:0,mediaKey:1}]}));
 assert.deepEqual(JSON.parse(JSON.stringify(await rt.call({action:'mediaPresence',tabId:1,targets:[]}))),{checked:true,missing:[]});
 assert.equal(rt.scriptRequests.length,0);assert.equal(rt.engineMessages.length,0);
});

test('a new build removes legacy hooks once without scanning players or starting the engine',async()=>{
 const initialTabs=[{id:1,url:'https://site.test/watch'},{id:2,url:'http://site.test/other'},{id:3,url:'chrome://extensions/'}];
 const rt=await loadBackground({initialTabs,initialStorage:{mediaObservationBuild:'old-build',youtubeSessions:[{body:'old'}],youtubeCaptionRequests:[{url:'old'}]}});
 assert.equal(rt.stored.mediaObservationBuild,BUILD_ID);assert.equal(rt.stored.youtubeSessions,undefined);assert.equal(rt.stored.youtubeCaptionRequests,undefined);
 assert.equal(rt.scriptRequests.length,2);assert.ok(rt.scriptRequests.every(request=>request.func===stopPageObservation&&request.injectImmediately));
 assert.equal(rt.engineMessages.length,0);
 const current=await loadBackground({initialTabs,initialStorage:{mediaObservationBuild:BUILD_ID}});assert.equal(current.scriptRequests.length,0);
});

test('a queued YouTube download owns its session after popup observation ends, scoped to the same stream',async()=>{
 const descriptor={tabId:1,frameId:0,documentId:'doc',mediaKey:1,title:'YouTube title',referer:'https://www.youtube.com/watch?v=abcdefghijk',platform:{site:'youtube',id:'abcdefghijk',streamingData:{serverAbrStreamingUrl:'https://cdn.googlevideo.com/videoplayback?id=stream-a'}}};
 let capture={tabId:1,documentId:'doc',streamId:'stream-a',body:'bounded-session',createdAt:Date.now()},finish;
 const rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:()=>new Promise(resolve=>finish=()=>resolve({ok:true,result:{saved:true}}))});
 const source=await rt.call({action:'inspect',descriptor});const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!finish;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(finish);
 capture=null;const sender={id:'ext',url:'chrome-extension://ext/offscreen.html'},request={action:'youtubeSession',descriptor};
 assert.equal((await rt.call(request,sender)).body,'bounded-session');
 assert.equal(await rt.call({...request,descriptor:{...descriptor,tabId:2}},sender),null);
 assert.equal(await rt.call({...request,descriptor:{...descriptor,platform:{...descriptor.platform,streamingData:{serverAbrStreamingUrl:'https://cdn.googlevideo.com/videoplayback?id=stream-b'}}}},sender),null);
 await assert.rejects(rt.call(request));finish();
 for(let i=0;i<100&&rt.jobs().find(j=>j.id===job.id)?.state!=='done';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(await rt.call(request,sender),null);
});

test('YouTube SABR repeat download survives popup observation ending without a new player request',async()=>{
 const descriptor={tabId:1,frameId:0,documentId:'repeat-doc',mediaKey:1,title:'Repeat YouTube title',referer:'https://www.youtube.com/watch?v=abcdefghijk',platform:{site:'youtube',id:'abcdefghijk',streamingData:{serverAbrStreamingUrl:'https://cdn.googlevideo.com/videoplayback?id=repeat-stream'}}};
 let capture={tabId:1,frameId:0,documentId:'repeat-doc',streamId:'repeat-stream',body:'bounded-session',createdAt:Date.now()},rt;
 const usedSessions=[];
 rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:async()=>{
  const current=await rt.call({action:'youtubeSession',descriptor},{id:'ext',url:'chrome-extension://ext/offscreen.html'});usedSessions.push(current);
  return current?{ok:true,result:{saved:true}}:{ok:false,failure:{code:'SOURCE_UNAVAILABLE'}};
 }});
 const close=rt.connect();
 const firstSource=await rt.call({action:'inspect',descriptor});
 const first=await rt.call({action:'download',sourceId:firstSource.id,kind:'video'});
 for(let i=0;i<100&&rt.jobs().find(j=>j.id===first.id)?.state!=='done';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(usedSessions[0]?.body,'bounded-session');
 capture=null;
 const reopenedSource=await rt.call({action:'inspect',descriptor});
 const second=await rt.call({action:'download',sourceId:reopenedSource.id,kind:'video'});
 for(let i=0;i<100&&rt.jobs().find(j=>j.id===second.id)?.state!=='done';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.jobs().find(j=>j.id===second.id)?.state,'done');
 assert.equal(usedSessions[1]?.body,'bounded-session');
 close();
});

test('YouTube downloads cannot use a live observation from a different frame',async()=>{
 const descriptor={tabId:1,frameId:0,documentId:'frame-doc',mediaKey:1,title:'Frame owned title',referer:'https://www.youtube.com/watch?v=abcdefghijk',platform:{site:'youtube',id:'abcdefghijk',streamingData:{serverAbrStreamingUrl:'https://cdn.googlevideo.com/videoplayback?id=frame-stream'}}};
 const capture={tabId:1,frameId:1,documentId:'frame-doc',streamId:'frame-stream',body:'wrong-frame-session',createdAt:Date.now()};
 let rt,used='not-requested';
 rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:async()=>{used=await rt.call({action:'youtubeSession',descriptor},{id:'ext',url:'chrome-extension://ext/offscreen.html'});return used?{ok:true,result:{saved:true}}:{ok:false,failure:{code:'SOURCE_UNAVAILABLE'}};}});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&rt.jobs().find(j=>j.id===job.id)?.state!=='error';i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(used,null);assert.equal(rt.jobs().find(j=>j.id===job.id)?.errorCode,'SOURCE_UNAVAILABLE');close();
});

const captionVideo={tabId:1,frameId:0,documentId:'caption-doc',mediaKey:8,title:'Captioned video',referer:'https://www.youtube.com/watch?v=abcdefghijk',platform:{site:'youtube',id:'abcdefghijk',streamingData:{serverAbrStreamingUrl:'https://cdn.googlevideo.com/videoplayback?id=caption-stream'}}};
const captionSession=(poLength=4)=>({tabId:1,frameId:0,documentId:'caption-doc',streamId:'caption-stream',body:`session-${poLength}`,poLength,createdAt:Date.now()});
const engineSender={id:'ext',url:'chrome-extension://ext/offscreen.html'};
async function completedJob(rt,id){for(let i=0;i<200;i++){const job=rt.jobs().find(j=>j.id===id);if(job&&['done','error','cancelled'].includes(job.state))return job;await new Promise(resolve=>setImmediate(resolve));}return rt.jobs().find(j=>j.id===id);}

test('an inspected YouTube source preserves its observed session before the first download',async()=>{
 let capture=captionSession(),rt,used;
 rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:async()=>{
  used=await rt.call({action:'youtubeSession',descriptor:captionVideo},engineSender);
  return used?{ok:true,result:{saved:true}}:{ok:false,failure:{code:'SOURCE_UNAVAILABLE'}};
 }});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo});
 capture=null; // Closing observation after a caption capture removes live records.
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'done');assert.equal(used?.body,'session-4');close();
});

test('a session arriving during caption capture is preserved before its observation is released',async()=>{
 let capture=null,rt,used;
 rt=await loadBackground({getYoutubeSession:async()=>capture,captionRead:async()=>{capture=captionSession();return {cues:[{start:0,end:1,text:'caption'}]};},downloadGate:async()=>{
  used=await rt.call({action:'youtubeSession',descriptor:captionVideo},engineSender);
  return used?{ok:true,result:{saved:true}}:{ok:false,failure:{code:'SOURCE_UNAVAILABLE'}};
 }});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo});
 const value=await rt.call({action:'pageSubtitle',tabId:1,documentId:'caption-doc',sourceId:source.id,language:'en',selector:{pageSource:'youtube-page',videoId:'abcdefghijk',mediaKey:8,frameId:0,documentId:'caption-doc'}});
 assert.equal(value.cues[0].text,'caption');capture=null;
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'done');assert.equal(used?.body,'session-4');close();
});

test('a queued YouTube job upgrades its exact-session proof before starting the stream',async()=>{
 let capture=captionSession(0),rt,used;
 rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:async()=>{
  capture=captionSession(4);used=await rt.call({action:'youtubeSession',descriptor:captionVideo},engineSender);
  return {ok:true,result:{saved:true}};
 }});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'done');assert.equal(used.body,'session-4');close();
});

test('a session lookup failure cannot discard a queued job owned capture',async()=>{
 let unavailable=false,rt,used;
 rt=await loadBackground({getYoutubeSession:async()=>{if(unavailable)throw new Error('temporary lookup failure');return captionSession();},downloadGate:async()=>{
  unavailable=true;used=await rt.call({action:'youtubeSession',descriptor:captionVideo},engineSender);return {ok:true,result:{saved:true}};
 }});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'done');assert.equal(used?.poLength,4);close();
});

test('clearing a tab cache cannot downgrade a running job to a weaker native capture',async()=>{
 let capture=captionSession(),rt,used;
 rt=await loadBackground({offscreenPresent:true,getYoutubeSession:async()=>capture,downloadGate:async()=>{
  rt.navigate(1,{url:captionVideo.referer+'&t=1'});await new Promise(resolve=>setImmediate(resolve));
  capture=captionSession(0);used=await rt.call({action:'youtubeSession',descriptor:captionVideo},engineSender);return {ok:true,result:{saved:true}};
 }});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'done');assert.equal(used?.poLength,4);assert.ok(rt.engineMessages.some(message=>message.action==='dropTabSources'));close();
});

test('YouTube verification retries once only with stronger proof for the same source and selection',async()=>{
 for(const range of [undefined,{start:1,end:3}]){
  let capture=captionSession(0),rt,attempts=0;const requests=[];
  rt=await loadBackground({inspectionInfo:{duration:8,range:{supported:true}},getYoutubeSession:async()=>capture,downloadGate:async message=>{
   attempts++;requests.push(message);
   if(attempts===1){capture=captionSession(4);return {ok:false,failure:{code:'STREAM_VERIFICATION'}};}
   const used=await rt.call({action:'youtubeSession',descriptor:captionVideo},engineSender);
   return used?.poLength===4?{ok:true,result:{saved:true}}:{ok:false,failure:{code:'STREAM_VERIFICATION'}};
  }});
  const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video',height:1080,...(range?{range}:{})});
  assert.equal((await completedJob(rt,job.id)).state,'done');assert.equal(attempts,2);
  for(const request of requests){assert.equal(request.sourceId,source.id);assert.equal(request.height,1080);assert.equal(JSON.stringify(request.range),JSON.stringify(range));}close();
 }
});

test('unchanged YouTube verification proof is not retried',async()=>{
 const capture=captionSession(),rt=await loadBackground({getYoutubeSession:async()=>capture,downloadFailure:{code:'STREAM_VERIFICATION'}});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'error');assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);close();
});

test('a failed proof lookup preserves the original YouTube verification error',async()=>{
 let unavailable=false,attempts=0;
 const rt=await loadBackground({getYoutubeSession:async()=>{if(unavailable)throw new Error('temporary lookup failure');return captionSession();},downloadGate:async()=>{unavailable=true;attempts++;return {ok:false,failure:{code:'STREAM_VERIFICATION'}};}});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 const failed=await completedJob(rt,job.id);assert.equal(failed.state,'error');assert.equal(failed.errorCode,'STREAM_VERIFICATION');assert.equal(attempts,1);close();
});

test('verification cannot borrow a stronger proof from another stream',async()=>{
 let capture=captionSession(0),attempts=0;
 const rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:async()=>{attempts++;capture={...captionSession(4),streamId:'other-stream'};return {ok:false,failure:{code:'STREAM_VERIFICATION'}};}});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'error');assert.equal(attempts,1);close();
});

test('repeated YouTube verification failure stops after one upgraded-proof retry',async()=>{
 let capture=captionSession(0),attempts=0;
 const rt=await loadBackground({getYoutubeSession:async()=>capture,downloadGate:async()=>{capture=captionSession(++attempts*4);return {ok:false,failure:{code:'STREAM_VERIFICATION'}};}});
 const close=rt.connect(),source=await rt.call({action:'inspect',descriptor:captionVideo}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 assert.equal((await completedJob(rt,job.id)).state,'error');assert.equal(attempts,2);close();
});

test('navigation during YouTube session preparation cannot restore the previous document source',async()=>{
 let entered,release;const preparing=new Promise(resolve=>{entered=resolve;});
 const rt=await loadBackground({getYoutubeSession:()=>new Promise(resolve=>{release=()=>resolve(captionSession());entered();})});
 const pending=rt.call({action:'inspect',descriptor:captionVideo});await preparing;
 assert.equal(rt.metaIds().length,1);rt.navigate(1,{status:'loading'});release();
 await assert.rejects(pending,{code:'SOURCE_CHANGED'});assert.equal(rt.metaIds().length,0);
});

test('existing successful background inspections never run the new collector',async()=>{
 const rt=await loadBackground();
 for(const referer of ['https://www.youtube.com/watch?v=one','https://x.com/a/status/1','https://unknown.test/watch']){
  const result=await rt.call({action:'inspect',inspectionId:referer,descriptor:{referer,url:'https://cdn.test/old.mp4',title:'real title',tabId:1,frameId:0,documentId:'doc',mediaKey:7}});
  assert.equal(result.title,'real title');
 }
 assert.equal(rt.genericCalls.length,0);assert.equal(rt.engineMessages.filter(m=>m.action==='inspect').length,3);
});

test('ready unknown-page inventory is injected immediately while known platforms keep their original scheduling',async()=>{
 for(const url of ['https://unknown.test/watch','https://www.youtube.com/watch?v=one']){
  const video={url:'blob:one',mediaKey:1,title:'Real title'},summary={url,title:'Real title',discoveryMode:'summary',videos:[video]},deep={url,title:'Real title',videos:[video],media:{url:'blob:one',mediaKey:1,duration:60}};
  const rt=await loadBackground({tabUrl:url,frames:[{frameId:0,documentId:'doc',result:summary}],frameSnapshots:[deep]});
  await rt.call({action:'snapshot',tabId:1,preferPicked:false});
  const inventory=rt.scriptRequests.find(r=>r.func&&r.target?.allFrames&&r.args?.[1]==='summary'),file=rt.scriptRequests.find(r=>r.files);
  assert.equal(inventory.injectImmediately,url.includes('unknown')?true:undefined);assert.equal(file.injectImmediately,inventory.injectImmediately);
  const selected=rt.scriptRequests.find(r=>r.func&&r.target?.documentIds&&r.args?.[1]==='deep');assert.equal(selected.injectImmediately,true);
  if(url.includes('youtube'))assert.equal(rt.genericCalls.length,0,'known providers do not acquire a new early scan');
 }
});

test('an empty early inventory falls back to the original document-load scheduling',async()=>{
 const page={url:'https://unknown.test/loading',title:'Loading',discoveryMode:'summary',videos:[]};
 const rt=await loadBackground({tabUrl:page.url,frames:[{frameId:0,documentId:'doc',result:page}]});
 const result=await rt.call({action:'snapshot',tabId:1});assert.equal(result.videos.length,0);
 const scans=rt.scriptRequests.filter(r=>r.func&&r.target?.allFrames&&r.args?.[1]==='summary');
 assert.equal(scans.length,2);assert.equal(scans[0].injectImmediately,true);assert.equal(scans[1].injectImmediately,undefined);
});

test('background unknown-player recovery stays scoped and revalidates before download',async()=>{
 const descriptor={referer:'https://unknown.test/watch',tabId:1,frameId:0,documentId:'doc',mediaKey:7,title:'影片 1'};
 const binding={mediaKey:7,source:'blob:one',pageUrl:descriptor.referer,fingerprint:'selected-runtime'};
 const rt=await loadBackground({genericSnapshots:[{binding,duration:60,candidates:[{url:'https://cdn.test/owned.mp4',kind:'progressive'}]},{valid:true},{valid:true},{valid:false}],inspectHandler:async message=>message.descriptor.platform?.site==='network-media'?{ok:true,result:{id:'recovered',duration:60,title:'影片 1'}}:{ok:false,error:'no source',failure:{code:'SOURCE_UNAVAILABLE'}}});
 const result=await rt.call({action:'genericInspect',inspectionId:'generic',descriptor});
 assert.equal(result.id,'recovered');assert.equal(rt.genericCalls.length,3);
 assert.ok(rt.genericCalls.every(r=>r.target.documentIds[0]==='doc'&&r.target.tabId===1));
 assert.equal(rt.engineMessages.filter(m=>m.action==='inspect').length,2);
 const checksBeforeDownload=rt.genericCalls.length;
 await assert.rejects(rt.call({action:'prepareDownload',sourceId:result.id,kind:'video'}),{code:'SOURCE_CHANGED'});
 assert.equal(rt.genericCalls.length,checksBeforeDownload+1,'the selected player is revalidated after the source is retained');
 assert.ok(rt.genericCalls.every(r=>r.target.documentIds[0]==='doc'&&r.target.tabId===1),'revalidation stays bound to the selected document');
 const retained=rt.engineMessages.find(m=>m.action==='retain'&&m.sourceId===result.id),forgotten=rt.engineMessages.find(m=>m.action==='forget'&&m.sourceId===result.id);
 assert.ok(retained,'the source is pinned before asynchronous generic-player validation');
 assert.ok(forgotten,'a failed validation releases the pin');assert.equal(forgotten.discardInspection,undefined);
 assert.equal(rt.engineMessages.filter(m=>m.action==='download').length,0);assert.equal(rt.jobs().length,0);
});

test('known-provider failures keep their error when no selected-player evidence exists',async()=>{
 const rt=await loadBackground({inspectHandler:async()=>({ok:false,error:'old failure',failure:{code:'SOURCE_UNAVAILABLE'}})});
 for(const referer of ['https://www.youtube.com/watch?v=one','https://x.com/a/status/1','https://www.instagram.com/reel/one/']){
  const descriptor={referer,tabId:1,frameId:0,documentId:'doc',mediaKey:1};
  await assert.rejects(rt.call({action:'inspect',descriptor}),{code:'SOURCE_UNAVAILABLE'});
  await assert.rejects(rt.call({action:'genericInspect',descriptor}),{code:'SOURCE_UNAVAILABLE'});
 }
 assert.equal(rt.genericCalls.length,6);
 assert.equal(rt.engineMessages.filter(m=>m.action==='inspect').length,6,'no extra media probe without an owned source');
});

test('known-provider recovery uses the same scoped player validation and preserves the selected title',async()=>{
 const referer='https://vimeo.com/1084537',descriptor={referer,tabId:1,frameId:0,documentId:'doc',mediaKey:7,title:'Selected movie',platform:{site:'vimeo',id:'1084537'}};
 const binding={mediaKey:7,source:'blob:one',pageUrl:referer,fingerprint:'selected-runtime'};
 const rt=await loadBackground({genericSnapshots:[{binding,duration:60,candidates:[{url:'https://cdn.test/current.mp4',kind:'progressive'}]},{valid:true},{valid:true}],inspectHandler:async message=>message.descriptor.platform?.site==='vimeo'?{ok:false,error:'no source',failure:{code:'SOURCE_UNAVAILABLE'}}:undefined});
 const result=await rt.call({action:'inspect',inspectionId:'provider-recovery',descriptor});
 assert.equal(result.title,'Selected movie');assert.equal(rt.genericCalls.length,3);
 const probes=rt.engineMessages.filter(m=>m.action==='inspect');assert.equal(probes.length,2);assert.equal(probes[1].descriptor.platform.site,'network-media');assert.equal(probes[1].descriptor.mediaKey,7);
});

test('opening an idle popup cleans orphaned media without requiring a video inspection',async()=>{
 const rt=await loadBackground(),before=rt.engineMessages.filter(m=>m.action==='recoverMedia').length;
 const result=await rt.call({action:'recoverDownloads'});
 assert.equal(result.cleaned,true);assert.equal(rt.engineMessages.filter(m=>m.action==='recoverMedia').length,before+1);
 assert.ok(!rt.engineMessages.some(m=>m.action==='inspect'));
});

test('stage timings are session-only numeric diagnostics and reject arbitrary fields or popup writers',async()=>{
 const rt=await loadBackground(),source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}}),job=await rt.call({action:'prepareDownload',sourceId:source.id,kind:'video'});
 const data={action:'performance',id:job.id,timings:{downloadMs:123.4,normalizeMs:40,convertMs:200,validateMs:15,saveMs:-1,browserSaveMs:NaN,url:'https://secret.test',strategy:'raw private message'}};
 await rt.call(data,{id:'ext',url:'chrome-extension://ext/offscreen.html'});
 assert.equal(rt.jobs()[0].timings.downloadMs,123);assert.deepEqual(Object.keys(rt.jobs()[0].timings).sort(),['convertMs','downloadMs','normalizeMs','validateMs']);
 await assert.rejects(rt.call(data));await rt.call({action:'cancel',id:job.id});
});

test('popup recovery preserves a download being prepared and a queued destination',async()=>{
 const handles=new Map([['valid-destination',{}]]),rt=await loadBackground({initialStorage:{runSession:'same-session'},destinationHandles:handles}),source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}}),clears=rt.destinationClearCount;
 rt.blockRetain();const pending=rt.call({action:'prepareDownload',sourceId:source.id,kind:'video',destinationId:'valid-destination'});
 for(let i=0;i<100&&!rt.retainCount;i++)await new Promise(resolve=>setImmediate(resolve));
 const before=rt.engineMessages.filter(m=>m.action==='recoverMedia').length;
 assert.equal((await rt.call({action:'recoverDownloads'})).active,true);
 assert.equal(rt.destinationClearCount,clears);assert.ok(handles.has('valid-destination'));
 rt.releaseRetain();const job=await pending;
 assert.equal((await rt.call({action:'recoverDownloads'})).active,true);
 assert.equal(rt.engineMessages.filter(m=>m.action==='recoverMedia').length,before);
 assert.equal(rt.destinationClearCount,clears);assert.ok(handles.has('valid-destination'));
 await rt.call({action:'cancel',id:job.id});
});

test('concurrent download preparations reserve the twenty job limit and cancellation frees a slot',async()=>{
 const rt=await loadBackground(),sources=[];
 for(let i=0;i<21;i++)sources.push(await rt.call({action:'inspect',descriptor:{url:`https://cdn.test/clip-${i}.mp4`,title:`clip-${i}`}}));
 rt.blockRetain();const pending=sources.slice(0,19).map(source=>rt.call({action:'prepareDownload',sourceId:source.id,kind:'video'}));
 for(let i=0;i<100&&rt.retainCount<19;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.retainCount,19);
 const duplicate=await rt.call({action:'prepareDownload',sourceId:sources[0].id,kind:'video'});assert.equal(duplicate.duplicate,true);
 const twentieth=rt.call({action:'prepareDownload',sourceId:sources[19].id,kind:'video'});
 for(let i=0;i<100&&rt.retainCount<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.retainCount,20);
 await assert.rejects(rt.call({action:'prepareDownload',sourceId:sources[20].id,kind:'video'}),/等待中的下載過多/);
 rt.releaseRetain();const jobs=await Promise.all([...pending,twentieth]);assert.equal(rt.jobs().filter(job=>ACTIVE_STATES.has(job.state)).length,20);
 await rt.call({action:'cancel',id:jobs[0].id});
 const replacement=await rt.call({action:'prepareDownload',sourceId:sources[20].id,kind:'video'});assert.ok(replacement.id);
 for(const job of jobs.slice(1))await rt.call({action:'cancel',id:job.id});await rt.call({action:'cancel',id:replacement.id});
});

test('same-session worker restart marks interrupted jobs failed and clears orphan destination handles',async()=>{
 const handles=new Map([['orphan-destination',{name:'remembered handle'}]]);
 const rt=await loadBackground({initialStorage:{runSession:'same-session',jobs:[{id:'interrupted',state:'queued',destinationId:'orphan-destination'}]},destinationHandles:handles});
 const recovered=await rt.call({action:'recoverDownloads'});
 assert.equal(recovered.cleaned,true);assert.equal(rt.jobs()[0].state,'error');assert.equal(handles.size,0);
 assert.equal(rt.destinationClearCount,1,'the existing session did not trigger a new-session clear');
});

test('browser save recovery keeps the finished blob alive until Chrome completes without restarting transfer',async()=>{
 const rt=await loadBackground({downloadResult:{url:'blob:completed-media',filename:'clip.mp4',blobId:'completed',saveFailure:{code:'SAVE_FAILED',saveStage:'open-target',saveReason:'permission'}},browserDownloadState:'in_progress'});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.browserDownloads.length;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.browserDownloads.length,1);assert.equal(rt.browserDownloads[0].url,'blob:completed-media');assert.equal(rt.browserDownloads[0].saveAs,true);
 assert.equal(rt.engineMessages.filter(message=>message.action==='release').length,0);
 await new Promise(resolve=>setImmediate(resolve));await rt.completeDownload();
 for(let i=0;i<100&&!rt.engineMessages.some(message=>message.action==='release');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
 assert.equal(rt.engineMessages.filter(message=>message.action==='release'&&message.blobId==='completed').length,1);
 assert.equal(rt.stored.lastError,undefined);assert.ok(rt.jobs().every(job=>!ACTIVE_STATES.has(job.state)));
});

test('a cancelled browser save releases the finished file without restarting or reporting E06',async()=>{
 const rt=await loadBackground({downloadResult:{url:'blob:completed-media',filename:'clip.mp4',blobId:'completed'},browserSaveError:new Error('USER_CANCELED')});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.engineMessages.some(message=>message.action==='release');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);assert.equal(rt.engineMessages.filter(message=>message.action==='release').length,1);
 assert.equal(rt.stored.lastError,undefined);
});

test('an invalid native filename retries only the completed blob with a conservative name',async()=>{
 const rt=await loadBackground({downloadResult:{url:'blob:completed-media',filename:'COOKED_ Ep. 1 🧑‍🍳.mp4',blobId:'completed'},browserDownloadState:'complete',browserSaveError:(_,attempt)=>attempt===1?new Error('Invalid filename'):null});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.engineMessages.some(message=>message.action==='release');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.browserDownloads.length,2);assert.equal(rt.browserDownloads[1].filename,'VideoPocket.mp4');assert.ok(rt.browserDownloads.every(item=>item.url==='blob:completed-media'));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);assert.equal(rt.stored.lastError,undefined);
 assert.equal(rt.engineMessages.filter(message=>message.action==='release').length,1);
});

test('native save refusal does not repeatedly retry and retains a bounded start failure',async()=>{
 for(const [error,count,reason] of [['Invalid filename',2,'invalid-filename'],['FILE_ACCESS_DENIED',1,'permission']]){
  const rt=await loadBackground({downloadResult:{url:'blob:completed-media',filename:'clip.mp4',blobId:'completed'},browserSaveError:new Error(error)});
  const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
  await rt.call({action:'download',sourceId:source.id,kind:'video'});
  for(let i=0;i<100&&!rt.engineMessages.some(message=>message.action==='release');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rt.browserDownloads.length,count);assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
  assert.equal(rt.stored.lastError.saveStage,'browser-start');assert.equal(rt.stored.lastError.saveReason,reason);
 }
});

test('background retains safe native-save failure details across popup reopen',async()=>{
 const rt=await loadBackground({downloadFailure:{code:'SAVE_FAILED',saveStage:'read-temp',saveReason:'unreadable',message:'C:/private/SECRET.mp4'}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.stored.lastError;i++)await new Promise(resolve=>setImmediate(resolve));
 const failure=await rt.call({action:'lastError'});assert.equal(failure.code,'SAVE_FAILED');assert.equal(failure.saveStage,'read-temp');assert.equal(failure.saveReason,'unreadable');assert.doesNotMatch(JSON.stringify(failure),/SECRET|private/);
});

test('background rejects invalid and unsupported ranges before reserving a job',async()=>{
 const rt=await loadBackground({inspectionInfo:{duration:10,range:{supported:false}}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await assert.rejects(rt.call({action:'download',sourceId:source.id,range:{start:2,end:11}}),{code:'RANGE_INVALID'});
 await assert.rejects(rt.call({action:'download',sourceId:source.id,range:{start:2,end:3}}),{code:'RANGE_UNSUPPORTED'});
 assert.equal(rt.retainCount,0);assert.equal(rt.jobs().length,0);
});

test('metadata candidates are checked against their originating document before and after inspection',async()=>{
 const descriptor={tabId:7,documentId:'private-doc',mediaKey:4,title:'Lesson',platform:{site:'metadata-media',validationToken:'opaque-proof',versions:[{url:'https://cdn.test/lesson.mp4',kind:'progressive'}]}};
 const stale=await loadBackground({metadataValidations:[false]});
 await assert.rejects(stale.call({action:'inspect',descriptor}),{code:'SOURCE_CHANGED'});
 assert.equal(stale.engineMessages.filter(message=>message.action==='inspect').length,0);
 const changed=await loadBackground({metadataValidations:[true,false]});
 await assert.rejects(changed.call({action:'inspect',descriptor}),{code:'SOURCE_CHANGED'});
 assert.equal(changed.engineMessages.filter(message=>message.action==='inspect').length,1);
 assert.equal(changed.engineMessages.filter(message=>message.action==='forget').length,1,'discard the newly inspected stale source');
 const stable=await loadBackground({metadataValidations:[true,true]});
 assert.ok((await stable.call({action:'inspect',descriptor})).id);
});
test('selected-player alternatives are revalidated even when another player is on the page',async()=>{
 const descriptor={tabId:7,documentId:'doc',mediaKey:4,platform:{site:'network-media',binding:'player-owned',bindingSource:'blob:current',expectedDuration:20,versions:[{url:'https://cdn.test/current.mp4',kind:'progressive'}]}};
 const stale=await loadBackground({metadataValidations:[false]});
 await assert.rejects(stale.call({action:'inspect',descriptor}),{code:'SOURCE_CHANGED'});
 assert.equal(stale.engineMessages.filter(m=>m.action==='inspect').length,0);
 const changed=await loadBackground({metadataValidations:[true,false]});
 await assert.rejects(changed.call({action:'inspect',descriptor}),{code:'SOURCE_CHANGED'});
 assert.equal(changed.engineMessages.filter(m=>m.action==='forget').length,1);
 const stable=await loadBackground({metadataValidations:[true,true]});
 assert.ok((await stable.call({action:'inspect',descriptor})).id);
});
test('background forwards only validated interval seconds to the engine',async()=>{
 const rt=await loadBackground({inspectionInfo:{duration:10,range:{supported:true}}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video',range:{start:2.25,end:3.75,other:'ignored'}});
 await new Promise(resolve=>setImmediate(resolve));
 const message=rt.engineMessages.find(m=>m.action==='download');assert.ok(message);assert.deepEqual(JSON.parse(JSON.stringify(message.range)),{start:2.25,end:3.75});
});

test('a finished download preserves the inspected source for another interval in the same popup',async()=>{
 const rt=await loadBackground({inspectionInfo:{duration:10,range:{supported:true}},downloadResult:{saved:true}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video',range:{start:1,end:2}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
 assert.ok(rt.jobs().every(job=>!ACTIVE_STATES.has(job.state)));
 await rt.call({action:'download',sourceId:source.id,kind:'video',range:{start:3,end:4}});
 await new Promise(resolve=>setImmediate(resolve));
 const downloads=rt.engineMessages.filter(message=>message.action==='download');
 assert.equal(downloads.length,2);assert.deepEqual(JSON.parse(JSON.stringify(downloads[1].range)),{start:3,end:4});
});

test('cancelling a prepared destination preserves interval metadata while releasing the claim',async()=>{
 const rt=await loadBackground({inspectionInfo:{duration:10,range:{supported:true}}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 const first=await rt.call({action:'prepareDownload',sourceId:source.id,kind:'video',range:{start:1,end:2}});
 await rt.call({action:'cancel',id:first.id});
 const second=await rt.call({action:'prepareDownload',sourceId:source.id,kind:'video',range:{start:3,end:4}});
 assert.equal(second.duplicate,undefined);assert.notEqual(second.id,first.id);
 await rt.call({action:'cancel',id:second.id});
});

test('snapshot restores the exact picked frame and keeps a stale choice blocked across popup reopen',async()=>{
 const url='https://example.test/feed',a={mediaKey:1,url:'blob:a',downloadUrl:'https://cdn/a.mp4'},b={mediaKey:1,url:'blob:b',downloadUrl:'https://cdn/b.mp4',mediaIdentity:'post-b'};
 const frames=[{frameId:0,documentId:'top',result:{url,videos:[a],tracks:[]}},{frameId:2,documentId:'child',result:{url:'https://example.test/frame',videos:[b],tracks:[]}}];
 const rt=await loadBackground({frames});
 rt.stored[selectionStorageKey(7)]={frameId:2,documentId:'child',mediaKey:1,pageToken:stableHash(url),sourceToken:stableHash('blob:b'),modelToken:stableHash('post-b')};
 const chosen=await rt.call({action:'snapshot',tabId:7});assert.equal(chosen.mediaIndex,1);assert.equal(chosen.documentId,'child');
 b.mediaIdentity='post-c';
 for(let i=0;i<2;i++){const stale=await rt.call({action:'snapshot',tabId:7});assert.equal(stale.selectionExpired,true);assert.ok(rt.stored[selectionStorageKey(7)]);}
 const explicit=await rt.call({action:'snapshot',tabId:7,mediaIndex:0,preferPicked:false});assert.equal(explicit.selectionExpired,false);assert.equal(rt.stored[selectionStorageKey(7)],undefined);
});

test('same-URL document reload drops the old picker identity and falls back to a fresh scan',async()=>{
 const url='https://example.test/feed',video={mediaKey:5,url:'blob:new',downloadUrl:'https://cdn/new.mp4'};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'new-doc',result:{url,videos:[video],tracks:[]}}]});
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'old-doc',mediaKey:4,pageToken:stableHash(url),sourceToken:stableHash('blob:old')};
 const current=await rt.call({action:'snapshot',tabId:7});
 assert.equal(current.selectionExpired,false);assert.equal(current.documentId,'new-doc');assert.equal(rt.stored[selectionStorageKey(7)],undefined);
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'new-doc',mediaKey:5,pageToken:stableHash(url)};
 rt.navigate(7,{status:'loading'});await new Promise(resolve=>setImmediate(resolve));assert.equal(rt.stored[selectionStorageKey(7)],undefined);
});

test('Bilibili snapshot collapses a floating mirror and restores selection after it disappears',async()=>{
 const url='https://www.bilibili.com/video/BVfixture/?p=2',identity='bilibili:BVfixture:2';
 const main={title:'實際影片標題',mediaKey:1,url:'blob:main',downloadUrl:url,bilibiliMain:true,bilibiliRank:1,mediaIdentity:identity,mediaContentId:identity};
 const mini={...main,mediaKey:2,url:'blob:mini',bilibiliRank:8},ad={title:'廣告',mediaKey:3,url:'https://ads.test/a.mp4'};
 const initial={url,videos:[main,mini,ad],tracks:[],platform:{site:'bilibili',bvid:'BVfixture',cid:22,page:2},media:{mediaKey:1,duration:600}};
 const frames=[{frameId:0,documentId:'bili-doc',result:initial}];
 const rt=await loadBackground({frames,frameSnapshots:[{...initial,media:{mediaKey:2,duration:600}}]});
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'bili-doc',mediaKey:1,pageToken:stableHash(url),sourceToken:stableHash('blob:main'),modelToken:stableHash(identity)};
 const selected=await rt.call({action:'snapshot',tabId:7});
 assert.equal(selected.videos.length,2);assert.equal(selected.videos[0].title,'實際影片標題');assert.equal(selected.videos[0].mediaKey,2);assert.equal(selected.platform.cid,22);assert.equal(selected.selectionExpired,false);
 frames[0].result={...initial,videos:[main,ad]};
 const restored=await rt.call({action:'snapshot',tabId:7});
 assert.equal(restored.videos.length,2);assert.equal(restored.videos[0].mediaKey,1);assert.equal(restored.selectionExpired,false);
});

test('Bilibili watch route remains downloadable while DOM ownership disappears during a floating-player swap',async()=>{
 const url='https://www.bilibili.com/video/BVfixture/?p=2',identity='bilibili:BVfixture:2';
 const context={site:'bilibili',bvid:'BVfixture',cid:22,page:2,title:'正確影片',duration:600,data:{dash:{video:[{baseUrl:'https://cdn.test/video'}]}}};
 const unknown=[{mediaKey:8,url:'blob:unknown'},{mediaKey:9,url:'blob:mirror'}];
 const rt=await loadBackground({frames:[{frameId:0,documentId:'bili-doc',result:{url,title:'正確影片',videos:unknown,tracks:[],bilibiliContext:context,media:{mediaKey:8,duration:10}}}]});
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'bili-doc',mediaKey:1,pageToken:stableHash(url),modelToken:stableHash(identity)};
 const page=await rt.call({action:'snapshot',tabId:7});
 assert.equal(page.videos.length,1);assert.equal(page.videos[0].routeOnly,true);assert.equal(page.videos[0].downloadUrl,url);assert.equal(page.platform.cid,22);assert.equal(page.media.duration,600);assert.equal(page.selectionExpired,false);
 const info=await rt.call({action:'inspect',descriptor:{url:page.videos[0].downloadUrl,title:page.videos[0].title,platform:page.platform,tabId:7,documentId:page.documentId}});
 assert.equal(info.platform,'bilibili');assert.equal(rt.engineMessages.find(m=>m.action==='inspect').descriptor.platform.data.dash.video[0].baseUrl,'https://cdn.test/video');
});

test('FB snapshot can inspect an observed unbound single player while other platforms remain unchanged',async()=>{
 const video={mediaKey:1,url:'',mediaIdentity:'fb-post'};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'fb-doc',result:{url:'https://www.facebook.com/reel/123',videos:[video],media:{duration:26.25},tracks:[]}}],networkCandidates:[{tabId:7,url:'https://video.xx.fbcdn.net/clip.mp4',service:'facebook',mime:'video/mp4',method:'GET',documentId:'fb-doc',frameId:0,time:Date.now()}]});
 const snapshot=await rt.call({action:'snapshot',tabId:7});
 assert.equal(snapshot.platform.site,'social-network');assert.equal(snapshot.platform.expectedDuration,26.25);
 assert.equal(snapshot.platform.versions[0].url,'https://video.xx.fbcdn.net/clip.mp4');
});

test('multi-player fallback restrictions are reported without assigning ambient media to a post',async()=>{
 const videos=Array.from({length:6},(_,index)=>({mediaKey:index+1,url:'',mediaIdentity:'post-'+index}));
 const rt=await loadBackground({frames:[{frameId:0,documentId:'fb-doc',result:{url:'https://www.facebook.com/feed',videos,media:{duration:26.25},tracks:[]}}],networkCandidates:[{tabId:7,url:'https://video.xx.fbcdn.net/clip.mp4',service:'facebook',mime:'video/mp4',method:'GET',documentId:'fb-doc',frameId:0,time:Date.now()}]});
 const result=await rt.call({action:'snapshot',tabId:7});assert.equal(result.platform,undefined);assert.equal(result.media.discoveryDiagnostics.unboundFallbackBlocked,true);assert.equal(result.media.discoveryDiagnostics.playerCount,6);
});

test('an unknown iframe player can use scoped network capture without a site declaration',async()=>{
 const top={frameId:0,documentId:'top',result:{url:'https://unknown.example/watch',videos:[],tracks:[]}};
 const child={frameId:2,documentId:'child',result:{url:'https://player.example/embed',videos:[{title:'Video',mediaKey:9,url:'blob:main',referer:'https://player.example/embed'}],media:{duration:26.25},tracks:[]}};
 const networkCandidates=[{tabId:7,frameId:2,documentId:'child',url:'https://cdn.example/opaque',mime:'video/mp4',kind:'progressive',method:'GET',time:100,service:'generic'}];
 const rt=await loadBackground({frames:[top,child],networkCandidates});
 const result=await rt.call({action:'snapshot',tabId:7});assert.equal(result.platform.site,'network-media');assert.equal(result.platform.expectedDuration,26.25);
 assert.equal(result.videos[0].referer,'https://player.example/embed');
 const old=await loadBackground({frames:[top,child],networkCandidates:[{...networkCandidates[0],documentId:'old'}]});
 assert.equal((await old.call({action:'snapshot',tabId:7})).platform,undefined);
});

test('Dailymotion playlist passes its exact current ID only to one main iframe player',async()=>{
 const top={frameId:0,documentId:'top',result:{url:'https://www.dailymotion.com/playlist/xa8h2y',title:'Playlist',videos:[],dailymotionContext:{id:'x9qh9tw',title:'Current episode'}}};
 const child={frameId:2,documentId:'child',result:{url:'https://geo.dailymotion.com/player/xtv3w.html?',videos:[{title:'Main',mediaKey:1,dailymotionMain:true,referer:'https://geo.dailymotion.com/player/xtv3w.html?'},{title:'Advertisement',mediaKey:2}],media:{duration:0}}};
 const rt=await loadBackground({frames:[top,child]});
 const result=await rt.call({action:'snapshot',tabId:7});
 assert.equal(result.platform.site,'dailymotion');assert.equal(result.platform.id,'x9qh9tw');assert.equal(result.documentId,'child');
 assert.equal(result.videos[0].title,'Current episode');assert.equal(result.videos[1].title,'Advertisement');
 const second={...child,documentId:'other',frameId:3};
 const ambiguous=await loadBackground({frames:[top,child,second]});
 assert.equal((await ambiguous.call({action:'snapshot',tabId:7})).platform,undefined,'two independent players must not borrow one top-page identity');
});

test('page transport is available only to the offscreen document with an exact browser document target',async()=>{
 const rt=await loadBackground();
 await assert.rejects(rt.call({action:'socialPageFetch',operation:'open',context:{tabId:7,documentId:'fb-doc',referer:'https://www.facebook.com/'},options:{url:'https://cdn.fbcdn.net/a.mp4'}}),/來源未授權/);
 await assert.rejects(rt.call({action:'socialPageFetch',operation:'open',context:{tabId:7},options:{}},{id:'ext',url:'chrome-extension://ext/offscreen.html'}),/通道無效/);
});

test('popup inspection identity reaches offscreen and cancellation stays separate from downloads',async()=>{
 const rt=await loadBackground(),inspectionId='inspection-current';
 await rt.call({action:'inspect',inspectionId,descriptor:{url:'https://cdn.example/a.mp4',title:'sample'}});
 await rt.call({action:'cancelInspect',inspectionId});
 assert.equal(rt.engineMessages.find(message=>message.action==='inspect').inspectionId,inspectionId);
 assert.equal(rt.engineMessages.find(message=>message.action==='cancelInspect').inspectionId,inspectionId);
 assert.equal(rt.engineMessages.some(message=>message.action==='cancel'),false);
 await assert.rejects(rt.call({action:'cancelInspect',inspectionId},{id:'ext',url:'https://social.example'}));
});

test('refresh uses selected-frame metadata from the same media-list generation',async()=>{
 const url='https://example.test/feed';
 const top={frameId:0,documentId:'top',result:{url,videos:[],tracks:[]}};
 const child={frameId:2,documentId:'child',result:{url,videos:[{mediaKey:11,title:'first',url:'blob:1'},{mediaKey:22,title:'second old',url:'blob:2'}],media:{mediaKey:11},tracks:[]}};
 const fresh={url,videos:[{mediaKey:11,title:'first',url:'blob:1'},{mediaKey:33,title:'second current',url:'blob:3',downloadUrl:'https://cdn/3.mp4'}],media:{mediaKey:33},tracks:[]};
 const rt=await loadBackground({frames:[top,child],frameSnapshots:[fresh]});
 const result=await rt.call({action:'snapshot',tabId:7,mediaIndex:1,preferPicked:false});
 assert.equal(result.mediaIndex,1);assert.equal(result.selectionExpired,true);assert.equal(result.media.mediaKey,33);assert.equal(result.videos[1].mediaKey,33);assert.equal(result.videos[1].title,'second current');
});

test('recycled DOM media key cannot accept a different post identity',async()=>{
 const url='https://example.test/feed';
 const top={frameId:0,documentId:'top',result:{url,videos:[],tracks:[]}};
 const child={frameId:2,documentId:'child',result:{url,videos:[{mediaKey:10,mediaIdentity:'other',url:'blob:other',title:'other'},{mediaKey:11,mediaIdentity:'post-old',url:'blob:old',title:'old'}],media:{mediaKey:11},tracks:[]}};
 const fresh={url,videos:[{mediaKey:10,mediaIdentity:'other',url:'blob:other',title:'other'},{mediaKey:11,mediaIdentity:'post-new',url:'blob:new',title:'new'}],media:{mediaKey:11},tracks:[]};
 const rt=await loadBackground({frames:[top,child],frameSnapshots:[fresh]});
 const result=await rt.call({action:'snapshot',tabId:7,mediaIndex:1,preferPicked:false});
 assert.equal(result.selectionExpired,true);assert.equal(result.videos[1].title,'new');
});

test('same explicit content identity permits a refreshed signed URL',async()=>{
 const url='https://example.test/feed';
 const top={frameId:0,documentId:'top',result:{url,videos:[],tracks:[]}};
 const child={frameId:2,documentId:'child',result:{url,videos:[{mediaKey:10,mediaIdentity:'other',url:'blob:other'},{mediaKey:11,mediaIdentity:'post-same',url:'https://cdn.example/video?token=old'}],media:{mediaKey:11},tracks:[]}};
 const fresh={url,videos:[{mediaKey:10,mediaIdentity:'other',url:'blob:other'},{mediaKey:11,mediaIdentity:'post-same',url:'https://cdn.example/video?token=new'}],media:{mediaKey:11},tracks:[]};
 const rt=await loadBackground({frames:[top,child],frameSnapshots:[fresh]});
 const result=await rt.call({action:'snapshot',tabId:7,mediaIndex:1,preferPicked:false});
 assert.equal(result.selectionExpired,false);assert.equal(result.videos[1].url,'https://cdn.example/video?token=new');
});

test('expected snapshot target rejects an old index after the document replaces its content',async()=>{
 const url='https://example.test/feed';
 const frames=[{frameId:0,documentId:'top',result:{url,videos:[],tracks:[]}},{frameId:2,documentId:'child',result:{url,videos:[{mediaKey:9,mediaIdentity:'post-new',url:'blob:new'}],media:{mediaKey:9},tracks:[]}}];
 const rt=await loadBackground({frames});
 await assert.rejects(rt.call({action:'snapshot',tabId:7,mediaIndex:0,preferPicked:false,expectedTarget:{frameId:2,documentId:'child',mediaKey:9,mediaIdentity:'post-old'}}),{code:'SOURCE_CHANGED'});
});

test('expected target can recover its deep-only identity but rejects changed or missing identity',async()=>{
 const url='https://example.test/feed';
 for(const resolvedId of ['model-1','model-2','']){
  const video={mediaKey:9,url:'blob:same'},frames=[{frameId:0,documentId:'top',result:{url,videos:[],tracks:[]}},{frameId:2,documentId:'child',result:{url,discoveryMode:'summary',videos:[video],media:video,tracks:[]}}];
  const selected={...video,...(resolvedId?{mediaContentId:resolvedId}:{})};
  const fresh={url,videos:[selected],media:selected,tracks:[]};
  const rt=await loadBackground({frames,frameSnapshots:[fresh]});
  const request={action:'snapshot',tabId:7,preferPicked:false,expectedTarget:{frameId:2,documentId:'child',mediaKey:9,url:'blob:same',mediaContentId:'model-1'}};
  if(resolvedId==='model-1'){
   const result=await rt.call(request);assert.equal(result.selectionExpired,false);assert.equal(result.videos[0].mediaContentId,'model-1');
  }else await assert.rejects(rt.call(request),{code:'SOURCE_CHANGED'});
 }
});

test('background inspect sources atomically deduplicates same media and releases after cancel',async()=>{
  const rt=await loadBackground(),descriptor={tabId:7,documentId:'doc',frameId:0,mediaKey:22,url:'https://cdn/video',title:'Episode'};
  const [one,two]=await Promise.all([rt.call({action:'inspect',descriptor}),rt.call({action:'inspect',descriptor})]);
  assert.ok(one.downloadKey);assert.equal(one.downloadKey,two.downloadKey);assert.notEqual(one.id,two.id);
  rt.blockRetain();
  const firstPromise=rt.call({action:'prepareDownload',sourceId:one.id,downloadKey:'malicious-1',title:'Episode',kind:'video'}, {id:'ext',url:'chrome-extension://ext/popup.html',documentId:'p1'});
  await new Promise(resolve=>setImmediate(resolve));
  const duplicate=await rt.call({action:'prepareDownload',sourceId:two.id,downloadKey:'malicious-2',title:'Episode',kind:'audio'}, {id:'ext',url:'chrome-extension://ext/popup.html',documentId:'p2'});
  assert.equal(duplicate.duplicate,true);assert.equal(rt.retainCount,1);
  rt.releaseRetain();const first=await firstPromise;
  assert.equal(duplicate.id,first.id);
  await rt.call({action:'cancel',id:first.id},{id:'ext',url:'chrome-extension://ext/popup.html'});
  const retried=await rt.call({action:'prepareDownload',sourceId:two.id,downloadKey:'same',title:'Episode',kind:'audio'},{id:'ext',url:'chrome-extension://ext/popup.html'});
  assert.notEqual(retried.id,first.id);assert.ok(rt.jobs().some(job=>ACTIVE_STATES.has(job.state)));
});

test('generic retained player labels cannot replace the actual popup title in a prepared download',async()=>{
  const rt=await loadBackground();
  const source=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'doc',frameId:0,mediaKey:22,url:'https://cdn/video',title:'YouTube 影片播放器'}});
  const prepared=await rt.call({action:'prepareDownload',sourceId:source.id,title:'真正的影片標題',kind:'video'});
  assert.equal(rt.jobs().find(job=>job.id===prepared.id).title,'真正的影片標題');
  await rt.call({action:'cancel',id:prepared.id});
});

test('active download reuses its verified inspect result when popup reopens',async()=>{
  const rt=await loadBackground(),descriptor={tabId:7,documentId:'dm-frame',frameId:2,mediaKey:22,url:'https://geo.dailymotion.com/player/x.html',platform:{site:'dailymotion',id:'x-video'},title:'Episode'};
  const first=await rt.call({action:'inspect',descriptor});
  const job=await rt.call({action:'prepareDownload',sourceId:first.id,title:'Episode',kind:'video'});
  const before=rt.engineMessages.filter(message=>message.action==='inspect').length;
  const reopened=await rt.call({action:'inspect',descriptor,inspectionId:'reopen'});
  assert.equal(reopened.id,first.id);assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,before);
  await rt.call({action:'cancel',id:job.id});
});

test('forced inspection bypasses an active choosing job without replacing or releasing its source',async()=>{
 const rt=await loadBackground(),descriptor={tabId:7,documentId:'force-doc',frameId:0,mediaKey:32,url:'https://cdn.test/force.mp4',title:'Episode'};
 const first=await rt.call({action:'inspect',descriptor});
 const job=await rt.call({action:'prepareDownload',sourceId:first.id,title:'Episode',kind:'video'});
 assert.equal(rt.jobs().find(item=>item.id===job.id)?.state,'choosing');
 const before=rt.engineMessages.filter(message=>message.action==='inspect').length;
 const forced=await rt.call({action:'inspect',descriptor,inspectionId:'force-reinspect',force:true});
 const inspections=rt.engineMessages.filter(message=>message.action==='inspect');
 assert.equal(inspections.length,before+1);
 assert.equal(inspections.at(-1).force,true);
 assert.notEqual(forced.id,first.id);
 assert.equal(rt.jobs().find(item=>item.id===job.id)?.state,'choosing','the existing prepared job remains available');
 assert.equal(rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId===first.id),false,'force must not release the source owned by the active job');
 await rt.call({action:'cancel',id:job.id});
 assert.ok(rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId===first.id&&!message.invalidateInspection));
});

test('a failed Chrome native download invalidates its inspected source',async()=>{
 const rt=await loadBackground({downloadResult:{url:'blob:interrupted-media',filename:'clip.mp4',blobId:'interrupted'},browserDownloadState:'interrupted'});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<200&&!rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId===source.id);i++)await new Promise(resolve=>setImmediate(resolve));
 const forget=rt.engineMessages.find(message=>message.action==='forget'&&message.sourceId===source.id);
 assert.ok(forget,'the failed native save releases its source');
 assert.equal(forget.invalidateInspection,true,'the browser failure invalidates the inspected result');
 assert.equal(rt.jobs().some(item=>item.id===job.id&&ACTIVE_STATES.has(item.state)),false,'the interrupted job finishes');
});

test('cancelling after a native interruption still invalidates its inspected source',async()=>{
 const rt=await loadBackground({downloadResult:{url:'blob:retrying-media',filename:'clip.mp4',blobId:'retrying'},browserDownloadState:'in_progress'});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.browserDownloads.length;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.browserDownloads.length,1);
 await rt.interruptDownload({canResume:true,error:'NETWORK_FAILED'});
 await rt.call({action:'cancel',id:job.id});
 await rt.interruptDownload({canResume:false,error:'USER_CANCELED'});
 for(let i=0;i<200&&!rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId===source.id);i++)await new Promise(resolve=>setImmediate(resolve));
 const forget=rt.engineMessages.find(message=>message.action==='forget'&&message.sourceId===source.id);
 assert.ok(forget);
 assert.equal(forget.invalidateInspection,true,'a previous non-cancel interruption remains invalidating after cancellation');
 assert.equal(rt.jobs().some(item=>item.id===job.id&&ACTIVE_STATES.has(item.state)),false,'the cancelled job finishes');
});

test('active reuse requires the Dailymotion ID and document identity to match',async()=>{
  const rt=await loadBackground(),base={tabId:7,documentId:'dm-frame',frameId:2,mediaKey:22,url:'https://geo.dailymotion.com/player/x.html',platform:{site:'dailymotion',id:'x-video'},title:'Episode'};
  const first=await rt.call({action:'inspect',descriptor:base});
  const job=await rt.call({action:'prepareDownload',sourceId:first.id,title:'Episode',kind:'video'});
  const before=rt.engineMessages.filter(message=>message.action==='inspect').length;
  await rt.call({action:'inspect',descriptor:{...base,platform:{site:'dailymotion',id:'other-video'}}});
  await rt.call({action:'inspect',descriptor:{...base,documentId:'new-frame'}});
  assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,before+2);
  await rt.call({action:'cancel',id:job.id});
});

test('accepted sources belong to the live popup document and active-job reuse registers that owner',async()=>{
 let finishDownload;
 const descriptor={tabId:7,frameId:0,documentId:'owner-doc',mediaKey:22,url:'https://cdn.example/owned.mp4',title:'Episode'};
 const rt=await loadBackground({offscreenPresent:true,initialStorage:{runSession:'source-owner'},downloadGate:()=>new Promise(resolve=>{finishDownload=()=>resolve({ok:true,result:{saved:true}});})});
 const firstPopup=rt.connect(),source=await rt.call({action:'inspect',descriptor},popupSender(firstPopup));
 const firstAccept=rt.engineMessages.find(message=>message.action==='acceptSource'&&message.sourceId===source.id);
 assert.equal(firstAccept.ownerId,firstPopup.documentId,'inspect acceptance is associated with its live popup port');

 const unowned=await rt.call({action:'inspect',descriptor:{...descriptor,mediaKey:23,url:'https://cdn.example/unowned.mp4'}});
 const unownedAccept=rt.engineMessages.find(message=>message.action==='acceptSource'&&message.sourceId===unowned.id);
 assert.equal(unownedAccept.ownerId,'','an unrelated live port cannot own a caller with no matching live port');

 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>typeof finishDownload==='function');
 const inspectionsBeforeReuse=rt.engineMessages.filter(message=>message.action==='inspect').length,secondPopup=rt.connect();
 const reused=await rt.call({action:'inspect',descriptor},popupSender(secondPopup));
 assert.equal(reused.id,source.id);
 assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,inspectionsBeforeReuse,'active-job cache reuse does not inspect another source');
 const reuseAccept=rt.engineMessages.filter(message=>message.action==='acceptSource'&&message.sourceId===source.id).at(-1);
 assert.equal(reuseAccept.ownerId,secondPopup.documentId,'the active-job shortcut also registers the requesting popup owner');

 secondPopup();await waitFor(()=>rt.engineMessages.some(message=>message.action==='releaseSourceOwner'&&message.ownerId===secondPopup.documentId));
 firstPopup();finishDownload();
 await waitFor(()=>rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId===source.id));
 assert.equal(rt.jobs().some(item=>item.id===job.id&&ACTIVE_STATES.has(item.state)),false);
});

test('YouTube source acceptance follows the verified session save',async()=>{
 const descriptor={tabId:12,frameId:0,documentId:'youtube-owner',mediaKey:41,url:'https://www.youtube.com/watch?v=abcdefghijk',platform:{site:'youtube',id:'abcdefghijk',streamingData:{serverAbrStreamingUrl:'https://youtube.test/sabr?id=stream-41'}}};
 const capture={tabId:12,frameId:0,documentId:'youtube-owner',streamId:'stream-41',body:'bounded-capture',createdAt:Date.now()};
 const rt=await loadBackground({offscreenPresent:true,getYoutubeSession:async()=>capture});
 const popup=rt.connect(),source=await rt.call({action:'inspect',descriptor},popupSender(popup));
 const saveIndex=rt.engineMessages.findIndex(message=>message.action==='youtubeSourceSession'&&message.sourceId===source.id);
 const acceptIndex=rt.engineMessages.findIndex(message=>message.action==='acceptSource'&&message.sourceId===source.id);
 assert.ok(saveIndex>=0,'the live YouTube session is saved on the inspected source');
 assert.ok(acceptIndex>saveIndex,'the popup owner is registered only after session preservation completes');
 assert.equal(rt.engineMessages[acceptIndex].ownerId,popup.documentId);
 popup();
});

test('closing a popup while source acceptance is pending releases its owner again after the late accept',async()=>{
 let releaseAccept,enteredAccept;
 const acceptEntered=new Promise(resolve=>{enteredAccept=resolve;});
 const rt=await loadBackground({offscreenPresent:true,acceptHandler:message=>{
  if(!message.ownerId)return;
  return new Promise(resolve=>{releaseAccept=()=>resolve(null);enteredAccept();});
 }});
 const popup=rt.connect(),pending=rt.call({action:'inspect',descriptor:{tabId:9,documentId:'late-owner-doc',mediaKey:5,url:'https://cdn.example/late.mp4'}},popupSender(popup));
 await acceptEntered;
 const accepted=rt.engineMessages.findIndex(message=>message.action==='acceptSource'&&message.ownerId===popup.documentId);
 popup();
 await waitFor(()=>rt.engineMessages.filter(message=>message.action==='releaseSourceOwner'&&message.ownerId===popup.documentId).length>=1);
 const disconnectedRelease=rt.engineMessages.findIndex((message,index)=>index>accepted&&message.action==='releaseSourceOwner'&&message.ownerId===popup.documentId);
 releaseAccept();await pending;
 await waitFor(()=>rt.engineMessages.filter(message=>message.action==='releaseSourceOwner'&&message.ownerId===popup.documentId).length>=2);
 const releases=rt.engineMessages.map((message,index)=>({message,index})).filter(({message})=>message.action==='releaseSourceOwner'&&message.ownerId===popup.documentId);
 assert.ok(accepted<disconnectedRelease,'disconnect releases the owner while acceptSource is still pending');
 assert.ok(releases[1].index>releases[0].index,'the accept finally path releases again after the late pin completes');
 assert.equal(rt.jobs().length,0);
});

test('a candidate rejected by post-inspection metadata validation is never accepted',async()=>{
 const rt=await loadBackground({offscreenPresent:true,metadataValidations:[true,false]});
 const popup=rt.connect(),descriptor={tabId:4,frameId:0,documentId:'metadata-owner',mediaKey:8,url:'https://cdn.example/metadata.mp4',platform:{site:'metadata-media',validationToken:'proof',bindingKey:'binding',versions:[{url:'https://cdn.example/metadata.mp4'}]}};
 await assert.rejects(rt.call({action:'inspect',descriptor},popupSender(popup)),{code:'SOURCE_CHANGED'});
 const candidateId=rt.engineMessages.find(message=>message.action==='forget'&&message.discardInspection===true)?.sourceId;
 assert.ok(candidateId,'rejected metadata discards only the unaccepted inspection');
 assert.equal(rt.engineMessages.some(message=>message.action==='acceptSource'&&message.sourceId===candidateId),false);
 assert.equal(rt.metaIds().includes(candidateId),false);
 assert.equal(rt.jobs().length,0);
 popup();
});

test('an expired source cannot create a job after its background metadata is removed',async()=>{
 const rt=await loadBackground({offscreenPresent:true,initialStorage:{runSession:'source-expired-before-job'}}),popup=rt.connect();
 const source=await rt.call({action:'inspect',descriptor:{tabId:6,documentId:'expired-owner',mediaKey:14,url:'https://cdn.example/expired-before-job.mp4'}},popupSender(popup));
 popup();
 await waitFor(()=>rt.engineMessages.some(message=>message.action==='releaseSourceOwner'&&message.ownerId===popup.documentId));
 await rt.expireSource(source.id);
 assert.equal(rt.metaIds().includes(source.id),false,'offscreen expiry removes the unused background metadata');
 await assert.rejects(rt.call({action:'prepareDownload',sourceId:source.id,kind:'video'}),{code:'SOURCE_CHANGED'});
 assert.equal(rt.jobs().length,0,'a failed retain cannot create a job with the expired source id');
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,0);
 assert.ok(rt.engineMessages.some(message=>message.action==='retain'&&message.sourceId===source.id));
});

test('a recycled metadata player cannot reuse an active download for its previous blob or JSON',async()=>{
  const rt=await loadBackground({metadataValidations:[true,true,true,true,true,false]});
  const descriptor={tabId:7,documentId:'doc',frameId:0,mediaKey:1,platform:{site:'metadata-media',validationToken:'proof-a',bindingKey:'binding-a',versions:[{url:'https://cdn.test/a.mp4'}]}};
  const first=await rt.call({action:'inspect',descriptor});
  const job=await rt.call({action:'prepareDownload',sourceId:first.id,kind:'video'});
  const reopened=await rt.call({action:'inspect',descriptor:{...descriptor,platform:{...descriptor.platform,validationToken:'new-proof-a'}}});
  assert.equal(reopened.id,first.id);
  const second=await rt.call({action:'inspect',descriptor:{...descriptor,platform:{...descriptor.platform,validationToken:'proof-b',bindingKey:'binding-b',versions:[{url:'https://cdn.test/b.mp4'}]}}});
  assert.notEqual(second.id,first.id);assert.notEqual(second.downloadKey,first.downloadKey);
  await assert.rejects(rt.call({action:'inspect',descriptor}),{code:'SOURCE_CHANGED'});
  assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,2);
  await rt.call({action:'cancel',id:job.id});
});

test('completed download does not provide an inspect cache on a later popup open',async()=>{
  const rt=await loadBackground(),descriptor={tabId:7,documentId:'doc',frameId:0,mediaKey:22,url:'https://cdn.example/video',title:'Episode'};
  const first=await rt.call({action:'inspect',descriptor});
  const job=await rt.call({action:'prepareDownload',sourceId:first.id,title:'Episode',kind:'video'});
  await rt.call({action:'cancel',id:job.id});
  const before=rt.engineMessages.filter(message=>message.action==='inspect').length;
  const reopened=await rt.call({action:'inspect',descriptor});
  assert.notEqual(reopened.id,first.id);assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,before+1);
});

test('background rejects unauthorized download messages and releases claim after retain failure',async()=>{
  const rt=await loadBackground(),inspected=await rt.call({action:'inspect',descriptor:{tabId:1,documentId:'d',mediaKey:3,url:'https://cdn/a',title:'A'}});
  await assert.rejects(rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'},{id:'ext',url:'https://evil.test/'}),/來源未授權/);
  rt.retainMode='reject';for(let i=0;i<20;i++)await assert.rejects(rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'}));
  rt.retainMode='ok';const retry=await rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'});assert.ok(retry.id);
  const youtube=await rt.call({action:'inspect',descriptor:{tabId:1,documentId:'d',mediaKey:4,url:'https://cdn/y',platform:{site:'youtube',id:'yt-empty'}}});
  await assert.rejects(rt.call({action:'prepareDownload',sourceId:youtube.id,title:'影片 1',kind:'video'}),/未取得 YouTube 影片標題/);
  const afterTitleFailure=await rt.call({action:'prepareDownload',sourceId:youtube.id,title:'Real title',kind:'video'});assert.ok(afterTitleFailure.id);
});


test('observed manifest transport rejects popup callers and missing document scope',async()=>{
 const rt=await loadBackground();
 await assert.rejects(rt.call({action:'observedManifest',url:'https://cdndirector.dailymotion.com/main.m3u8',context:{tabId:7,documentId:'dm-doc',referer:'https://geo.dailymotion.com/player/a.html'}}),/來源未授權/);
 await assert.rejects(rt.call({action:'observedManifest',url:'https://cdndirector.dailymotion.com/main.m3u8',context:{tabId:7}},{id:'ext',url:'chrome-extension://ext/offscreen.html'}),/清單讀取目標無效/);
});

test('unseen download failure survives popup disconnect and reappears once with safe detail',async()=>{
 const rt=await loadBackground(),close=rt.connect();
 await rt.call({action:'reportFailure',stage:'download',failure:{code:'HTTP_AUTH',httpStatus:403,requestMethod:'GET RANGE',requestHost:'cdn.example',sourceStage:'bilibili-playurl',message:'SECRET'}});
 const original=await rt.call({action:'lastError'});assert.equal(original.code,'HTTP_AUTH');assert.equal(original.stage,'download');assert.equal(original.httpStatus,403);assert.equal(original.sourceStage,'bilibili-playurl');assert.ok(!JSON.stringify(original).includes('SECRET'));
 close();const closeAgain=rt.connect();
 assert.equal((await rt.call({action:'lastError'})).id,original.id);
 await rt.call({action:'dismissError',id:'older-record'});assert.ok(await rt.call({action:'lastError'}));
 await rt.call({action:'dismissError',id:original.id});assert.equal(await rt.call({action:'lastError'}),null);closeAgain();
});

test('a failed download keeps its network cause when the popup was closed throughout the job',async()=>{
 const rt=await loadBackground({downloadFailure:{code:'HTTP_AUTH',httpStatus:403,sourceStage:'stream-segment',requestHost:'cdn.example',requestMethod:'GET RANGE'}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.example/clip.mp4',title:'Clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<20&&!rt.stored.lastError;i++)await new Promise(resolve=>setImmediate(resolve));
 const failure=await rt.call({action:'lastError'});assert.equal(failure.code,'HTTP_AUTH');assert.equal(failure.stage,'download');assert.equal(failure.httpStatus,403);assert.equal(failure.sourceStage,'stream-segment');assert.ok(!JSON.stringify(failure).includes('private CDN response'));
 const close=rt.connect();assert.equal((await rt.call({action:'lastError'})).id,failure.id);close();
});

test('stored range-processing failures retain only the allowlisted phase',async()=>{
 const rt=await loadBackground({downloadFailure:{code:'RANGE_PROCESSING_TIMEOUT',processingStage:'normalizing',message:'private fragment details'}});
 const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.example/clip.webm',title:'Clip'}});
 await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.stored.lastError;i++)await new Promise(resolve=>setImmediate(resolve));
 const failure=await rt.call({action:'lastError'});assert.equal(failure.code,'RANGE_PROCESSING_TIMEOUT');assert.equal(failure.processingStage,'normalizing');
 assert.ok(!JSON.stringify(failure).includes('private fragment details'));
});

test('an expired signed source is reinspected once for the same selected plan and restarts the transfer',async()=>{
 const video={mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',url:'blob:player-12',downloadUrl:'https://cdn.example/video.m3u8?sig=fresh',sourceType:'hls',title:'Episode'};
 const descriptor={tabId:7,frameId:0,documentId:'doc-12',mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',playerUrl:'blob:player-12',url:'https://cdn.example/video.m3u8?sig=old',referer:'https://site.example/watch',title:'Episode',duration:90};
 const validation=[];
 const freshPage={url:'https://site.example/watch',videos:[video],media:{...video,duration:90},tracks:[],platform:{site:'example'}};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'doc-12',result:{url:'https://site.example/watch',discoveryMode:'summary',videos:[video],media:video,tracks:[]}}],frameSnapshots:[freshPage,freshPage],inspectionInfo:{duration:90,range:{supported:true}},downloadFailure:[{code:'HTTP_AUTH',status:401,sourceStage:'stream-segment'},null],downloadResult:{url:'https://cdn.example/video.mp4',filename:'Episode.mp4'},browserDownloadState:'complete',recoveryValidation:message=>{validation.push(message);return {}}});
 const source=await rt.call({action:'inspect',descriptor});
 await rt.call({action:'download',sourceId:source.id,kind:'video',height:1080,audioQuality:'best',range:{start:10,end:20}});
 for(let i=0;i<200&&rt.jobs().some(job=>ACTIVE_STATES.has(job.state));i++)await new Promise(resolve=>setImmediate(resolve));
 const downloads=rt.engineMessages.filter(message=>message.action==='download');
 assert.equal(downloads.length,2);assert.equal(downloads[0].sourceId,source.id);assert.notEqual(downloads[1].sourceId,source.id);
 assert.equal(downloads[0].downloadKey,downloads[1].downloadKey,'the original download claim key remains active');
 assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,2);
 assert.equal(validation.length,1);assert.equal(validation[0].oldSourceId,source.id);assert.equal(validation[0].newSourceId,downloads[1].sourceId);
 assert.deepEqual(JSON.parse(JSON.stringify(validation[0].selection)),{kind:'video',height:1080,audioQuality:'best',range:{start:10,end:20}});
 assert.ok(rt.engineMessages.some(message=>message.action==='retain'&&message.sourceId===downloads[1].sourceId));
 assert.ok(rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId===source.id));
 assert.equal(rt.stored.lastError,undefined);
 const reusable=await rt.call({action:'prepareDownload',sourceId:source.id,kind:'audio'});
 assert.ok(rt.engineMessages.some(message=>message.action==='retain'&&message.sourceId===source.id),'the original inspected source remains in the bounded cache');
 await rt.call({action:'cancel',id:reusable.id});
});

test('signed-source recovery rejects a changed player before inspecting or downloading it',async()=>{
 const descriptor={tabId:7,frameId:0,documentId:'doc-12',mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',playerUrl:'blob:player-12',url:'https://cdn.example/video.m3u8?sig=old',referer:'https://site.example/watch',title:'Episode'};
 const current={mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',url:'blob:player-12',downloadUrl:'https://cdn.example/video.m3u8?sig=fresh',title:'Episode'};
 const changed={...current,selectionIdentity:'player-replaced'};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'doc-12',result:{url:'https://site.example/watch',discoveryMode:'summary',videos:[current],tracks:[]}}],frameSnapshots:[{url:'https://site.example/watch',videos:[changed],media:changed,tracks:[]}],downloadFailure:{code:'HTTP_AUTH',httpStatus:403}});
 const source=await rt.call({action:'inspect',descriptor});await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<200&&!rt.stored.lastError;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
 assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,1);
 assert.equal(rt.engineMessages.some(message=>message.action==='validateRecovery'),false);
 assert.equal((await rt.call({action:'lastError'})).code,'SOURCE_CHANGED');
});

test('selected-plan mismatch cleans the refreshed source and does not retry',async()=>{
 const video={mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',url:'blob:player-12',downloadUrl:'https://cdn.example/video.m3u8?sig=fresh',title:'Episode'};
 const descriptor={tabId:7,frameId:0,documentId:'doc-12',mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',playerUrl:'blob:player-12',url:'https://cdn.example/video.m3u8?sig=old',referer:'https://site.example/watch',title:'Episode'};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'doc-12',result:{url:'https://site.example/watch',discoveryMode:'summary',videos:[video],tracks:[]}}],frameSnapshots:[{url:'https://site.example/watch',videos:[video],media:{...video,duration:90},tracks:[]}],downloadFailure:{code:'HTTP_AUTH',httpStatus:403},recoveryValidation:()=>({ok:false,error:'plan mismatch',failure:{code:'PLAN_MISMATCH'}})});
 const source=await rt.call({action:'inspect',descriptor});await rt.call({action:'download',sourceId:source.id,kind:'video'});
 for(let i=0;i<200&&!rt.stored.lastError;i++)await new Promise(resolve=>setImmediate(resolve));
 const refreshed=rt.engineMessages.find(message=>message.action==='inspect'&&message.descriptor.url===video.downloadUrl);
 assert.ok(refreshed);assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
 assert.ok(rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId==='source-2'));
});

test('a pending pause or cancellation prevents signed-source recovery',async()=>{
 for(const state of ['pause','cancel']){
  let release,startedResolve;const started=new Promise(resolve=>{startedResolve=resolve;});
  const rt=await loadBackground({downloadGate:()=>new Promise(resolve=>{release=()=>resolve({ok:false,error:'private CDN response',failure:{code:'HTTP_AUTH',httpStatus:403}});startedResolve();})});
  const source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.example/clip.mp4',title:'Clip'}}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
  await started;await rt.call({action:state,id:job.id});release();
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1,state);
  assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,1,state);
  if(state==='pause')await rt.call({action:'resume',id:job.id});
  for(let i=0;i<200&&rt.jobs().some(item=>ACTIVE_STATES.has(item.state));i++)await new Promise(resolve=>setImmediate(resolve));
 }
});

test('pausing after reinspection holds the recovery until resume',async()=>{
 const video={mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',url:'blob:player-12',downloadUrl:'https://cdn.example/video.m3u8?sig=fresh',title:'Episode'};
 const descriptor={tabId:7,frameId:0,documentId:'doc-12',mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',playerUrl:'blob:player-12',url:'https://cdn.example/video.m3u8?sig=old',referer:'https://site.example/watch',title:'Episode'};
 const freshPage={url:'https://site.example/watch',videos:[video],media:{...video,duration:90},tracks:[]};let releaseValidation,enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});
 const rt=await loadBackground({frames:[{frameId:0,documentId:'doc-12',result:{url:'https://site.example/watch',discoveryMode:'summary',videos:[video],tracks:[]}}],frameSnapshots:[freshPage,freshPage],downloadFailure:[{code:'HTTP_AUTH',httpStatus:403},null],downloadResult:{url:'https://cdn.example/video.mp4',filename:'Episode.mp4'},browserDownloadState:'complete',recoveryValidation:()=>new Promise(resolve=>{releaseValidation=()=>resolve({});enteredResolve();})});
 const source=await rt.call({action:'inspect',descriptor}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await entered;await rt.call({action:'pause',id:job.id});releaseValidation();
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
 assert.equal(rt.engineMessages.some(message=>message.action==='retain'&&message.sourceId==='source-2'),false);
 await rt.call({action:'resume',id:job.id});
 for(let i=0;i<200&&rt.jobs().some(item=>ACTIVE_STATES.has(item.state));i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,2);
 assert.ok(rt.engineMessages.some(message=>message.action==='retain'&&message.sourceId==='source-2'));
});

test('cancelling after reinspection releases the fresh source without restarting',async()=>{
 const video={mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',url:'blob:player-12',downloadUrl:'https://cdn.example/video.m3u8?sig=fresh',title:'Episode'};
 const descriptor={tabId:7,frameId:0,documentId:'doc-12',mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',playerUrl:'blob:player-12',url:'https://cdn.example/video.m3u8?sig=old',referer:'https://site.example/watch',title:'Episode'};
 const freshPage={url:'https://site.example/watch',videos:[video],media:{...video,duration:90},tracks:[]};let releaseValidation,enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});
 const rt=await loadBackground({frames:[{frameId:0,documentId:'doc-12',result:{url:'https://site.example/watch',discoveryMode:'summary',videos:[video],tracks:[]}}],frameSnapshots:[freshPage],downloadFailure:{code:'HTTP_AUTH',httpStatus:403},recoveryValidation:()=>new Promise(resolve=>{releaseValidation=()=>resolve({});enteredResolve();})});
 const source=await rt.call({action:'inspect',descriptor}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await entered;await rt.call({action:'cancel',id:job.id});releaseValidation();
 for(let i=0;i<200&&rt.jobs().some(item=>ACTIVE_STATES.has(item.state));i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,1);
 assert.ok(rt.engineMessages.some(message=>message.action==='forget'&&message.sourceId==='source-2'));
 assert.equal(rt.engineMessages.some(message=>message.action==='retain'&&message.sourceId==='source-2'),false);
});

test('X multi-player expected target uses unique mediaKey when post content identity is shared',async()=>{
 const postId='x-post-shared',url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const primary={mediaKey:11,mediaContentId:postId,mediaIdentity:postId,selectionIdentity:'x-broadcast',url:'blob:broadcast',downloadUrl:'https://cdn.example/broadcast.m3u8',title:'broadcast'};
 const replyGif={mediaKey:22,mediaContentId:postId,mediaIdentity:postId,selectionIdentity:'x-reply-gif',url:'blob:gif',downloadUrl:'https://cdn.example/reply.gif',title:'reply'};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'x-doc',result:{url,videos:[primary,replyGif],media:primary,tracks:[]}}]});
 await assert.doesNotReject(rt.call({action:'snapshot',tabId:7,mediaIndex:0,preferPicked:false,expectedTarget:{frameId:0,documentId:'x-doc',mediaKey:11,mediaContentId:postId,selectionIdentity:'x-broadcast',selectionToken:stableHash('x-broadcast'),url:'blob:broadcast'}}));
});

test('X multi-player expected target rejects ambiguous duplicate mediaKey despite shared post identity',async()=>{
 const postId='x-post-shared',url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const first={mediaKey:11,mediaContentId:postId,mediaIdentity:postId,selectionIdentity:'x-broadcast',url:'blob:first'};
 const second={mediaKey:11,mediaContentId:'different-post',mediaIdentity:'different-post',selectionIdentity:'x-other',url:'blob:second'};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'x-doc',result:{url,videos:[first,second],media:first,tracks:[]}}]});
 await assert.rejects(rt.call({action:'snapshot',tabId:7,mediaIndex:0,preferPicked:false,expectedTarget:{frameId:0,documentId:'x-doc',mediaKey:11,mediaContentId:postId,selectionIdentity:'x-broadcast',selectionToken:stableHash('x-broadcast')}}),{code:'SOURCE_CHANGED'});
});

test('remembered picker selection survives evidence key to deep model identity transition',async()=>{
 const url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const summaryVideo={mediaKey:11,mediaContentId:'x.com:2112242739198959913',mediaIdentity:'x.com:2112242739198959913',selectionIdentity:'x-broadcast',url:'blob:broadcast'};
 const deepVideo={mediaKey:11,mediaContentId:'broadcast-model',mediaIdentity:'broadcast-model',selectionIdentity:'x-broadcast',url:'blob:broadcast',downloadUrl:'https://cdn.example/broadcast.m3u8'};
 const summary={url,discoveryMode:'summary',videos:[summaryVideo],media:summaryVideo,tracks:[]};
 const deep={url,videos:[deepVideo],media:deepVideo,tracks:[],platform:{site:'embedded',id:'broadcast-model',versions:[{url:deepVideo.downloadUrl}]}};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'x-doc',result:summary}],frameSnapshots:[deep]});
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'x-doc',mediaKey:11,pageToken:stableHash(url),sourceToken:stableHash('blob:broadcast'),modelToken:stableHash('broadcast-model'),selectionIdentity:'x-broadcast',selectionToken:stableHash('x-broadcast')};
 const result=await rt.call({action:'snapshot',tabId:7});
 assert.equal(result.selectionExpired,false);
});

test('background applies page preferredMediaIndex only when there is no remembered or explicit selection',async()=>{
 const url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const gif={mediaKey:1,url:'https://video.example/reply.gif',title:'reply'};
 const broadcast={mediaKey:2,url:'blob:broadcast',downloadUrl:'https://cdn.example/broadcast.m3u8',title:'broadcast'};
 const top={url,discoveryMode:'summary',preferredMediaIndex:1,videos:[gif,broadcast],media:gif,tracks:[]};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'x-doc',result:top}],frameSnapshots:[{...top,discoveryMode:'deep',media:broadcast},{...top,discoveryMode:'deep',media:gif}]});
 const automatic=await rt.call({action:'snapshot',tabId:7});
 assert.equal(automatic.mediaIndex,1);
 const manual=await rt.call({action:'snapshot',tabId:7,mediaIndex:0,preferPicked:false,expectedTarget:{frameId:0,documentId:'x-doc',mediaKey:1,url:gif.url}});
 assert.equal(manual.mediaIndex,0);
});

test('legacy build20 selection migrates modelToken to selectionToken after deep verification',async()=>{
 const url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const summaryVideo={mediaKey:11,mediaContentId:'x.com:2112242739198959913',mediaIdentity:'x.com:2112242739198959913',selectionIdentity:'x-broadcast',url:'blob:broadcast'};
 const deepVideo={mediaKey:11,mediaContentId:'broadcast-model',mediaIdentity:'broadcast-model',selectionIdentity:'x-broadcast',url:'blob:broadcast',downloadUrl:'https://cdn.example/broadcast.m3u8'};
 const summary={url,discoveryMode:'summary',videos:[summaryVideo],media:summaryVideo,tracks:[]};
 const deep={url,videos:[deepVideo],media:deepVideo,tracks:[],platform:{site:'embedded',id:'broadcast-model',versions:[{url:deepVideo.downloadUrl}]}};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'x-doc',result:summary}],frameSnapshots:[deep]});
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'x-doc',mediaKey:11,pageToken:stableHash(url),sourceToken:stableHash('blob:broadcast'),modelToken:stableHash('broadcast-model')};
 const result=await rt.call({action:'snapshot',tabId:7});
 assert.equal(result.selectionExpired,false);
 assert.equal(rt.stored[selectionStorageKey(7)].selectionToken,stableHash('x-broadcast'));
});

test('legacy selection migration stays expired when deep model or source changes',async()=>{
 const url='https://x.com/OpenAIDevs/status/2112242739198959913';
 const summaryVideo={mediaKey:11,mediaContentId:'x.com:2112242739198959913',mediaIdentity:'x.com:2112242739198959913',selectionIdentity:'x-broadcast',url:'blob:broadcast'};
 const deepVideo={mediaKey:11,mediaContentId:'different-model',mediaIdentity:'different-model',selectionIdentity:'x-broadcast',url:'blob:other',downloadUrl:'https://cdn.example/other.m3u8'};
 const summary={url,discoveryMode:'summary',videos:[summaryVideo],media:summaryVideo,tracks:[]};
 const deep={url,videos:[deepVideo],media:deepVideo,tracks:[],platform:{site:'embedded',id:'different-model',versions:[{url:deepVideo.downloadUrl}]}};
 const rt=await loadBackground({frames:[{frameId:0,documentId:'x-doc',result:summary}],frameSnapshots:[deep]});
 rt.stored[selectionStorageKey(7)]={frameId:0,documentId:'x-doc',mediaKey:11,pageToken:stableHash(url),sourceToken:stableHash('blob:broadcast'),modelToken:stableHash('broadcast-model')};
 const result=await rt.call({action:'snapshot',tabId:7});
 assert.equal(result.selectionExpired,true);
 assert.equal(rt.stored[selectionStorageKey(7)].selectionToken,undefined);
});

test('a native in-progress download times out only after 120 seconds without byte progress',async()=>{
 const rt=await loadBackground({downloadResult:{url:'https://cdn.example/stalled.mp4',filename:'clip.mp4'},browserDownloadState:'in_progress'});
 const close=rt.connect();
 const source=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'stall-doc',url:'https://cdn.example/stalled.mp4',title:'Clip'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>rt.browserDownloads.length===1);
 await rt.checkBrowserDownloads();
 rt.advanceTime(119_999);await rt.checkBrowserDownloads();
 assert.equal(rt.cancelledDownloadIds.length,0,'the transfer remains active just before the timeout');
 assert.ok(rt.jobs().some(item=>item.id===job.id&&ACTIVE_STATES.has(item.state)));
 rt.advanceTime(1);await rt.checkBrowserDownloads();
 await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&item.state==='error'));
 const finished=rt.jobs().find(item=>item.id===job.id);
 assert.equal(finished.errorCode,'NETWORK_TIMEOUT');
 assert.deepEqual(rt.cancelledDownloadIds,[71]);
 assert.equal(rt.downloadCount(),0,'the failed native download is removed from the active monitor');
 close();
});

test('slow but continuous native byte progress does not time out on total duration',async()=>{
 const rt=await loadBackground({downloadResult:{url:'https://cdn.example/slow.mp4',filename:'clip.mp4'},browserDownloadItem:{state:'in_progress',bytesReceived:0,totalBytes:100},browserDownloadState:'in_progress'});
 const close=rt.connect();
 const startedAt=rt.time;
 const source=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'slow-doc',url:'https://cdn.example/slow.mp4',title:'Clip'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>rt.browserDownloads.length===1);
 await rt.checkBrowserDownloads();
 for(let bytesReceived=10;bytesReceived<=40;bytesReceived+=10){
  rt.advanceTime(119_000);await rt.setBrowserItem({bytesReceived});await rt.checkBrowserDownloads();
  assert.equal(rt.cancelledDownloadIds.length,0);
 }
 assert.ok(rt.time-startedAt>120_000,'the test clock has advanced beyond the stall threshold overall');
 await rt.completeDownload();
 await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&item.state==='done'));
 assert.equal(rt.cancelledDownloadIds.length,0);
 close();
});

test('external and job pauses reset native stall time, and destination choosing does not start it',async()=>{
 const rt=await loadBackground({downloadResult:{url:'https://cdn.example/paused.mp4',filename:'clip.mp4'},browserDownloadState:'in_progress'});
 const close=rt.connect();
 const source=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'pause-doc',url:'https://cdn.example/paused.mp4',title:'Clip'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>rt.browserDownloads.length===1);await rt.checkBrowserDownloads();

 await rt.setBrowserItem({paused:true});rt.advanceTime(180_000);await rt.checkBrowserDownloads();
 assert.equal(rt.cancelledDownloadIds.length,0,'a Chrome-paused item is excluded');
 await rt.setBrowserItem({paused:false});await rt.checkBrowserDownloads();
 rt.advanceTime(90_000);await rt.call({action:'pause',id:job.id});rt.advanceTime(180_000);await rt.checkBrowserDownloads();
 assert.equal(rt.cancelledDownloadIds.length,0,'a job-paused item is excluded');
 await rt.call({action:'resume',id:job.id});await rt.checkBrowserDownloads();
 rt.advanceTime(119_999);await rt.checkBrowserDownloads();assert.equal(rt.cancelledDownloadIds.length,0);
 rt.advanceTime(1);await rt.checkBrowserDownloads();
 await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&item.state==='error'));
 assert.equal(rt.jobs().find(item=>item.id===job.id).errorCode,'NETWORK_TIMEOUT');
 close();

 const choosing=await loadBackground({downloadResult:{url:'https://cdn.example/chosen.mp4',filename:'clip.mp4'},browserDownloadState:'in_progress',destinationHandles:new Map()});
 const closeChoosing=choosing.connect();
 const chosenSource=await choosing.call({action:'inspect',descriptor:{tabId:8,documentId:'choose-doc',url:'https://cdn.example/chosen.mp4',title:'Clip'}});
 const pending=await choosing.call({action:'prepareDownload',sourceId:chosenSource.id,kind:'video',destinationId:'pending-choice'});
 assert.equal(choosing.jobs().find(item=>item.id===pending.id).state,'choosing');
 choosing.advanceTime(180_000);await choosing.checkBrowserDownloads();
 assert.equal(choosing.browserDownloads.length,0,'destination selection has not started a Chrome transfer');
 assert.equal(choosing.jobs().find(item=>item.id===pending.id).state,'choosing');
 choosing.destinationHandles.set('pending-choice',{});await choosing.checkDestinations();
 await waitFor(()=>choosing.browserDownloads.length===1);await choosing.checkBrowserDownloads();
 choosing.advanceTime(119_999);await choosing.checkBrowserDownloads();assert.equal(choosing.cancelledDownloadIds.length,0);
 await choosing.completeDownload();await waitFor(()=>choosing.jobs().some(item=>item.id===pending.id&&item.state==='done'));
 closeChoosing();
});

function expiredAuthFixture(){
 const descriptor={tabId:7,frameId:0,documentId:'auth-doc',mediaKey:12,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',playerUrl:'blob:player-12',url:'https://cdn.example/old.m3u8',referer:'https://site.example/watch',title:'Episode',platform:{site:'embedded'}};
 const video={mediaKey:12,documentId:'auth-doc',frameId:0,recoveryIdentity:true,mediaContentId:'episode-12',mediaIdentity:'episode-12',selectionIdentity:'player-12',url:'blob:player-12',downloadUrl:'https://cdn.example/fresh.m3u8',sourceType:'hls',referer:'https://site.example/watch',title:'Episode'};
 const frames=[{frameId:0,documentId:'auth-doc',result:{url:'https://site.example/watch',videos:[video],media:video,tracks:[]}}];
 const freshPage={url:'https://site.example/watch',videos:[video],media:video,tracks:[]};
 return {descriptor,video,frames,frameSnapshots:[freshPage,freshPage]};
}

test('native forbidden and unauthorized errors re-inspect once and retry the same selection',async()=>{
 for(const nativeError of ['SERVER_FORBIDDEN','SERVER_UNAUTHORIZED']){
  const {descriptor,frames,frameSnapshots}=expiredAuthFixture();let transfers=0;
  const rt=await loadBackground({frames,frameSnapshots,initialStorage:{runSession:'auth-retry'},downloadGate:async()=>({ok:true,result:{url:`https://cdn.example/output-${++transfers}.mp4`,filename:'Episode.mp4',referer:'https://site.example/watch'}}),browserDownloadItems:[{state:'in_progress',bytesReceived:0},{state:'in_progress',bytesReceived:0}]});
  const close=rt.connect();
  const source=await rt.call({action:'inspect',descriptor}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
  await waitFor(()=>rt.browserDownloads.length===1);
  await rt.interruptDownload({error:nativeError,canResume:false});
  await waitFor(()=>rt.browserDownloads.length===2);
  const inspections=rt.engineMessages.filter(message=>message.action==='inspect');
  const downloads=rt.engineMessages.filter(message=>message.action==='download');
  assert.equal(inspections.length,2,`${nativeError} should cause exactly one re-inspection`);
  assert.equal(downloads.length,2,`${nativeError} should cause exactly one new transfer`);
  assert.notEqual(downloads[0].sourceId,downloads[1].sourceId);
  assert.equal(downloads[0].downloadKey,downloads[1].downloadKey);
  await rt.completeDownload();await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&item.state==='done'));
  assert.equal(rt.stored.lastError,undefined);
  close();
 }
});

test('a native authorization error after one refresh preserves HTTP_AUTH without a second refresh',async()=>{
 const {descriptor,frames,frameSnapshots}=expiredAuthFixture();let transfers=0;
 const rt=await loadBackground({frames,frameSnapshots,initialStorage:{runSession:'auth-retry-fail'},downloadGate:async()=>({ok:true,result:{url:`https://cdn.example/output-${++transfers}.mp4`,filename:'Episode.mp4',referer:'https://site.example/watch'}}),browserDownloadItems:[{state:'in_progress',bytesReceived:0},{state:'in_progress',bytesReceived:0}]});
 const close=rt.connect();
 const source=await rt.call({action:'inspect',descriptor}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>rt.browserDownloads.length===1);
 await rt.interruptDownload({error:'SERVER_UNAUTHORIZED',canResume:false});
 await waitFor(()=>rt.browserDownloads.length===2);
 await rt.interruptDownload({error:'SERVER_FORBIDDEN',canResume:false});
 await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&item.state==='error'));
 const finished=rt.jobs().find(item=>item.id===job.id),failure=await rt.call({action:'lastError'});
 assert.equal(finished.errorCode,'HTTP_AUTH');assert.equal(failure.code,'HTTP_AUTH');assert.equal(failure.httpStatus,403);
 assert.equal(rt.engineMessages.filter(message=>message.action==='inspect').length,2,'the retry guard prevents a second source refresh');
 assert.equal(rt.engineMessages.filter(message=>message.action==='download').length,2);
 close();
});

test('cancelling during refreshed-source download prevents a saved result from finishing as done',async()=>{
 const {descriptor,frames,frameSnapshots}=expiredAuthFixture();let downloadCalls=0,releaseRecovery,enteredRecovery;
 const recoveryStarted=new Promise(resolve=>{enteredRecovery=resolve;});
 const rt=await loadBackground({frames,frameSnapshots,initialStorage:{runSession:'cancel-refreshed-save'},downloadGate:message=>{
  if(message.action!=='download')return null;
  if(++downloadCalls===1)return {ok:true,result:{url:'https://cdn.example/first.mp4',filename:'Episode.mp4',referer:'https://site.example/watch'}};
  return new Promise(resolve=>{releaseRecovery=()=>resolve({ok:true,result:{saved:true}});enteredRecovery();});
 },browserDownloadItems:[{state:'in_progress',bytesReceived:0}]});
 const close=rt.connect();
 const source=await rt.call({action:'inspect',descriptor}),job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>rt.browserDownloads.length===1);
 await rt.interruptDownload({error:'SERVER_FORBIDDEN',canResume:false});
 await recoveryStarted;
 assert.equal(downloadCalls,2,'the native authorization failure refreshed and retried the same job');
 await rt.call({action:'cancel',id:job.id});
 releaseRecovery();
 await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&!ACTIVE_STATES.has(item.state)));
 assert.equal(rt.jobs().find(item=>item.id===job.id).state,'cancelled');
 close();
});

test('sourcesExpired accepts only offscreen senders and preserves active job metadata',async()=>{
 let finishTransfer;
 const rt=await loadBackground({initialStorage:{runSession:'source-expiry'},offscreenPresent:true,downloadGate:()=>new Promise(resolve=>{finishTransfer=()=>resolve({ok:true,result:{saved:true}});})});
 const close=rt.connect();
 const expired=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'expired-doc',url:'https://cdn.example/expired.mp4',title:'Expired'}});
 const active=await rt.call({action:'inspect',descriptor:{tabId:8,documentId:'active-doc',url:'https://cdn.example/active.mp4',title:'Active'}});
 const job=await rt.call({action:'download',sourceId:active.id,kind:'video'});
 await waitFor(()=>typeof finishTransfer==='function');
 await assert.rejects(rt.call({action:'sourcesExpired',sourceIds:[expired.id,active.id]}),/來源未授權/);
 assert.ok(rt.metaIds().includes(expired.id));
 await rt.call({action:'sourcesExpired',sourceIds:[expired.id,active.id]},{id:'ext',url:'chrome-extension://ext/offscreen.html'});
 assert.equal(rt.metaIds().includes(expired.id),false,'the expired, unowned metadata is removed');
 assert.equal(rt.metaIds().includes(active.id),true,'an active job keeps its source metadata');
 finishTransfer();await waitFor(()=>rt.jobs().some(item=>item.id===job.id&&item.state==='done'));
 close();
});

test('popup observation release leaves the job tab lease until completion or cancellation',async()=>{
 let finishTransfer;
 const rt=await loadBackground({initialStorage:{runSession:'popup-job-lease',mediaObservationBuild:BUILD_ID},offscreenPresent:true,downloadGate:()=>new Promise(resolve=>{finishTransfer=()=>resolve({ok:true,result:{saved:true}});})});
 const close=rt.connect();close.send({action:'observeMedia',tabId:7});
 await waitFor(()=>activitySnapshots(rt).some(tabs=>tabs.includes(7)));
 const source=await rt.call({action:'inspect',descriptor:{tabId:7,documentId:'lease-doc',url:'https://cdn.example/lease.mp4',title:'Lease'}});
 const job=await rt.call({action:'download',sourceId:source.id,kind:'video'});
 await waitFor(()=>typeof finishTransfer==='function');close();
 assert.deepEqual(JSON.parse(JSON.stringify(rt.activeSourceTabs())),[7]);
 assert.deepEqual(activitySnapshots(rt).at(-1),[7],'closing the popup does not release the active job observation');
 finishTransfer();await waitFor(()=>activitySnapshots(rt).at(-1)?.length===0);
 assert.deepEqual(JSON.parse(JSON.stringify(rt.activeSourceTabs())),[]);

 const cancelling=await loadBackground({initialStorage:{runSession:'popup-job-cancel',mediaObservationBuild:BUILD_ID},offscreenPresent:true});
 const closeCancel=cancelling.connect();closeCancel.send({action:'observeMedia',tabId:9});
 await waitFor(()=>activitySnapshots(cancelling).some(tabs=>tabs.includes(9)));
 const cancelSource=await cancelling.call({action:'inspect',descriptor:{tabId:9,documentId:'cancel-lease-doc',url:'https://cdn.example/cancel.mp4',title:'Cancel'}});
 const pending=await cancelling.call({action:'prepareDownload',sourceId:cancelSource.id,kind:'video',destinationId:'not-picked'});
 closeCancel();assert.deepEqual(JSON.parse(JSON.stringify(cancelling.activeSourceTabs())),[9]);
 await cancelling.call({action:'cancel',id:pending.id});
 await waitFor(()=>activitySnapshots(cancelling).at(-1)?.length===0);
 assert.deepEqual(JSON.parse(JSON.stringify(cancelling.activeSourceTabs())),[],'cancelling the choosing job releases its observation lease');
});

test('closing the last browser window clears observation and source state with queued and choosing jobs',async()=>{
 let finishTransfer;
 const rt=await loadBackground({initialStorage:{runSession:'last-window-cleanup',mediaObservationBuild:BUILD_ID},offscreenPresent:true,downloadGate:()=>new Promise(resolve=>{finishTransfer=()=>resolve({ok:true,result:{saved:true}});})});
 const close=rt.connect();close.send({action:'observeMedia',tabId:17});
 await waitFor(()=>activitySnapshots(rt).some(tabs=>tabs.includes(17)));
 const inspect=async(mediaKey,title)=>rt.call({action:'inspect',descriptor:{tabId:17,documentId:`window-doc-${mediaKey}`,mediaKey,url:`https://cdn.example/window-${mediaKey}.mp4`,title}});
 const runningSource=await inspect(1,'Running'),queuedSource=await inspect(2,'Queued'),choosingSource=await inspect(3,'Choosing');
 const running=await rt.call({action:'download',sourceId:runningSource.id,kind:'video'});
 await waitFor(()=>typeof finishTransfer==='function');
 const queued=await rt.call({action:'download',sourceId:queuedSource.id,kind:'video'});
 const choosing=await rt.call({action:'prepareDownload',sourceId:choosingSource.id,kind:'video',destinationId:'last-window-choice'});
 assert.deepEqual(JSON.parse(JSON.stringify(rt.jobs().filter(job=>[running.id,queued.id,choosing.id].includes(job.id)).map(job=>job.state).sort())),['choosing','queued','running']);
 assert.equal(rt.metaIds().length,3);

 close();
 assert.deepEqual(JSON.parse(JSON.stringify(rt.activeSourceTabs())),[17],'job leases remain after popup observation disconnects');
 rt.closeLastWindow();
 await waitFor(()=>rt.activeSourceTabs().length===0&&rt.metaIds().length===0&&activitySnapshots(rt).at(-1)?.length===0);
 assert.deepEqual(JSON.parse(JSON.stringify(rt.activeSourceTabs())),[]);
 assert.deepEqual(JSON.parse(JSON.stringify(rt.metaIds())),[],'the last-window path removes all source metadata despite active jobs');
 assert.deepEqual(activitySnapshots(rt).at(-1),[],'offscreen observers receive the empty active-tab set');
 finishTransfer();
});
