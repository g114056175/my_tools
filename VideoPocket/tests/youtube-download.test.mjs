import test from 'node:test';
import assert from 'node:assert/strict';
import { assertComplete, assertRangeComplete, downloadYoutube, setSabrStreamForTests } from '../extension/youtube-download.js';
import { SabrStream, VideoPlaybackAbrRequest } from '../extension/vendor/sabr.js';

const segment = (number, start, end, init = false) => ({
  segmentNumber: number, startTimeMs: start, endTimeMs: end,
  durationMs: end - start, mediaHeader: { isInitializationSegment: init }
});
const track = (segments, endSegmentNumber = 2) => ({
  formatInitializationMetadata: { endSegmentNumber, durationUnits: 6000, durationTimescale: 1000 },
  downloadedSegments: new Map(segments.map(s => [s.segmentNumber, s])),
  consumedSegments: new Set(segments.map(s => s.segmentNumber))
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function captureFetchFunction(request,{bodyReadTimeoutMs=20,isPaused}={}){
 const configs=[];
 class FakeSabr{
  constructor(config){configs.push(config);this.buildRequestBody=()=>new Uint8Array();}
  on(){}
  start(){const closed=()=>new ReadableStream({start(controller){controller.close();}});return {videoStream:closed(),audioStream:closed()};}
  abort(){}
 }
 setSabrStreamForTests(FakeSabr);
 const seed=VideoPlaybackAbrRequest.encode({initializationFormatIds:[],bufferedRanges:[],selectedAudioFormatIds:[],selectedVideoFormatIds:[],selectedCaptionFormatIds:[],ssapPlaybackInfos:[],field1000:[],streamerContext:{clientInfo:{},sabrContexts:[],unsentSabrContexts:[]},videoPlaybackUstreamerConfig:new Uint8Array()}).finish();
 const body=btoa(String.fromCharCode(...seed)),source={duration:10,descriptor:{platform:{id:'x'}},formats:[{itag:137,ext:'mp4',videoCodec:'avc1'},{itag:140,ext:'m4a',audioCodec:'mp4a'}]};
 try{
  await assert.rejects(downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},new AbortController().signal,()=>{},async()=>({url:'x',body}),request,undefined,{start:1,end:2},{bodyReadTimeoutMs,isPaused}),error=>error.code==='YOUTUBE_RANGE_INCOMPLETE');
  return configs[0].fetchFunction;
 }finally{setSabrStreamForTests();}
}

test('a missing YouTube session has an explicit cause before requesting video or audio data',async()=>{
 for(const range of [undefined,{start:1,end:3}]){
  await assert.rejects(downloadYoutube({descriptor:{platform:{id:'abcdefghijk'}}},{},new AbortController().signal,()=>{},async()=>null,()=>assert.fail('no media request without a session'),undefined,range),{code:'YOUTUBE_SESSION_UNAVAILABLE',sourceStage:'youtube-session'});
 }
});

test('YouTube range validation accepts keyframe preroll and coverage past end', () => {
  const result = assertRangeComplete(track([
    segment(0, 0, 0, true), segment(10, 4000, 5000), segment(11, 5000, 6000)
  ]), { startMs: 4500 }, 5500);
  assert.deepEqual(result, { startTimeMs: 4000, endTimeMs: 6000 });
});

test('YouTube range validation rejects gaps and incomplete slow tracks', () => {
  assert.throws(() => assertRangeComplete(track([
    segment(0, 0, 0, true), segment(10, 4000, 5000), segment(12, 5100, 6000)
  ]), { startMs: 4500 }, 5500), /不連續/);
  assert.throws(() => assertRangeComplete(track([
    segment(0, 0, 0, true), segment(10, 4000, 5000)
  ]), { startMs: 4500 }, 5500), /未覆蓋/);
});

test('YouTube full download validation remains strict', () => {
  const complete = track([segment(0, 0, 0, true), segment(1, 0, 3000), segment(2, 3000, 6000)], 2);
  assert.doesNotThrow(() => assertComplete(complete, 6000));
  complete.downloadedSegments.delete(1);
  assert.throws(() => assertComplete(complete, 6000), /不完整/);
});

test('YouTube range download starts at requested time, waits for slow track, and stops queued tail', async () => {
  let fake;
  class FakeSabr {
    constructor(){ this.listeners = new Map(); this.aborted = false; fake = this; this.buildRequestBody = () => new Uint8Array(); }
    on(name, fn){ this.listeners.set(name, fn); }
    emit(name, value){ this.listeners.get(name)?.(value); }
    start(options){
      this.options = options;
      const make = type => { let controller; const stream = new ReadableStream({ start(c){ controller = c; } }); return { stream, controller }; };
      const v = make('video'), a = make('audio'); this.v = v; this.a = a;
      queueMicrotask(() => this.play(v, a));
      return { videoStream: v.stream, audioStream: a.stream };
    }
    track(format, type, segments){ return { formatId: format, endSegmentNum: 9, endTimeMs: 10000, trackedSegments: new Map(segments.map(s => [s.segmentNumber, s])) }; }
    async play(v, a){
      const video = { itag: 137 }, audio = { itag: 140 };
      const init = (n, length) => ({ segmentNumber:n, startTimeMs:0, endTimeMs:0, durationMs:0, mediaHeader:{ isInitializationSegment:true, segmentLengthBytes:length } });
      const seg = (n, start, end, length) => ({ segmentNumber:n, startTimeMs:start, endTimeMs:end, durationMs:end-start, mediaHeader:{ isInitializationSegment:false, segmentLengthBytes:length } });
      const vs=[init(0,1),seg(1,0,2000,2),seg(2,2000,4000,2),seg(3,4000,6000,2)], as=[init(0,1),seg(1,0,2000,2),seg(2,2000,4000,2),seg(3,4000,6000,2)];
      this.emit('formatInitialization', this.track(video,'video',[vs[0]])); this.emit('formatInitialization', this.track(audio,'audio',[as[0]]));
      v.controller.enqueue(new Uint8Array([1])); a.controller.enqueue(new Uint8Array([1]));
      for(let i=1;i<3;i++){
        v.controller.enqueue(new Uint8Array([2, i])); vs.splice(0,i+1, ...vs.slice(0,i+1)); this.emit('trackStateUpdate',{video:this.track(video,'video',vs.slice(0,i+1)),audio:this.track(audio,'audio',as.slice(0,1))});
        if(i===1){ a.controller.enqueue(new Uint8Array([2, i])); as.splice(0,i+1, ...as.slice(0,i+1)); this.emit('trackStateUpdate',{video:this.track(video,'video',vs.slice(0,i+1)),audio:this.track(audio,'audio',as.slice(0,i+1))}); }
      }
      await new Promise(resolve => setTimeout(resolve, 80));
      if(!this.aborted){ a.controller.enqueue(new Uint8Array([2,2])); as.splice(0,3, ...as.slice(0,3)); this.emit('trackStateUpdate',{video:this.track(video,'video',vs.slice(0,3)),audio:this.track(audio,'audio',as.slice(0,3))}); }
      await new Promise(resolve => setTimeout(resolve, 15));
      if(!this.aborted){ v.controller.enqueue(new Uint8Array([9,9])); a.controller.enqueue(new Uint8Array([9,9])); }
    }
    abort(){ this.aborted = true; this.v?.controller.error(new Error('aborted')); this.a?.controller.error(new Error('aborted')); }
  }
  setSabrStreamForTests(FakeSabr);
  try {
    const seed = VideoPlaybackAbrRequest.encode({ initializationFormatIds:[], bufferedRanges:[], selectedAudioFormatIds:[], selectedVideoFormatIds:[], selectedCaptionFormatIds:[], ssapPlaybackInfos:[], field1000:[], streamerContext:{ clientInfo:{}, sabrContexts:[], unsentSabrContexts:[] }, videoPlaybackUstreamerConfig:new Uint8Array() }).finish();
    const body = btoa(String.fromCharCode(...seed));
    const source = { duration:10, descriptor:{ platform:{id:'x'} }, formats:[{itag:137,ext:'mp4',videoCodec:'avc1'},{itag:140,ext:'m4a',audioCodec:'mp4a'}] };
    const result = await downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},new AbortController().signal,()=>{},async()=>({url:'x',body}),async()=>({}),undefined,{start:1,end:3});
    assert.equal(fake.options.startTimeMs,1000);
    assert.equal(fake.aborted,true);
    assert.equal(result.length,2);
    assert.deepEqual([...result[0].bytes],[1,2,1,2,2]);
    assert.deepEqual([...result[1].bytes],[1,2,1,2,2]);
    assert.equal([...result[0].bytes].includes(9),false);
    let appended = 0;
    const slowSink = async () => ({ append: async bytes => { await new Promise(resolve => setTimeout(resolve, 3)); appended += bytes.length; }, finish: async () => ({ path:'slow' }), abort: async () => {} });
    const slowResult = await downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},new AbortController().signal,()=>{},async()=>({url:'x',body}),async()=>({}),slowSink,{start:1,end:3});
    assert.equal(slowResult.length,2); assert.equal(appended,10);
    await assert.rejects(() => downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},new AbortController().signal,()=>{},async()=>({url:'x',body}),async()=>({}),async()=>({ append: async () => { throw new Error('sink failed'); }, abort: async () => {} }),{start:1,end:3}), /sink failed/);
    let finishes=0;
    await assert.rejects(() => downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},new AbortController().signal,()=>{},async()=>({url:'x',body}),async()=>({}),async()=>({append:async()=>{},finish:async()=>{finishes++;throw new Error('finish failed');},abort:async()=>{}}),{start:1,end:3}),/finish failed/);
    assert.equal(finishes,2,'each of the two sinks is finalized at most once, even after intentional range stop');
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(() => downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},cancelled.signal,()=>{},async()=>({url:'x',body}),async()=>({}),undefined,{start:1,end:3}), /已取消/);
  } finally { setSabrStreamForTests(); }
});

test('YouTube SABR segment requests use the header-only timeout policy and preserve both abort signals', async () => {
  const configs = [], forwarded = [];
  class FakeSabr {
    constructor(config) { configs.push(config); this.buildRequestBody = () => new Uint8Array(); }
    on() {}
    start() {
      const closed = () => new ReadableStream({ start(controller) { controller.close(); } });
      return { videoStream: closed(), audioStream: closed() };
    }
    abort() {}
  }
  setSabrStreamForTests(FakeSabr);
  const seed = VideoPlaybackAbrRequest.encode({ initializationFormatIds:[], bufferedRanges:[], selectedAudioFormatIds:[], selectedVideoFormatIds:[], selectedCaptionFormatIds:[], ssapPlaybackInfos:[], field1000:[], streamerContext:{ clientInfo:{}, sabrContexts:[], unsentSabrContexts:[] }, videoPlaybackUstreamerConfig:new Uint8Array() }).finish();
  const body = btoa(String.fromCharCode(...seed));
  const source = { duration:10, descriptor:{ platform:{id:'x'} }, formats:[{itag:137,ext:'mp4',videoCodec:'avc1'},{itag:140,ext:'m4a',audioCodec:'mp4a'}] };
  const request = async (_url, options) => { forwarded.push(options); return new Response(null); };
  const originalTimeout = AbortSignal.timeout;
  let timeoutCalls = 0;
  AbortSignal.timeout = () => { timeoutCalls++; throw new Error('unexpected whole-request timeout'); };
  try {
    const makeConfig = async callerSignal => {
      await assert.rejects(
        downloadYoutube(source,{video:source.formats[0],audio:source.formats[1]},callerSignal,()=>{},async()=>({url:'x',body}),request,undefined,{start:1,end:2}),
        error => error.code === 'YOUTUBE_RANGE_INCOMPLETE'
      );
      return configs.at(-1);
    };

    const callerA = new AbortController(), vendorA = new AbortController();
    const configA = await makeConfig(callerA.signal);
    await configA.fetchFunction('https://example.test/sabr', { signal:vendorA.signal, headers:{'x-test':'kept'} });
    const optionsA = forwarded.at(-1);
    assert.equal(optionsA.sourceStage, 'stream-segment');
    assert.equal(optionsA.credentials, 'include');
    assert.equal(optionsA.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(optionsA.headers['x-test'], 'kept');
    assert.equal(optionsA.signal.aborted, false);
    vendorA.abort();
    assert.equal(optionsA.signal.aborted, true, 'SABR cancellation reaches the request');
    assert.equal(callerA.signal.aborted, false);

    const callerB = new AbortController(), vendorB = new AbortController();
    const configB = await makeConfig(callerB.signal);
    await configB.fetchFunction('https://example.test/sabr', { signal:vendorB.signal });
    const optionsB = forwarded.at(-1);
    callerB.abort();
    assert.equal(optionsB.signal.aborted, true, 'caller cancellation reaches the request');
    assert.equal(vendorB.signal.aborted, false);
    assert.equal(timeoutCalls, 0, 'segment body is not capped by a fixed total timeout');
  } finally {
    AbortSignal.timeout = originalTimeout;
    setSabrStreamForTests();
  }
});

test('YouTube body timeout starts only for an active read, aborts the fetch, and cancels the stalled body',async()=>{
 let requestSignal,cancelled=false;
 const fetchFunction=await captureFetchFunction(async(_url,options)=>{
  requestSignal=options.signal;
  return new Response(new ReadableStream({cancel(){cancelled=true;}}));
 },{bodyReadTimeoutMs:30});
 const response=await fetchFunction('https://youtube.test/sabr');
 await wait(45);
 assert.equal(requestSignal.aborted,false,'an unread body has no armed deadline');
 const reader=response.body.getReader();
 const readStarted=performance.now();
 await assert.rejects(reader.read(),error=>error.code==='NETWORK_TIMEOUT'&&error.name==='TimeoutError');
 const readElapsed=performance.now()-readStarted;
 assert.ok(readElapsed>=20&&readElapsed<150,`one stalled read should expire near 30ms, received ${readElapsed}ms`);
 assert.equal(requestSignal.aborted,true,'a body timeout aborts the request signal');
 await wait(0);
 assert.equal(cancelled,true,'a stalled response body is cancelled');
});

test('YouTube body deadline resets for each chunk and does not cap total stream duration',async()=>{
 let requestSignal,index=0;
 const fetchFunction=await captureFetchFunction(async(_url,options)=>{
  requestSignal=options.signal;
  return new Response(new ReadableStream({async pull(controller){
   await wait(15);
   if(index===8){controller.close();return;}
   controller.enqueue(Uint8Array.of(++index));
  }}));
 },{bodyReadTimeoutMs:50});
 const started=Date.now(),response=await fetchFunction('https://youtube.test/sabr'),reader=response.body.getReader(),bytes=[];
 while(true){const packet=await reader.read();if(packet.done)break;bytes.push(packet.value[0]);}
 assert.deepEqual(bytes,[1,2,3,4,5,6,7,8]);
 assert.ok(Date.now()-started>50,'the body continues beyond one read deadline');
 await wait(60);
 assert.equal(requestSignal.aborted,false,'completed reads leave no timeout behind');
});

test('YouTube body idle time excludes request cooldown and user pause',async()=>{
 let requestSignal,paused=false;
 const fetchFunction=await captureFetchFunction(async(_url,options)=>{
  requestSignal=options.signal;
  await wait(60); // The request gate may honor Retry-After before returning headers.
  return new Response(new ReadableStream({start(){}}));
 },{bodyReadTimeoutMs:30,isPaused:()=>paused});
 const response=await fetchFunction('https://youtube.test/sabr'),reader=response.body.getReader();
 let settled=false;
 const pending=reader.read().then(value=>{settled=true;return value;},error=>{settled=true;throw error;});
 await wait(5);paused=true;
 await wait(75);
 assert.equal(settled,false,'a pending read may remain idle while the transfer is paused');
 paused=false;
 await assert.rejects(pending,error=>error.code==='NETWORK_TIMEOUT');
 assert.equal(requestSignal.aborted,true);
});

test('cancelling an active YouTube body read clears its deadline and underlying reader',async()=>{
 let requestSignal,cancelled=false;
 const fetchFunction=await captureFetchFunction(async(_url,options)=>{
  requestSignal=options.signal;
  return new Response(new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(1));},cancel(){cancelled=true;}}));
 },{bodyReadTimeoutMs:40});
 const vendorSignal=new AbortController(),response=await fetchFunction('https://youtube.test/sabr',{signal:vendorSignal.signal}),reader=response.body.getReader();
 assert.deepEqual([...((await reader.read()).value)], [1]);
 const pending=reader.read(),reason=new DOMException('cancelled','AbortError');
 await wait(5);vendorSignal.abort(reason);
 await assert.rejects(pending,error=>error===reason);
 assert.equal(requestSignal.reason,reason);
 await wait(60);
 assert.equal(cancelled,true,'cancellation reaches the original response reader');
 assert.equal(requestSignal.reason,reason,'no later timeout replaces the cancellation');
});

test('real vendor SABR exhausts its retries and rejects when response bodies stop reading',{timeout:15000},async()=>{
 setSabrStreamForTests(SabrStream);
 const seed=VideoPlaybackAbrRequest.encode({initializationFormatIds:[],bufferedRanges:[],selectedAudioFormatIds:[],selectedVideoFormatIds:[],selectedCaptionFormatIds:[],ssapPlaybackInfos:[],field1000:[],streamerContext:{clientInfo:{},sabrContexts:[],unsentSabrContexts:[]},videoPlaybackUstreamerConfig:new Uint8Array()}).finish();
 const body=btoa(String.fromCharCode(...seed)),formats=[{itag:137,ext:'mp4',mimeType:'video/mp4',videoCodec:'avc1',height:720},{itag:140,ext:'m4a',mimeType:'audio/mp4',audioCodec:'mp4a'}];
 const source={duration:60,descriptor:{platform:{id:'abcdefghijk'}},formats};let requests=0,cancellations=0,aborts=0;const abortReasons=[];
 const request=async(_url,options)=>{
  requests++;assert.equal(options.sourceStage,'stream-segment');assert.equal(options.headers.accept,'application/vnd.yt-ump');
  options.signal.addEventListener('abort',()=>{aborts++;abortReasons.push(options.signal.reason?.code);},{once:true});
  return new Response(new ReadableStream({cancel(){cancellations++;}}),{headers:{'content-type':'application/vnd.yt-ump'}});
 };
 try{
  await assert.rejects(
   downloadYoutube(source,{video:formats[0],audio:formats[1]},new AbortController().signal,()=>{},async()=>({url:'https://youtube.test/sabr',body}),request,undefined,undefined,{bodyReadTimeoutMs:30}),
   error=>error.name==='TimeoutError'&&error.code==='NETWORK_TIMEOUT'&&error.sourceStage==='stream-segment'&&error.message==='YouTube 串流讀取逾時'
  );
  assert.equal(requests,5,'vendor maxRetries=4 means five total segment requests');
  assert.equal(cancellations,5,'each hanging response body is cancelled');
  assert.equal(aborts,5,'each timed-out request signal is aborted');
  assert.deepEqual(abortReasons,Array(5).fill('NETWORK_TIMEOUT'));
 }finally{setSabrStreamForTests();}
});
