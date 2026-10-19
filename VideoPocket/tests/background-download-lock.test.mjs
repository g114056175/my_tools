import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {ACTIVE_STATES} from '../extension/jobs.js';
import {downloadKey,createDownloadClaims,stableHash} from '../extension/download-identity.js';
import {createPopupMarkerController} from '../extension/popup-marker.js';
import {createMediaSelectionController,selectionStorageKey,selectedMediaIndex} from '../extension/media-selection-controller.js';

async function loadBackground({frames=[]}={}) {
  const source=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');
  const code=source.replace(/^import[^;]+;\s*/gm,'');
  const stored={};let listener,inspectNo=0,retainCount=0,retainMode='ok',retainBlocked=false,retainRelease;
  const sources=new Map();
  const session={
    async get(key){if(key===null)return {...stored};if(typeof key==='string')return {[key]:stored[key]};return Object.fromEntries(key.map(k=>[k,stored[k]]));},
    async set(value){Object.assign(stored,value);},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];}
  };
  const chrome={
    runtime:{id:'ext',getURL:path=>`chrome-extension://ext/${path}`,getContexts:async()=>[],sendMessage:async message=>{
      if(message.action==='inspect'){const id=`source-${++inspectNo}`,d=message.descriptor;sources.set(id,{title:d.title||'',platform:d.platform?.site||'unknown'});return {ok:true,result:{id,title:d.title||'',platform:d.platform?.site||'unknown'}};}
      if(message.action==='retain'){retainCount++;if(retainMode==='reject')return {ok:false,error:'retain failed'};const s=sources.get(message.sourceId);if(retainBlocked)return new Promise(resolve=>{retainRelease=()=>resolve({ok:true,result:{title:s?.title||''}})});return {ok:true,result:{title:s?.title||''}};}
      if(message.action==='forget'||message.action==='cancel'||message.action==='cleanup')return {ok:true,result:{}};
      return {ok:true,result:{}};
    },onMessage:{addListener:fn=>{listener=fn}},onConnect:{addListener:()=>{}}},
    storage:{session,onChanged:{addListener:()=>{}},local:{remove:async()=>{},get:async()=>({})}},
    offscreen:{createDocument:async()=>{}},
    declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async()=>{}},
    downloads:{onChanged:{addListener:()=>{}},search:async()=>[],cancel:async()=>{},pause:async()=>{},resume:async()=>{}},
    scripting:{executeScript:async request=>request.files?[]:frames},
    tabs:{onRemoved:{addListener:()=>{}}},
    windows:{onRemoved:{addListener:()=>{}},getAll:async()=>[{}]},
    action:{setBadgeText:async()=>{}}
  };
  const context={chrome,crypto:webcrypto,URL,URLSearchParams,AbortSignal,TextEncoder,TextDecoder,console,setTimeout,clearTimeout,setInterval:()=>0,
    pageSnapshot:()=>({}),pageSubtitles:()=>({}),createBilibiliClient:()=>({}),bilibiliRoute:()=>({}),normalizeCues:x=>x,parseSubtitles:x=>x,
    ACTIVE_STATES, youtubeSession:async()=>null,youtubeCaptionRequest:async()=>null,classifyFailure:e=>({code:e?.code||'INTERNAL_ERROR',message:e?.message||String(e)}),ERROR_VISIBILITY_MS:100,
    CAPTURE_PREFIX:'capture:',CAPTURE_VERSION:1,createSubtitleCaptureManager:()=>({start:async()=>{},removeTab:async()=>{},clearAll:async()=>{}}),loadBilibiliSubtitle:async()=>{},fileStem:s=>s,createFilenameRecorder:()=>async()=>{},mediaRequestHeaders:()=>[],
    VideoPocketDestinations:{remove:async()=>{},clear:async()=>{},get:async()=>false},
    downloadKey,createDownloadClaims,stableHash,createPopupMarkerController,createMediaSelectionController,selectionStorageKey,selectedMediaIndex};
  vm.runInNewContext(code,context,{filename:'background.js'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof listener,'function');
  const call=(message,sender={id:'ext',url:'chrome-extension://ext/popup.html',documentId:'popup-doc'})=>new Promise((resolve,reject)=>listener(message,sender,response=>response?.ok?resolve(response.result):reject(Object.assign(new Error(response?.error||'failed'),response?.failure||{}))));
  return {call,stored,get retainCount(){return retainCount;},set retainMode(value){retainMode=value;},blockRetain(){retainBlocked=true;},releaseRetain(){retainBlocked=false;retainRelease?.();},jobs:()=>stored.jobs||[]};
}

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

test('background rejects unauthorized download messages and releases claim after retain failure',async()=>{
  const rt=await loadBackground(),inspected=await rt.call({action:'inspect',descriptor:{tabId:1,documentId:'d',mediaKey:3,url:'https://cdn/a',title:'A'}});
  await assert.rejects(rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'},{id:'ext',url:'https://evil.test/'}),/來源未授權/);
  rt.retainMode='reject';await assert.rejects(rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'}));
  rt.retainMode='ok';const retry=await rt.call({action:'prepareDownload',sourceId:inspected.id,downloadKey:'k',title:'A',kind:'video'});assert.ok(retry.id);
  const youtube=await rt.call({action:'inspect',descriptor:{tabId:1,documentId:'d',mediaKey:4,url:'https://cdn/y',platform:{site:'youtube',id:'yt-empty'}}});
  await assert.rejects(rt.call({action:'prepareDownload',sourceId:youtube.id,title:'影片 1',kind:'video'}),/未取得 YouTube 影片標題/);
  const afterTitleFailure=await rt.call({action:'prepareDownload',sourceId:youtube.id,title:'Real title',kind:'video'});assert.ok(afterTitleFailure.id);
});
