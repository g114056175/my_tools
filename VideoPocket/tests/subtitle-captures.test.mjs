import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPTURE_PREFIX,CAPTURE_VERSION,captureScope,captureKey,createSubtitleCaptureManager} from '../extension/subtitle-captures.js';

function sessionStorage(){
 const values={};
 return {
  values,
  async get(key){if(key===null)return structuredClone(values);if(Array.isArray(key))return Object.fromEntries(key.filter(k=>k in values).map(k=>[k,structuredClone(values[k])]));return key in values?{[key]:structuredClone(values[key])}:{};},
  async set(items){Object.assign(values,structuredClone(items));},
  async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete values[key];}
 };
}

const track={trackId:'zh|true|bili:BVfixture:11:caption',language:'zh',name:'中文',automatic:true,pageSource:'bilibili-api',pageTrackId:'caption'};
const page=(id)=>({url:'https://www.bilibili.com/video/BVfixture/?p=1&trackid='+id,documentId:'document-a',platform:{site:'bilibili',bvid:'BVfixture',cid:11,page:1},media:{mediaKey:1},videos:[{url:'https://video.example/media.m4s'}]});

test('capture identity stays per tab, document, media and selected source',async()=>{
 const one=await captureScope(1,page('a'),0),same=await captureScope(1,page('b'),0),otherTab=await captureScope(2,page('a'),0),otherDocument=await captureScope(1,{...page('a'),documentId:'document-b'},0);
 assert.equal(one,same,'irrelevant Bilibili query parameters do not split the same page identity');
 assert.equal(one,await captureScope(1,{...page('a'),media:{mediaKey:100},videos:[{url:'https://video.example/new-blob'}]},0),'player replacement does not discard same-video Bilibili captions');
 assert.notEqual(one,otherTab);
 assert.notEqual(one,otherDocument);
 assert.notEqual(await captureKey(1,one,track),await captureKey(2,one,track));
 assert.notEqual(await captureKey(1,one,track),await captureKey(1,one,{...track,trackId:'en|true|bili:BVfixture:11:caption'}));
});

test('capture retries transient failures for the same track and stores the full result',async()=>{
 const storage=sessionStorage(),waits=[];let attempts=0;
 const manager=createSubtitleCaptureManager({storage,read:async request=>{assert.equal(request.track.trackId,track.trackId);if(++attempts<3)throw Object.assign(new Error('SUBTITLE_UNAVAILABLE'),{code:'SUBTITLE_UNAVAILABLE'});return {cues:[{start:0,end:2,text:'字幕完整'}],language:'zh'};},sleep:async ms=>waits.push(ms),retryDelays:[10,20]});
 const scope='scope-one',key=await captureKey(1,scope,track),result=await manager.start({key,tabId:1,scope,track});
 assert.equal(attempts,3);
 assert.deepEqual(waits,[10,20]);
 assert.equal(result.cues[0].text,'字幕完整');
 assert.equal(storage.values[key].state,'complete');
 assert.equal(storage.values[key].value.cues.length,1);
});

test('capture manager persists cues together with the restore warning code',async()=>{
 const storage=sessionStorage(),youtubeTrack={...track,pageSource:'youtube-page',pageTrackId:'youtube:0'},manager=createSubtitleCaptureManager({storage,read:async()=>({cues:[{start:0,end:1,text:'字幕保留'}],warningCode:'YT_RESTORE_UNCONFIRMED'})});
 const scope='scope-restore-warning',key=await captureKey(9,scope,youtubeTrack),result=await manager.start({key,tabId:9,scope,track:youtubeTrack});
 assert.equal(result.cues[0].text,'字幕保留');assert.equal(result.warningCode,'YT_RESTORE_UNCONFIRMED');
 assert.deepEqual(storage.values[key].value,{cues:[{start:0,end:1,text:'字幕保留'}],warningCode:'YT_RESTORE_UNCONFIRMED',trackId:youtubeTrack.trackId});
});

test('an in-flight capture completes in session storage after its popup caller closes',async()=>{
 const storage=sessionStorage();let finishRead;let attempts=0;
 const manager=createSubtitleCaptureManager({storage,read:()=>{attempts++;return new Promise(resolve=>{finishRead=resolve;});},retryDelays:[]});
 const scope='scope-three',key=await captureKey(3,scope,track),operation=manager.start({key,tabId:3,scope,track});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(storage.values[key].state,'running');
 // The popup can disappear here; the independent background task still owns this promise.
 finishRead({cues:[{start:1,end:3,text:'背景完成'}]});
 await operation;
 assert.equal(attempts,1);
 assert.equal(storage.values[key].state,'complete');
 assert.equal(storage.values[key].value.cues[0].text,'背景完成');
});

test('two popup requests for the same active source share one background read',async()=>{
 const storage=sessionStorage();let finishRead,attempts=0;
 const manager=createSubtitleCaptureManager({storage,read:()=>{attempts++;return new Promise(resolve=>{finishRead=resolve;});},retryDelays:[]});
 const scope='scope-dedupe',key=await captureKey(5,scope,track),request={key,tabId:5,scope,track},first=manager.start(request);
 await new Promise(resolve=>setImmediate(resolve));const second=manager.start(request);
 finishRead({cues:[{start:0,end:1,text:'只讀一次'}]});
 assert.equal((await first).cues[0].text,'只讀一次');
 assert.equal((await second).cues[0].text,'只讀一次');
 assert.equal(attempts,1);
});

test('a new completed caption replaces the previous completed cache across tabs',async()=>{
 const storage=sessionStorage(),manager=createSubtitleCaptureManager({storage,read:async request=>({cues:[{start:0,end:1,text:request.tabId+'-'+request.scope}]})});
 const firstScope='scope-1',firstKey=await captureKey(1,firstScope,track);
 await manager.start({key:firstKey,tabId:1,scope:firstScope,track});
 const nextScope='scope-2',nextKey=await captureKey(2,nextScope,track);
 await manager.start({key:nextKey,tabId:2,scope:nextScope,track});
 assert.equal(storage.values[firstKey],undefined);
 assert.equal((await manager.forTab(1,firstScope)).length,0);
 assert.equal((await manager.forTab(2,nextScope)).length,1);
 assert.equal(Object.values(storage.values).filter(record=>record?.state==='complete').length,1);
 await manager.removeTab(2);
 assert.equal((await manager.forTab(2,nextScope)).length,0);
 assert.equal(Object.values(storage.values).filter(record=>record?.state==='complete').length,0);
});

test('concurrent captures retain running records and keep only the last completion',async()=>{
 const storage=sessionStorage(),finish=new Map(),manager=createSubtitleCaptureManager({storage,read:request=>new Promise(resolve=>finish.set(request.scope,resolve)),retryDelays:[]});
 const requests=await Promise.all([1,2].map(async tabId=>{const scope='scope-concurrent-'+tabId,key=await captureKey(tabId,scope,track);return {scope,key,tabId};}));
 const operations=requests.map(request=>manager.start({...request,track}));
 await new Promise(resolve=>setImmediate(resolve));
 for(const request of requests)assert.equal(storage.values[request.key].state,'running');
 finish.get(requests[0].scope)({cues:[{start:0,end:1,text:'第一筆完成'}]});
 assert.equal((await operations[0]).cues[0].text,'第一筆完成');
 assert.equal(storage.values[requests[1].key].state,'running');
 assert.equal(Object.values(storage.values).filter(record=>record?.state==='complete').length,1);
 finish.get(requests[1].scope)({cues:[{start:0,end:1,text:'第二筆完成'}]});
 assert.equal((await operations[1]).cues[0].text,'第二筆完成');
 assert.equal(storage.values[requests[0].key],undefined);
 assert.equal(storage.values[requests[1].key].state,'complete');
 assert.equal(Object.values(storage.values).filter(record=>record?.state==='complete').length,1);
});

test('removing a tab during capture keeps another tab cache and blocks the old completion',async()=>{
 const storage=sessionStorage();let finishOld;
 const manager=createSubtitleCaptureManager({storage,read:request=>request.tabId===31?new Promise(resolve=>{finishOld=resolve;}):Promise.resolve({cues:[{start:0,end:1,text:'另一分頁'}]}),retryDelays:[]});
 const oldScope='scope-closing',oldKey=await captureKey(31,oldScope,track),oldOperation=manager.start({key:oldKey,tabId:31,scope:oldScope,track});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(storage.values[oldKey].state,'running');
 const keptScope='scope-kept',keptKey=await captureKey(32,keptScope,track);
 await manager.start({key:keptKey,tabId:32,scope:keptScope,track});
 await manager.removeTab(31);
 finishOld({cues:[{start:0,end:1,text:'已關閉分頁的舊字幕'}]});await oldOperation;
 assert.equal(storage.values[oldKey],undefined);
 assert.equal(storage.values[keptKey].state,'complete');
 assert.equal(storage.values[keptKey].value.cues[0].text,'另一分頁');
 assert.equal(Object.values(storage.values).filter(record=>record?.state==='complete').length,1);
});

test('an uncachable large result still returns and preserves the prior cache',async()=>{
 const storage=sessionStorage(),set=storage.set.bind(storage),oldKey=CAPTURE_PREFIX+'33:old';
 storage.values[oldKey]={version:CAPTURE_VERSION,scope:'old-scope',tabId:33,state:'complete',finishedAt:1,value:{cues:[{start:0,end:1,text:'先前字幕'}]}};
 storage.set=async items=>{
  if(Object.values(items).some(record=>record?.state==='complete'&&record.value?.cues?.[0]?.text?.length>100))throw new Error('QUOTA_BYTES');
  return set(items);
 };
 const manager=createSubtitleCaptureManager({storage,read:async()=>({cues:[{start:0,end:1,text:'大'.repeat(500)}]})});
 const scope='scope-large',key=await captureKey(34,scope,track),result=await manager.start({key,tabId:34,scope,track});
 assert.equal(result.cues[0].text.length,500);
 assert.equal(storage.values[key],undefined);
 assert.equal(storage.values[oldKey].state,'complete');
});
test('legacy subtitle caches are not restored after the Bilibili identity fix',async()=>{
 const storage=sessionStorage(),manager=createSubtitleCaptureManager({storage,read:async()=>({cues:[{start:0,end:1,text:'new'}]})});
 const scope='scope-legacy',key=await captureKey(12,scope,track),oldKey=CAPTURE_PREFIX+'12:legacy';
 storage.values[oldKey]={version:1,scope,tabId:12,state:'complete',track:{trackId:'old'},value:{cues:[{start:0,end:1,text:'疑似錯誤字幕'}]}};
 assert.deepEqual(await manager.forTab(12,scope),[]);
 await manager.clearAll();
 assert.equal(storage.values[oldKey],undefined);
 const result=await manager.start({key,tabId:12,scope,track});
 assert.equal(storage.values[key].version,CAPTURE_VERSION);
 assert.equal(result.cues[0].text,'new');
});

test('ending the Chrome session clears captures and blocks late writes from active tasks',async()=>{
 const storage=sessionStorage();let finishRead;
 const manager=createSubtitleCaptureManager({storage,read:()=>new Promise(resolve=>{finishRead=resolve;}),retryDelays:[]});
 const scope='scope-end',key=await captureKey(6,scope,track),operation=manager.start({key,tabId:6,scope,track});
 await new Promise(resolve=>setImmediate(resolve));
 await manager.clearAll();
 finishRead({cues:[{start:0,end:1,text:'不應在會期結束後留存'}]});
 await operation;
 assert.deepEqual(Object.keys(storage.values).filter(name=>name.startsWith('subtitleCapture:')),[]);
});

test('navigation invalidates an old pending capture so a new capture can start',async()=>{
 const storage=sessionStorage();let firstFinish,attempts=0;
 const manager=createSubtitleCaptureManager({storage,read:request=>{attempts++;if(attempts===1)return new Promise(resolve=>{firstFinish=resolve;});return Promise.resolve({cues:[{start:0,end:1,text:'新頁'}]});},retryDelays:[]});
 const scope='scope-navigation',key=await captureKey(7,scope,track),first=manager.start({key,tabId:7,scope,track});
 await new Promise(resolve=>setImmediate(resolve));await manager.removeTab(7);
 const second=manager.start({key,tabId:7,scope,track});assert.equal((await second).cues[0].text,'新頁');
 firstFinish({cues:[{start:0,end:1,text:'舊頁'}]});await first;
 assert.equal(attempts,2);assert.equal(storage.values[key].value.cues[0].text,'新頁');
});

test('session clear invalidates pending deduplication',async()=>{
 const storage=sessionStorage();let firstFinish,attempts=0;
 const manager=createSubtitleCaptureManager({storage,read:()=>{attempts++;if(attempts===1)return new Promise(resolve=>{firstFinish=resolve;});return Promise.resolve({cues:[{start:0,end:1,text:'新會期'}]});},retryDelays:[]});
 const scope='scope-session',key=await captureKey(8,scope,track),first=manager.start({key,tabId:8,scope,track});
 await new Promise(resolve=>setImmediate(resolve));await manager.clearAll();
 const second=manager.start({key,tabId:8,scope,track});assert.equal((await second).cues[0].text,'新會期');
 firstFinish({cues:[{start:0,end:1,text:'舊會期'}]});await first;
 assert.equal(attempts,2);assert.equal(storage.values[key].value.cues[0].text,'新會期');
});

test('identity changes and access denial fail immediately instead of retrying another caption',async()=>{
 for(const code of ['SOURCE_CHANGED','HTTP_AUTH']){
  const storage=sessionStorage();let attempts=0;
  const manager=createSubtitleCaptureManager({storage,read:async()=>{attempts++;throw Object.assign(new Error(code),{code});},sleep:async()=>{},retryDelays:[1,2]});
  const scope='scope-'+code,key=await captureKey(4,scope,track);
  await assert.rejects(manager.start({key,tabId:4,scope,track}),new RegExp(code));
  assert.equal(attempts,1);
  assert.equal(storage.values[key].state,'failed');
 }
});

test('Bilibili pipeline failures keep safe detail and do not trigger five outer retry rounds',async()=>{
 const storage=sessionStorage();let attempts=0,waits=0;
 const manager=createSubtitleCaptureManager({storage,read:async()=>{attempts++;throw Object.assign(new Error('https://private/?sign=SECRET'),{code:'BILI_LIST_API',apiCode:-412,subtitleStage:'list'});},sleep:async()=>{waits++;}});
 const scope='bili-details',key=await captureKey(20,scope,track);
 await assert.rejects(manager.start({key,tabId:20,scope,track,platform:'bilibili',selector:{pageSource:'bilibili-api'}}));
 assert.equal(attempts,1);assert.equal(waits,0);assert.equal(storage.values[key].failureDetail.apiCode,-412);assert.equal(storage.values[key].failureDetail.subtitleStage,'list');
 assert.ok(!JSON.stringify(storage.values).includes('SECRET'));
});
