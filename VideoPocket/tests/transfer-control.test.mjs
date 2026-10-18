import test from 'node:test';import assert from 'node:assert/strict';
import {TransferControl} from '../extension/transfer-control.js';import {directTransfer} from '../extension/transfers.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Range retry and pause preserve completed ranges, and only failed ranges are fetched again',async()=>{
 const payload=Uint8Array.from({length:7*1024*1024},(_,i)=>i%251),attempts=new Map(),writes=[],states=[],abort=new AbortController(),control=new TransferControl(abort.signal,s=>states.push(s),{delay:1});let failed=false;
 const request=async(url,{headers,signal})=>{const [start,endRaw]=headers.Range.slice(6).split('-').map(Number),end=Math.min(endRaw,payload.length-1);attempts.set(start,(attempts.get(start)||0)+1);if(start===65536&&!failed){failed=true;throw new TypeError('Failed to fetch');}if(start>65536){await Promise.race([sleep(100),new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})]);}return new Response(payload.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${payload.length}`}});};
 const sink={writeAt:async(bytes,offset)=>writes.push({bytes,offset}),finish:async()=>({size:payload.length})};
 const pending=directTransfer({url:'https://source/video'},request,abort.signal,()=>{},sink,control);await sleep(30);control.pause();const committed=writes.length;await sleep(130);assert.equal(writes.length,committed);assert.ok(states.includes('paused'));control.resume();const result=await pending;assert.equal(result.size,payload.length);assert.equal(attempts.get(0),1);assert.equal(attempts.get(65536),2);let cursor=0;for(const part of writes.sort((a,b)=>a.offset-b.offset)){assert.equal(part.offset,cursor);assert.deepEqual(part.bytes,payload.subarray(cursor,cursor+part.bytes.length));cursor+=part.bytes.length;}assert.equal(cursor,payload.length);
});
test('Retry exhaustion keeps a session waiting for Continue, while cancellation releases it',async()=>{
 const abort=new AbortController(),states=[],control=new TransferControl(abort.signal,s=>states.push(s),{delay:1,attempts:1});let online=false,attempts=0;
 const pending=control.run(async()=>{attempts++;if(!online)throw new TypeError('Failed to fetch');return 'complete';});while(!control.paused)await sleep(1);assert.ok(states.includes('interrupted'));assert.equal(attempts,2);online=true;control.resume();assert.equal(await pending,'complete');
 control.pause();const stopped=control.run(()=>Promise.resolve('wrong'));abort.abort(new DOMException('已取消','AbortError'));await assert.rejects(stopped,/取消/);
});
test('Forbidden sources do not retry indefinitely',async()=>{const control=new TransferControl(new AbortController().signal,()=>{},{delay:1});let tries=0;await assert.rejects(control.run(()=>{tries++;throw new Error('HTTP 403');}),/403/);assert.equal(tries,1);});
