import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoPlaybackAbrRequest} from '../extension/vendor/sabr.js';

const makeBody=(poToken=[1,2])=>VideoPlaybackAbrRequest.encode({
 initializationFormatIds:[],bufferedRanges:[],selectedAudioFormatIds:[],selectedVideoFormatIds:[],selectedCaptionFormatIds:[],ssapPlaybackInfos:[],field1000:[],
 streamerContext:{clientInfo:{},sabrContexts:[],unsentSabrContexts:[],poToken:Uint8Array.from(poToken)},
 videoPlaybackUstreamerConfig:Uint8Array.of(9),
}).finish();

async function loadObserver({records=[]}={}){
 const previousChrome=globalThis.chrome,values={youtubeSessions:structuredClone(records)},listeners=new Set();
 let adds=0,removes=0,blockedGet,blockNextGet=false,gets=0,sets=0;
 const onBeforeRequest={
  addListener(listener,filter,extraInfoSpec){adds++;assert.deepEqual(filter,{urls:['https://*.googlevideo.com/videoplayback*']});assert.deepEqual(extraInfoSpec,['requestBody']);listeners.add(listener);},
  removeListener(listener){removes++;listeners.delete(listener);},
  emit(details){for(const listener of [...listeners])listener(details);},
 };
 const session={
  async get(key){gets++;const result={[key]:structuredClone(values[key]||[])};if(blockNextGet){blockNextGet=false;return new Promise(resolve=>{blockedGet=()=>resolve(result);});}return result;},
  async set(update){sets++;Object.assign(values,structuredClone(update));},
 };
 globalThis.chrome={webRequest:{onBeforeRequest},storage:{session}};
 const module=await import(`../extension/youtube-session.js?observe=${Math.random()}`);
 return {module,values,listeners,onBeforeRequest,get adds(){return adds;},get removes(){return removes;},get gets(){return gets;},get sets(){return sets;},get getBlocked(){return !!blockedGet;},blockNextGet(){blockNextGet=true;},releaseGet(){blockedGet?.();},restore(){globalThis.chrome=previousChrome;}};
}

const request=(tabId,documentId,id,poToken=[1,2],timeStamp=Date.now())=>({
 tabId,documentId,frameId:0,method:'POST',timeStamp,url:`https://rr.googlevideo.com/videoplayback?id=${id}`,
 requestBody:{raw:[{bytes:makeBody(poToken).buffer.slice(0)}]},
});
const descriptor=(tabId,documentId,id)=>({tabId,documentId,platform:{streamingData:{serverAbrStreamingUrl:`https://rr.googlevideo.com/videoplayback?id=${id}`}}});

test('SABR listener and session writes exist only during an active observation',async()=>{
 const rt=await loadObserver();
 try{
  const {beginYoutubeSessionObservation:begin,endYoutubeSessionObservation:end,youtubeSession}=rt.module;
  assert.equal(rt.listeners.size,0);assert.equal(rt.adds,0);
  assert.equal(await youtubeSession(descriptor(10,'doc-10','stream-10')),null);assert.equal(rt.gets,0);
  const first=begin(10),second=begin(20);assert.equal(rt.adds,1);assert.equal(rt.listeners.size,1);
  rt.onBeforeRequest.emit(request(10,'doc-10','stream-10',[1]));
  rt.onBeforeRequest.emit(request(20,'doc-20','stream-20',[2]));
  rt.onBeforeRequest.emit(request(30,'doc-30','unobserved',[3]));
  const a=await youtubeSession(descriptor(10,'doc-10','stream-10'));
  const b=await youtubeSession(descriptor(20,'doc-20','stream-20'));
  assert.equal(a.tabId,10);assert.equal(b.tabId,20);
  await end(10,first);assert.equal(rt.removes,0);assert.equal(rt.listeners.size,1);
  assert.equal(await youtubeSession(descriptor(10,'doc-10','stream-10')),null);
  assert.equal((await youtubeSession(descriptor(20,'doc-20','stream-20'))).tabId,20);
  rt.onBeforeRequest.emit(request(10,'doc-10','stream-10',[4]));
  rt.onBeforeRequest.emit(request(20,'doc-20','stream-20',[5]));
  assert.equal((await youtubeSession(descriptor(10,'doc-10','stream-10'))),null);
  assert.equal((await youtubeSession(descriptor(20,'doc-20','stream-20'))).poLength,1);
  assert.ok(rt.values.youtubeSessions.every(item=>item.tabId!==30));
  await end(20,second);assert.equal(rt.removes,1);assert.equal(rt.listeners.size,0);
  assert.deepEqual(rt.values.youtubeSessions,[]);
 }finally{rt.restore();}
});

test('begin removes stale persisted captures only for its tab',async()=>{
 const rt=await loadObserver({records:[
  {tabId:19,documentId:'old-doc',streamId:'old-stream',observationId:'old-observation',createdAt:Date.now(),body:'old'},
  {tabId:20,documentId:'other-doc',streamId:'other-stream',observationId:'other-observation',createdAt:Date.now(),body:'other'},
 ]});
 try{
  const token=rt.module.beginYoutubeSessionObservation(19);
  assert.equal(await rt.module.youtubeSession(descriptor(19,'old-doc','old-stream')),null);
  assert.deepEqual(rt.values.youtubeSessions.map(item=>item.tabId),[20]);
  await rt.module.endYoutubeSessionObservation(19,token);
  assert.deepEqual(rt.values.youtubeSessions.map(item=>item.tabId),[20]);
 }finally{rt.restore();}
});

test('a stronger proof-of-origin token remains preferred for the same stream',async()=>{
 const rt=await loadObserver();
 try{
  const token=rt.module.beginYoutubeSessionObservation(12),target=descriptor(12,'doc-12','stream-12');
  rt.onBeforeRequest.emit(request(12,'doc-12','stream-12',[1,2,3,4]));
  rt.onBeforeRequest.emit(request(12,'doc-12','stream-12',[8,9]));
  const capture=await rt.module.youtubeSession(target);
  assert.equal(capture.poLength,4);
  const seed=VideoPlaybackAbrRequest.decode(Uint8Array.from(atob(capture.body),character=>character.charCodeAt(0)));
  assert.deepEqual([...seed.streamerContext.poToken],[1,2,3,4]);
  await rt.module.endYoutubeSessionObservation(12,token);
 }finally{rt.restore();}
});

test('stop and reopen invalidates pending writes and old listener callbacks',async()=>{
 const rt=await loadObserver();
 try{
  const {beginYoutubeSessionObservation:begin,endYoutubeSessionObservation:end,youtubeSession}=rt.module,target=descriptor(15,'doc-15','stream-15');
  const old=begin(15);await youtubeSession(target);
  rt.blockNextGet();rt.onBeforeRequest.emit(request(15,'doc-15','stream-15',[1]));
  for(let i=0;i<20&&!rt.getBlocked;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rt.getBlocked,true);
  const oldListener=[...rt.listeners][0],stopping=end(15,old);
  assert.equal(await youtubeSession(target),null,'stopped observation is unavailable immediately');
  const current=begin(15);assert.notEqual(current,old);assert.equal(rt.adds,2);
  rt.onBeforeRequest.emit(request(15,'doc-15','stream-15',[7]));
  oldListener(request(15,'doc-15','stream-15',[9]));
  rt.releaseGet();await stopping;
  const capture=await youtubeSession(target);
  assert.ok(capture.url.includes('id=stream-15'));
  const seed=VideoPlaybackAbrRequest.decode(Uint8Array.from(atob(capture.body),character=>character.charCodeAt(0)));
  assert.deepEqual([...seed.streamerContext.poToken],[7]);
  assert.equal(rt.values.youtubeSessions.length,1);
  await end(15,current);assert.equal(await youtubeSession(target),null);assert.equal(rt.listeners.size,0);
 }finally{rt.restore();}
});

test('a stale request timestamp is ignored after one tab restarts while another remains active',async()=>{
 const rt=await loadObserver();
 try{
  const {beginYoutubeSessionObservation:begin,endYoutubeSessionObservation:end,youtubeSession}=rt.module;
  const old=begin(17),other=begin(18),otherTarget=descriptor(18,'doc-18','stream-18');
  rt.onBeforeRequest.emit(request(18,'doc-18','stream-18',[2]));
  await youtubeSession(otherTarget);
  await end(17,old);
  const current=begin(17),target=descriptor(17,'doc-17','stream-17');
  assert.equal(rt.adds,1,'the listener stays registered for the other tab');
  rt.onBeforeRequest.emit(request(17,'doc-17','stream-17',[9],0));
  assert.equal(await youtubeSession(target),null);
  rt.onBeforeRequest.emit(request(17,'doc-17','stream-17',[3]));
  assert.equal((await youtubeSession(target)).poLength,1);
  assert.equal(await end(17,old),false,'a stale token cannot stop a reopened tab');
  assert.equal((await youtubeSession(target)).poLength,1);
  await end(17,current);assert.equal(await youtubeSession(target),null);
  assert.equal((await youtubeSession(otherTarget)).poLength,1);
  await end(18,other);assert.equal(rt.listeners.size,0);
 }finally{rt.restore();}
});
