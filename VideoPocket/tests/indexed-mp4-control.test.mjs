import {classifyFailure} from '../extension/diagnostics.js';
import {createMediaRangeVersions} from '../extension/media-range-versions.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {TransferControl} from '../extension/transfer-control.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function runtime(){
 const text=await readFile(new URL('../extension/offscreen.js',import.meta.url),'utf8');
 const code=text.slice(text.indexOf('async function downloadIndexedMp4('),text.indexOf('async function rangeFormat('));
 const workers=[],reads=[];
 class Worker{
  constructor(url){this.url=url;this.messages=[];this.terminated=false;workers.push(this);}
  postMessage(data){this.messages.push(data);}
  terminate(){this.terminated=true;}
  emit(data){this.onmessage({data});}
 }
 const transfer=(url,referer,signal,range,progress,pageContext)=>new Promise((resolve,reject)=>{
  const read={url,referer,signal,range,pageContext,resolve,reject};reads.push(read);
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 });
 const context={classifyFailure,createMediaRangeVersions,Worker,transfer,chrome:{runtime:{getURL:path=>path}},AbortController,AbortSignal,Error,Promise};
 vm.runInNewContext(code+';globalThis.download=downloadIndexedMp4;',context);
 const controller=new AbortController(),control=new TransferControl(controller.signal);
 const pending=context.download({url:'https://cdn.test/video.mp4'},{referer:'https://page.test/',descriptor:{pageContext:{tabId:7,documentId:'doc'}}},{start:1,end:2},controller.signal,'test','video',true,()=>{},control);
 return {pending,worker:workers[0],reads,controller,control};
}
test('indexed RPC pause retries the same authenticated byte range after resume',async()=>{
 const r=await runtime();r.worker.emit({type:'readRange',requestId:4,offset:256,length:32});await tick();
 assert.equal(r.reads.length,1);assert.equal(r.reads[0].referer,'https://page.test/');assert.equal(r.reads[0].pageContext.documentId,'doc');
 r.control.pause();await tick();assert.equal(r.reads[0].signal.aborted,true);assert.equal(r.worker.messages.length,1);
 r.control.resume();await tick();assert.equal(r.reads.length,2);assert.equal(r.reads[1].range.offset,256);
 r.reads[1].resolve(new Uint8Array(32));await tick();assert.equal(r.worker.messages.at(-1).requestId,4);assert.equal(r.worker.messages.at(-1).bytes.length,32);
 r.worker.emit({type:'done',path:'test/indexed'});assert.equal((await r.pending).path,'test/indexed');assert.equal(r.worker.terminated,true);
});
test('indexed RPC abort stops in-flight reads and ignores late worker responses',async()=>{
 const r=await runtime(),failure=assert.rejects(r.pending,{code:'CANCELLED'});
 r.worker.emit({type:'readRange',requestId:1,offset:0,length:32});await tick();r.controller.abort(new Error('cancel'));
 await failure;await tick();assert.equal(r.reads[0].signal.aborted,true);assert.equal(r.worker.terminated,true);
 const count=r.worker.messages.length;r.worker.emit({type:'done',path:'stale'});r.worker.emit({type:'readRange',requestId:2,offset:32,length:32});await tick();
 assert.equal(r.reads.length,1);assert.equal(r.worker.messages.length,count);
});
test('indexed RPC forwards access failures and terminates crashed workers',async()=>{
 for(const crash of [false,true]){
  const r=await runtime(),failure=assert.rejects(r.pending,{code:crash?'RANGE_PROCESSING_FAILED':'HTTP_AUTH'});
  r.worker.emit({type:'readRange',requestId:1,offset:0,length:32});await tick();
  if(crash)r.worker.onerror({message:'worker crash'});
  else{r.reads[0].reject(Object.assign(new Error('403'),{code:'HTTP_AUTH'}));await tick();assert.equal(r.worker.messages.at(-1).errorCode,'HTTP_AUTH');r.worker.emit({type:'error',error:'403',errorCode:'HTTP_AUTH'});}
  await failure;assert.equal(r.worker.terminated,true);assert.equal(r.reads[0].signal.aborted,true);
 }
});
