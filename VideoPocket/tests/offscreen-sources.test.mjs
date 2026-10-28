import {createSourceRetention} from '../extension/source-retention.js';
import {sharedHttpRequestPolicy,parseRetryAfter} from '../extension/http-resilience.js';
import {validateMediaRecovery} from '../extension/media-recovery.js';
import {createMediaRangeVersions} from '../extension/media-range-versions.js';
import {createYoutubeSourceSessions} from '../extension/youtube-source-session.js';
import {inspectionReuseKey,inspectionReusable} from '../extension/inspection-reuse.js';
import {parseByteRange as byteRange,rangeCapability,formatRangeCapability} from '../extension/range-capability.js';
import {createMediaTransfer} from '../extension/media-transfer.js';
import {resolveNetworkCandidates,prioritizeMediaVersions} from '../extension/source-candidates.js';
import {platformSource} from '../extension/platform-formats.js';
import {assembleSegments} from '../extension/ordered-segments.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {HlsParser,parseDash} from '../extension/vendor/parsers.js';
import {mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs,qualityOfFormat} from '../extension/browser-media.js';
import {parseSubtitles} from '../extension/subtitles.js';
import {classifyFailure} from '../extension/diagnostics.js';
import {resolveAnime1} from '../extension/anime1.js';
import {mediaCredentials} from '../extension/media-credentials.js';
import {parseTransportStreamCodecs} from '../extension/transport-stream.js';
import {readMp4Metadata} from '../extension/mp4-metadata.js';
import {decryptHlsSample,hlsIv} from '../extension/hls-sample.js';
import {twitchVodManifest} from '../extension/twitch-adapter.js';
import {twitchClipManifest,tokenizedTwitchClipUrl} from '../extension/twitch-clips.js';
import {verifiedSocialSource} from '../extension/social-source.js';
import {socialPageResponse} from '../extension/social-page-fetch.js';
import {resolveDailymotion} from '../extension/dailymotion.js';
import {resolveLinkedMedia} from '../extension/linked-media.js';
import {extractMediaModels} from '../extension/media-models.js';

const EMPTY={videoCodec:'',audioCodec:''};
function response(body,{status=200,type='application/octet-stream',length,contentRange=null,url=''}={}){
  const bytes=typeof body==='string'?new TextEncoder().encode(body):new Uint8Array(body||[]);
  let read=false;return {url,ok:status>=200&&status<300,status,headers:{get:k=>k.toLowerCase()==='content-type'?type:k.toLowerCase()==='content-length'?String(length ?? bytes.length):k.toLowerCase()==='content-range'?contentRange:null},text:async()=>new TextDecoder().decode(bytes),json:async()=>JSON.parse(new TextDecoder().decode(bytes)),body:{cancel:async()=>{},getReader:()=>({read:async()=>read?{done:true}:{done:(read=true,false),value:bytes},cancel:async()=>{}})},arrayBuffer:async()=>bytes.buffer, _bytes:bytes};
}
function ts(){
  const psi=(table,body)=>{const n=body.length+4,s=new Uint8Array(3+body.length+4);s[0]=table;s[1]=0xb0|n>>8;s[2]=n;s.set(body,3);return s;};
  const pat=psi(0,[0,1,0xc1,0,0,0,1,0xe1,0]);const pmt=psi(2,[0,1,0xc1,0,0,0xe1,0,0xf0,0,0x1b,0xe1,0,0xf0,0,0x0f,0xe1,0,0xf0,0]);
  const packet=(pid,s)=>{const p=new Uint8Array(188);p.fill(255);p.set([0x47,0x40|pid>>8,pid&255,0x30],0);p[4]=183-s.length-1;p.set([0,...s],5+p[4]);return p;};
  return Uint8Array.from([...packet(0,pat),...packet(0x100,pmt)]);
}
function fakeVideo(){const v={preload:'',muted:false,videoWidth:1280,videoHeight:720,duration:12,removeAttribute(){},load(){}};Object.defineProperty(v,'src',{set(){queueMicrotask(()=>v.onloadedmetadata?.())}});return v;}
function mp4Box(type,payload){const out=new Uint8Array(8+payload.length),size=out.length;out.set([size>>>24,(size>>>16)&255,(size>>>8)&255,size&255,...type].map((x,i)=>typeof x==='string'?x.charCodeAt(0):x));out.set(payload,8);return out;}
function largeMp4(){
  const avc=mp4Box('avc1',new Uint8Array(28)),aac=mp4Box('mp4a',new Uint8Array(20));
  const stsdPayload=new Uint8Array(8+avc.length+aac.length);stsdPayload.set([0,0,0,0,0,0,0,2]);stsdPayload.set(avc,8);stsdPayload.set(aac,8+avc.length);
  const stbl=mp4Box('stbl',mp4Box('stsd',stsdPayload));
  const minf=mp4Box('minf',stbl),mdia=mp4Box('mdia',minf),trak=mp4Box('trak',mdia),moov=mp4Box('moov',trak);
  const total=220000,out=new Uint8Array(total);out.set([0,0,0,8,102,116,121,112]);const freeSize=200000-8;out.set([freeSize>>>24,(freeSize>>>16)&255,(freeSize>>>8)&255,freeSize&255,102,114,101,101],8);out.set(moov,200000);return out;
}

function timedMp4(duration,height=360,width=0){
 const join=(...parts)=>Uint8Array.from(parts.flatMap(p=>[...p]));
 const movie=new Uint8Array(32),mv=new DataView(movie.buffer);mv.setUint32(12,1000);mv.setUint32(16,Math.round(duration*1000));
 const avcPayload=new Uint8Array(28);avcPayload[24]=width>>8;avcPayload[25]=width&255;avcPayload[26]=height>>8;avcPayload[27]=height&255;
 const avc=mp4Box('avc1',avcPayload),aac=mp4Box('mp4a',new Uint8Array(20));
 const stsd=join(new Uint8Array([0,0,0,0,0,0,0,2]),avc,aac);
 const trak=mp4Box('trak',mp4Box('mdia',mp4Box('minf',mp4Box('stbl',mp4Box('stsd',stsd)))));
 return join(mp4Box('ftyp',new Uint8Array(8)),mp4Box('moov',join(mp4Box('mvhd',movie),trak)));
}

function silentMp4(){
 const join=(...parts)=>Uint8Array.from(parts.flatMap(part=>[...part]));
 const handler=new Uint8Array(12);handler.set([118,105,100,101],8);
 const video=new Uint8Array(28),sample=mp4Box('avc1',video),table=join(new Uint8Array([0,0,0,0,0,0,0,1]),sample);
 return join(mp4Box('ftyp',new Uint8Array(8)),mp4Box('moov',mp4Box('trak',mp4Box('mdia',join(mp4Box('hdlr',handler),mp4Box('minf',mp4Box('stbl',mp4Box('stsd',table))))))));
}

async function makeRuntime(routes,{inspectionTimeoutMs=25000,requestTimeoutMs=20000,pageReply,parseDocument,manifestReply,mediabunny,clock}={}){
  const messages=[];let listener;
  const chrome={runtime:{id:'test-extension',sendMessage:async message=>{messages.push({kind:'rpc',message});return {ok:true,result:message.action==='observedManifest'&&manifestReply?await manifestReply(message):message.action==='socialPageFetch'&&pageReply?await pageReply(message):{}}},onMessage:{addListener:fn=>{listener=fn}}}};
  const fetchLog=[];
  const fetch=async (url,options={})=>{const u=String(url),opts={...options,headers:{...(options.headers||{})}};fetchLog.push({url:u,options:opts,credentials:opts.credentials});const route=routes.find(r=>r.match(u,opts));if(!route)throw new Error('unmocked '+u);if(typeof route.reply==='function')return route.reply(u,opts);return route.reply;};
  const source=await fs.readFile(new URL('../extension/offscreen.js',import.meta.url),'utf8');
  const code=source.replace(/^import[^;]+;\s*/gm,'');
  const runtimeSetTimeout=(fn,ms,...args)=>setTimeout(fn,ms===20000?requestTimeoutMs:ms,...args);
  const RuntimeDate=clock?class extends Date{static now(){return clock.now;}}:Date;
  const context={createSourceRetention:options=>createSourceRetention({...options,setTimer:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref?.();return timer;}}),sharedHttpRequestPolicy,parseRetryAfter,validateMediaRecovery,createMediaRangeVersions,createYoutubeSourceSessions,inspectionReuseKey,inspectionReusable,qualityOfFormat,byteRange,rangeCapability,formatRangeCapability,createMediaTransfer,resolveNetworkCandidates,prioritizeMediaVersions,platformSource,assembleSegments,HlsParser,parseDash,mediaChoices,selectedPlan,metadataCodecs,codec,parseMp4Codecs,parseSubtitles,directTransfer:async()=>{},downloadYoutube:async()=>{},TransferControl:class{},classifyFailure,resolveAnime1,mediaCredentials,parseTransportStreamCodecs,readMp4Metadata,decryptHlsSample,hlsIv,chrome,fetch,document:{createElement:()=>fakeVideo()},VideoPocketDiskMedia:{removeMediaFiles:async()=>{}},crypto,URL,URLSearchParams,TextEncoder,TextDecoder,DOMException,AbortController,AbortSignal:{any:signals=>AbortSignal.any(signals),timeout:ms=>AbortSignal.timeout(ms===25000?inspectionTimeoutMs:ms===20000?requestTimeoutMs:ms)},Uint8Array,ArrayBuffer,File:class{},Worker:class{},Date:RuntimeDate,setInterval:()=>{},setTimeout:runtimeSetTimeout,clearTimeout,queueMicrotask,console};
  if(mediabunny){
    class BlobSource{constructor(blob){this.blob=blob;}}
    class Input{constructor({source}){this.source=source;}async getPrimaryVideoTrack(){return {}; }async dispose(){}}
    class EncodedPacketSink{constructor(){}async getFirstPacket(){return mediabunny.firstPacket?{close(){}}:null;}}
    context.VideoPocketMediabunny={MP4:{},BlobSource,Input,EncodedPacketSink};
  }
    vm.runInNewContext(code,{...context,Response,twitchVodManifest,twitchClipManifest,tokenizedTwitchClipUrl,verifiedSocialSource,socialPageResponse,resolveDailymotion,resolveLinkedMedia:(link,referer,request,options)=>resolveLinkedMedia(link,referer,request,{...options,...(parseDocument?{parseDocument}:{})})},{filename:'offscreen.js'});
  assert.equal(typeof listener,'function');
  async function inspect(descriptor,inspectionId,options={}){return new Promise((resolve,reject)=>listener({target:'offscreen',action:'inspect',descriptor,inspectionId,...options},{id:'test-extension'},reply=>reply?.ok?resolve(reply.result):reject(Object.assign(new Error(reply?.error||'inspect failed'),reply?.failure||{}))));}
  const call=message=>new Promise((resolve,reject)=>listener({target:'offscreen',...message},{id:'test-extension'},reply=>reply?.ok?resolve(reply.result):reject(Object.assign(new Error(reply?.error||'operation failed'),reply?.failure||{}))));
  return {inspect,call,fetchLog,messages,cancel:inspectionId=>new Promise(resolve=>listener({target:'offscreen',action:'cancelInspect',inspectionId},{id:'test-extension'},resolve))};
}

test('leaving a tab drops unused sources and defers active source removal until release',async()=>{
 const bytes=timedMp4(10,360,640);
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const descriptor={tabId:7,documentId:'doc',referer:'https://example.test/watch',url:'https://cdn.test/a.mp4',title:'First'};
 const active=await rt.inspect(descriptor),unused=await rt.inspect({...descriptor,url:'https://cdn.test/b.mp4'}),other=await rt.inspect({...descriptor,tabId:8,url:'https://cdn.test/c.mp4'});
 await rt.call({action:'retain',sourceId:active.id});await rt.call({action:'dropTabSources',tabId:7});
 await assert.rejects(rt.call({action:'retain',sourceId:unused.id}));
 assert.ok(await rt.call({action:'retain',sourceId:other.id}));
 await rt.call({action:'retain',sourceId:active.id});await rt.call({action:'forget',sourceId:active.id});
 assert.ok(await rt.call({action:'retain',sourceId:active.id}));
 await rt.call({action:'forget',sourceId:active.id});await rt.call({action:'forget',sourceId:active.id});
 await assert.rejects(rt.call({action:'retain',sourceId:active.id}));
});

function replacementDescriptor(patch={}){return {tabId:7,frameId:0,documentId:'replacement-document',mediaKey:'selected-player',mediaContentId:'selected-content',referer:'https://example.test/watch',url:'https://cdn.example/selected.mp4',title:'Selected video',...patch};}
async function replacementRuntime(options={}){
 const bytes=timedMp4(12,360,640);
 return makeRuntime([{match:()=>true,reply:(url,request)=>options.refused?.()?response('',{status:403}):request.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}],options);
}

test('ten accepted refreshes replace unused versions without losing the current inspected result',async()=>{
 const rt=await replacementRuntime(),descriptor=replacementDescriptor();let current=await rt.inspect(descriptor,undefined,{activeSourceTabs:[7]});
 await rt.call({action:'acceptSource',sourceId:current.id,ownerId:'popup-a'});
 const retired=[];
 for(let i=0;i<10;i++){
  const previous=current;current=await rt.inspect(descriptor,undefined,{force:true});
  await rt.call({action:'acceptSource',sourceId:current.id,ownerId:'popup-a'});
  await assert.rejects(rt.call({action:'retain',sourceId:previous.id}));retired.push(previous.id);
 }
 const before=rt.fetchLog.length;assert.equal((await rt.inspect(descriptor)).id,current.id);assert.equal(rt.fetchLog.length,before,'the accepted newest source still reuses its probe');
 const removed=rt.messages.filter(entry=>entry.message.action==='sourcesExpired').flatMap(entry=>entry.message.sourceIds);
 assert.deepEqual(new Set(removed),new Set(retired));assert.equal(removed.includes(current.id),false);
});

test('replacement keeps a download version until its last reference is released',async()=>{
 const rt=await replacementRuntime(),descriptor=replacementDescriptor(),old=await rt.inspect(descriptor,undefined,{activeSourceTabs:[7]});
 await rt.call({action:'acceptSource',sourceId:old.id,ownerId:'popup-a'});await rt.call({action:'retain',sourceId:old.id});
 const current=await rt.inspect(descriptor,undefined,{force:true});await rt.call({action:'acceptSource',sourceId:current.id,ownerId:'popup-a'});
 assert.ok(await rt.call({action:'retain',sourceId:old.id}));await rt.call({action:'forget',sourceId:old.id});
 await rt.call({action:'forget',sourceId:old.id});await assert.rejects(rt.call({action:'retain',sourceId:old.id}));
 assert.ok(await rt.call({action:'retain',sourceId:current.id}));await rt.call({action:'forget',sourceId:current.id});
});

test('a second popup may keep its own previous source until it closes',async()=>{
 const rt=await replacementRuntime(),descriptor=replacementDescriptor(),old=await rt.inspect(descriptor,undefined,{activeSourceTabs:[7]});
 await rt.call({action:'acceptSource',sourceId:old.id,ownerId:'popup-a'});
 const current=await rt.inspect(descriptor,undefined,{force:true});await rt.call({action:'acceptSource',sourceId:current.id,ownerId:'popup-b'});
 assert.ok(await rt.call({action:'retain',sourceId:old.id}));await rt.call({action:'forget',sourceId:old.id});
 await rt.call({action:'releaseSourceOwner',ownerId:'popup-a'});await assert.rejects(rt.call({action:'retain',sourceId:old.id}));
 assert.ok(await rt.call({action:'retain',sourceId:current.id}));await rt.call({action:'forget',sourceId:current.id});
});

test('selecting an older cached player uses the new popup request order, not the source creation order',async()=>{
 const rt=await replacementRuntime(),a=replacementDescriptor(),b=replacementDescriptor({mediaKey:'second-player'});
 const first=await rt.inspect(a,undefined,{activeSourceTabs:[7]});await rt.call({action:'acceptSource',sourceId:first.id,ownerId:'popup-a',ownerRequestOrder:1});
 const second=await rt.inspect(b);await rt.call({action:'acceptSource',sourceId:second.id,ownerId:'popup-a',ownerRequestOrder:2});
 const cached=await rt.inspect(a);assert.equal(cached.id,first.id);await rt.call({action:'acceptSource',sourceId:cached.id,ownerId:'popup-a',ownerRequestOrder:3});
 const refreshed=await rt.inspect(a,undefined,{force:true});await rt.call({action:'acceptSource',sourceId:refreshed.id,ownerId:'popup-b',ownerRequestOrder:4});
 await rt.call({action:'acceptSource',sourceId:second.id,ownerId:'popup-a',ownerRequestOrder:2});
 assert.ok(await rt.call({action:'retain',sourceId:first.id}),'a late request cannot steal the current cached player ownership');await rt.call({action:'forget',sourceId:first.id});
 await rt.call({action:'releaseSourceOwner',ownerId:'popup-a'});await assert.rejects(rt.call({action:'retain',sourceId:first.id}));
});

test('a refused probe or rejected candidate never replaces the previous accepted source',async()=>{
 let refused=false;const rt=await replacementRuntime({refused:()=>refused}),descriptor=replacementDescriptor(),old=await rt.inspect(descriptor,undefined,{activeSourceTabs:[7]});
 await rt.call({action:'acceptSource',sourceId:old.id,ownerId:'popup-a'});refused=true;
 await assert.rejects(rt.inspect(descriptor,undefined,{force:true}),{code:'HTTP_AUTH'});refused=false;
 assert.ok(await rt.call({action:'retain',sourceId:old.id}));await rt.call({action:'forget',sourceId:old.id});
 const candidate=await rt.inspect(descriptor,undefined,{force:true});await rt.call({action:'forget',sourceId:candidate.id,discardInspection:true});
 await assert.rejects(rt.call({action:'retain',sourceId:candidate.id}));assert.ok(await rt.call({action:'retain',sourceId:old.id}));await rt.call({action:'forget',sourceId:old.id});
 const current=await rt.inspect(descriptor,undefined,{force:true});await rt.call({action:'acceptSource',sourceId:current.id,ownerId:'popup-a'});
 await assert.rejects(rt.call({action:'retain',sourceId:old.id}));
});

test('pending candidates are not shared and inspection disposal cannot release a job reference',async()=>{
 const clock={now:Date.now()},rt=await replacementRuntime({clock}),descriptor=replacementDescriptor();
 const first=await rt.inspect(descriptor),second=await rt.inspect(descriptor);assert.notEqual(first.id,second.id,'an unverified candidate is not reused');
 await rt.call({action:'forget',sourceId:first.id,discardInspection:true});await rt.call({action:'acceptSource',sourceId:second.id,ownerId:'popup-a'});
 await rt.call({action:'retain',sourceId:second.id});await rt.call({action:'forget',sourceId:second.id,discardInspection:true});
 await rt.call({action:'releaseSourceOwner',ownerId:'popup-a'});clock.now+=120_000;
 assert.ok(await rt.call({action:'retain',sourceId:second.id}),'discarding an inspection must not consume the existing download reference');
 await rt.call({action:'forget',sourceId:second.id});await rt.call({action:'forget',sourceId:second.id});
});

test('same title and content id in another player or frame cannot retire the selected player',async()=>{
 const rt=await replacementRuntime(),descriptor=replacementDescriptor(),first=await rt.inspect(descriptor,undefined,{activeSourceTabs:[7]});
 await rt.call({action:'acceptSource',sourceId:first.id,ownerId:'popup-a'});
 for(const patch of [{mediaKey:'another-player'},{frameId:2},{documentId:'another-document'},{tabId:8}]){
  const other=await rt.inspect(replacementDescriptor(patch));await rt.call({action:'acceptSource',sourceId:other.id,ownerId:'popup-b'});
  assert.ok(await rt.call({action:'retain',sourceId:first.id}));await rt.call({action:'forget',sourceId:first.id});
 }
});

test('a successful inspection is reused only for the exact, complete selected input',async()=>{
 const bytes=timedMp4(10,360,640),url='https://cdn.example/reuse.mp4';
 const rt=await makeRuntime([{match:()=>true,reply:(requestUrl,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const descriptor={tabId:7,frameId:2,documentId:'reuse-doc',mediaKey:'reuse-key',mediaContentId:'reuse-media',referer:'https://example.test/watch',url,title:'Selected video'};
 const first=await rt.inspect(descriptor),calls=rt.fetchLog.length;
 await rt.call({action:'acceptSource',sourceId:first.id});
 const repeated=await rt.inspect(descriptor);
 assert.equal(repeated.id,first.id);
 assert.equal(rt.fetchLog.length,calls,'reusing a successful source performs no additional requests');

 const changes=[
  ['URL',{url:'https://cdn.example/other.mp4'}],
  ['media ID',{mediaContentId:'different-media'}],
  ['document ID',{documentId:'different-document'}],
  ['frame ID',{frameId:3}],
  ['media key',{mediaKey:'different-key'}]
 ];
 for(const [label,patch] of changes){
  const before=rt.fetchLog.length,result=await rt.inspect({...descriptor,...patch});
  assert.notEqual(result.id,first.id,`${label} change must inspect a fresh source`);
  assert.ok(rt.fetchLog.length>before,`${label} change must read its source again`);
 }
 const beforeDrm=rt.fetchLog.length;
 await assert.rejects(rt.inspect({...descriptor,drm:true}));
 assert.equal(rt.fetchLog.length,beforeDrm,'a DRM input cannot reuse the earlier source');
});

test('force clears same-scope reuse before a DRM rejection, while non-force DRM is rejected',async()=>{
 const bytes=timedMp4(10,360,640),url='https://cdn.example/force-drm.mp4';
 const rt=await makeRuntime([{match:()=>true,reply:(requestUrl,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const descriptor={tabId:18,frameId:1,documentId:'force-drm-doc',mediaKey:'force-drm-key',referer:'https://example.test/watch',url,title:'Selected video'};
 const first=await rt.inspect(descriptor),beforeForce=rt.fetchLog.length;
 await assert.rejects(rt.inspect({...descriptor,drm:true},undefined,{force:true}));
 const afterDrmForce=await rt.inspect(descriptor);
 await rt.call({action:'acceptSource',sourceId:afterDrmForce.id});
 assert.notEqual(afterDrmForce.id,first.id,'a forced DRM failure invalidates the earlier same-scope entry');
 assert.ok(rt.fetchLog.length>beforeForce);

 const beforeNonForceDrm=rt.fetchLog.length;
 await assert.rejects(rt.inspect({...descriptor,drm:true}));
 assert.equal(rt.fetchLog.length,beforeNonForceDrm,'a non-forced DRM selection is rejected without probing');
 assert.equal((await rt.inspect(descriptor)).id,afterDrmForce.id,'a non-forced DRM rejection leaves the valid source untouched');
 assert.equal(rt.fetchLog.length,beforeNonForceDrm);
});

test('forget with invalidateInspection prevents reuse while retaining a referenced source',async()=>{
 const bytes=timedMp4(10,360,640),url='https://cdn.example/forget-invalidates.mp4';
 const rt=await makeRuntime([{match:()=>true,reply:(requestUrl,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const descriptor={tabId:19,frameId:0,documentId:'forget-doc',mediaKey:'forget-key',referer:'https://example.test/watch',url,title:'Selected video'};
 const first=await rt.inspect(descriptor);
 await rt.call({action:'retain',sourceId:first.id});
 await rt.call({action:'forget',sourceId:first.id,invalidateInspection:true});
 const before=rt.fetchLog.length,second=await rt.inspect(descriptor);
 assert.notEqual(second.id,first.id,'invalidating forget removes the key even when the source remains present');
 assert.ok(rt.fetchLog.length>before);
});

test('force, tab removal, cleanup and expiry all require a new source inspection',async()=>{
 const bytes=timedMp4(10,360,640),url='https://cdn.example/reuse-life.mp4';
 const clock={now:1_000_000};
 const rt=await makeRuntime([{match:()=>true,reply:(requestUrl,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}],{clock});
 const descriptor={tabId:17,frameId:0,documentId:'reuse-life-doc',mediaKey:'reuse-life-key',referer:'https://example.test/watch',url,title:'Selected video'};
 const first=await rt.inspect(descriptor),afterFirst=rt.fetchLog.length;
 await rt.call({action:'acceptSource',sourceId:first.id});
 assert.equal((await rt.inspect(descriptor)).id,first.id);
 assert.equal(rt.fetchLog.length,afterFirst);

 const forced=await rt.call({action:'inspect',descriptor,force:true});
 assert.notEqual(forced.id,first.id);
 assert.ok(rt.fetchLog.length>afterFirst,'force bypasses a reusable source');

 const beforeDrop=rt.fetchLog.length;
 await rt.call({action:'dropTabSources',tabId:descriptor.tabId});
 const afterDrop=await rt.inspect(descriptor);
 assert.notEqual(afterDrop.id,forced.id);
 assert.ok(rt.fetchLog.length>beforeDrop,'dropTabSources removes the source from reuse');

 const beforeCleanup=rt.fetchLog.length;
 await rt.call({action:'cleanup'});
 const afterCleanup=await rt.inspect(descriptor);
 await rt.call({action:'acceptSource',sourceId:afterCleanup.id});
 assert.notEqual(afterCleanup.id,afterDrop.id);
 assert.ok(rt.fetchLog.length>beforeCleanup,'cleanup removes the source from reuse');

 const afterCleanupRequests=rt.fetchLog.length;
 clock.now+=59_999;
 assert.equal((await rt.inspect(descriptor)).id,afterCleanup.id,'a read within 60 seconds reuses the original success');
 assert.equal(rt.fetchLog.length,afterCleanupRequests);
 clock.now+=1;
 const expired=await rt.inspect(descriptor);
 assert.notEqual(expired.id,afterCleanup.id,'age 60 seconds is expired from the first successful inspection');
 assert.ok(rt.fetchLog.length>afterCleanupRequests);
});

test('popup and job ownership keep a source beyond 60 seconds; the final release expires it in both layers',async()=>{
 const bytes=timedMp4(10,360,640),clock={now:Date.now()};
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}],{clock});
 const descriptor={tabId:23,documentId:'held-document',mediaKey:'held-video',referer:'https://example.test/watch',url:'https://cdn.example/held.mp4',title:'Held source'};
 const first=await rt.inspect(descriptor,undefined,{activeSourceTabs:[23]}),requests=rt.fetchLog.length;
 await rt.call({action:'acceptSource',sourceId:first.id});
 clock.now+=180_000;
 assert.equal((await rt.inspect(descriptor,undefined,{activeSourceTabs:[23]})).id,first.id);
 assert.equal(rt.fetchLog.length,requests,'a long-lived popup does not age out its successful source');
 await rt.call({action:'retain',sourceId:first.id});
 await rt.call({action:'sourceActivity',activeSourceTabs:[]});clock.now+=3_600_000;
 assert.equal((await rt.inspect(descriptor)).id,first.id,'a retained download owns its source after the popup closes');
 await rt.call({action:'forget',sourceId:first.id});clock.now+=59_999;
 assert.equal((await rt.inspect(descriptor)).id,first.id);
 clock.now++;
 const replacement=await rt.inspect(descriptor);assert.notEqual(replacement.id,first.id);
 const notification=rt.messages.find(entry=>entry.message.action==='sourcesExpired'&&entry.message.sourceIds.includes(first.id));
 assert.ok(notification,'expiry notifies the background to remove its matching metadata');
 await assert.rejects(rt.call({action:'retain',sourceId:first.id}));
});

test('source expiry removes an old YouTube capture even when another source in the same tab is retained',async()=>{
 const clock={now:Date.now()},rt=await makeRuntime([],{clock});
 const descriptor=id=>({tabId:25,documentId:'yt-retention-doc',mediaKey:id,referer:'https://www.youtube.com/watch?v='+id,title:id,platform:{site:'youtube',id,duration:10,streamingData:{serverAbrStreamingUrl:'https://rr.googlevideo.com/videoplayback?id='+id,adaptiveFormats:[{itag:1,url:'https://cdn.test/video',height:360,mimeType:'video/mp4; codecs="avc1.64001f"'},{itag:2,url:'https://cdn.test/audio',mimeType:'audio/mp4; codecs="mp4a.40.2"'}]}}});
 const one=await rt.inspect(descriptor('one')),two=await rt.inspect(descriptor('two'));
 for(const [source,id]of [[one,'one'],[two,'two']])await rt.call({action:'youtubeSourceSession',sourceId:source.id,capture:{tabId:25,documentId:'yt-retention-doc',frameId:0,streamId:id,body:'request-body-'+id,createdAt:clock.now}});
 await rt.call({action:'retain',sourceId:two.id});clock.now+=60_000;
 await rt.call({action:'sourceActivity',activeSourceTabs:[]});
 assert.equal(await rt.call({action:'youtubeSourceSession',sourceId:one.id}),null);
 assert.equal((await rt.call({action:'youtubeSourceSession',sourceId:two.id})).body,'request-body-two');
});

test('incomplete scope and inspections without downloadable choices are never reused',async()=>{
 const bytes=timedMp4(10,360,640),url='https://cdn.example/non-reusable.mp4';
 const rt=await makeRuntime([{match:()=>true,reply:(requestUrl,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const incomplete={tabId:4,documentId:'incomplete-doc',referer:'https://example.test/watch',url,title:'No media key'};
 const first=await rt.inspect(incomplete),before=rt.fetchLog.length,repeated=await rt.inspect(incomplete);
 assert.notEqual(repeated.id,first.id,'a missing mediaKey is not a reusable scope');
 assert.ok(rt.fetchLog.length>before);

 const noChoices={tabId:5,frameId:0,documentId:'no-choice-doc',mediaKey:'no-choice-key',referer:'https://www.youtube.com/watch?v=abcdefghijk',title:'Video without a downloadable audio pair',platform:{site:'youtube',id:'abcdefghijk',duration:12,streamingData:{formats:[{itag:18,url:'https://cdn.example/video-only.mp4',mimeType:'video/mp4; codecs="avc1.42001E"',height:360,approxDurationMs:12000}]}}};
 const nonDownloadable=await rt.inspect(noChoices);
 assert.equal(nonDownloadable.choices.video.auto.enabled,false);
 assert.equal(nonDownloadable.choices.audio.original.enabled,false);
 const checkedAgain=await rt.inspect(noChoices);
 assert.notEqual(checkedAgain.id,nonDownloadable.id,'a successful but non-downloadable result is not cached');
});

test('YouTube source sessions survive a new inspection but are cleared on navigation and engine cleanup',async()=>{
 const rt=await makeRuntime([]);
 const descriptor={tabId:7,frameId:0,documentId:'yt-doc',title:'YouTube repeat',referer:'https://www.youtube.com/watch?v=abcdefghijk',platform:{site:'youtube',id:'abcdefghijk',streamingData:{serverAbrStreamingUrl:'https://rr.googlevideo.com/videoplayback?id=stream-a',adaptiveFormats:[{itag:137,mimeType:'video/mp4; codecs="avc1.640028"',width:1920,height:1080},{itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"',audioQuality:'AUDIO_QUALITY_MEDIUM'}]},videoDetails:{lengthSeconds:'60'}}};
 const capture={tabId:7,frameId:0,documentId:'yt-doc',streamId:'stream-a',body:'bounded-session',createdAt:Date.now()};
 const first=await rt.inspect(descriptor);
 assert.equal((await rt.call({action:'youtubeSourceSession',sourceId:first.id,capture})).body,capture.body);
 const second=await rt.inspect(descriptor);assert.notEqual(second.id,first.id);
 assert.equal((await rt.call({action:'youtubeSourceSession',sourceId:second.id})).body,capture.body);
 const otherDocument=await rt.inspect({...descriptor,documentId:'another-document'});
 assert.equal(await rt.call({action:'youtubeSourceSession',sourceId:otherDocument.id}),null);
 await rt.call({action:'dropTabSources',tabId:7});
 const afterNavigation=await rt.inspect(descriptor);
 assert.equal(await rt.call({action:'youtubeSourceSession',sourceId:afterNavigation.id}),null);
 await rt.call({action:'youtubeSourceSession',sourceId:afterNavigation.id,capture});
 await rt.call({action:'cleanup'});
 const afterCleanup=await rt.inspect(descriptor);
 assert.equal(await rt.call({action:'youtubeSourceSession',sourceId:afterCleanup.id}),null);
});

test('Anime1 API and CDN requests use include credentials and produce a video choice',async()=>{
  const referer='https://anime1.me/12/34';
  const media='https://v.anime1.me/12/34.mp4',token=encodeURIComponent(JSON.stringify({c:'12',e:'34'}));
  const rt=await makeRuntime([
    {match:u=>u==='https://v.anime1.me/api',reply:response(JSON.stringify({s:[{src:media}]}),{type:'application/json'})},
    {match:u=>u===media,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:1000}):response(new Uint8Array([1,2,3]),{type:'video/mp4'})},
  ]);
  const result=await rt.inspect({referer,platform:{site:'anime1',apiRequest:token},title:'episode'});
  assert.equal(result.choices.video.auto.enabled,true);
  assert.ok(rt.fetchLog.filter(x=>x.url.startsWith('https://v.anime1.me/')).every(x=>x.credentials==='include'));
});

test('Bilibili playurl source failures stay classified instead of becoming empty generic media',async()=>{
 const rt=await makeRuntime([]);
 await assert.rejects(rt.inspect({referer:'https://www.bilibili.com/video/BVfailure01/',title:'bili',platform:{site:'bilibili',bvid:'BVfailure01',cid:18,page:1,sourceFailure:{code:'HTTP_AUTH',message:'Bilibili 播放來源拒絕請求',sourceStage:'bilibili-playurl',httpStatus:403}}}),error=>error.code==='HTTP_AUTH'&&error.sourceStage==='bilibili-playurl'&&error.httpStatus===403);
});

test('HEAD failure followed by bounded GET can still inspect a source',async()=>{
  const url='https://cdn.example/video.mp4',rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{status:405}):response(new Uint8Array([0,1,2]),{type:'video/mp4'})}]);
  const result=await rt.inspect({url,referer:'https://example.test/watch',title:'x'});
  assert.equal(result.choices.video.auto.enabled,true);assert.ok(rt.fetchLog.some(x=>x.options.headers.Range==='bytes=0-131071'));
});

test('request header timeout is bounded, while redirected response URL is retained',async()=>{
 const url='https://cdn.example/master.m3u8',finalUrl='https://cdn.example/final/master.m3u8',child='https://cdn.example/final/video.m3u8';
 const manifest='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=320x180\nvideo.m3u8\n';
 const media='#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n';
 const rt=await makeRuntime([
  {match:u=>u===url,reply:response(manifest,{type:'application/vnd.apple.mpegurl',url:finalUrl})},
  {match:u=>u===child,reply:response(media,{type:'application/vnd.apple.mpegurl',url:child})},
  {match:u=>u.endsWith('/seg.ts'),reply:response(new Uint8Array([0x47,0,0]),{type:'video/mp2t'})},
 ],{requestTimeoutMs:5});
 const result=await rt.inspect({url,referer:'https://example.test/watch',title:'hls'});
 assert.equal(result.platform,'hls');
 assert.ok(rt.fetchLog.some(entry=>entry.url===child),'relative child URL should resolve from response.url');

 const stalled=await makeRuntime([{match:u=>u===url,reply:(u,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))}],{requestTimeoutMs:5});
 await assert.rejects(stalled.inspect({url,referer:'https://example.test/watch',title:'stalled'}),error=>error.code==='NETWORK_TIMEOUT');
});

test('an exact feed permalink provides missing FB metadata before the normal media pipeline',async()=>{
 const referer='https://www.facebook.com/kfctaiwan/',link={url:'https://www.facebook.com/reel/123/',id:'123'},media='https://video.xx.fbcdn.net/clip.mp4';
 const scripts=[JSON.stringify({require:[{data:{video:{id:'123',length_in_second:14.06,videoDeliveryLegacyFields:{id:'123',browser_native_sd_url:media}}}}]})];
 const rt=await makeRuntime([
  {match:u=>u===link.url,reply:(u,o)=>{assert.equal(o.method,'GET');assert.equal(o.credentials,'include');return response('<html/>',{type:'text/html'});}},
  {match:u=>u===media,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:1000}):response(timedMp4(14.06),{type:'video/mp4'})},
 ],{parseDocument:()=>({querySelectorAll:()=>scripts.map(textContent=>({textContent}))})});
 const result=await rt.inspect({referer,linkedMedia:link,title:'Selected post',tabId:7,documentId:'fb-doc'});
 assert.equal(result.choices.video.auto.enabled,true);
 assert.equal(rt.fetchLog.filter(r=>r.url===link.url).length,1);
});

test('a complete silent social MP4 remains downloadable without inventing an audio track',async()=>{
 const url='https://video.xx.fbcdn.net/silent.mp4',bytes=silentMp4();
 const rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const result=await rt.inspect({referer:'https://www.facebook.com/feed',title:'Silent',platform:{site:'embedded',id:'silent',versions:[{url}]}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,false);
});

test('X broadcast card resolves its verified replay page before unrelated ambient manifests',async()=>{
 const referer='https://x.com/user/status/1234567890',bid='broadcast-123',broadcast='https://x.com/i/broadcasts/'+bid,manifest='https://video.example/replay.m3u8';
 const fields={broadcast_id:bid,broadcast_url:broadcast,broadcast_media_key:'28_123456789'};
 const card={rest_id:'1234567890',card:{legacy:{binding_values:Object.entries(fields).map(([key,string_value])=>({key,value:{string_value}}))}}};
 const script='stream({kind:"Result.Ok",value:'+JSON.stringify(JSON.stringify({data:{tweet_result:{result:card}}}))+'});';
 const meta={'twitter:text:broadcast_id':bid,'twitter:text:broadcast_media_key':'28_123456789','twitter:text:broadcast_title':'Selected replay','og:video:url':manifest};
 const parseDocument=html=>({querySelectorAll:selector=>selector.startsWith('script')?(html==='post'?[{textContent:script}]:[]):Object.entries(meta).filter(([name])=>selector.includes('"'+name+'"')).map(([,content])=>({getAttribute:()=>content}))});
 const rt=await makeRuntime([
  {match:u=>u===referer,reply:()=>response('post',{type:'text/html',url:referer})},
  {match:u=>u===broadcast,reply:()=>response('broadcast',{type:'text/html',url:broadcast})},
  {match:u=>u===manifest,reply:()=>response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.42E01E,mp4a.40.2"\n720.m3u8\n')},
  {match:u=>u==='https://video.example/720.m3u8',reply:()=>response('#EXTM3U\n#EXTINF:12,\nmain.ts\n#EXT-X-ENDLIST\n')},
 ],{parseDocument});
 const result=await rt.inspect({referer,linkedMedia:{url:referer,id:'1234567890'},platform:{site:'network-media',expectedDuration:12,versions:[{url:'https://unrelated.example/ad.m3u8',kind:'hls'}]}});
 assert.equal(result.title,'Selected replay');assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.video.auto.heights[0],720);
 assert.ok(rt.fetchLog.every(item=>!item.url.includes('unrelated.example')));
});

test('X ambient source still works when public permalink metadata is unavailable',async()=>{
 const referer='https://x.com/user/status/1234567890',media='https://video.example/main.mp4',bytes=timedMp4(12);
 const rt=await makeRuntime([
  {match:u=>u===referer,reply:()=>response('empty',{url:referer,type:'text/html'})},
  {match:u=>u===media,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}
 ],{parseDocument:()=>({querySelectorAll:()=>[]})});
 const result=await rt.inspect({referer,linkedMedia:{url:referer,id:'1234567890'},platform:{site:'network-media',expectedDuration:12,versions:[{url:media,kind:'progressive'}]}});
 assert.equal(result.choices.video.auto.enabled,true);
});

test('a complete DASH manifest explicitly declaring video-only adaptations allows silent download',async()=>{
 const init='https://video.xx.fbcdn.net/init.mp4',xml='<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.42E01E"><Representation id="v" bandwidth="100000" width="320" height="180"><SegmentTemplate timescale="1" duration="10" initialization="init.mp4" media="$Number$.m4s" startNumber="1"/></Representation></AdaptationSet></Period></MPD>';
 const rt=await makeRuntime([{match:u=>u===init,reply:response(silentMp4(),{type:'video/mp4'})}]);
 const result=await rt.inspect({referer:'https://video.xx.fbcdn.net/master.mpd',title:'Silent',platform:{site:'embedded',id:'silent',manifestXml:xml}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,false);
});

test('Brightcove video-only HLS uses the complete init track table to keep silent video downloadable',async()=>{
 const master='https://manifest.example/master.m3u8',child='https://manifest.example/720.m3u8',init='https://manifest.example/init.m4f';
 const playlist='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3834600,RESOLUTION=1280x720,CODECS="avc1.64001f"\n720.m3u8\n';
 const media='#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:10\n#EXT-X-MAP:URI="init.m4f"\n#EXTINF:10,\nsegment0.m4f\n#EXTINF:3.8,\nsegment1.m4f\n#EXT-X-ENDLIST\n';
 const rt=await makeRuntime([
  {match:u=>u===master,reply:response(playlist)},
  {match:u=>u===child,reply:response(media)},
  {match:u=>u===init,reply:response(silentMp4(),{type:'video/mp4'})},
 ]);
 const result=await rt.inspect({referer:'https://players.brightcove.net/account/player/index.html',title:'Living Desert Giraffe',platform:{site:'embedded',manifestUrl:master,manifestType:'hls'}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,false);
 assert.deepEqual([...result.choices.video.auto.heights],[720]);assert.equal(result.duration,13.8);
 assert.equal(rt.fetchLog.filter(item=>item.url===init).length,1,'reuse the existing bounded header probe');
 assert.equal(rt.fetchLog.some(item=>/segment\d/.test(item.url)),false,'inspection must not download media segments');
});

test('HLS missing audio metadata, incomplete init, unknown audio tracks and broken audio groups do not prove silence',async()=>{
 const full=silentMp4(),unknownAudio=full.slice();
 const handlerAt=Buffer.from(unknownAudio).indexOf('vide');unknownAudio.set(new TextEncoder().encode('soun'),handlerAt);
 for(const [name,bytes,group] of [['incomplete',full.subarray(0,full.length-1),''],['unknown-audio',unknownAudio,''],['codecs-only',new TextEncoder().encode('avc1'), ''],['missing-audio-rendition',full,',AUDIO="missing"']]){
  const rt=await makeRuntime([
   {match:u=>u==='https://cdn.test/master.m3u8',reply:response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360,CODECS="avc1.42E01E"${group}\nvideo.m3u8\n`)},
   {match:u=>u==='https://cdn.test/video.m3u8',reply:response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\nseg.m4s\n#EXT-X-ENDLIST\n')},
   {match:u=>u==='https://cdn.test/init.mp4',reply:response(bytes,{type:'video/mp4'})},
  ]);
  const result=await rt.inspect({url:'https://cdn.test/master.m3u8',referer:'https://player.test/watch',title:name});
  assert.equal(result.choices.video.auto.enabled,false,name);assert.equal(result.choices.audio.original.enabled,false,name);
 }
});

test('platform sources preserve Bilibili DASH and durl dimensions',()=>{
 const source=platformSource({site:'bilibili',title:'bili',duration:12,width:640,height:360,data:{dash:{video:[{baseUrl:'https://cdn.example/dash.mp4',width:1280,height:720,codecs:'avc1'}],audio:[{baseUrl:'https://cdn.example/audio.mp4',codecs:'mp4a'}]},durl:[{url:'https://cdn.example/durl.mp4'}]}});
 assert.deepEqual(source.formats.filter(f=>f.kind==='video').map(({url,width,height})=>({url,width,height})),[
  {url:'https://cdn.example/dash.mp4',width:1280,height:720},
  {url:'https://cdn.example/durl.mp4',width:640,height:360},
 ]);
 assert.equal(source.formats.find(f=>f.kind==='audio').width,0);
});

test('Twitch playback lookup runs in offscreen and renews the manifest for the selected VOD',async()=>{
 const referer='https://www.twitch.tv/videos/2891894094',child='https://cdn.example/vod/index.m3u8';
 const rt=await makeRuntime([
  {match:u=>u==='https://gql.twitch.tv/gql',reply:(u,o)=>{assert.equal(JSON.parse(o.body).variables.vodID,'2891894094');return response(JSON.stringify({data:{videoPlaybackAccessToken:{value:'new-token',signature:'sig'}}}),{type:'application/json'});}},
  {match:u=>u.startsWith('https://usher.ttvnw.net/vod/2891894094.m3u8?'),reply:(u)=>{assert.equal(new URL(u).searchParams.get('token'),'new-token');return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n'+child+'\n');}},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n')}
 ]);
 const result=await rt.inspect({url:'https://old.example/stale.m3u8',referer,platform:{site:'twitch',id:'2891894094',manifest:'old'}});
 assert.equal(result.choices.video.auto.enabled,true);assert.deepEqual([...result.choices.video.auto.heights],[360]);
 assert.equal(rt.fetchLog.some(r=>r.url.includes('old.example')),false);
});

test('Twitch Clips resolve initial metadata into verified signed MP4 choices',async()=>{
 const file='https://cdn.example/clip.mp4',bytes=timedMp4(4,1080);
 const rt=await makeRuntime([
  {match:u=>u==='https://gql.twitch.tv/gql',reply:(u,o)=>{assert.equal(JSON.parse(o.body).variables.slug,'SelectedSlug');return response(JSON.stringify({data:{clip:{slug:'SelectedSlug',title:'Actual clip',durationSeconds:4,playbackAccessToken:{signature:'sig',value:'token'},assets:[{videoQualities:[{quality:'1080',sourceURL:file}]}]}}}),{type:'application/json'});}},
  {match:u=>u.startsWith(file),reply:(u,o)=>{assert.equal(new URL(u).searchParams.get('sig'),'sig');return o.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'});}}
 ]);
 const result=await rt.inspect({referer:'https://www.twitch.tv/channel/clip/SelectedSlug',platform:{site:'twitch-clip',kind:'clip',slug:'SelectedSlug',qualities:[]}});
 assert.equal(result.title,'Actual clip');assert.equal(result.choices.video.auto.enabled,true);assert.deepEqual([...result.choices.video.auto.heights],[1080]);
});

test('a channel page trailer resolves the owned VOD ID without a /videos/ page URL',async()=>{
 const master='https://usher.ttvnw.net/vod/123456.m3u8',child='https://cdn.example/trailer.m3u8';
 const rt=await makeRuntime([
  {match:u=>u==='https://gql.twitch.tv/gql',reply:(u,o)=>{assert.equal(JSON.parse(o.body).variables.vodID,'123456');return response(JSON.stringify({data:{videoPlaybackAccessToken:{value:'new-token',signature:'sig'}}}),{type:'application/json'});}},
  {match:u=>u.startsWith(master),reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n'+child+'\n')},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXTINF:58,\n0.ts\n#EXT-X-ENDLIST\n')}
 ]);
 const result=await rt.inspect({referer:'https://www.twitch.tv/twitch/clips?range=7d',platform:{site:'twitch',id:'123456',title:'Trailer'}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.duration,58);
});

test('Dailymotion metadata resolves to HLS capabilities and preserves HTTP refusal diagnostics',async()=>{
 const metadata='https://www.dailymotion.com/player/metadata/video/x9qh9tw?app=com.dailymotion.neon',master='https://vod.dmcdn.net/main.m3u8',child='https://vod.dmcdn.net/360.m3u8';
 const descriptor={referer:'https://geo.dailymotion.com/player/xtv3w.html?',title:'Playlist',platform:{site:'dailymotion',id:'x9qh9tw'}};
 const rt=await makeRuntime([
  {match:u=>u===metadata,reply:response(JSON.stringify({id:'x9qh9tw',title:'Episode',duration:30,qualities:{auto:[{type:'application/x-mpegURL',url:master}]}}),{type:'application/json'})},
  {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n360.m3u8\n')},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXTINF:30,\nmain.ts\n#EXT-X-ENDLIST\n')},
 ]);
 const result=await rt.inspect(descriptor);assert.equal(result.title,'Episode');assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
 const blocked=await makeRuntime([
  {match:u=>u===metadata,reply:response(JSON.stringify({id:'x9qh9tw',qualities:{auto:[{type:'application/x-mpegURL',url:master}]}}),{type:'application/json'})},
  {match:u=>u===master,reply:response('',{status:403})},
 ]);
 await assert.rejects(blocked.inspect(descriptor),error=>error.code==='HTTP_AUTH'&&error.httpStatus===403);
 const deniedMetadata=await makeRuntime([{match:u=>u===metadata,reply:response('',{status:403})}]);
 await assert.rejects(deniedMetadata.inspect(descriptor),error=>error.code==='HTTP_AUTH'&&error.httpStatus===403);
 const bridge=await makeRuntime([
  {match:u=>u===metadata,reply:response(JSON.stringify({id:'x9qh9tw',qualities:{auto:[{type:'application/x-mpegURL',url:master}]}}),{type:'application/json'})},
  {match:u=>u===master,reply:response('',{status:403})},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXTINF:30,\nmain.ts\n#EXT-X-ENDLIST\n')},
 ],{pageReply:async message=>{
  assert.equal(message.context.documentId,'dm-frame');assert.equal(message.context.referer,descriptor.referer);
  if(message.operation==='open')return {status:200,headers:{'content-type':'application/x-mpegURL'},handle:'h',done:false};
  if(message.operation==='read')return {done:true,data:[...new TextEncoder().encode('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n360.m3u8\n')]};
  return {done:true};
 }});
 const recovered=await bridge.inspect({...descriptor,tabId:7,documentId:'dm-frame'});
 assert.equal(recovered.choices.video.auto.enabled,true);assert.ok(bridge.messages.some(m=>m.message.action==='socialPageFetch'));
 assert.equal(mediaCredentials(master,descriptor.referer),'include');assert.equal(mediaCredentials('https://evil.example/a.mp4',descriptor.referer),'omit');
});

test('Dailymotion first uses the actual main-player manifest without a second metadata request',async()=>{
 const manifest='https://vod.dmcdn.net/active.m3u8';
 const rt=await makeRuntime([{match:u=>u===manifest,reply:response('#EXTM3U\n#EXTINF:30,\nmain.ts\n#EXT-X-ENDLIST\n')}]);
 const result=await rt.inspect({referer:'https://geo.dailymotion.com/player/xtv3w.html?',platform:{site:'dailymotion',id:'x9qh9tw',observedSource:{url:manifest,type:'hls'}}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(rt.fetchLog.some(item=>item.url.includes('/player/metadata/')),false);
});

test('Dailymotion refreshes metadata once when its observed manifest is expired',async()=>{
 const stale='https://vod.dmcdn.net/expired.m3u8',fresh='https://vod.dmcdn.net/fresh.m3u8',metadata='https://www.dailymotion.com/player/metadata/video/x9qh9tw?app=com.dailymotion.neon';
 const rt=await makeRuntime([
  {match:u=>u===stale,reply:response('',{status:403})},
  {match:u=>u===metadata,reply:response(JSON.stringify({id:'x9qh9tw',qualities:{auto:[{type:'application/x-mpegURL',url:fresh}]}}),{type:'application/json'})},
  {match:u=>u===fresh,reply:response('#EXTM3U\n#EXTINF:30,\nmain.ts\n#EXT-X-ENDLIST\n')},
 ]);
 const result=await rt.inspect({referer:'https://geo.dailymotion.com/player/xtv3w.html?',platform:{site:'dailymotion',id:'x9qh9tw',observedSource:{url:stale,type:'hls'}}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(rt.fetchLog.filter(item=>item.url===metadata).length,1);
 const denied=await makeRuntime([{match:()=>true,reply:response('',{status:403})}]);
 await assert.rejects(denied.inspect({referer:'https://geo.dailymotion.com/player/xtv3w.html?',platform:{site:'dailymotion',id:'x9qh9tw'}}),error=>error.code==='HTTP_AUTH'&&error.sourceStage==='dailymotion-metadata');
});

test('a refused embedded manifest does not hide an independently working progressive backup',async()=>{
 const bad='https://cdn.example/refused.m3u8',good='https://cdn.example/backup.mp4',bytes=timedMp4(12);
 const rt=await makeRuntime([
  {match:u=>u===bad,reply:response('',{status:403})},
  {match:u=>u===good,reply:(u,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})},
 ]);
 const result=await rt.inspect({referer:'https://example.test',platform:{site:'embedded',manifestUrl:bad,versions:[{url:good}]}});
 assert.equal(result.choices.video.auto.enabled,true);
});

test('mediaDefinitions metadata reaches usable HLS choices and retains HTTP refusal as a separate failure',async()=>{
 const master='https://cdn.example.test/lecture/720/master.m3u8',child='https://cdn.example.test/lecture/720/stream.m3u8';
 const [model]=extractMediaModels({video_id:123,video_duration:189,video_title:'Lecture',mediaDefinitions:[
  {format:'hls',height:720,videoUrl:master},
  {format:'mp4',remote:true,videoUrl:'https://player.example.test/video/get_media'},
 ]});
 const descriptor={referer:'https://player.example.test/watch',platform:{...model,site:'embedded'}};
 const rt=await makeRuntime([
  {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.42E01E,mp4a.40.2"\nstream.m3u8\n')},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:189\n#EXTINF:189,\nmedia.ts\n#EXT-X-ENDLIST\n')},
 ]);
 const result=await rt.inspect(descriptor);
 assert.equal(result.choices.video.auto.enabled,true);assert.ok(result.choices.video.auto.heights.includes(720));
 assert.equal(result.duration,189);assert.equal(rt.fetchLog.some(item=>item.url.includes('/get_media')),false);
 const refused=await makeRuntime([{match:()=>true,reply:response('',{status:403})}]);
 await assert.rejects(refused.inspect(descriptor),error=>error.code==='HTTP_AUTH'&&error.httpStatus===403);
});

test('GET 403 is reported as HTTP_AUTH rather than unknown MP4',async()=>{
  const url='https://cdn.example/private.mp4',rt=await makeRuntime([{match:u=>u===url,reply:response('',{status:403,type:'video/mp4'})}]);
  const reply=await rt.inspect({url,referer:'https://example.test/watch'}).then(result=>({ok:true,result}),error=>({ok:false,error}));
  assert.equal(reply.ok,false);assert.equal(classifyFailure(reply.error,'inspect').code,'HTTP_AUTH');
});

test('TikTok probes use scoped browser credentials and report the rejected request host',async()=>{
 const referer='https://www.tiktok.com/@creator/video/tt-1',url='https://v16m.tiktokcdn.com/video/a.mp4';
 const rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:1000}):response('',{status:403,type:'video/mp4'})}]);
 const result=await rt.inspect({url,referer,title:'sample'}).then(value=>({ok:true,value}),error=>({ok:false,error}));
 assert.equal(result.ok,false);
 assert.equal(classifyFailure(result.error,'inspect').code,'HTTP_AUTH');
 assert.equal(result.error.requestMethod,'GET RANGE');
 assert.equal(result.error.requestHost,'v16m.tiktokcdn.com');
 assert.ok(rt.fetchLog.every(item=>item.credentials==='include'));
});

test('FB unbound fallback verifies actual movie duration and rejects an advertisement',async()=>{
 const rt=await makeRuntime([{match:()=>true,reply:(url,o)=>{const bytes=timedMp4(url.includes('ad.mp4')?5:26.25);return o.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'});}}]);
 const result=await rt.inspect({referer:'https://www.facebook.com/reel/123',platform:{site:'social-network',expectedDuration:26.25,versions:[{url:'https://cdn.example/ad.mp4',kind:'progressive'},{url:'https://cdn.example/main.mp4',kind:'progressive'}]}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.duration,26.25);
 const ambiguous=await makeRuntime([{match:()=>true,reply:(url,o)=>{const bytes=timedMp4(26.25);return o.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'});}}]);
 await assert.rejects(ambiguous.inspect({referer:'https://www.facebook.com/reel/123',platform:{site:'social-network',expectedDuration:26.25,versions:[{url:'https://cdn.example/a.mp4'},{url:'https://cdn.example/b.mp4'}]}}),{code:'SOURCE_UNAVAILABLE'});
});

test('FB init-only MP4 fixture is rejected when MediaBunny finds no first video packet',async()=>{
 const url='https://video.xx.fbcdn.net/init-only.mp4';
 const fixturePath=new URL('./fixtures/fb-init-only-895.mp4',import.meta.url);
 const bytes=new Uint8Array(await fs.readFile(fixturePath));
 assert.equal(bytes.byteLength,895);
 const rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}],{mediabunny:{firstPacket:false}});
 await assert.rejects(rt.inspect({referer:'https://www.facebook.com/kfctaiwan/',platform:{site:'social-network',expectedDuration:14.066667,versions:[{url,kind:'progressive'}]}}));
});

test('direct MP4 without Content-Length remains inspectable without network-candidate packet probing',async()=>{
 const url='https://cdn.example/direct-unknown-size.mp4',bytes=timedMp4(12),base=response(bytes,{type:'video/mp4'});
 base.headers={get:key=>String(key).toLowerCase()==='content-type'?'video/mp4':null};
 const rt=await makeRuntime([{match:u=>u===url,reply:base}],{mediabunny:{firstPacket:false}});
 const result=await rt.inspect({url,referer:'https://example.test/watch',title:'direct'});
 assert.equal(result.choices.video.auto.enabled,true);
});

test('unknown single-player network candidates verify real duration without a platform adapter',async()=>{
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>{
  const bytes=timedMp4(url.includes('advert')?5:26.25);
  return options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'});
 }}]);
 const result=await rt.inspect({referer:'https://unknown.example/watch',platform:{site:'network-media',expectedDuration:26.25,versions:[{url:'https://cdn.example/advert.mp4',kind:'progressive'},{url:'https://cdn.example/actual.mp4',kind:'progressive'}]}});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.duration,26.25);
 assert.ok(rt.fetchLog.every(entry=>entry.credentials==='omit'),'generic capture never widens the existing cookie policy');
});

test('document metadata requires real media duration and rejects a same-duration ambiguity',async()=>{
 const video='https://cdn.example.test/video.mp4',ad='https://cdn.example.test/ad.mp4';
 const descriptor={referer:'https://private.example.test/lesson',duration:60,platform:{site:'metadata-media',binding:'metadata-unbound',expectedDuration:60,versions:[{url:video,kind:'progressive'},{url:ad,kind:'progressive'}]}};
 const runtime=durationFor=>makeRuntime([{match:()=>true,reply:(url,options)=>{
  const bytes=timedMp4(durationFor(url));return options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'});
 }}]);
 const correct=await runtime(url=>url===video?60:5),result=await correct.inspect(descriptor);
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.duration,60);
 const wrong=await runtime(()=>5);await assert.rejects(wrong.inspect(descriptor),{code:'SOURCE_UNAVAILABLE'});
 const ambiguous=await runtime(()=>60);await assert.rejects(ambiguous.inspect(descriptor),{code:'SOURCE_UNAVAILABLE'});
});

test('document metadata HTML responses and HTTP refusals never turn into available download choices',async()=>{
 const descriptor={referer:'https://private.example.test/lesson',platform:{site:'metadata-media',expectedDuration:60,versions:[{url:'https://cdn.example.test/not-video.mp4',kind:'progressive'}]}};
 const html=await makeRuntime([{match:()=>true,reply:response('<!doctype html><title>Not found</title>',{type:'text/html'})}]);
 await assert.rejects(html.inspect(descriptor),{code:'SOURCE_UNAVAILABLE'});
 const denied=await makeRuntime([{match:()=>true,reply:response('',{status:403})}]);
 await assert.rejects(denied.inspect(descriptor),{code:'HTTP_AUTH',httpStatus:403});
});

test('an expired embedded source automatically falls back to one verified observed source',async()=>{
 const old='https://cdn.example/expired.mp4',fresh='https://cdn.example/fresh.mp4',bytes=timedMp4(26.25);
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>url===old?response('',{status:403}):options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const result=await rt.inspect({referer:'https://unknown.example/watch',platform:{site:'embedded',versions:[{url:old}],networkFallback:{expectedDuration:26.25,versions:[{url:fresh,kind:'progressive'}]}}});
 assert.equal(result.choices.video.auto.enabled,true);assert.ok(rt.fetchLog.some(entry=>entry.url===old));assert.ok(rt.fetchLog.some(entry=>entry.url===fresh));
});

test('a working embedded source keeps the fast route and never probes its network fallback',async()=>{
 const main='https://cdn.example/main.mp4',fallback='https://cdn.example/unused.mp4',bytes=timedMp4(26.25);
 const rt=await makeRuntime([{match:url=>url===main,reply:(_,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const result=await rt.inspect({referer:'https://unknown.example/watch',platform:{site:'embedded',versions:[{url:main}],networkFallback:{expectedDuration:26.25,versions:[{url:fallback,kind:'progressive'}]}}});
 assert.equal(result.choices.video.auto.enabled,true);assert.ok(rt.fetchLog.every(entry=>entry.url===main));
});

test('TikTok HTTP refusal can use its exact browser document for bounded page reads',async()=>{
 const bytes=timedMp4(12),handles=new Map();let next=0;
 const rt=await makeRuntime([{match:()=>true,reply:response('',{status:403,type:'video/mp4'})}],{pageReply:async m=>{
  assert.equal(m.context.tabId,7);assert.equal(m.context.documentId,'tt-doc');
  if(m.operation==='open'){
   if(m.options.method==='HEAD')return {status:200,headers:{'content-type':'video/mp4','content-length':String(bytes.length)},done:true};
   assert.match(m.options.range,/^bytes=0-/);const handle=String(++next);handles.set(handle,bytes);
   return {status:200,headers:{'content-type':'video/mp4','content-length':String(bytes.length)},handle,done:false};
  }
  if(m.operation==='read'){const data=handles.get(m.options.handle);handles.delete(m.options.handle);return {data:[...data],done:true};}
  handles.delete(m.options.handle);return {done:true};
 }});
 const result=await rt.inspect({tabId:7,documentId:'tt-doc',url:'https://v19-webapp-prime.tiktok.com/video/tos/clip/',referer:'https://www.tiktok.com/zh-Hant-TW/'});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.duration,12);
 assert.ok(rt.messages.some(m=>m.message.action==='socialPageFetch'&&m.message.operation==='read'));
 const other=await makeRuntime([{match:()=>true,reply:response('',{status:403})}]);
 await assert.rejects(other.inspect({tabId:7,documentId:'doc',url:'https://cdn.example/a.mp4',referer:'https://example.com/'}),{code:'HTTP_AUTH'});
 assert.equal(other.messages.some(m=>m.message.action==='socialPageFetch'),false);
});

test('cancelling an inspection aborts its pending request and stops fallback probes',async()=>{
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})}]);
 const pending=rt.inspect({referer:'https://social.example/feed',platform:{site:'embedded',versions:[{url:'https://cdn.example/first.mp4'},{url:'https://cdn.example/second.mp4'}]}},'inspection-a').then(value=>({value}),error=>({error}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(rt.fetchLog.length,1);
 await rt.cancel('inspection-a');assert.equal((await pending).error.code,'CANCELLED');
 assert.equal(rt.fetchLog.length,1);
 await rt.cancel('cancel-before-start');
 await assert.rejects(rt.inspect({url:'https://cdn.example/a.mp4'},'cancel-before-start'),{code:'CANCELLED'});
});

test('the total inspection deadline ends a stalled candidate instead of probing every URL',async()=>{
 const keepAlive=setTimeout(()=>{},1000);
 try{
  const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});})}],{inspectionTimeoutMs:20});
  await assert.rejects(rt.inspect({referer:'https://social.example/feed',platform:{site:'embedded',versions:[{url:'https://cdn.example/first.mp4'},{url:'https://cdn.example/second.mp4'}]}}),{code:'NETWORK_TIMEOUT'});
  assert.equal(rt.fetchLog.length,1);
 }finally{clearTimeout(keepAlive);}
});

test('same-quality backup URLs stop after success while distinct declared qualities remain available',async()=>{
 const bytes=largeMp4().subarray(200000);
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const result=await rt.inspect({referer:'https://social.example/feed',duration:12,platform:{site:'embedded',versions:[{url:'https://cdn.example/360.mp4',width:640,height:360},{url:'https://backup.example/360.mp4',width:640,height:360},{url:'https://cdn.example/720.mp4',width:1280,height:720}]}});
 assert.deepEqual([...result.choices.video.auto.heights],[720,360]);
 assert.equal(rt.fetchLog.some(call=>call.url.includes('backup.example')),false);
 await rt.inspect({referer:'https://social.example/feed',duration:12,platform:{site:'embedded',versions:[{url:'https://cdn.example/unknown-a.mp4'},{url:'https://cdn.example/unknown-b.mp4'}]}});
 assert.ok(rt.fetchLog.some(call=>call.url.endsWith('/unknown-a.mp4'))&&rt.fetchLog.some(call=>call.url.endsWith('/unknown-b.mp4')),'unknown dimensions are not assumed to be the same quality');
});

test('a later quality timing out preserves an already verified downloadable source',async()=>{
 const keepAlive=setTimeout(()=>{},1000),bytes=largeMp4().subarray(200000);
 try{
  const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>url.includes('slow.mp4')?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})):options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}],{inspectionTimeoutMs:25});
  const result=await rt.inspect({referer:'https://social.example/feed',duration:12,platform:{site:'embedded',versions:[{url:'https://cdn.example/360.mp4',height:360},{url:'https://cdn.example/slow.mp4',height:1080}]}});
  assert.equal(result.choices.video.auto.enabled,true);assert.deepEqual([...result.choices.video.auto.heights],[360]);
 }finally{clearTimeout(keepAlive);}
});

test('bounded embedded probes still discover 1080p after many 360p backup URLs',async()=>{
 const versions=[...Array.from({length:8},(_,i)=>({url:`https://cdn.test/360-${i}.mp4`,height:360})),{url:'https://cdn.test/1080.mp4',height:1080}];
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>{const bytes=timedMp4(12,url.includes('1080')?1080:360);return options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'});}}]);
 const result=await rt.inspect({referer:'https://player.test/watch',platform:{site:'embedded',versions}});
 assert.deepEqual([...result.choices.video.auto.heights],[1080,360]);
 assert.equal(new Set(rt.fetchLog.map(call=>call.url)).size,2);
});

test('a known 1080p file is considered even when a lower-quality manifest already works',async()=>{
 const manifest='https://cdn.test/360.m3u8',file='https://cdn.test/1080.mp4',bytes=timedMp4(12,1080);
 const rt=await makeRuntime([
  {match:url=>url===manifest,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:12\n#EXTINF:12,\nsegment.ts\n#EXT-X-ENDLIST\n')},
  {match:url=>url===file,reply:(url,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})},
 ]);
 const result=await rt.inspect({referer:'https://player.test/watch',platform:{site:'embedded',manifestUrl:manifest,versions:[{url:file,height:1080}]}});
 assert.ok(result.choices.video.auto.heights.includes(1080));
});

test('expired model manifests can use the same player live manifest as a fallback',async()=>{
 const master='https://cdn.test/master.m3u8',current='https://cdn.test/360.m3u8';
 const rt=await makeRuntime([
  {match:url=>url===master,reply:response('',{status:403})},
  {match:url=>url===current,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:12\n#EXTINF:12,\nsegment.ts\n#EXT-X-ENDLIST\n')},
 ]);
 const result=await rt.inspect({referer:'https://player.test/watch',platform:{site:'embedded',manifestUrl:master,playbackManifest:{url:current,type:'hls'}}});
 assert.equal(result.choices.video.auto.enabled,true);
 assert.deepEqual(rt.fetchLog.map(call=>call.url),[master,current]);
});

test('a full master keeps 1080p available while the player is using its 360p rendition',async()=>{
 const master='https://cdn.test/master.m3u8',child='#EXTM3U\n#EXT-X-TARGETDURATION:12\n#EXTINF:12,\nsegment.ts\n#EXT-X-ENDLIST\n';
 const rt=await makeRuntime([
  {match:url=>url===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.42E01E,mp4a.40.2"\n1080.m3u8\n')},
  {match:url=>/\/(360|1080)\.m3u8$/.test(url),reply:response(child)},
 ]);
 const result=await rt.inspect({referer:'https://player.test/watch',platform:{site:'embedded',manifestUrl:master,playbackManifest:{url:'https://cdn.test/360.m3u8',type:'hls'}}});
 assert.deepEqual([...result.choices.video.auto.heights],[1080,360]);assert.equal(rt.fetchLog[0].url,master);
});

test('MP4 sample-entry height overrides both understated and overstated quality labels',async()=>{
 for(const [actual,declared] of [[1080,360],[360,1080]]){
  const url='https://cdn.test/quality.mp4',bytes=timedMp4(12,actual);
  const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
  const result=await rt.inspect({referer:'https://player.test/watch',platform:{site:'embedded',versions:[{url,height:declared}]}});
  assert.deepEqual([...result.choices.video.auto.heights],[actual]);
 }
});

test('portrait MP4 dimensions and DASH resolution both expose the short-edge quality',async()=>{
 const url='https://cdn.test/portrait.mp4',bytes=timedMp4(12,1920,1080);
 const rt=await makeRuntime([{match:()=>true,reply:(url,options)=>options.method==='HEAD'?response('',{type:'video/mp4',length:bytes.length}):response(bytes,{type:'video/mp4'})}]);
 const mp4=await rt.inspect({referer:'https://player.test/watch',platform:{site:'embedded',versions:[{url,width:720,height:1280}]}}).catch(error=>{error.message='portrait MP4: '+error.message;throw error;});
 assert.deepEqual([...mp4.choices.video.auto.heights],[1080]);
 const xml='<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT12S"><Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.42E01E"><Representation id="v" bandwidth="100000" width="720" height="1280"><SegmentTemplate timescale="1" duration="12" initialization="init.mp4" media="$Number$.m4s" startNumber="1"/></Representation></AdaptationSet></Period></MPD>';
 const dash=await makeRuntime([{match:u=>u.endsWith('/init.mp4'),reply:response(silentMp4(),{type:'video/mp4'})}]),result=await dash.inspect({referer:'https://player.test/watch',platform:{site:'embedded',manifestXml:xml}}).catch(error=>{error.message='portrait DASH: '+error.message;throw error;});
 assert.deepEqual([...result.choices.video.auto.heights],[720]);
});

test('HLS single audio rendition permits a whole-variant size without double-counting audio',async()=>{
 const base='https://cdn.test/bound/',master=base+'master.m3u8';
 const rt=await makeRuntime([
  {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="a.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=900000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720,AUDIO="audio"\nv.m3u8\n')},
  {match:u=>u.endsWith('.m3u8'),reply:response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\n1.m4s\n#EXT-X-ENDLIST\n')},
  {match:u=>u.endsWith('init.mp4'),reply:response(silentMp4())},
 ]);
 const result=await rt.inspect({url:master,referer:'https://example.test/watch'});
 assert.equal(result.choices.video.auto.enabled,true);
 assert.equal(result.choices.video.auto.sizes[720].bytes,1_125_000);
 assert.equal(result.choices.audio.original.sizes.best,null);
});

test('HLS 2ch/6ch group average stays unknown for the selected audio combination',async()=>{
 const base='https://cdn.test/angel/',master=base+'master.m3u8';
 const rt=await makeRuntime([
  {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,CHANNELS="2",URI="a2.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Surround",CHANNELS="6",URI="a6.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=827972,AVERAGE-BANDWIDTH=482170,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=192x144,AUDIO="audio"\nv.m3u8\n')},
  {match:u=>u.endsWith('.m3u8'),reply:response('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:60,\n1.m4s\n#EXT-X-ENDLIST\n')},
  {match:u=>u.endsWith('init.mp4'),reply:response(silentMp4())},
 ]);
 const result=await rt.inspect({url:master,referer:'https://example.test/watch'});
 assert.equal(result.choices.video.auto.enabled,true);
 assert.equal(result.choices.video.auto.sizes[144],null);
});

test('YouTube explicit per-format averages can be summed for the selected full tracks',()=>{
 const source=platformSource({site:'youtube',duration:60,streamingData:{adaptiveFormats:[
  {itag:1,url:'https://cdn.test/v',height:720,mimeType:'video/mp4; codecs="avc1.64001f"',averageBitrate:800000},
  {itag:2,url:'https://cdn.test/a',mimeType:'audio/mp4; codecs="mp4a.40.2"',averageBitrate:100000},
 ]}});
 const result=mediaChoices(source);
 assert.equal(result.choices.video.auto.sizes[720].bytes,6_750_000);
 assert.equal(result.choices.audio.original.sizes.best.bytes,750_000);
});

test('MMOV master without CODECS sniffs child TS PMT for video and audio',async()=>{
  const master='https://hk.mmov.io/vodplay/416398/master.m3u8',child='https://hk.mmov.io/vodplay/416398/720.m3u8',segment='https://hk.mmov.io/vodplay/416398/720.ts',bytes=ts();
  const rt=await makeRuntime([
    {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n720.m3u8\n',{type:'application/vnd.apple.mpegurl'})},
    {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n720.ts\n#EXT-X-ENDLIST\n',{type:'application/vnd.apple.mpegurl'})},
    {match:u=>u===segment,reply:response(bytes,{type:'video/mp2t'})},
  ]);
  const result=await rt.inspect({url:master,referer:'https://hk.mmov.io/vodplay/416398/6-1.html',title:'MMOV'});
  assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
});

test('AES-128 HLS without CODECS inspects bounded decrypted TS and enables both modes',async()=>{
 const base='https://bahamut.akamaized.net/fixture/',master=base+'playlist.m3u8',child=base+'chunklist.m3u8',keyUrl=base+'key.m3u8key',segment=base+'0.ts';
 const rawKey=crypto.getRandomValues(new Uint8Array(16)),iv=hlsIv(null,17),key=await crypto.subtle.importKey('raw',rawKey,{name:'AES-CBC'},false,['encrypt']);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv},key,ts()));
 const rt=await makeRuntime([
  {match:u=>u===master,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000\nchunklist.m3u8\n')},
  {match:u=>u===child,reply:response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:17\n#EXT-X-KEY:METHOD=AES-128,URI="key.m3u8key"\n#EXTINF:10,\n0.ts\n#EXT-X-ENDLIST\n')},
  {match:u=>u===keyUrl,reply:response(rawKey)},
  {match:u=>u===segment,reply:response(encrypted)},
 ]);
 const result=await rt.inspect({url:master,referer:'https://ani.gamer.com.tw/animeVideo.php?sn=1'});
 assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
 assert.equal(rt.fetchLog.find(x=>x.url===segment).options.headers.Range,'bytes=0-131071');
 assert.equal(rt.fetchLog.find(x=>x.url===keyUrl).options.headers.Range,'bytes=0-16');
});

test('ordinary source requests omit credentials',async()=>{
  const url='https://cdn.example/plain.mp4',rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>o.method==='HEAD'?response('',{type:'video/mp4',length:3}):response(new Uint8Array([1]),{type:'video/mp4'})}]);
  await rt.inspect({url,referer:'https://example.test/watch'});assert.ok(rt.fetchLog.every(x=>x.credentials==='omit'));
});

test('generic HLS HTTP refusal preserves request phase, method and host across RPC',async()=>{
 const rt=await makeRuntime([{match:()=>true,reply:response('',{status:403})}]);
 await assert.rejects(rt.inspect({url:'https://stream.example/master.m3u8?token=private',sourceType:'hls',referer:'https://example.test/watch'}),error=>{
  assert.equal(error.code,'HTTP_AUTH');assert.equal(error.sourceStage,'stream-manifest');assert.equal(error.requestMethod,'GET');assert.equal(error.requestHost,'stream.example');
  return true;
 });
});

test('large MP4 metadata seeks beyond the initial 128 KiB and enables audio/video',async()=>{
  const url='https://cdn.example/large.mp4',bytes=largeMp4(),total=bytes.length;
  const rt=await makeRuntime([{match:u=>u===url,reply:(u,o)=>{
    if(o.method==='HEAD')return response('',{type:'video/mp4',length:total});
    const range=String(o.headers.Range||'').match(/bytes=(\d+)-(\d+)/),start=range?Number(range[1]):0,end=range?Math.min(total-1,Number(range[2])):total-1;
    return response(bytes.slice(start,end+1),{status:206,type:'video/mp4',contentRange:`bytes ${start}-${end}/${total}`});
  }}]);
  const result=await rt.inspect({url,referer:'https://example.test/watch',title:'large'});
  assert.equal(result.choices.video.auto.enabled,true);assert.equal(result.choices.audio.original.enabled,true);
  assert.ok(rt.fetchLog.some(x=>x.options.headers.Range==='bytes=196608-219999'));
});

test('HLS master CODECS with an external AUDIO group must produce a two-input plan',async()=>{
 const rt=await makeRuntime([
 {match:u=>u==='https://cdn.example/master.m3u8',reply:response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Audio",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2",AUDIO="a"\nvideo.m3u8\n')},
 {match:u=>u==='https://cdn.example/video.m3u8',reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MAP:URI="video-init.mp4"\n#EXTINF:10,\nv.m4s\n#EXT-X-ENDLIST\n')},
 {match:u=>u==='https://cdn.example/audio.m3u8',reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.m4s\n#EXT-X-ENDLIST\n')},
 {match:u=>u==='https://cdn.example/video-init.mp4',reply:response(mp4Box('avc1',new Uint8Array(28)),{type:'video/mp4'})}
 ]);
 const info=await rt.inspect({url:'https://cdn.example/master.m3u8',referer:'https://example.test',sourceType:'hls'});
 assert.equal(info.choices.video.auto.enabled,true);assert.equal(info.choices.audio.original.enabled,true);
 // Two sizes are unknown independently; selecting video must not advertise a
 // direct video-only file or silently assume that it contains AAC.
 assert.equal(info.choices.video.auto.sizes[360],null);
});


test('Dailymotion reuses exact successful player manifests without refetching cdndirector',async()=>{
 const master='https://cdndirector.dailymotion.com/sec/master.m3u8?sig=one',actual='https://vod.dmcdn.net/media/master.m3u8',child='https://vod.dmcdn.net/media/360.m3u8';
 const cache=new Map([[master,{url:actual,text:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n360.m3u8\n',type:'application/x-mpegURL'}],[child,{url:child,text:'#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\npart.ts\n#EXT-X-ENDLIST\n',type:'application/x-mpegURL'}]]);
 const rt=await makeRuntime([{match:()=>true,reply:response('',{status:403})}],{manifestReply:async m=>{assert.equal(m.context.documentId,'dm-player');return cache.get(m.url)||null;}});
 const info=await rt.inspect({tabId:7,documentId:'dm-player',referer:'https://geo.dailymotion.com/player/main.html',platform:{site:'dailymotion',id:'x9qh9tw',observedSource:{url:master,type:'hls'}}});
 assert.equal(info.choices.video.auto.enabled,true);assert.equal(info.duration,10);assert.equal(rt.fetchLog.length,0);
 assert.deepEqual(rt.messages.filter(m=>m.message.action==='observedManifest').map(m=>m.message.url),[master,child]);
});

test('redirected HLS masters and children resolve relative references from their final URLs',async()=>{
 const entry='https://cdndirector.dailymotion.com/master.m3u8',final='https://vod.dmcdn.net/edge/master.m3u8',variant='https://vod.dmcdn.net/edge/360.m3u8',childFinal='https://vod.dmcdn.net/actual/360.m3u8';
 const rt=await makeRuntime([
  {match:u=>u===entry,reply:response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.42E01E,mp4a.40.2"\n360.m3u8\n',{url:final})},
  {match:u=>u===variant,reply:response('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\npart.ts\n#EXT-X-ENDLIST\n',{url:childFinal})},
 ]);
 const info=await rt.inspect({url:entry,sourceType:'hls',referer:'https://www.dailymotion.com/video/x9qh9tw'});
 assert.equal(info.choices.video.auto.enabled,true);assert.deepEqual(rt.fetchLog.map(x=>x.url),[entry,variant]);
});
