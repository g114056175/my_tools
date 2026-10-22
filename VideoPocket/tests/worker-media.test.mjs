import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {observeWorkerMetadata} from '../extension/worker-media.js';

function environment(){
 class WorkerMock{
  constructor(url){this.url=url;this.events=new Map();}
  addEventListener(type,fn){this.events.set(type,fn);}
  removeEventListener(type,fn){if(this.events.get(type)===fn)this.events.delete(type);}
  postMessage(...args){if(args[0]?.reject)throw new Error('clone failed');this.sent=args;return 17;}
  receive(data){this.events.get('message')?.({data});}
 }
 return {Worker:WorkerMock};
}

test('worker observation preserves construction, subclasses, arguments and native failures',()=>{
 const target=environment(),Native=target.Worker,post=Native.prototype.postMessage,values=[];
 const dispose=observeWorkerMetadata(target,value=>values.push(value));
 class Child extends target.Worker{}
 const worker=new Child('https://www.facebook.com/worker.js');
 assert.ok(worker instanceof Native);assert.ok(worker instanceof Child);
 const payload={video:{id:'one'}},transfer=[];
 assert.equal(worker.postMessage(payload,transfer),17);
 assert.equal(worker.sent[0],payload);assert.equal(worker.sent[1],transfer);
 assert.deepEqual(JSON.parse(JSON.stringify(values[0])),payload);
 worker.receive({video:{id:'two'}});assert.equal(values[1].video.id,'two');
 assert.throws(()=>worker.postMessage({reject:true}),/clone failed/);assert.equal(values.length,2);
 dispose();assert.equal(target.Worker,Native);assert.equal(Native.prototype.postMessage,post);
 worker.receive({video:{id:'after-dispose'}});assert.equal(values.length,2);
});

test('worker metadata copying excludes native buffers and accessors and bounds large messages',()=>{
 const target=environment(),values=[],dispose=observeWorkerMetadata(target,value=>values.push(value));
 try{
  const worker=new target.Worker('worker.js');let getters=0;
  const payload={buffer:new Uint8Array(2*1024*1024),videoID:'one'};
  Object.defineProperty(payload,'secret',{enumerable:true,get(){getters++;return 'unused';}});
  payload.cycle=payload;worker.receive(payload);
  assert.equal(getters,0);assert.equal(values[0].videoID,'one');
  assert.equal(values[0].buffer,undefined);assert.equal(values[0].secret,undefined);assert.equal(values[0].cycle,undefined);
  worker.receive({huge:'x'.repeat(512*1024+1),after:'ignored'});
  assert.equal(values[1].huge,undefined);assert.equal(values[1].after,undefined);
 }finally{dispose();}
});

test('metadata listener count is capped and observer errors never break messaging',()=>{
 const target=environment(),dispose=observeWorkerMetadata(target,()=>{throw new Error('observer failed');});
 try{
  const workers=Array.from({length:33},()=>new target.Worker('worker.js'));
  assert.equal(workers[31].events.size,1);assert.equal(workers[32].events.size,0);
  assert.equal(workers[0].postMessage({videoID:'one'}),17);
  assert.doesNotThrow(()=>workers[0].receive({videoID:'one'}));
 }finally{dispose();}
});

test('metadata-only mode keeps bounded media candidates and drops unrelated worker data',()=>{
 const target=environment(),values=[],dispose=observeWorkerMetadata(target,value=>values.push(value),{
  metadataOnly:true,maxDepth:4,maxNodes:32,maxMessages:1,
 });
 try{
  const worker=new target.Worker('worker.js');
  worker.receive({privateToken:'secret',nested:{video:{id:'one',url:'https://cdn.example/one.mp4'},private:'drop'}});
  worker.receive({video:{id:'two',url:'https://cdn.example/two.mp4'}});
  assert.equal(values.length,1);
  assert.equal(values[0].nested.video.url,'https://cdn.example/one.mp4');
  assert.equal(values[0].privateToken,undefined);
  assert.equal(values[0].nested.private,undefined);
 }finally{dispose();}
});

test('metadata-only mode accepts URL arrays, ignores identity-only messages, and recovers its rate budget',()=>{
 let clock=0;const target=environment(),values=[],dispose=observeWorkerMetadata(target,value=>values.push(value),{
  metadataOnly:true,maxMessages:1,now:()=>clock,
 });
 try{
  const worker=new target.Worker('worker.js');
  worker.receive({videoID:'identity-only',type:'state'});
  assert.equal(values.length,0);
  worker.receive({video:{url:'https://cdn.example/throttled.mp4'}});
  assert.equal(values.length,0,'unrelated messages also consume the bounded observation budget');
  clock=1000;
  worker.receive({video:{id:'one',url_list:['https://cdn.example/one.mp4','https://cdn.example/two.mp4']}});
  assert.equal(values.length,1);
  assert.deepEqual(values[0].video.url_list,['https://cdn.example/one.mp4','https://cdn.example/two.mp4']);
  clock=2000;
  worker.receive({video:{id:'three',source:['https://cdn.example/three.mp4']}});
  assert.equal(values.length,2);
 }finally{dispose();}
});

test('metadata-only mode keeps short media titles without treating title-only data as media',()=>{
 const target=environment(),values=[],dispose=observeWorkerMetadata(target,value=>values.push(value),{metadataOnly:true});
 try{
  const worker=new target.Worker('worker.js');
  worker.receive({video:{id:'title-only',title:'A short title'}});
  assert.equal(values.length,0);
  worker.receive({video:{id:'with-source',name:'A named video',video_url:'https://cdn.example/video.mp4',video_title:'x'.repeat(513)}});
  assert.equal(values.length,1);
  assert.equal(values[0].video.name,'A named video');
  assert.equal(values[0].video.video_title,undefined);
 }finally{dispose();}
});

test('bounded worker copying skips giant arrays, cycles and buffers before media',()=>{
 const target=environment(),values=[],dispose=observeWorkerMetadata(target,value=>values.push(value),{metadataOnly:true,maxNodes:64});
 try{
  const worker=new target.Worker('worker.js');
  const payload={noise:Array(600000).fill(0),buffer:new Uint8Array(1024*1024),video:{id:'after-noise',video_url:'https://cdn.example/after-noise.mp4'}};
  payload.cycle=payload;
  worker.receive(payload);
  assert.equal(values.length,1);
  assert.equal(values[0].video.video_url,'https://cdn.example/after-noise.mp4');
  assert.equal(values[0].noise,undefined);
  assert.equal(values[0].buffer,undefined);
  assert.equal(values[0].cycle,undefined);
 }finally{dispose();}
});

test('metadata-only worker copying keeps X broadcast binding identities',()=>{
 const target=environment(),values=[],dispose=observeWorkerMetadata(target,value=>values.push(value),{metadataOnly:true,maxDepth:12,maxNodes:128});
 try{
  const worker=new target.Worker('worker.js');
  worker.receive({tweet_result:{result:{rest_id:'2112242739198959913',legacy:{card:{legacy:{binding_values:[
   {key:'broadcast_id',value:{string_value:'1RKZzBELBbXKB'}},
   {key:'broadcast_media_key',value:{string_value:'28_123456789'}},
  ]}}}}}});
  assert.equal(values.length,1);
  const binding=values[0].tweet_result.result.legacy.card.legacy.binding_values;
  assert.equal(binding[0].key,'broadcast_id');
  assert.equal(binding[0].value.string_value,'1RKZzBELBbXKB');
 }finally{dispose();}
});

test('the shipped document-start bundle observes FB worker metadata and binds the selected ID',async()=>{
 const target=environment();target.location={href:'https://www.facebook.com/feed',hostname:'www.facebook.com'};
 const original=target.Worker;
 const context=vm.createContext({...target,URL:class extends URL{},TextDecoder,TextEncoder,WeakRef});
 const bundle=await fs.readFile(new URL('../extension/media-observer.js',import.meta.url),'utf8');
 vm.runInContext(bundle,context);
 assert.notEqual(context.Worker,original,'the production bundle must install the FB worker observer');
 const outcome=vm.runInContext(`
   const worker=new Worker('worker.js');
   worker.postMessage({__typename:'Video',id:'selected',videoDeliveryLegacyFields:{browser_native_hd_url:'https://video.fbcdn.net/selected.mp4'}});
   const player={currentSrc:'',src:'',nodeType:1,getAttribute:()=>'',closest:()=>null,__reactProps$test:{videoID:'selected'}};
   player.ownerDocument={querySelectorAll:()=>[player]};
   const observer=globalThis[Symbol.for('video-pocket.mediaObserver')];
   const result=observer.modelFor(player)?.versions[0]?.url;
   observer.dispose();result;
 `,context);
 assert.equal(outcome,'https://video.fbcdn.net/selected.mp4');
 assert.equal(context.Worker,original);
});
