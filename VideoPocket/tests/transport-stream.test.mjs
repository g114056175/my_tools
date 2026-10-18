import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTransportStreamCodecs} from '../extension/transport-stream.js';

function psi(table,body){
  const length=body.length+4,section=new Uint8Array(3+body.length+4);
  section[0]=table;section[1]=0xb0|((length>>8)&0x0f);section[2]=length&0xff;section.set(body,3);return section;
}
function pat(pmtPid=0x100){return psi(0,[0,1,0xc1,0,0,0,1,(pmtPid>>8)|0xe0,pmtPid&0xff]);}
function pmt(streams,pmtPid=0x100,programInfo=[]){
  const body=[0,1,0xc1,0,0,0xe0|((pmtPid>>8)&0x1f),pmtPid&0xff,0xf0|((programInfo.length>>8)&0x0f),programInfo.length&0xff,...programInfo];
  for(const type of streams)body.push(type,0xe1,0,0xf0,0);
  return psi(2,body);
}
function packets(pid,section,{chunk=section.length}={}){
  const out=[];let at=0,first=true,cc=0;
  while(first||at<section.length){
    const take=Math.min(chunk,section.length-at),payload=first?new Uint8Array([0,...section.subarray(at,at+take)]):section.subarray(at,at+take);at+=take;
    const packet=new Uint8Array(188);packet.fill(0xff);packet[0]=0x47;packet[1]=((first?0x40:0)|((pid>>8)&0x1f));packet[2]=pid&0xff;packet[3]=0x30|(cc++&0x0f);
    packet[4]=183-payload.length;packet.set(payload,5+packet[4]);out.push(packet);first=false;
  }
  return out;
}
function stream(streams,{chunk=184,programInfo=[]}={}){
  const packetsOut=[...packets(0,pat()),...packets(0x100,pmt(streams,0x100,programInfo),{chunk})];return Uint8Array.from(packetsOut.flatMap(p=>[...p]));
}

test('detects AVC with AAC from PAT/PMT',()=>assert.deepEqual(parseTransportStreamCodecs(stream([0x1b,0x0f])),{videoCodec:'h264',audioCodec:'aac'}));
test('detects HEVC and leaves absent audio empty',()=>assert.deepEqual(parseTransportStreamCodecs(stream([0x24])),{videoCodec:'hevc',audioCodec:''}));
test('supports fragmented PMT sections across TS packets',()=>assert.deepEqual(parseTransportStreamCodecs(stream([0x1b,0x11],{chunk:7,programInfo:new Array(170).fill(0)})),{videoCodec:'h264',audioCodec:'aac'}));
test('rejects malformed alignment, oversized PSI and scrambled packets',()=>{
  const valid=stream([0x1b]);const bad=Uint8Array.from(valid);bad[0]=0;
  assert.deepEqual(parseTransportStreamCodecs(bad),{videoCodec:'',audioCodec:''});
  const huge=stream([0x1b]);huge[173]=0x0f;huge[174]=0xff;assert.deepEqual(parseTransportStreamCodecs(huge),{videoCodec:'',audioCodec:''});
  const scrambled=Uint8Array.from(valid);scrambled[3]|=0x80;assert.deepEqual(parseTransportStreamCodecs(scrambled),{videoCodec:'',audioCodec:''});
});
test('does not infer codecs from arbitrary text',()=>assert.deepEqual(parseTransportStreamCodecs(new Uint8Array(188).fill(0x47)),{videoCodec:'',audioCodec:''}));
test('accepts a leading prefix, a partial tail, and payload-only adaptation packets',()=>{
  const full=stream([0x1b,0x0f]),prefix=new Uint8Array([1,2,3]),combined=new Uint8Array(prefix.length+full.length+5);combined.set(prefix);combined.set(full,prefix.length);combined.set([9,8,7,6,5],prefix.length+full.length);
  assert.deepEqual(parseTransportStreamCodecs(combined),{videoCodec:'h264',audioCodec:'aac'});
  const payloadOnly=new Uint8Array(188);payloadOnly.fill(0xff);payloadOnly.set([0x47,0x40,0,0x10],0);payloadOnly[4]=0;payloadOnly.set(pat(),5);
  assert.deepEqual(parseTransportStreamCodecs(Uint8Array.from([...payloadOnly,...stream([0x1b,0x0f])])),{videoCodec:'h264',audioCodec:'aac'});
});
test('ignores PES-like packets on unrelated PIDs',()=>{
  const pes=new Uint8Array(188);pes.fill(0);pes[0]=0x47;pes[1]=0x41;pes[2]=0x01;pes[3]=0x10;pes[4]=0x00;pes[5]=0x00;pes[6]=0x01;pes[7]=0xe0;
  assert.deepEqual(parseTransportStreamCodecs(Uint8Array.from([...stream([0x1b]),...pes])),{videoCodec:'h264',audioCodec:''});
});
