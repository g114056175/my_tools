import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
async function runtime(extra={}){
 let writes=0,disposed=0;
 const M={EncodedPacketSink:class{constructor(track){this.track=track;}async getFirstKeyPacket(){return {timestamp:await this.track.getFirstTimestamp()};}},VideoSampleSink:class{constructor(track){this.track=track;}async *samples(from,to){for(let t=from;t<to;t+=.04)yield {timestamp:t,duration:.04,close(){}};}},BlobSource:class{constructor(file){this.file=file;}},Input:class{constructor({source}){this.file=source.file;}async getPrimaryVideoTrack(){return this.file.video||null;}async getPrimaryAudioTrack(){return this.file.audio||null;}dispose(){disposed++;}},...extra};
 const context={VideoPocketMediabunny:M,VideoPocketRangeMp4:{presentationDuration:async file=>file.presentationDuration??25},VideoPocketDiskMedia:{createSyncMediaFile(){writes++;throw new Error('should not write');}}};context.self=context;
 vm.runInNewContext(await fs.readFile(new URL('../extension/range-cut.js',import.meta.url),'utf8'),context);
 return {api:context.VideoPocketRangeCut,get writes(){return writes;},get disposed(){return disposed;}};
}
const track=(start,end)=>({getFirstTimestamp:async()=>start,computeDuration:async()=>end});
test('range output gate rejects preroll-expanded, late, silent and unsynchronized results',async()=>{
 const rt=await runtime();
 for(const file of [{video:track(0,35),audio:track(0,35)},{video:track(3,25),audio:track(0,25)},{video:track(0,25)},{video:track(0,25),audio:track(.12,25)}])await assert.rejects(rt.api.validate(file,25,{video:true,audio:true}),{code:'RANGE_PROCESSING_FAILED'});
 const result=await rt.api.validate({video:track(0,25),audio:track(.011,24.992)},25,{video:true,audio:true});assert.equal(result.duration,25);assert.equal(rt.disposed,5);
});
test('invalid range or missing source clock fails before allocating an output file',async()=>{
 const rt=await runtime();await assert.rejects(rt.api.cutRange({range:{start:60,end:60},inputs:[]}),{code:'RANGE_INVALID'});
 await assert.rejects(rt.api.cutRange({range:{start:60,end:85},inputs:[]}),{code:'RANGE_PROCESSING_FAILED'});
 await assert.rejects(rt.api.cutRange({range:{start:60,end:85},inputs:[{name:'video.webm'}]}),{code:'RANGE_PROCESSING_FAILED'});
 assert.equal(rt.writes,0);
});
test('conversion trim removes floating-point boundary sliver but keeps next frame',async()=>{
 const rt=await runtime();
 const clip=(sample,trim)=>{
  const start=Math.max(trim.start,sample.timestamp),end=Math.min(trim.end,sample.timestamp+sample.duration);
  return start>=end?null:{timestamp:start-trim.start,duration:end-start};
 };
 const cases=[
  {start:0,end:.3},
  {start:12,end:12.3},
  {start:60.3,end:65.3},
 ];
 for(const {start,end} of cases){
  const old={start,end},fixed=rt.api.trimBoundary(start,end);
  const leadingTimestamp=start-.033;
  const leading={timestamp:leadingTimestamp,duration:(start+1e-14)-leadingTimestamp};
  const next={timestamp:start,duration:.033};
  const trailingTimestamp=end-1e-14;
  const trailing={timestamp:trailingTimestamp,duration:2e-14};
  const oldSliver=clip(leading,old),fixedSliver=clip(leading,fixed),fixedNext=clip(next,fixed);
  const oldTrailing=clip(trailing,old),fixedTrailing=clip(trailing,fixed);
  if(start>0){
   assert.ok(oldSliver&&oldSliver.duration>0&&oldSliver.duration<1e-6,`old trim should retain sliver at ${start}`);
   assert.equal(fixedSliver,null,`fixed trim should remove sliver at ${start}`);
  }else assert.equal(fixedSliver,null,'zero start has no preceding sliver');
  assert.ok(oldTrailing&&oldTrailing.duration>0&&oldTrailing.duration<1e-6,`old trim should retain end sliver at ${end}`);
  assert.equal(fixedTrailing,null,`fixed trim should remove end sliver at ${end}`);
  assert.ok(fixedNext&&fixedNext.duration>.03,`fixed trim should retain next frame at ${start}`);
  assert.ok(Math.abs((fixed.end-fixed.start)-(end-start-2e-6))<1e-12);
 }
});
test('a cancelled range cannot produce or finalize a downloadable file',async()=>{
 const rt=await runtime();await assert.rejects(rt.api.cutRange({range:{start:60,end:85},inputs:[{}],signal:{aborted:true}}),{code:'CANCELLED'});assert.equal(rt.writes,0);
});

const key=(timestamp,duration=.1)=>({timestamp,duration});
function policyRuntime({first=key(10),next=key(15),hardware=false,software=true}={}){
 const probes=[];
 return runtime({Quality:class{constructor(options){Object.assign(this,options);}},QUALITY_HIGH:'high',EncodedPacketSink:class{async getKeyPacket(){return first;}async getFirstKeyPacket(){return first;}async getNextKeyPacket(){return next;}},canEncodeVideo:async(codec,options)=>{probes.push({codec,options});return options.hardwareAcceleration==='prefer-hardware'?hardware:software;}}).then(rt=>({...rt,probes}));
}
const videoTrack={getCodec:async()=>'vp9',getSquarePixelWidth:async()=>1920,getSquarePixelHeight:async()=>1080};
test('a safe keyframe boundary does not request quality, codec changes or any encoder',async()=>{
 const rt=await policyRuntime();const options=await rt.api.videoOptions(videoTrack,{getSupportedVideoCodecs:()=>['vp9','vp8']},10);
 assert.deepEqual(Object.keys(options),[]);assert.equal(rt.probes.length,0);
});

test('an exact keyframe with unknown packet duration remains eligible for direct copy',async()=>{
 const rt=await policyRuntime({first:key(10,0)});const options=await rt.api.videoOptions(videoTrack,{getSupportedVideoCodecs:()=>['vp9']},10);
 assert.deepEqual(Object.keys(options),[]);assert.equal(rt.probes.length,0);
});
test('precise non-keyframe cut probes matching high-quality hardware configuration',async()=>{
 const rt=await policyRuntime({hardware:true});const options=await rt.api.videoOptions(videoTrack,{getSupportedVideoCodecs:()=>['vp9','vp8']},12);
 assert.equal(options.hardwareAcceleration,'prefer-hardware');assert.equal(options.quality.preferBitrate,true);assert.equal(options.codec,'vp9');assert.equal(rt.probes[0].options.width,1920);
 assert.equal(options.latencyMode,undefined,'frame-dropping realtime encoding is not enabled');
});
test('unsupported hardware preserves the ordinary encoder policy without codec or quality overrides',async()=>{
 const rt=await policyRuntime();const options=await rt.api.videoOptions(videoTrack,{getSupportedVideoCodecs:()=>['vp9','av1','vp8']},12);
 assert.equal(options.forceTranscode,true);assert.deepEqual(rt.probes.map(p=>p.codec),['vp9','av1','vp8']);
});
test('normalization copies only the required GOP window and retains audio preroll',async()=>{
 const calls=[];const first=key(10),endKey=key(30),stop=key(40),audio=key(11.88,.02);
 const rt=await runtime({EncodedPacketSink:class{constructor(t){this.kind=t.kind;}async getKeyPacket(t){calls.push(['key',t]);return t<20?first:endKey;}async getNextKeyPacket(){return stop;}async getPacket(t){calls.push(['audio',t]);return audio;}async getNextPacket(){return stop;}}});
 const video=await rt.api.packetWindow({kind:'video',track:{kind:'video'},source:{offset:50}}, {start:62,end:82});
 assert.equal(video.first,first);assert.equal(video.last,stop);assert.equal(video.firstTime,60);
 const result=await rt.api.packetWindow({kind:'audio',track:{kind:'audio'},source:{offset:50}}, {start:62,end:82});assert.equal(result.first,audio);assert.equal(result.firstTime,61.88);
 assert.deepEqual(calls.filter(c=>c[0]==='audio').map(c=>Number(c[1].toFixed(2))),[11.88,32.12]);
});

test('MP4 validation rejects video preroll even when edit-list presentation claims zero',async()=>{
 let closed=0;class Sink{constructor(track){this.track=track;}async *samples(from,to){for(let t=from;t<to;t+=.04)yield {timestamp:t,duration:.04,close(){}};}async getSample(){return {timestamp:this.track.presented,duration:.04,close(){closed++;}};}}
 const rt=await runtime({VideoSampleSink:Sink,AudioSampleSink:Sink});
 const video={...track(0,25),presented:0},audio={...track(-.01,25.01),presented:-.01};
 const result=await rt.api.validate({video,audio},25,{video:true,audio:true,presentation:true});assert.equal(result.tracks[0].codedStart,0);assert.equal(result.tracks[0].start,0);assert.equal(closed,2);
 await assert.rejects(rt.api.validate({video:{...video,presented:-3},audio},25,{video:true,audio:true,presentation:true}),{code:'RANGE_PROCESSING_FAILED'});
 await assert.rejects(rt.api.validate({video:{...video,presented:3},audio},25,{video:true,audio:true,presentation:true}),{code:'RANGE_PROCESSING_FAILED'});
 await assert.rejects(rt.api.validate({video:{...video,getFirstTimestamp:async()=>-5},audio},25,{video:true,audio:true,presentation:true}),{code:'RANGE_PROCESSING_FAILED'});
 const dependencies=await rt.api.validate({video:{...video,computeDuration:async()=>25.4},audio},25,{video:true,audio:true,presentation:true});assert.equal(dependencies.tracks[0].end,25);assert.equal(dependencies.tracks[0].codedEnd,25.4);
 await assert.rejects(rt.api.validate({video,audio,presentationDuration:25.1},25,{video:true,audio:true,presentation:true}),{code:'RANGE_PROCESSING_FAILED'});
 await assert.rejects(rt.api.validate({video:{...video,computeDuration:async()=>24},audio},25,{video:true,audio:true,presentation:true}),{code:'RANGE_PROCESSING_FAILED'});
});

test('decoder gate rejects an initial black gap and a gap at the smart splice',async()=>{
 class Sink{constructor(track){this.track=track;}async *samples(from,to){yield {timestamp:from+.2,duration:.04,close(){}};}}
 const rt=await runtime({VideoSampleSink:Sink});await assert.rejects(rt.api.validate({video:track(0,25)},25,{video:true,audio:false}),{code:'RANGE_PROCESSING_FAILED'});
 class SpliceSink{async *samples(from,to){if(from>0){yield {timestamp:from+.2,duration:.04,close(){}};return;}for(let t=from;t<to;t+=.04)yield {timestamp:t,duration:.04,close(){}};}}
 const splice=await runtime({VideoSampleSink:SpliceSink});await assert.rejects(splice.api.validate({video:track(0,25)},25,{video:true,audio:false,splice:3}),{code:'RANGE_PROCESSING_FAILED'});
});
