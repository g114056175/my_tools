import test from 'node:test';
import assert from 'node:assert/strict';
import {definitionMediaSources,ownedPlayerConfiguration} from '../extension/player-config.js';
import {createMediaModelStore,extractMediaModels} from '../extension/media-models.js';
import {installMediaObserver} from '../extension/media-observer-source.js';
import {pageSnapshot} from '../extension/page.js';

const base='https://player.example.test/watch';
const manifest='https://cdn.example.test/lecture/720/master.m3u8?expires=2000000000';
function fixture(){
  const config={video_title:'Calculus lecture',video_duration:189,playbackTracking:{video_id:123},mediaDefinitions:[
    {format:'hls',height:240,videoUrl:'https://cdn.example.test/lecture/240/master.m3u8'},
    {format:'hls',height:720,defaultQuality:true,videoUrl:manifest},
    {format:'mp4',videoUrl:'https://player.example.test/video/get_media?id=123',remote:true},
  ],nextVideo:{video_id:456,mediaDefinitions:[{format:'hls',videoUrl:'https://ads.example.test/unrelated.m3u8'}]}};
  const makeVideo=(src='',title='')=>({tagName:'VIDEO',nodeType:1,src,currentSrc:src,readyState:src?1:0,duration:src?189:NaN,
    title,textTracks:[],getAttribute:key=>key==='src'?src:null,hasAttribute:()=>false,closest:()=>null,
    querySelector:()=>null,querySelectorAll:()=>[]});
  const placeholder=makeVideo(),main=makeVideo('blob:https://player.example.test/media');
  const siblings=[placeholder,main],other=Array.from({length:4},()=>makeVideo('blob:https://player.example.test/other'));
  const container={tagName:'DIV',getAttribute:key=>key==='data-video-id'?'123':null,
    querySelectorAll:key=>key==='video'?siblings:[]};
  const wrapper={tagName:'DIV',parentElement:container,getAttribute:key=>key==='id'?'playerDiv_123':null,
    querySelectorAll:key=>key==='video'?siblings:[],contains:video=>siblings.includes(video)};
  for(const video of siblings){video.parentElement=wrapper;video.closest=selector=>selector==='[id^="playerDiv_"]'?wrapper:null;}
  const videos=[...siblings,...other];
  const document={title:'Lecture page',scripts:[],documentElement:{lang:'zh-Hant'},querySelector:()=>null,querySelectorAll:selector=>selector==='video'?videos:[]};
  for(const video of videos)video.ownerDocument=document;
  const target={document,location:new URL(base),JSON:{parse:JSON.parse},flashvars_123:config,playerObjList:{playerDiv_123:{flashvars:{embedId:123}}}};
  return {target,config,placeholder,main,other,wrapper,container,siblings,videos,document};
}

test('element-owned mediaDefinitions bind a blob player without scanning globals or executing script text',()=>{
  const f=fixture(),store=createMediaModelStore({target:f.target});
  Object.defineProperty(f.target,'unrelatedSecret',{get(){throw new Error('unrelated global must not be read');}});
  const model=store.modelFor(f.main,base);
  assert.equal(model.id,'123');assert.equal(model.title,'Calculus lecture');assert.equal(model.duration,189);
  assert.equal(model.manifestUrl,manifest);assert.equal(model.manifestType,'hls');assert.deepEqual(model.versions,[]);
  assert.deepEqual(store.models().map(model=>model.id),['123'],'nextVideo must not enter the selected-player model');
  assert.equal(store.modelFor(f.other[0],base),null);
  assert.equal(store.modelFor(f.placeholder,base),null);
  assert.equal(store.canonicalVideo(f.placeholder),f.main);
  assert.equal(store.diagnosticsFor(f.main,base).reason,'matched');
});

test('player configurations are reread after token refresh and never rescued from stale cached models',()=>{
  const f=fixture(),store=createMediaModelStore({target:f.target});
  assert.equal(store.modelFor(f.main,base).manifestUrl,manifest);
  f.config.mediaDefinitions[1].videoUrl=manifest.replace('2000000000','2000000900');
  assert.equal(store.modelFor(f.main,base).manifestUrl,f.config.mediaDefinitions[1].videoUrl);
  f.config.playbackTracking.video_id=456;
  assert.equal(store.modelFor(f.main,base),null,'conflicting live ID must not reuse a cached source');
  assert.equal(store.canonicalVideo(f.placeholder),f.placeholder);
  f.config.playbackTracking.video_id=123;f.config.mediaDefinitions=[];
  assert.equal(store.modelFor(f.main,base),null,'removed sources must not resurrect old signed URLs');
  delete f.target.flashvars_123;
  assert.equal(store.modelFor(f.main,base),null,'a removed configuration must not resurrect its cached model');
});

test('an extra active video, conflicting container, or conflicting player record blocks configuration binding',()=>{
  for(const change of [
    f=>{f.placeholder.currentSrc='blob:advertisement';},
    f=>{f.container.getAttribute=key=>key==='data-video-id'?'456':null;},
    f=>{f.target.playerObjList.playerDiv_123.flashvars.embedId=456;},
  ]){
    const f=fixture();change(f);
    const store=createMediaModelStore({target:f.target});
    assert.equal(store.modelFor(f.main,base),null);
    assert.equal(store.canonicalVideo(f.placeholder),f.placeholder);
  }
});

test('known configuration accessors and source accessors are not executed',()=>{
  const f=fixture();let reads=0;
  Object.defineProperty(f.target,'flashvars_123',{get(){reads++;return f.config;}});
  assert.equal(ownedPlayerConfiguration(f.main,f.target).payload,null);assert.equal(reads,0);
  const entry={format:'hls'};Object.defineProperty(entry,'videoUrl',{get(){reads++;return manifest;}});
  assert.deepEqual(definitionMediaSources([entry],base).versions,[]);assert.equal(reads,0);
});

test('definition parsing accepts real HTTP media, prefers an adaptive manifest and excludes API indirection',()=>{
  const [model]=extractMediaModels({video_id:123,video_title:'Lecture',mediaDefinitions:[
    {format:'hls',height:720,videoUrl:manifest},
    {format:'hls',quality:['240','480','720'],videoUrl:'/all.m3u8'},
    {format:'mp4',videoUrl:'/real.mp4',height:480},
    {format:'mp4',videoUrl:'/video/get_media',remote:true},
    {format:'mp4',videoUrl:'/video/get_media'},
    {format:'hls',videoUrl:'javascript:alert(1)'},
  ]},{baseUrl:base});
  assert.equal(model.manifestUrl,'https://player.example.test/all.m3u8');assert.equal(model.manifestType,'hls');
  assert.deepEqual(model.versions.map(item=>item.url),['https://player.example.test/real.mp4']);
  assert.equal(definitionMediaSources([{format:'dash',videoUrl:'/stream.mpd'}],base).manifestType,'dash');
  const f=fixture();f.config.mediaDefinitions.push({format:'hls',quality:['240','720'],videoUrl:'/adaptive.m3u8'});
  assert.equal(createMediaModelStore({target:f.target}).modelFor(f.main,base).manifestUrl,'https://player.example.test/adaptive.m3u8');
});

test('JSON hooks and JSON script scans recognize the same mediaDefinitions schema on unknown hosts',()=>{
  const f=fixture(),observer=installMediaObserver(f.target);
  const payload={video_id:'456',mediaDefinitions:[{format:'hls',videoUrl:'https://cdn.example.test/other.m3u8'}]};
  const video=f.other[0];video.__reactProps$test={videoID:'456'};
  try{
    f.target.JSON.parse(JSON.stringify(payload));
    assert.equal(observer.modelFor(video).manifestUrl,payload.mediaDefinitions[0].videoUrl);
    const store=createMediaModelStore();
    store.scanDocument({querySelectorAll:()=>[{textContent:JSON.stringify(payload)}]},base);
    assert.equal(store.modelFor(video,base).manifestUrl,payload.mediaDefinitions[0].videoUrl);
  }finally{observer.dispose();}
});

async function snapshot(f,mediaIndex=0){
  const values={window:f.target,document:f.document,location:f.target.location,performance:{getEntriesByType:()=>[]}},saved=new Map();
  for(const [key,value] of Object.entries(values)){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
  try{return await pageSnapshot(mediaIndex);}finally{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

test('page snapshot and observer map the empty fallback to the actual player among six videos',async()=>{
  const f=fixture(),observer=installMediaObserver(f.target);
  try{
    const page=await snapshot(f);
    assert.equal(page.videos.length,5);assert.equal(page.mediaIndex,0);assert.equal(page.media.url,f.main.currentSrc);
    assert.equal(page.platform.site,'embedded');assert.equal(page.platform.id,'123');assert.equal(page.platform.manifestUrl,manifest);
    assert.equal(page.videos[0].title,'Calculus lecture');assert.equal(page.videos[0].mediaContentId,'123');
    assert.equal(page.videos[0].downloadUrl,manifest);
    const other=await snapshot(f,1);assert.equal(other.platform,undefined);assert.equal(other.videos[1].downloadUrl,null);
    assert.equal(observer.sourcesFor(f.main).candidates[0].url,manifest);
  }finally{observer.dispose();}
});

test('two actively sourced elements remain separate and cannot borrow the configured video',async()=>{
  const f=fixture();f.placeholder.currentSrc='blob:advertisement';const observer=installMediaObserver(f.target);
  try{
    const page=await snapshot(f);assert.equal(page.videos.length,6);assert.equal(page.platform,undefined);
    assert.equal(page.videos[0].downloadUrl,null);assert.equal(page.videos[1].downloadUrl,null);
  }finally{observer.dispose();}
});
