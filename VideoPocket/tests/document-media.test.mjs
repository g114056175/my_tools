import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaModelStore,extractMediaModels} from '../extension/media-models.js';
import {installMediaObserver} from '../extension/media-observer-source.js';
import {pageSnapshot} from '../extension/page.js';
import {validateDocumentMediaPlan} from '../extension/document-media.js';

function fixture(){
  const pageUrl='https://private.example.test/lesson';
  const video={currentSrc:'blob:https://private.example.test/local',src:'blob:https://private.example.test/local',duration:60,
    title:'Lesson',textTracks:[],getAttribute:()=>null,hasAttribute:()=>false,closest:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
  const payload={'@type':'VideoObject',contentUrl:'https://cdn.example.test/lesson.mp4',duration:999};
  const script={textContent:JSON.stringify(payload),isConnected:true,closest:()=>null};
  const videos=[video],scripts=[script];
  const document={title:'Lesson',scripts,documentElement:{lang:'en'},querySelector:()=>null,
    querySelectorAll:selector=>selector==='video'?videos:selector.startsWith('script[')?scripts:[]};
  video.ownerDocument=document;
  const target={document,location:new URL(pageUrl),JSON:{parse:JSON.parse}};
  const store=createMediaModelStore({target});
  return {video,payload,script,scripts,videos,document,target,store,pageUrl,
    scan(){store.scanDocument(document,target.location.href,videos);},
    plan(){return store.metadataCandidatesFor(this.video,target.location.href,videos);}};
}

test('one blob player with no ID gets a verification plan, never an exact model binding',()=>{
  const f=fixture();f.scan();
  assert.equal(f.store.modelFor(f.video,f.pageUrl),null);
  const plan=f.plan();assert.equal(plan.reason,'verification-required');assert.equal(plan.expectedDuration,60,'DOM duration, not metadata duration');
  assert.deepEqual(plan.versions.map(({url,kind})=>({url,kind})),[{url:f.payload.contentUrl,kind:'progressive'}]);
  assert.match(plan.versions[0].sourceGroup,/^media-[0-9a-f]+$/);
  const again=f.plan();assert.notEqual(plan.token,again.token);assert.equal(plan.bindingKey,again.bindingKey);
  const diagnostic=f.store.diagnosticsFor(f.video,f.pageUrl);
  assert.equal(diagnostic.reason,'no-player-identity');assert.equal(diagnostic.matches,0);assert.equal(diagnostic.metadataCandidates,1);
});

test('cached models without live document provenance cannot become fallback sources',()=>{
  const f=fixture();f.store.merge(extractMediaModels(f.payload));
  assert.equal(f.plan().reason,'no-live-metadata');assert.equal(f.plan().versions.length,0);
});

test('unknown endpoint, audio and segment URLs are not guessed as complete progressive videos',()=>{
  for(const url of ['https://cdn.example.test/player','https://cdn.example.test/chunk.ts','https://cdn.example.test/chunk.m4s','https://cdn.example.test/audio.m4a']){
    const f=fixture();f.script.textContent=JSON.stringify({...f.payload,contentUrl:url});f.scan();
    assert.equal(f.plan().reason,'unknown-source-kind');assert.deepEqual(f.plan().versions,[]);
  }
});

test('multiple players, missing duration, DRM and explicit identities do not take the unbound fallback',()=>{
  for(const [mutate,reason] of [
    [f=>f.videos.push({...f.video}),'multiple-players'],
    [f=>{f.video.duration=NaN;},'missing-duration'],
    [f=>{f.video.duration=Infinity;},'missing-duration'],
    [f=>{f.video.duration=0;},'missing-duration'],
    [f=>{f.video.mediaKeys={};},'protected'],
    [f=>{f.video.__reactProps$test={videoID:'different-video'};},'explicit-identity'],
    [f=>{f.target.location=new URL('https://private.example.test/watch?v=other');},'explicit-identity'],
  ]){
    const f=fixture();mutate(f);f.scan();assert.equal(f.plan().reason,reason);assert.equal(f.plan().versions.length,0);
  }
});

test('refresh cannot reassign unchanged JSON after a blob, element, or SPA route replacement',()=>{
  for(const mutate of [
    f=>{f.video.currentSrc='blob:new-video';},
    f=>{f.video={...f.video};f.videos[0]=f.video;},
    f=>{f.target.location=new URL('https://private.example.test/other-lesson');},
  ]){
    const f=fixture();f.scan();assert.equal(f.plan().versions.length,1);mutate(f);f.scan();
    assert.equal(f.plan().reason,'stale-metadata');assert.equal(f.plan().versions.length,0);
  }
});

test('updated live metadata may supply new signed URLs after a player change',()=>{
  const f=fixture();f.scan();const original=f.plan();f.video.currentSrc='blob:replacement';f.scan();assert.equal(f.plan().versions.length,0);
  const fresh='https://cdn.example.test/new-lesson.mp4?expires=2000000900';
  f.script.textContent=JSON.stringify({...f.payload,contentUrl:fresh});f.scan();
  assert.deepEqual(f.plan().versions.map(({url,kind})=>({url,kind})),[{url:fresh,kind:'progressive'}]);
  assert.notEqual(f.plan().bindingKey,original.bindingKey);
  f.scripts.splice(0);f.scan();assert.equal(f.plan().reason,'no-live-metadata');
});

test('a first blob assignment is allowed once, while later reuse is stale',()=>{
  const f=fixture();f.video.currentSrc=f.video.src='';f.scan();
  f.video.currentSrc='blob:first';f.scan();assert.equal(f.plan().versions.length,1);
  f.video.currentSrc='blob:second';f.scan();assert.equal(f.plan().reason,'stale-metadata');
});

test('every distinct candidate is retained for verification and excess candidates fail closed',()=>{
  const f=fixture();f.script.textContent=JSON.stringify({id:'model',video_versions:[{url:'https://cdn.example.test/a.mp4'},{url:'https://cdn.example.test/b.mp4'}]});f.scan();
  assert.equal(f.plan().versions.length,2);
  f.script.textContent=JSON.stringify({video_versions:Array.from({length:13},(_,i)=>({url:`https://cdn.example.test/${i}.mp4`}))});f.scan();
  assert.equal(f.plan().reason,'too-many-candidates');assert.equal(f.plan().versions.length,0);
});

test('document candidates keep model groups opaque and do not merge duplicate URLs across models',()=>{
 const f=fixture();
 const second={textContent:JSON.stringify({id:'other-model',video_versions:[{url:f.payload.contentUrl},{url:'https://cdn.example.test/other.mp4'}]}),isConnected:true,closest:()=>null};
 f.scripts.push(second);f.scan();
 const urls=f.plan().versions;
 assert.equal(urls.length,2);
 assert.equal(urls.find(item=>item.url===f.payload.contentUrl).sourceGroup,null);
 assert.match(urls.find(item=>item.url.endsWith('other.mp4')).sourceGroup,/^media-[0-9a-f]+$/);
});

test('page snapshot exposes a provisional metadata plan without marking its URL as a bound source',async()=>{
  const f=fixture(),observer=installMediaObserver(f.target),saved=new Map();
  const values={window:f.target,document:f.document,location:f.target.location,performance:{getEntriesByType:()=>[]}};
  for(const [key,value] of Object.entries(values)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
  try{
    const page=await pageSnapshot();
    assert.equal(page.platform.site,'metadata-media');assert.equal(page.platform.binding,'metadata-unbound');
    assert.equal(page.platform.expectedDuration,60);assert.equal(page.videos[0].downloadUrl,null);
    assert.equal(validateDocumentMediaPlan({token:page.platform.validationToken,mediaKey:page.media.mediaKey}).valid,true);
    assert.equal(page.media.discoveryDiagnostics.metadataReason,'verification-required');
    assert.equal(page.media.discoveryDiagnostics.matches,0);
    assert.equal(observer.sourcesFor(f.video).candidates.length,0,'unbound URLs cannot enter sourcesFor as exact evidence');
  }finally{
    observer.dispose();for(const [key,value] of saved){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
  }
});

test('verification tokens reject page changes after a snapshot, even before another popup scan',()=>{
  for(const mutate of [
    f=>{f.video.currentSrc='blob:replacement';},
    f=>{f.video={...f.video};f.videos[0]=f.video;},
    f=>{f.video.duration=300;},
    f=>{f.video.mediaKeys={};},
    f=>{f.script.textContent=JSON.stringify({...f.payload,contentUrl:'https://cdn.example.test/other.mp4'});},
    f=>{f.scripts.splice(0);},
    f=>{f.videos.push({...f.video});},
    f=>{f.target.location=new URL('https://private.example.test/new-lesson');},
  ]){
    const f=fixture();f.scan();const plan=f.plan();
    assert.equal(f.store.validateMetadataPlan(plan.token,f.video,f.target.location.href,f.videos),true);
    mutate(f);
    assert.equal(f.store.validateMetadataPlan(plan.token,f.video,f.target.location.href,f.videos),false);
  }
});
