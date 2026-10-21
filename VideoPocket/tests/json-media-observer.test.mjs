import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {observeJsonMetadata} from '../extension/json-media-observer.js';

const text=JSON.stringify({id:'post',video_url:'https://cdn.example/main.mp4'});

test('JSON wrapper preserves native values, coercion, revivers, syntax errors and non-constructability',()=>{
 const target={JSON:{parse:JSON.parse}},values=[],original=target.JSON.parse;
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  assert.equal(target.JSON.parse.name,original.name);assert.equal(target.JSON.parse.length,original.length);
  const result=target.JSON.parse(text,(key,value)=>key==='id'?'updated':value);
  assert.equal(result.id,'updated');assert.equal(values[0].id,'updated');
  assert.deepEqual(target.JSON.parse('false'),false);assert.equal(target.JSON.parse('2'),2);
  assert.throws(()=>target.JSON.parse('{bad'),SyntaxError);
  assert.throws(()=>new target.JSON.parse(text),TypeError);
  let coercions=0;assert.equal(target.JSON.parse({toString(){coercions++;return 'true';}}),true);assert.equal(coercions,1);
  assert.equal(values.length,1);
 }finally{observer.dispose();}
 assert.equal(target.JSON.parse,original);
});

test('proxy forwards original receiver and exact result while observer errors and recursion stay isolated',()=>{
 const marker={},results=[];let result,receiver,calls=0;
 const target={JSON:{parse:function(...args){receiver=this;result=JSON.parse(...args);results.push(result);return result;}}};
 const observer=observeJsonMetadata(target,()=>{calls++;target.JSON.parse(text);throw new Error('observer error');});
 try{
  const parsed=target.JSON.parse.call(marker,text);assert.equal(receiver,target.JSON,'recursive call uses its own receiver');
  assert.equal(parsed,results[0]);assert.equal(parsed.id,'post');assert.equal(calls,1);assert.equal(observer.stats().errors,1);
  const plain=target.JSON.parse.call(marker,'{"plain":1}');assert.equal(receiver,marker);assert.equal(plain,result);
 }finally{observer.dispose();}
});

test('metadata observation is bounded and counters show size or rate rejection',()=>{
 let now=100;const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value),{now:()=>now,maxPerSecond:2});
 try{
  for(let i=0;i<4;i++)target.JSON.parse(text);
  assert.equal(values.length,2);assert.equal(observer.stats().throttled,2);
  now+=1000;target.JSON.parse(text);assert.equal(values.length,3);
  target.JSON.parse(JSON.stringify({video_url:'x'.repeat(1024*1024)}));
  assert.equal(observer.stats().oversized,1);
  target.JSON.parse(JSON.stringify({video_url:'x'.repeat(512*1024+1)}));
  assert.equal(observer.stats().oversized,2);
 }finally{observer.dispose();}
});

test('reviver-created accessors and native buffers are not read or retained by metadata extraction',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];let reads=0;
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const result=target.JSON.parse(text,(key,value)=>{
   if(key===''){
    Object.defineProperty(value,'unused',{enumerable:true,get(){reads++;return 'private';}});
    value.buffer=new Uint8Array(1024);value.self=value;
   }
   return value;
  });
  assert.equal(reads,0);assert.ok(result.buffer);assert.equal(values[0].buffer,undefined);assert.equal(values[0].unused,undefined);
  assert.equal(values[0].self,undefined);assert.equal(values[0].video_url,'https://cdn.example/main.mp4');
 }finally{observer.dispose();}
});

test('installation is idempotent and disposal does not overwrite another wrapper',()=>{
 const target={JSON:{parse:JSON.parse}},observer=observeJsonMetadata(target,()=>{}),installed=target.JSON.parse;
 assert.equal(observeJsonMetadata(target,()=>{}),observer);
 target.JSON.parse=function(...args){return installed(...args);};const newer=target.JSON.parse;
 observer.dispose();assert.equal(target.JSON.parse,newer);assert.deepEqual(target.JSON.parse(text).id,'post');
});

test('the shipped MAIN bundle captures application JSON parsing and restores its native parser',async()=>{
 const context=vm.createContext({URL:class extends URL{},WeakRef,TextEncoder,TextDecoder,location:{href:'https://unseen.example/video/selected',hostname:'unseen.example'}});
 vm.runInContext('const nativeParse=JSON.parse;',context);
 vm.runInContext(await fs.readFile(new URL('../extension/media-observer.js',import.meta.url),'utf8'),context);
 const result=vm.runInContext(`
  JSON.parse('{"id":"selected","qualities":{"auto":[{"type":"application/x-mpegURL","url":"https://cdn.example/main.m3u8"}]}}');
  const player={currentSrc:'blob:main',src:'',getAttribute:()=>'',closest:()=>null};
  player.ownerDocument={querySelectorAll:selector=>selector==='video'?[player]:[]};
  const observer=globalThis[Symbol.for('video-pocket.mediaObserver')];
  const model=observer.modelFor(player),stats=observer.diagnosticsFor(player);
  observer.dispose();({url:model?.manifestUrl,observed:stats.json.observed,restored:JSON.parse===nativeParse});
 `,context);
 assert.equal(result.url,'https://cdn.example/main.m3u8');assert.equal(result.observed,1);assert.equal(result.restored,true);
});
