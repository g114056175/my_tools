import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {VideoPlaybackAbrRequest} from '../extension/vendor/sabr.js';
import {readYoutubePageSession,youtubePageSession} from '../extension/youtube-page-session.js';

const VIDEO_ID='abcdefghijk';
const STREAM_ID='stream-session-41';
const MEDIA_KEY='media-key-41';
const TAB_ID=41;
const DOCUMENT_ID='document-41';
const FRAME_ID=3;
const STREAM_URL=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41`;
const CONFIG=Uint8Array.of(3,7,11,19);
const NOW=1_800_000_000_000;
const encode64=bytes=>Buffer.from(bytes).toString('base64');

function makeBody(config=CONFIG,extra={}){
 return VideoPlaybackAbrRequest.encode({
  initializationFormatIds:[],bufferedRanges:[],selectedAudioFormatIds:[],selectedVideoFormatIds:[],selectedCaptionFormatIds:[],ssapPlaybackInfos:[],field1000:[],
  streamerContext:{clientInfo:{},sabrContexts:[],unsentSabrContexts:[],poToken:Uint8Array.of(5,8,13)},
  videoPlaybackUstreamerConfig:config,...extra,
 }).finish();
}

function descriptor({videoId=VIDEO_ID,streamUrl=STREAM_URL,tabId=TAB_ID,documentId=DOCUMENT_ID,frameId=FRAME_ID,mediaKey=MEDIA_KEY}={}){
 return {tabId,documentId,frameId,mediaKey,platform:{site:'youtube',id:videoId,streamingData:{serverAbrStreamingUrl:streamUrl}}};
}

function requestState({config=CONFIG,body=makeBody(config),outerKey='loaderCache',settingsKey='runtimeConfig',bodyKey='payload'}={}){
 const request={requestType:7,resource:{url:STREAM_URL},[settingsKey]:{videoPlaybackUstreamerConfig:config},[bodyKey]:body};
 return {[outerKey]:request};
}

function preparedLoaderState({config=CONFIG,body=makeBody(config),resourceUrl=STREAM_URL,resourceValue,transportUrl=STREAM_URL,transportKey='transport',urlKey='q',transportUrlGetter}={}){
 const info={requestType:7,resource:resourceValue??{url:resourceUrl},runtimeConfig:{videoPlaybackUstreamerConfig:config},payload:body},transport={};
 if(transportUrlGetter)Object.defineProperty(transport,urlKey,{enumerable:true,get:transportUrlGetter});
 else transport[urlKey]=transportUrl;
 return {minifiedCacheEntry:{info,[transportKey]:transport}};
}

function pageWorld({
 videoId=VIDEO_ID,
 pageUrl=`https://www.youtube.com/watch?v=${VIDEO_ID}`,
 streamUrl=STREAM_URL,
 selectedConfig=encode64(CONFIG),
 loaderConfig=CONFIG,
 loaderBody=makeBody(loaderConfig),
 mediaKey=MEDIA_KEY,
 state=requestState({config:loaderConfig,body:loaderBody}),
 rootName='ytPubsubPubsubInstance',
 resources=[{name:STREAM_URL}],
 performance:performanceOverride,
}={}){
 const controls={videoPlay:0,playerPlay:0,videoSeek:0,playerSeek:0,pausedWrite:0,fetch:0,xhr:0,beacon:0};
 let paused=true,currentTime=73.25;
 const video={
  play(){controls.videoPlay++;throw new Error('video.play must not be called');},
 };
 Object.defineProperties(video,{
  paused:{get(){return paused;},set(value){controls.pausedWrite++;paused=value;}},
  currentTime:{get(){return currentTime;},set(value){controls.videoSeek++;currentTime=value;}},
 });
 const response={
  videoDetails:{videoId},
  playerConfig:{mediaCommonConfig:{mediaUstreamerRequestConfig:{videoPlaybackUstreamerConfig:selectedConfig}}},
  streamingData:{serverAbrStreamingUrl:streamUrl},
 };
 const player={
  querySelector(selector){return selector==='video'?video:null;},
  getPlayerResponse(){return response;},
  getVideoData(){return {video_id:videoId};},
  playVideo(){controls.playerPlay++;throw new Error('playVideo must not be called');},
  seekTo(){controls.playerSeek++;throw new Error('seekTo must not be called');},
 };
 const identities={keys:new Map([[video,mediaKey]])};
 const window={[rootName]:state,[Symbol.for('video-pocket.identities')]:identities};
 const document={querySelector(selector){return selector==='#movie_player'?player:null;}};
 const location={href:pageUrl};
 const performance=performanceOverride||{now:()=>globalThis.performance.now(),getEntriesByType:type=>type==='resource'?resources:[]};
 class FakeNode{}
 class FakeXMLHttpRequest{open(){controls.xhr++;throw new Error('XMLHttpRequest must not be used');}send(){controls.xhr++;throw new Error('XMLHttpRequest must not be used');}}
 const fetch=()=>{controls.fetch++;throw new Error('fetch must not be used');};
 const navigator={sendBeacon(){controls.beacon++;throw new Error('sendBeacon must not be used');}};
 const context={
  expected:{videoId:VIDEO_ID,streamId:STREAM_ID,mediaKey:MEDIA_KEY},
  window,document,location,performance,navigator,fetch,XMLHttpRequest:FakeXMLHttpRequest,
  URL,Uint8Array,ArrayBuffer,Map,WeakSet,Symbol,Node:FakeNode,atob,btoa,
 };
 const read=()=>vm.runInNewContext(`(${readYoutubePageSession.toString()})(expected)`,context,{timeout:1000});
 return {read,video,player,response,identities,controls,get paused(){return paused;},get currentTime(){return currentTime;}};
}

function pageResult({videoId=VIDEO_ID,streamId=STREAM_ID,url=STREAM_URL,config=encode64(CONFIG),candidates=[encode64(makeBody())],changed=false}={}){
 return {videoId,streamId,url,config,candidates,...(changed?{changed:true}:{})};
}

test('a paused page reuses its selected player request state without a new POST',()=>{
 const world=pageWorld(),page=world.read();
 assert.equal(world.paused,true);
 assert.equal(page.videoId,VIDEO_ID);
 assert.equal(page.streamId,STREAM_ID);
 assert.equal(page.url,STREAM_URL);
 assert.equal(page.config,encode64(CONFIG));
 assert.equal(page.candidates.length,1);
 assert.equal(page.candidates[0],encode64(makeBody()));
 assert.deepEqual(world.controls,{videoPlay:0,playerPlay:0,videoSeek:0,playerSeek:0,pausedWrite:0,fetch:0,xhr:0,beacon:0});
 assert.equal(world.currentTime,73.25);
});

test('an open paused request uses the prepared sibling transport URL without Resource Timing',()=>{
 const rawUrl=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=raw`;
 const preparedUrl=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=prepared`;
 const source=descriptor({streamUrl:rawUrl}),state=preparedLoaderState({resourceUrl:rawUrl,transportUrl:preparedUrl,urlKey:'minified-transport-url'});
 const world=pageWorld({streamUrl:rawUrl,state,resources:[]}),page=world.read();
 assert.equal(world.paused,true);
 assert.equal(page.url,preparedUrl);
 assert.equal(page.candidates[0],encode64(makeBody()));
 const capture=youtubePageSession(source,page,NOW);
 assert.equal(capture?.url,preparedUrl);
});

test('a matching prepared sibling URL wins over the raw resource URL in request info',()=>{
 const rawUrl=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=raw`;
 const preparedUrl=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=prepared`;
 const state=preparedLoaderState({resourceUrl:rawUrl,resourceValue:rawUrl,transportUrl:preparedUrl});
 const page=pageWorld({streamUrl:rawUrl,state,resources:[]}).read();
 assert.equal(page.url,preparedUrl);
});

test('a foreign resource or loader URL is not adopted for the selected stream',()=>{
 const rawUrl=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=raw`;
 const foreignUrl='https://rr.googlevideo.com/videoplayback?id=other-stream&sabr=sabr-session-41&n=foreign';
 const source=descriptor({streamUrl:rawUrl});
 const withPrepared=pageWorld({streamUrl:rawUrl,resources:[{name:foreignUrl}],state:preparedLoaderState({resourceUrl:rawUrl,transportUrl:`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=prepared`})}).read();
 assert.equal(withPrepared.url,`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=prepared`);
 assert.notEqual(withPrepared.url,foreignUrl);
 const withoutPrepared=pageWorld({streamUrl:rawUrl,resources:[{name:foreignUrl}],state:preparedLoaderState({resourceUrl:foreignUrl,transportUrl:foreignUrl})}).read();
 assert.notEqual(withoutPrepared.url,foreignUrl);
 assert.equal(youtubePageSession(source,withoutPrepared,NOW),null,'a same-config request without a matching prepared URL must not fall back to the unprocessed URL');
});

test('validated capture matches video, stream, config, tab, document and frame identities',()=>{
 const world=pageWorld(),page=world.read(),source=descriptor(),capture=youtubePageSession(source,page,NOW);
 assert.equal(page.videoId,source.platform.id);
 assert.equal(page.streamId,new URL(source.platform.streamingData.serverAbrStreamingUrl).searchParams.get('id'));
 assert.ok(capture);
 assert.equal(capture.tabId,TAB_ID);
 assert.equal(capture.documentId,DOCUMENT_ID);
 assert.equal(capture.frameId,FRAME_ID);
 assert.equal(capture.streamId,STREAM_ID);
 assert.equal(capture.url,STREAM_URL);
 assert.equal(capture.createdAt,NOW);
 assert.equal(capture.poLength,3);
 const seed=VideoPlaybackAbrRequest.decode(Uint8Array.from(atob(capture.body),character=>character.charCodeAt(0)));
 assert.deepEqual([...seed.videoPlaybackUstreamerConfig],[...CONFIG]);
 assert.ok(seed.streamerContext.clientInfo);
});

test('wrong video, stream or selected player config cannot produce a capture',()=>{
 const source=descriptor(),good=pageResult();
 assert.equal(youtubePageSession(source,{...good,videoId:'wrong-video'},NOW),null);
 assert.equal(youtubePageSession(source,{...good,streamId:'wrong-stream'},NOW),null);
 assert.equal(youtubePageSession(source,{...good,config:encode64(Uint8Array.of(99,98,97))},NOW),null);
 assert.equal(youtubePageSession(source,{...good,changed:true},NOW),null);
 const badReader=pageWorld({videoId:'wrong-video'});
 assert.equal(badReader.read().changed,true);
});

test('a changed media key invalidates the page snapshot',()=>{
 const world=pageWorld();
 world.identities.keys.set(world.video,'replacement-media-key');
 const page=world.read();
 assert.equal(page.changed,true);
 assert.equal(youtubePageSession(descriptor(),page,NOW),null);
});

test('malicious hosts and oversized decoded request bodies are rejected',()=>{
 const source=descriptor(),good=pageResult();
 assert.equal(youtubePageSession(source,{...good,url:`https://googlevideo.com.attacker.test/videoplayback?id=${STREAM_ID}`},NOW),null);
 assert.equal(youtubePageSession(source,{...good,url:`https://evilgooglevideo.com/videoplayback?id=${STREAM_ID}`},NOW),null);
 assert.equal(youtubePageSession(source,{...good,url:`https://rr.googlevideo.com/videoplayback?id=other-stream`},NOW),null);
 const badHost=pageWorld({streamUrl:`https://rr.googlevideo.com.attacker.test/videoplayback?id=${STREAM_ID}`});
 assert.equal(badHost.read().changed,true);
 const oversizedBody=encode64(new Uint8Array(65_537));
 assert.ok(oversizedBody.length<=87_384);
 assert.equal(youtubePageSession(source,{...good,candidates:[oversizedBody]},NOW),null);
 assert.equal(youtubePageSession(source,{...good,candidates:['x'.repeat(87_385)]},NOW),null);
});

test('request cache remains discoverable when cache and payload keys are minified or renamed',()=>{
 const body=makeBody(),loader=requestState({outerKey:'a7',settingsKey:'b2',bodyKey:'c9'});
 const state=new Map([['renamed-slot',{minifiedCacheField:loader}]]);
 const world=pageWorld({state,rootName:'ytplayer'}),source=descriptor(),page=world.read();
 assert.equal(page.candidates[0],encode64(body));
 assert.ok(youtubePageSession(source,page,NOW));
});

test('enumeration does not invoke page getters',()=>{
 let getterCalls=0;
 const state=requestState();
 Object.defineProperty(state,'lazyCache',{enumerable:true,get(){getterCalls++;throw new Error('page getter must not run');}});
 const world=pageWorld({state}),page=world.read();
 assert.equal(getterCalls,0);
 assert.equal(page.candidates.length,1);
});

test('prepared transport URL discovery never invokes its getter',()=>{
 let getterCalls=0;
 const rawUrl=`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=raw`;
 const state=preparedLoaderState({resourceUrl:rawUrl,transportUrlGetter(){getterCalls++;return `https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=prepared`;}});
 const page=pageWorld({streamUrl:rawUrl,state,resources:[]}).read();
 assert.equal(getterCalls,0);
 assert.notEqual(page.url,`https://rr.googlevideo.com/videoplayback?id=${STREAM_ID}&sabr=sabr-session-41&n=prepared`);
});

test('large cyclic page graphs stop at the bounded scan budget',()=>{
 let clock=0;
 const many=Object.create(null);
 for(let index=0;index<5000;index++)many[`cache_${index}`]={parent:many};
 const timing={now(){return clock++;},getEntriesByType(){return [{name:STREAM_URL}];}};
 const world=pageWorld({state:many,performance:timing}),page=world.read();
 assert.deepEqual(Array.from(page.candidates),[]);
 assert.ok(clock<=205,`scan should stop at its 200-step time budget, clock=${clock}`);
 assert.equal(world.paused,true);
 assert.equal(world.currentTime,73.25);
 assert.deepEqual(world.controls,{videoPlay:0,playerPlay:0,videoSeek:0,playerSeek:0,pausedWrite:0,fetch:0,xhr:0,beacon:0});
});
