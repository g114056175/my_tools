import test from 'node:test';
import assert from 'node:assert/strict';
import { assertComplete, assertRangeComplete, downloadYoutube, setSabrStreamForTests } from '../extension/youtube-download.js';
import { VideoPlaybackAbrRequest } from '../extension/vendor/sabr.js';

const segment = (number, start, end, init = false) => ({
  segmentNumber: number, startTimeMs: start, endTimeMs: end,
  durationMs: end - start, mediaHeader: { isInitializationSegment: init }
});
const track = (segments, endSegmentNumber = 2) => ({
  formatInitializationMetadata: { endSegmentNumber, durationUnits: 6000, durationTimescale: 1000 },
  downloadedSegments: new Map(segments.map(s => [s.segmentNumber, s])),
  consumedSegments: new Set(segments.map(s => s.segmentNumber))
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
