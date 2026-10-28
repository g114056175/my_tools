import test from 'node:test';
import assert from 'node:assert/strict';

const VIDEO_ID='abcdefghijk';

async function loadObserver({records=[],blockFirstGet=false}={}){
 const previousChrome=globalThis.chrome,values={youtubeCaptionRequests:structuredClone(records)},listeners=new Set();
 let adds=0,removes=0,blockedGet,blockNextGet=blockFirstGet;
 const onBeforeRequest={
  addListener(listener,filter){adds++;assert.deepEqual(filter,{urls:['https://*.youtube.com/api/timedtext*']});listeners.add(listener);},
  removeListener(listener){removes++;listeners.delete(listener);},
  emit(details){for(const listener of [...listeners])listener(details);},
 };
 const session={
  async get(key){const result={[key]:structuredClone(values[key]||[])};if(blockNextGet){blockNextGet=false;return new Promise(resolve=>{blockedGet=()=>resolve(result);});}return result;},
  async set(update){Object.assign(values,structuredClone(update));},
 };
 globalThis.chrome={webRequest:{onBeforeRequest},storage:{session}};
 const module=await import(`../extension/youtube-captions.js?observe=${Math.random()}`);
 return {module,values,listeners,onBeforeRequest,get adds(){return adds;},get removes(){return removes;},get getBlocked(){return !!blockedGet;},releaseGet(){blockedGet?.();},restore(){globalThis.chrome=previousChrome;}};
}

const request=(tabId,documentId,token)=>({tabId,documentId,frameId:0,method:'GET',url:`https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=zh-TW&pot=${token}`});
const selection=documentId=>({videoId:VIDEO_ID,documentId,captionName:''});

test('timedtext listener is demand registered and stopping one tab preserves another tab',async()=>{
 const rt=await loadObserver();
 try{
  const {beginYoutubeCaptionObservation:begin,endYoutubeCaptionObservation:end,youtubeCaptionRequest:find}=rt.module;
  assert.equal(rt.listeners.size,0);assert.equal(rt.adds,0);
  const first=begin(10),second=begin(20);assert.equal(rt.adds,1);assert.equal(rt.listeners.size,1);
  rt.onBeforeRequest.emit(request(10,'doc-10','first'));
  rt.onBeforeRequest.emit(request(20,'doc-20','second'));
  rt.onBeforeRequest.emit(request(30,'doc-30','unobserved'));
  assert.match(await find(10,selection('doc-10'),'zh-TW',false),/pot=first/);
  assert.match(await find(20,selection('doc-20'),'zh-TW',false),/pot=second/);
  assert.equal(await find(30,selection('doc-30'),'zh-TW',false),undefined);
  await end(10,first);assert.equal(rt.removes,0);assert.equal(rt.listeners.size,1);
  assert.ok(rt.values.youtubeCaptionRequests.every(item=>item.tabId!==10));
  assert.ok(rt.values.youtubeCaptionRequests.some(item=>item.tabId===20));
  rt.onBeforeRequest.emit(request(10,'doc-10','after-stop'));
  rt.onBeforeRequest.emit(request(20,'doc-20','still-active'));
  assert.equal(await find(10,selection('doc-10'),'zh-TW',false),undefined);
  assert.match(await find(20,selection('doc-20'),'zh-TW',false),/pot=still-active/);
  await end(20,second);assert.equal(rt.removes,1);assert.equal(rt.listeners.size,0);
  assert.ok(rt.values.youtubeCaptionRequests.every(item=>item.tabId!==20));
 }finally{rt.restore();}
});

test('stop invalidates pending writes and a reopened tab cannot read its old observation',async()=>{
 const rt=await loadObserver({blockFirstGet:true});
 try{
  const {beginYoutubeCaptionObservation:begin,endYoutubeCaptionObservation:end,youtubeCaptionRequest:find}=rt.module;
  const old=begin(10);rt.onBeforeRequest.emit(request(10,'doc-10','old'));
  for(let i=0;i<20&&!rt.getBlocked;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rt.getBlocked,true);
  const stopping=end(10,old);
  assert.equal(await find(10,selection('doc-10'),'zh-TW',false),undefined,'stopped observations are unavailable immediately');
  rt.onBeforeRequest.emit(request(10,'doc-10','after-stop'));
  const current=begin(10);assert.notEqual(current,old);assert.equal(rt.adds,2);
  rt.onBeforeRequest.emit(request(10,'doc-10','new'));
  rt.releaseGet();await stopping;
  assert.match(await find(10,selection('doc-10'),'zh-TW',false),/pot=new/);
  assert.ok(rt.values.youtubeCaptionRequests.every(item=>item.url.includes('pot=new')));
  assert.equal(await end(10,old),false,'a stale stop token cannot end the reopened observation');
  assert.equal(rt.listeners.size,1);assert.match(await find(10,selection('doc-10'),'zh-TW',false),/pot=new/);
  await end(10,current);assert.equal(rt.listeners.size,0);assert.equal(await find(10,selection('doc-10'),'zh-TW',false),undefined);
 }finally{rt.restore();}
});
