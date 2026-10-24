import {parseByteRange as byteRange,rangeCapability,formatRangeCapability} from '../extension/range-capability.js';
import {fullCutPolicy} from '../extension/full-cut-policy.js';
import {createMediaTransfer} from '../extension/media-transfer.js';
import {resolveNetworkCandidates} from '../extension/source-candidates.js';
import {platformSource} from '../extension/platform-formats.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { HlsParser, parseDash } from '../extension/vendor/parsers.js';
import { mediaChoices, selectedPlan, metadataCodecs, codec, parseMp4Codecs } from '../extension/browser-media.js';
import { parseSubtitles } from '../extension/subtitles.js';
import { classifyFailure } from '../extension/diagnostics.js';
import { TransferControl } from '../extension/transfer-control.js';
import { assembleSegments } from '../extension/ordered-segments.js';
import { createTransferProgress } from '../extension/transfer-progress.js';
import { normalizeRange, planSegmentRange, parseSidx, planIndexedRange, coalesceIndexedSegments } from '../extension/media-range.js';

import {createIndexedRoutes} from '../extension/indexed-routes.js';

const enc = new TextEncoder();
function response(body, { status = 200, range = null, type = 'video/mp2t', chunkDelay=0, chunkSize=0, onEnd=()=>{} } = {}) {
  const bytes = typeof body === 'string' ? enc.encode(body) : new Uint8Array(body);
  let offset=0,ended=false;
  return { ok: status >= 200 && status < 300, status,
    headers: { get: k => k.toLowerCase() === 'content-range' ? range : k.toLowerCase() === 'content-type' ? type : String(bytes.length) },
    text: async () => new TextDecoder().decode(bytes), body: { cancel: async () => {}, getReader: () => ({ read: async()=>{if(offset>=bytes.length){if(!ended){ended=true;onEnd();}return {done:true};}if(chunkDelay)await new Promise(r=>setTimeout(r,chunkDelay));const end=Math.min(bytes.length,offset+(chunkSize||bytes.length)),value=bytes.slice(offset,end);offset=end;return {done:false,value};}, cancel: async () => {} }) } };
}
function diskMock() {
  const files = new Map(),cleanups=[]; let n = 0;
  return { files,cleanups,removeMediaFiles: async scope => {cleanups.push(scope);for(const path of files.keys())if(!scope||path.startsWith(scope+'-'))files.delete(path);}, removeMediaFile: async p => files.delete(p), readMediaFile: async p => new Blob([files.get(p) || new Uint8Array()]),
    createMediaFile: async (scope, name) => { const path = `${scope}-${name}-${++n}`, parts = []; let size = 0; return { path, append: async b => { parts.push(new Uint8Array(b)); size += b.length; }, finish: async () => { const out = new Uint8Array(size); let p = 0; for (const b of parts) { out.set(b, p); p += b.length; } files.set(path, out); return { path, size }; }, abort: async () => {} }; } };
}
async function runtime({ badRange = false,cutFailure=false,indexCount=3,indexDelay=0,requestDelay=0,segmentBytes=10,failPrimary=false,sourcePath,chunkDelay=0,allowFullIndexed=false,saveMode='normal',fullCutFixture=false } = {}) {
  let mediaCompleted=0;
  const master = 'https://range.test/master.m3u8', child = 'https://range.test/child.m3u8';
  const urls = [1, 2, 3].map(i => `https://range.test/${i}.ts`), calls = [], mux = [], messages = [],indexLength=32+12*indexCount;
  let activeIndexes=0,peakIndexes=0;
  const indexedBytes=new Uint8Array(10+indexLength+segmentBytes*indexCount).map((_,i)=>i%251),v=new DataView(indexedBytes.buffer);indexedBytes.fill(0,10,10+indexLength);v.setUint32(10,indexLength);indexedBytes.set([115,105,100,120],14);v.setUint32(22,1);v.setUint32(26,1000);v.setUint16(40,indexCount);
  for(let i=0;i<indexCount;i++){v.setUint32(42+i*12,segmentBytes);v.setUint32(46+i*12,1000);v.setUint32(50+i*12,0x90000000);}
  const fetch = async (url, options = {}) => { const u = String(url); calls.push({ url: u, options });
    if (u === master) return response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720\nchild.m3u8\n', { type: 'application/vnd.apple.mpegurl' });
    if (u === child) return response('#EXTM3U\n#EXT-X-TARGETDURATION:1\n'+[1,2,3].map(i=>`#EXTINF:1,\n${badRange?'#EXT-X-BYTERANGE:1@0\n':''}${i}.ts\n`).join('')+'#EXT-X-ENDLIST\n', { type: 'application/vnd.apple.mpegurl' });
    if(['https://range.test/indexed.mp4','https://range.test/backup.mp4'].includes(u)){
      if (!options.headers?.Range && allowFullIndexed) return response(indexedBytes, { type: 'video/mp4' });
      const m=options.headers?.Range?.match(/^bytes=(\d+)-(\d+)$/);if(!m)throw new Error('unexpected full indexed request');
      if(indexDelay&&Number(m[1])===10){activeIndexes++;peakIndexes=Math.max(peakIndexes,activeIndexes);await new Promise(r=>setTimeout(r,indexDelay));activeIndexes--;}
      if(requestDelay)await new Promise(r=>setTimeout(r,requestDelay));
      if(failPrimary&&u.endsWith('/indexed.mp4'))return response(new Uint8Array(),{status:403});
      return response(indexedBytes.subarray(Number(m[1]),Number(m[2])+1),{status:206,range:`bytes ${m[1]}-${m[2]}/${indexedBytes.length}`,type:'video/mp4',...(chunkDelay&&Number(m[1])>=10+indexLength?{chunkDelay,chunkSize:5,onEnd:()=>mediaCompleted++}:{})});
    }
    if (u === 'https://range.test/file.mp4') return response(fullCutFixture?enc.encode('0000ftypavc1mp4a'):new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]), { type: 'video/mp4' });
    const i = urls.indexOf(u); if (i < 0) throw new Error(`unexpected ${u}`);
    if (options.headers?.Range && badRange) return response(new Uint8Array([1]), { status: 206, range: 'bytes=99-99/100' });
    return response(new Uint8Array([i + 1]), { type: 'video/mp2t', range: options.headers?.Range ? (badRange ? 'bytes=99-99/100' : 'bytes=0-0/1') : null });
  };
  const disk = diskMock(); let listener;
  class Worker {
    constructor(url){this.url=url;this.onmessage=null;}
    postMessage(data){
      mux.push({url:this.url,...data});queueMicrotask(()=>{
        const send=message=>this.onmessage?.({data:message});
        if(data.action==='cancel'){send({type:'error',code:'CANCELLED',errorCode:'CANCELLED',error:'已取消'});return;}
        const cutting=this.url==='range-cut-worker.js',saving=this.url==='save-worker.js';
        if(cutting)for(const progress of [.5,.6,1])send({type:'cutProgress',progress});
        if(cutting&&cutFailure){send({type:'error',errorCode:'RANGE_ENCODER_UNAVAILABLE',error:'unsupported encoder'});return;}
        if(!cutting&&saveMode==='processing-crash'){this.onerror?.({message:'processing failed'});return;}
        const path=saving?data.path:`${data.scope}-${data.output}`,size=8;
        if(!saving)disk.files.set(path,new Uint8Array(size).fill(7));
        if(!cutting&&data.destinationId){
          if(!saving)send({type:'readyToSave',path,size});
          send({type:saving?'progress':'saving',progress:0});
          if(saveMode==='save-crash'){this.onerror?.({message:'target worker failed'});return;}
          if(saveMode==='cancel-save')return;
        }
        const saveFailure={code:'SAVE_FAILED',saveStage:'close-target',saveReason:'permission'};
        send({type:'done',path,size,saved:false,...(!cutting&&saveMode==='target-failure'?{saveFailure}:{})});
      });
    }
    terminate(){}
  }
  const FileCtor = globalThis.File || class File extends Blob { constructor(parts, name, options = {}) { super(parts, options); this.name = name; } };
  const source = await fs.readFile(sourcePath || new URL('../extension/offscreen.js', import.meta.url), 'utf8');
  const code = source.replace(/^import[^;]+;\s*/gm, '');
  const chrome = { runtime: { id: 'range-test', getURL: n => n, sendMessage: async message => {messages.push({...message,mediaCompleted});return { ok: true, result: {} };}, onMessage: { addListener: fn => { listener = fn; } } } };
  const context = { fullCutPolicy,byteRange,rangeCapability,formatRangeCapability,createMediaTransfer,resolveNetworkCandidates,platformSource,HlsParser, parseDash, mediaChoices, selectedPlan, metadataCodecs, codec, parseMp4Codecs, parseSubtitles, classifyFailure: e => ({ code: e.code || 'INTERNAL_ERROR', message: e.stack || e.message }), TransferControl, assembleSegments, createTransferProgress,

    normalizeRange, planSegmentRange, parseSidx, planIndexedRange, coalesceIndexedSegments, createIndexedRoutes, directTransfer: async (format,request,signal,onBytes,sink) => {const response=await request(format.url,{signal}),reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;await sink.append(value);onBytes(value.length);}return sink.finish();}, downloadYoutube: async () => [], chrome, fetch, VideoPocketDiskMedia: disk, crypto: { randomUUID: () => Math.random().toString() }, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, Uint8Array, ArrayBuffer, Blob, File: FileCtor, Worker, setInterval: () => {}, setTimeout, clearTimeout, queueMicrotask, console, performance, document: { createElement: () => { const v = { videoHeight: 720, duration: 3, removeAttribute() {}, load() {} }; Object.defineProperty(v, 'src', { set() { queueMicrotask(() => v.onloadedmetadata?.()); } }); return v; } }, readMp4Metadata: async () => ({}), parseTransportStreamCodecs: () => ({}), mediaCredentials: () => undefined, resolveAnime1: async x => x, decryptHlsSample: async x => x, hlsIv: () => new Uint32Array(4), twitchVodManifest: async () => ({}), verifiedSocialSource: () => true, socialPageResponse: async () => {}, resolveDailymotion: async () => ({}), resolveLinkedMedia: async () => ({}) };
  vm.runInNewContext(code, context, { filename: 'offscreen.js' });
  const call = (action, data) => new Promise((resolve, reject) => listener({ target: 'offscreen', action, ...data }, { id: 'range-test' }, r => r?.ok ? resolve(r.result) : reject(Object.assign(new Error(r?.error), r?.failure || {}, { detail: r }))));
  return { call, calls, mux, urls, messages,disk,indexLength,indexedBytes,get peakIndexes(){return peakIndexes;} };
}

test('full and range target-save failures retain finished bytes until browser download releases them',async()=>{
 for(const range of [undefined,{start:1.2,end:1.8}]){
  const rt=await runtime({saveMode:'target-failure'}),source=await rt.call('inspect',{descriptor:{url:'https://range.test/master.m3u8',title:'clip'}});
  const id=range?'range-fallback':'full-fallback',result=await rt.call('download',{sourceId:source.id,id,kind:'video',height:720,filename:'clip',destinationId:'target',...(range?{range}:{})});
  assert.match(result.url,/^blob:/);assert.equal(result.saveFailure.saveStage,'close-target');
  assert.equal((await fetch(result.url)).headers.get('content-type'),'video/mp4');assert.equal((await(await fetch(result.url)).arrayBuffer()).byteLength,8);
  assert.deepEqual(rt.urls.map(url=>rt.calls.filter(call=>call.url===url).length),range?[0,1,0]:[1,1,1],'saving recovery must not fetch media again');
  assert.equal(rt.disk.cleanups.filter(scope=>scope===id).length,0,'keep completed output during native saving');
  await rt.call('release',{blobId:result.blobId});assert.equal(rt.disk.cleanups.filter(scope=>scope===id).length,1);
  await assert.rejects(fetch(result.url));
 }
});

test('only a sealed output can recover from a worker crash during saving',async()=>{
 const broken=await runtime({saveMode:'processing-crash'}),source=await broken.call('inspect',{descriptor:{url:'https://range.test/master.m3u8',title:'clip'}});
 await assert.rejects(broken.call('download',{sourceId:source.id,id:'broken',kind:'video',height:720,filename:'clip',destinationId:'target'}),{code:'MERGE_FAILED'});
 for(const range of [undefined,{start:1.2,end:1.8}]){
  const rt=await runtime({saveMode:'save-crash'}),source=await rt.call('inspect',{descriptor:{url:'https://range.test/master.m3u8',title:'clip'}});
  const result=await rt.call('download',{sourceId:source.id,id:'sealed',kind:'video',height:720,filename:'clip',destinationId:'target',...(range?{range}:{})});
  assert.match(result.url,/^blob:/);assert.equal(result.saveFailure.saveReason,'worker-failed');
  await rt.call('release',{blobId:result.blobId});
 }
});

test('cancelling full or range saving never opens the browser fallback',async()=>{
 for(const range of [undefined,{start:1.2,end:1.8}]){
  const rt=await runtime({saveMode:'cancel-save'}),source=await rt.call('inspect',{descriptor:{url:'https://range.test/master.m3u8',title:'clip'}});
  const pending=rt.call('download',{sourceId:source.id,id:'cancel-saving',kind:'video',height:720,filename:'clip',destinationId:'target',...(range?{range}:{})});
  const rejected=assert.rejects(pending,{code:'CANCELLED'});
  for(let i=0;i<100&&!rt.messages.some(message=>message.state==='saving');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(rt.messages.some(message=>message.state==='saving'));
  await rt.call('cancel',{id:'cancel-saving'});await rejected;
  assert.equal(rt.disk.cleanups.filter(scope=>scope==='cancel-saving').length,1);
 }
});

test('HLS range fetches only selected segments and routes their source clocks to precise cutting', async () => {
  const rt = await runtime();
  const inspected = await rt.call('inspect', { descriptor: { url: 'https://range.test/master.m3u8', referer: 'https://range.test/watch', title: 'range' } });
  assert.equal(inspected.range.supported, true);
  await rt.call('download', { sourceId: inspected.id, id: 'range-job', kind: 'video', height: 720, filename: 'range', range: { start: 1.2, end: 1.8 } });
  assert.deepEqual(rt.urls.map(u => rt.calls.filter(c => c.url === u).length), [0, 1, 0]);
  const cut=rt.mux.at(-1);assert.equal(cut.url,'range-cut-worker.js');assert.equal(cut.range.start,1.2);assert.equal(cut.range.end,1.8);assert.equal(cut.inputs[0].timelineStart,1);assert.equal(cut.args.length,0);
  await rt.call('download',{sourceId:inspected.id,id:'whole-after-range',kind:'video',height:720,filename:'full'});
  assert.deepEqual(rt.urls.map(u=>rt.calls.filter(c=>c.url===u).length),[1,2,1],'cached full source must not be replaced by sliced segments');
  assert.equal(rt.mux.at(-1).url,'ffmpeg-worker.js');assert.ok(rt.mux.at(-1).args.includes('copy'));
});

test('precise-cut codec failure never falls back to the old inaccurate FFmpeg path',async()=>{
 const rt=await runtime({cutFailure:true});const source=await rt.call('inspect',{descriptor:{url:'https://range.test/master.m3u8',referer:'https://range.test/watch',title:'range'}});
 await assert.rejects(rt.call('download',{sourceId:source.id,id:'cut-fail',kind:'video',height:720,filename:'cut',range:{start:1.2,end:1.8}}),{code:'RANGE_ENCODER_UNAVAILABLE'});
 assert.deepEqual(rt.mux.map(m=>m.url),['range-cut-worker.js']);
});

test('unsupported range rejects before fetching a progressive whole file', async () => {
  const rt = await runtime();
  const inspected = await rt.call('inspect', { descriptor: { url: 'https://range.test/file.mp4', referer: 'https://range.test/watch', title: 'direct', duration: 3 } });
  const before = rt.calls.filter(c => c.url.endsWith('file.mp4')).length;
  await assert.rejects(rt.call('download', { sourceId: inspected.id, id: 'unsupported', kind: 'video', height: 0, filename: 'direct', range: { start: 1, end: 2 } }));
  assert.equal(rt.calls.filter(c => c.url.endsWith('file.mp4')).length, before);
});

test('a supported progressive source downloads once then cuts with zero-based source clocks without artificial size limits',async()=>{
 const rt=await runtime({fullCutFixture:true});
 const source=await rt.call('inspect',{descriptor:{url:'https://range.test/file.mp4',referer:'https://range.test/watch',title:'clip',duration:3}});
 assert.equal(source.range.planDetails.video[0].mode,'full-cut');assert.equal(source.range.plans.video[0],true);
 const before=rt.calls.length;
 const result=await rt.call('download',{sourceId:source.id,id:'full-cut',kind:'video',height:0,filename:'clip',range:{start:1,end:2}});
 assert.equal(rt.calls.length-before,1,'the complete input is downloaded exactly once');
 const cut=rt.mux.at(-1);assert.equal(cut.url,'range-cut-worker.js');assert.equal(cut.inputs[0].timelineStart,0);assert.equal(cut.cutLimits,undefined);
 await rt.call('release',{blobId:result.blobId});assert.equal(rt.disk.files.size,0);
});

test('full-file fallback cleans downloaded input after precise cutting fails',async()=>{
 const rt=await runtime({fullCutFixture:true,cutFailure:true});
 const source=await rt.call('inspect',{descriptor:{url:'https://range.test/file.mp4',duration:3}});
 await assert.rejects(rt.call('download',{sourceId:source.id,id:'failed-full-cut',kind:'video',height:0,filename:'clip',range:{start:1,end:2}}),{code:'RANGE_ENCODER_UNAVAILABLE'});
 assert.equal(rt.disk.files.size,0);assert.ok(rt.disk.cleanups.includes('failed-full-cut'));
});

test('a cancel received before a download starts prevents late source reads and temporary creation',async()=>{
 const rt=await runtime({fullCutFixture:true}),source=await rt.call('inspect',{descriptor:{url:'https://range.test/file.mp4',duration:3}}),before=rt.calls.length;
 await rt.call('cancel',{id:'early'});
 await assert.rejects(rt.call('download',{sourceId:source.id,id:'early',kind:'video',height:0,filename:'clip',range:{start:1,end:2}}),{code:'CANCELLED'});
 assert.equal(rt.calls.length,before);assert.equal(rt.disk.files.size,0);
});

test('malformed 206 Content-Range is rejected by range transfer', async () => {
  const rt = await runtime({ badRange: true });
  const inspected = await rt.call('inspect', { descriptor: { url: 'https://range.test/master.m3u8', referer: 'https://range.test/watch', title: 'bad' } });
  await assert.rejects(rt.call('download', { sourceId: inspected.id, id: 'bad-range', kind: 'video', height: 0, filename: 'bad', range: { start: 1, end: 2 } }));
});

test('Bilibili SegmentBase downloads only init, index and selected byte ranges', async () => {
  const rt = await runtime();
  const result = await rt.call('inspect', { descriptor: { referer: 'https://www.bilibili.com/video/1', title: 'bili', platform: { site: 'bilibili', duration: 3, data: { dash: { video: [{ baseUrl: 'https://range.test/indexed.mp4', codecs: 'avc1',height:720, SegmentBase: { Initialization: '0-9', indexRange: '10-77' } }], audio: [{base_url:'https://range.test/indexed.mp4',codecs:'mp4a',bandwidth:128000,segment_base:{initialization:'0-9',index_range:'10-77'}}] } } } } });
  assert.equal(result.range.supported, true);
  assert.equal(result.range.duration, 3);
  await rt.call('download',{sourceId:result.id,id:'indexed-job',kind:'video',height:720,filename:'indexed',range:{start:1.2,end:1.8}});
  const requests=rt.calls.filter(c=>c.url.endsWith('indexed.mp4'));assert.equal(requests.length,6);
  assert.deepEqual(requests.map(c=>c.options.headers.Range).sort(),['bytes=0-9','bytes=0-9','bytes=10-77','bytes=10-77','bytes=88-97','bytes=88-97'].sort());
});

test('precise-cut progress is separate from transfer progress and throttles intermediate updates',async()=>{
 const rt=await runtime();const source=await rt.call('inspect',{descriptor:{url:'https://range.test/master.m3u8',referer:'https://range.test/watch',title:'range'}});
 await rt.call('download',{sourceId:source.id,id:'progress-cut',kind:'video',height:720,filename:'cut',range:{start:1.2,end:1.8}});
 assert.deepEqual(rt.messages.filter(m=>m.action==='progress'&&m.state==='processing'&&Number.isFinite(m.progress)).map(m=>m.progress),[50,100]);
});

function indexedDescriptor(rt,duration=3){return{referer:'https://www.bilibili.com/video/BVfixture',title:'bili',platform:{site:'bilibili',duration,data:{dash:{video:[{baseUrl:'https://range.test/indexed.mp4',backupUrl:['https://range.test/backup.mp4'],codecs:'avc1',height:720,SegmentBase:{Initialization:'0-9',indexRange:`10-${9+rt.indexLength}`}}],audio:[{baseUrl:'https://range.test/indexed.mp4',backupUrl:['https://range.test/backup.mp4'],codecs:'mp4a',bandwidth:128000,SegmentBase:{Initialization:'0-9',indexRange:`10-${9+rt.indexLength}`}}]}}}};}

test('Bilibili range fetches video/audio indexes concurrently and coalesces exact selected bytes',async()=>{
 const rt=await runtime({indexCount:24,indexDelay:20});const source=await rt.call('inspect',{descriptor:indexedDescriptor(rt,24)});
 await rt.call('download',{sourceId:source.id,id:'coalesced',kind:'video',height:720,filename:'cut',range:{start:2.2,end:22.8}});
 assert.equal(rt.peakIndexes,2);
 const requests=rt.calls.filter(c=>c.url.endsWith('.mp4'));assert.equal(requests.length,6,'21 media subsegments per track must become one contiguous range per track');
 const begin=10+rt.indexLength+20,end=10+rt.indexLength+230;
 for(const input of rt.mux.at(-1).inputs){
  const expected=new Uint8Array(10+end-begin);expected.set(rt.indexedBytes.subarray(0,10));expected.set(rt.indexedBytes.subarray(begin,end),10);
  assert.deepEqual(new Uint8Array(await input.file.arrayBuffer()),expected);assert.equal(input.timelineStart,2);
 }
 assert.equal(requests.filter(c=>c.options.headers.Range===`bytes=${begin}-${end-1}`).length,2);
});

test('Bilibili ranges can recover a refused primary CDN and reuse backup for init and media',async()=>{
 const rt=await runtime({failPrimary:true});const source=await rt.call('inspect',{descriptor:indexedDescriptor(rt)});
 await rt.call('download',{sourceId:source.id,id:'backup',kind:'video',height:720,filename:'cut',range:{start:1.2,end:1.8}});
 assert.equal(rt.calls.filter(c=>c.url.endsWith('/indexed.mp4')).length,2,'only the two original index attempts should use the refused primary');
 const backup=rt.calls.filter(c=>c.url.endsWith('/backup.mp4'));assert.equal(backup.length,6);
 assert.deepEqual(backup.map(c=>c.options.headers.Range).sort(),['bytes=0-9','bytes=0-9','bytes=10-77','bytes=10-77','bytes=88-97','bytes=88-97'].sort());
 assert.equal(rt.mux.at(-1).url,'range-cut-worker.js');
});

test('SIDX progress advances during the first range body before any media range finishes',async()=>{
 const rt=await runtime({chunkDelay:300}),inspected=await rt.call('inspect',{descriptor:indexedDescriptor(rt)});
 await rt.call('download',{sourceId:inspected.id,id:'body-progress',kind:'video',height:720,filename:'cut',range:{start:1.2,end:1.8}});
 const running=rt.messages.filter(m=>m.action==='progress'&&m.state==='running');
 assert.ok(running.some(m=>m.mediaCompleted===0&&m.progress>0&&m.progress<100),'must publish real byte progress before the first verified segment');
 assert.equal(running.at(-1).progress,100);assert.equal(running.at(-1).mediaCompleted,2);
 assert.ok(running.filter(m=>m.mediaCompleted<2).every(m=>m.progress<100));
});

test('oversized SIDX is not advertised for ranges while full download remains available', async () => {
 const rt=await runtime({indexCount:11000,allowFullIndexed:true});
 const inspected=await rt.call('inspect',{descriptor:indexedDescriptor(rt,11000)});
 assert.equal(inspected.range.supported,false);
 assert.match(inspected.range.reason,/探測上限|可用/);
 await rt.call('download',{sourceId:inspected.id,id:'oversized-full',kind:'video',height:720,filename:'oversized-full'});
 const full=rt.calls.filter(c=>c.url.endsWith('indexed.mp4')&&!c.options.headers?.Range);
 assert.ok(full.length>0,'full download should still use the source without a Range header');
});
