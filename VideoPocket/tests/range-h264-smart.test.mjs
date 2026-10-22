import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source=await fs.readFile(new URL('../extension/range-h264-smart.js',import.meta.url),'utf8');
const root={VideoPocketMediabunny:{},VideoPocketDiskMedia:{},VideoPocketRangeMp4:{capMovieDuration:()=>({data:new Uint8Array(),duration:0})}};root.self=root;
vm.runInNewContext(source,root,{filename:'range-h264-smart.js'});
const smart=root.VideoPocketRangeH264;

function avcConfig({profile=0x64,level=0x1f,lengthSize=4,sps=[0x67,0x64],pps=[0x68,0xce]}={}) {
  const data=[1,profile,0,level,0xfc|(lengthSize-1),0xe0|1,sps.length>>8,sps.length&255,...sps,1,pps.length>>8,pps.length&255,...pps];
  return Uint8Array.from(data);
}
function packet(nals,{type='key',timestamp=0,duration=1}={}) {
  const data=new Uint8Array(nals.reduce((sum,nal)=>sum+4+nal.length,0));let at=0;
  for(const nal of nals){data[at++]=0;data[at++]=0;data[at++]=0;data[at++]=nal.length;data.set(nal,at);at+=nal.length;}
  return {data,type,timestamp,duration,clone(options){return {...this,...options};}};
}

test('configuration validates AVC records and normalizes four byte NAL lengths',()=>{
  const config=smart.configuration(avcConfig());
  assert.equal(config.lengthSize,4);assert.equal(config.profile,0x64);assert.equal(config.level,0x1f);
  assert.equal(config.description[4]&3,3);assert.equal(config.sets.length,2);
  assert.throws(()=>smart.configuration(Uint8Array.from([1,0,0,0,0xff,0])),/有效設定|參數集/);
  assert.throws(()=>smart.configuration(Uint8Array.from([1,0x64,0,0x1f,0xff,0xe1,0,1,0x65,1,0,0])),/類型無效|截斷/);
});

test('NAL parser and IDR detection reject malformed lengths and require key packets',()=>{
  const config=smart.configuration(avcConfig());
  const idr=packet([Uint8Array.from([0x65,1]),Uint8Array.from([0x06,2])]);
  assert.equal(smart.units(idr.data,4).length,2);assert.equal(smart.isIdr(idr,config),true);
  assert.equal(smart.isIdr({...idr,type:'delta'},config),false);
  assert.throws(()=>smart.units(Uint8Array.from([0,0,0,8,1]),4),/長度無效/);
  assert.throws(()=>smart.units(Uint8Array.from([0,0,0,0]),4),/長度無效/);
});

test('packetData injects SPS/PPS only at each stream join and preserves NAL order',()=>{
  const config=smart.configuration(avcConfig()),tail=packet([Uint8Array.from([0x65,1]),Uint8Array.from([0x41,2])]);
  const withConfig=smart.packetData(tail,config,true),without=smart.packetData(tail,config,false);
  const parse=data=>Array.from(smart.units(data,4),nal=>nal[0]&31);
  assert.deepEqual(parse(withConfig),[7,8,5,1]);assert.deepEqual(parse(without),[5,1]);
  assert.equal(withConfig.length,without.length+config.sets.reduce((n,s)=>n+4+s.length,0));
});

test('compatibility rejects coded dimensions, profile/level and known colour changes',()=>{
  const description=avcConfig();
  const base={codedWidth:1280,codedHeight:720,description,colorSpace:{primaries:1,transfer:1,matrix:1,fullRange:false}};
  assert.equal(smart.compatible(base,{...base,description:description.slice()}),true);
  assert.equal(smart.compatible(base,{...base,codedHeight:1080}),false);
  assert.equal(smart.compatible(base,{...base,description:avcConfig({profile:0x4d})}),false);
  assert.equal(smart.compatible(base,{...base,description:avcConfig({level:0x20})}),true);
  assert.equal(smart.compatible(base,{...base,description:avcConfig({level:0x1e})}),false);
  const constrained=description.slice();constrained[2]=0x40;
  assert.equal(smart.compatible(base,{...base,description:constrained}),false);
  assert.equal(smart.compatible(base,{...base,colorSpace:{...base.colorSpace,transfer:2}}),false);
});

test('plan fails closed for unsupported codec, transparent tracks, odd pixels and short prefix fallback',async()=>{
  const make=({codec='avc',transparent=false,width=1280,height=720,squareWidth=width,squareHeight=height,short=false}={})=>{
    const track={getCodec:async()=>codec,canBeTransparent:async()=>transparent,getDecoderConfig:async()=>({codec:'avc1.64001f',description:avcConfig(),codedWidth:width,codedHeight:height}),getSquarePixelWidth:async()=>squareWidth,getSquarePixelHeight:async()=>squareHeight};
    root.VideoPocketMediabunny.EncodedPacketSink=class{constructor(){ }async getKeyPacket(){return short?{timestamp:0,type:'key',data:packet([Uint8Array.from([0x65,1])]).data}:null;}async getNextKeyPacket(){return null;}};
    return track;
  };
  assert.equal(await smart.plan(make({codec:'vp9'}),0,10),null);
  assert.equal(await smart.plan(make({transparent:true}),0,10),null);
  assert.equal(await smart.plan(make({squareWidth:1279}),0,10),null);
  assert.equal(await smart.plan(make({short:true}),0,10),null);
});

test('cancel is safe when no conversion is active',()=>{assert.doesNotThrow(()=>smart.cancel());});
