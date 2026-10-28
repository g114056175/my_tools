import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {observeJsonMetadata} from '../extension/json-media-observer.js';
import {extractXMediaModels} from '../extension/x-media.js';

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
  now+=1000;
  target.JSON.parse(JSON.stringify({video_url:'x'.repeat(1024*1024)}));
  assert.equal(observer.stats().oversized,1);
  now+=1000;
  target.JSON.parse(JSON.stringify({video_url:'x'.repeat(512*1024+1)}));
  assert.equal(observer.stats().oversized,2);
 }finally{observer.dispose();}
});

test('large JSON keeps a bounded media subtree beside unrelated feed data',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const payload={data:{media:{video_url:'https://cdn.example/selected.m3u8',duration:12}},noise:'x'.repeat(2*1024*1024)};
  const result=target.JSON.parse(JSON.stringify(payload));
  assert.equal(result.noise.length,2*1024*1024);
  assert.equal(values.length,1);
  assert.equal(values[0].data.media.video_url,'https://cdn.example/selected.m3u8');
  assert.equal(values[0].noise,undefined);
 }finally{observer.dispose();}
});

test('large nested containers skip huge siblings and preserve media schema',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const payload={data:{hugeText:'x'.repeat(2*1024*1024),before:Array.from({length:500},()=>({noise:'y'.repeat(100)})),media:{video_info:{variants:[{url:'https://cdn.example/chosen.m3u8',content_type:'application/x-mpegURL'}]}}}};
  target.JSON.parse(JSON.stringify(payload));
  assert.equal(values.length,1);
  assert.equal(values[0].data.media.video_info.variants[0].url,'https://cdn.example/chosen.m3u8');
  assert.equal(values[0].data.hugeText,undefined);
  assert.equal(values[0].data.before,undefined);
 }finally{observer.dispose();}
});

test('large X broadcast payload preserves broadcast and nested tweet-card identities',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const data={tweet_result:{result:{rest_id:'2112242739198959913',legacy:{card:{legacy:{binding_values:[
   {key:'broadcast_id',value:{string_value:'1RKZzBELBbXKB'}},
   {key:'broadcast_url',value:{string_value:'https://x.com/i/broadcasts/1RKZzBELBbXKB'}},
   {key:'broadcast_media_key',value:{string_value:'28_123456789'}},
  ]}}}}}};
  for(let i=0;i<30000;i++)data[`unrelated_${i}`]='x';
  target.JSON.parse(JSON.stringify({data}));
  assert.equal(values.length,1);
  const [model]=extractXMediaModels(values[0]);
  assert.equal(model.broadcastId,'1RKZzBELBbXKB');
  assert.ok(model.aliases.includes('2112242739198959913'));
  assert.ok(model.aliases.includes('28_123456789'));
 }finally{observer.dispose();}
});

test('media remains observable when an unrelated huge array or field comes first',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const first=target.JSON.parse(JSON.stringify({noise:Array(200000).fill(0),video:{id:'v1',video_url:'https://cdn.example/v1.mp4'}}));
  assert.equal(first.video.video_url,'https://cdn.example/v1.mp4');
  assert.equal(values.at(-1).video.video_url,'https://cdn.example/v1.mp4');
  target.JSON.parse(JSON.stringify({source:'x'.repeat(600000),video:{video_url:'https://cdn.example/v2.mp4'}}));
  assert.equal(values.at(-1).video.video_url,'https://cdn.example/v2.mp4');
  assert.equal(values.at(-1).source,undefined);
 }finally{observer.dispose();}
});

test('bounded array sampling keeps media after a huge metadata list',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const payload={data:{items:Array.from({length:300000},()=>({noise:'x'})),video:{video_url:'https://cdn.example/after-list.mp4'}}};
  target.JSON.parse(JSON.stringify(payload));
  assert.equal(values.length,1);
  assert.equal(values[0].data.video.video_url,'https://cdn.example/after-list.mp4');
 }finally{observer.dispose();}
});

test('large JSON probes unfamiliar deep containers and arrays within the depth budget',()=>{
 const target={JSON:{parse:JSON.parse}},values=[];
 const observer=observeJsonMetadata(target,value=>values.push(value));
 try{
  const payload={outer:{opaque:{branch:{entries:[{streamUrl:'https://cdn.example/deep.mp4'}]}}},noise:'z'.repeat(2*1024*1024)};
  target.JSON.parse(JSON.stringify(payload));
  assert.equal(values.length,1);
  assert.equal(values[0].outer.opaque.branch.entries[0].streamUrl,'https://cdn.example/deep.mp4');
  assert.equal(values[0].noise,undefined);
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
 let timerId=0;const timers=new Map();
 const context=vm.createContext({URL:class extends URL{},WeakRef,TextEncoder,TextDecoder,
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},
  clearTimeout:id=>timers.delete(id),
  location:{href:'https://unseen.example/video/selected',hostname:'unseen.example'}});
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
 assert.equal(timers.size,0,'dispose clears the observer lease timer');
});
