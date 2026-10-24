import {attachNetworkSources,networkFallbackReason,scopeDocumentCandidates,validateOwnedSourcePlan} from '../extension/network-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {classifyFailure} from '../extension/diagnostics.js';
import {ACTIVE_STATES} from '../extension/jobs.js';
import {downloadKey,createDownloadClaims,stableHash} from '../extension/download-identity.js';
import {createPopupMarkerController} from '../extension/popup-marker.js';
import {createMediaSelectionController,selectionStorageKey,selectedMediaIndex,collapseBilibiliPlayers,recoverBilibiliRoute} from '../extension/media-selection-controller.js';
import {attachSocialSources} from '../extension/social-source.js';
import {normalizeRange} from '../extension/media-range.js';
import {mediaTime} from '../extension/media-time.js';
import {isGenericMediaTitle} from '../extension/media-titles.js';
import {validateDocumentMediaPlan} from '../extension/document-media.js';

async function loadBackground({frames=[],frameSnapshots=[],networkCandidates=[],inspectionInfo={},downloadFailure=null,downloadResult=null,metadataValidations=[],browserDownloadState,browserSaveError}={}) {
  const source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');
  const code=source.replace(/^import[^;]+;\s*/gm,'');
  const stored={};let listener,tabUpdateListener,connectListener,inspectNo=0,retainCount=0,retainMode='ok',retainBlocked=false,retainRelease;
  const sources=new Map(),engineMessages=[],browserDownloads=[];let downloadChanged;
  const browserItem={id:71,state:browserDownloadState};
  const pageSnapshotMock=()=>({});
  const session={
    async get(key){if(key===null)return {...stored};if(typeof key==='string')return {[key]:stored[key]};return Object.fromEntries(key.map(k=>[k,stored[k]]));},
    async set(value){Object.assign(stored,value);},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];}
  };
  const chrome={
    runtime:{id:'ext',getURL:path=>`chrome-extension://ext/${path}`,getContexts:async()=>[],sendMessage:async message=>{
      engineMessages.push(message);
      if(message.action==='inspect'){const id=`source-${++inspectNo}`,d=message.descriptor;sources.set(id,{title:d.title||'',platform:d.platform?.site||'unknown'});return {ok:true,result:{id,title:d.title||'',platform:d.platform?.site||'unknown',...inspectionInfo}};}
      if(message.action==='download'&&downloadFailure)return {ok:false,error:'private CDN response',failure:downloadFailure};
      if(message.action==='download'&&downloadResult)return {ok:true,result:downloadResult};
      if(message.action==='retain'){retainCount++;if(retainMode==='reject')return {ok:false,error:'retain failed'};const s=sources.get(message.sourceId);if(retainBlocked)return new Promise(resolve=>{retainRelease=()=>resolve({ok:true,result:{title:s?.title||''}})});return {ok:true,result:{title:s?.title||''}};}
      if(message.action==='forget'||message.action==='cancel'||message.action==='cleanup')return {ok:true,result:{}};
      return {ok:true,result:{}};
    },onMessage:{addListener:fn=>{listener=fn}},onConnect:{addListener:fn=>{connectListener=fn}}},
    storage:{session,onChanged:{addListener:()=>{}},local:{remove:async()=>{},get:async()=>({})}},
    offscreen:{createDocument:async()=>{}},
    declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async()=>{}},
    downloads:{onChanged:{addListener:fn=>{downloadChanged=fn;}},search:async()=>browserItem.state?[browserItem]:[],cancel:async()=>{},pause:async()=>{},resume:async()=>{},...(browserDownloadState||browserSaveError?{download:async options=>{browserDownloads.push(options);const error=typeof browserSaveError==='function'?browserSaveError(options,browserDownloads.length):browserSaveError;if(error)throw error;return browserItem.id;}}:{})},
    scripting:{executeScript:async request=>{
      if(request.files)return [];
      if(request.func===validateDocumentMediaPlan||request.func===validateOwnedSourcePlan)return [{documentId:request.target.documentIds[0],result:{valid:metadataValidations.shift()===true}}];
      if(request.func===pageSnapshotMock&&request.target?.documentIds){const value=frameSnapshots.shift();return value?[{frameId:request.target.documentIds[0]==='child'?2:0,documentId:request.target.documentIds[0],result:value}]:[];}
      return frames;
    }},
    tabs:{onRemoved:{addListener:()=>{}},onUpdated:{addListener:fn=>{tabUpdateListener=fn;}}},
    windows:{onRemoved:{addListener:()=>{}},getAll:async()=>[{}]},
    action:{setBadgeText:async()=>{}}
  };
  const context={chrome,crypto:webcrypto,URL,URLSearchParams,AbortSignal,TextEncoder,TextDecoder,console,setTimeout,clearTimeout,setInterval:()=>0,
    pageSnapshot:pageSnapshotMock,pageSubtitles:()=>({}),createBilibiliClient:()=>({}),bilibiliRoute:()=>({}),normalizeCues:x=>x,parseSubtitles:x=>x,
    ACTIVE_STATES, normalizeRange,mediaTime,isGenericMediaTitle,validateDocumentMediaPlan,validateOwnedSourcePlan,scopeDocumentCandidates,youtubeSession:async()=>null,youtubeCaptionRequest:async()=>null,classifyFailure:(e,stage)=>({...classifyFailure(e,stage),message:e?.message||String(e)}),ERROR_RETENTION_MS:100,
    CAPTURE_PREFIX:'capture:',CAPTURE_VERSION:1,createSubtitleCaptureManager:()=>({start:async()=>{},removeTab:async()=>{},clearAll:async()=>{}}),loadBilibiliSubtitle:async()=>{},fileStem:s=>s,mediaRequestHeaders:()=>[],
    VideoPocketDestinations:{remove:async()=>{},clear:async()=>{},get:async()=>false},
    downloadKey,createDownloadClaims,stableHash,createPopupMarkerController,createMediaSelectionController,selectionStorageKey,selectedMediaIndex,collapseBilibiliPlayers,recoverBilibiliRoute,attachSocialSources,waitForMediaSource:async()=>({ready:false,changed:false}),createNetworkMediaObserver:()=>({candidates:()=>networkCandidates}),attachNetworkSources,networkFallbackReason,socialPageFetch:()=>{}};
  vm.runInNewContext(code,context,{filename:'background.js'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof listener,'function');
  const call=(message,sender={id:'ext',url:'chrome-extension://ext/popup.html',documentId:'popup-doc'})=>new Promise((resolve,reject)=>listener(message,sender,response=>response?.ok?resolve(response.result):reject(Object.assign(new Error(response?.error||'failed'),response?.failure||{}))));
  return {connect(){const callbacks=[];connectListener({name:'popup',sender:{url:'chrome-extension://ext/popup.html'},onMessage:{addListener(){}},onDisconnect:{addListener:fn=>callbacks.push(fn)}});return()=>callbacks.forEach(fn=>fn());},call,stored,engineMessages,browserDownloads,async completeDownload(){browserItem.state='complete';await downloadChanged({id:browserItem.id,state:{current:'complete'}});},navigate:(tabId,changeInfo)=>tabUpdateListener?.(tabId,changeInfo),get retainCount(){return retainCount;},set retainMode(value){retainMode=value;},blockRetain(){retainBlocked=true;},releaseRetain(){retainBlocked=false;retainRelease?.();},jobs:()=>stored.jobs||[]};
}

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
 const rt=await loadBackground(),source=await rt.call({action:'inspect',descriptor:{url:'https://cdn.test/clip.mp4',title:'clip'}});
 rt.blockRetain();const pending=rt.call({action:'prepareDownload',sourceId:source.id,kind:'video'});
 for(let i=0;i<100&&!rt.retainCount;i++)await new Promise(resolve=>setImmediate(resolve));
 const before=rt.engineMessages.filter(m=>m.action==='recoverMedia').length;
 assert.equal((await rt.call({action:'recoverDownloads'})).active,true);
 rt.releaseRetain();const job=await pending;
 assert.equal((await rt.call({action:'recoverDownloads'})).active,true);
 assert.equal(rt.engineMessages.filter(m=>m.action==='recoverMedia').length,before);
 await rt.call({action:'cancel',id:job.id});
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
  rt.retainMode='reject';await assert.rejects(rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'}));
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
