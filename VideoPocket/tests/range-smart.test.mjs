import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../extension/range-smart.js',import.meta.url),'utf8');
const config={codec:'vp09.00.50.08',codedWidth:3840,codedHeight:2160,colorSpace:{matrix:'bt709',fullRange:false}};
function runtime({codec='vp9',decoder=config,key=60.72,next=61.88,width=3840}={}){
 const rt={VideoPocketMediabunny:{EncodedPacketSink:class{async getKeyPacket(){return {timestamp:key,type:'key'};}async getFirstKeyPacket(){return {timestamp:key,type:'key'};}async getNextKeyPacket(){return {timestamp:next,type:'key'};}}},VideoPocketDiskMedia:{}};rt.self=rt;vm.runInNewContext(source,rt);
 return {api:rt.VideoPocketRangeSmart,track:{getCodec:async()=>codec,getDecoderConfig:async()=>decoder,getSquarePixelWidth:async()=>width,getSquarePixelHeight:async()=>2160}};
}
test('smart cut derives the real next key packet, without assuming a fixed GOP interval',async()=>{
 const {api,track}=runtime();const plan=await api.plan(track,60.9,75.9);assert.equal(plan.key.timestamp,61.88);assert.ok(Math.abs(plan.prefixDuration-.98)<1e-6);
});
test('safe source boundaries keep the existing packet-copy path; a clip within one GOP is not spliced',async()=>{
 const {api,track}=runtime({key:60.9});assert.equal(await api.plan(track,60.9,75.9),null);
 const other=runtime({next:80});assert.equal(await other.api.plan(other.track,60.9,75.9),null);
});
test('unsupported profiles, codecs and non-square pixels cannot enter VP9 smart splicing',async()=>{
 for(const options of [{codec:'avc'},{decoder:{...config,codec:'vp09.02.50.10'}},{width:4096}]){const {api,track}=runtime(options);assert.equal(await api.plan(track,60.9,75.9),null);}
});
test('smart splice requires matching decoder profile, size, description and known colour metadata',()=>{
 const {api}=runtime();assert.equal(api.sameConfig(config,{...config,codec:'vp09.00.41.08'}),true,'lower boundary level fits the original decoder configuration');
 assert.equal(api.sameConfig(config,{...config,codec:'vp09.00.51.08'}),false,'a boundary cannot require a higher decoder level than the original track');
 for(const changed of [{codedWidth:1920},{codec:'vp09.02.50.10'},{description:new Uint8Array([1])},{colorSpace:{matrix:'bt2020-ncl',fullRange:false}}])assert.equal(api.sameConfig(config,{...config,...changed}),false);
});
test('audio-only and other containers never invoke the VP9 hybrid path',async()=>{
 const {api}=runtime();assert.equal(await api.tryCut({kind:'audio',output:'out.webm'}),null);assert.equal(await api.tryCut({kind:'video',output:'out.mp4'}),null);
});
