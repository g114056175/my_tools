import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {directTransfer} from '../extension/transfers.js';
const payload=Uint8Array.from({length:6*1024*1024+237},(_,i)=>i%251);

test('a continuous non-range file can outlive the read deadline without restarting',async()=>{
 let whole=0,received=0;const bytes=[];
 const request=async(url,{headers,signal})=>{
  if(headers?.Range)return new Response('',{status:200});whole++;
  let index=0;return new Response(new ReadableStream({async pull(controller){await new Promise(r=>setTimeout(r,40));if(signal.aborted){controller.error(signal.reason);return;}if(index===8){controller.close();return;}controller.enqueue(new Uint8Array([++index]));}}),{headers:{'content-length':'8'}});
 };
 const sink={async truncate(){bytes.length=0;},async append(b){bytes.push(...b);},async finish(){return {size:bytes.length};}};
 const result=await directTransfer({url:'https://source/continuous'},request,new AbortController().signal,n=>received+=n,sink,undefined,{readTimeoutMs:200});
 assert.equal(result.size,8);assert.deepEqual(bytes,[1,2,3,4,5,6,7,8]);assert.equal(received,8);assert.equal(whole,1);
});

test('a non-range body that stops returning data still times out and is cancelled',async()=>{
 let cancelled=false;
 const request=async(url,{headers,signal})=>{
  if(headers?.Range)return new Response('',{status:200});
  return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));signal.addEventListener('abort',()=>{cancelled=true;controller.error(signal.reason);},{once:true});}}));
 };
 await assert.rejects(directTransfer({url:'https://source/stalled'},request,new AbortController().signal,()=>{},undefined,undefined,{readTimeoutMs:20}),{name:'TimeoutError'});
 assert.equal(cancelled,true);
});
const responseFor=(bytes,start,end,total,signal,{failAfterFirst=false,stallAfterFirst=false}={})=>{
 const body=bytes.subarray(start,end+1),half=Math.max(1,Math.ceil(body.length/2));
 return new Response(new ReadableStream({start(controller){
  controller.enqueue(body.subarray(0,half));
  if(failAfterFirst){setTimeout(()=>controller.error(new Error('mid-range failure')),0);return;}
  if(stallAfterFirst){const abort=()=>controller.error(signal?.reason || new Error('aborted'));signal?.addEventListener('abort',abort,{once:true});return;}
  setTimeout(()=>{try{controller.enqueue(body.subarray(half));}catch{}},0);setTimeout(()=>{try{controller.close();}catch{}},1);
 }}),{status:206,headers:{'content-range':`bytes ${start}-${end}/${total}`}});
};
test('Parallel ranges preserve every byte, select a fast backup, and report only committed data',async()=>{
 let active=0,peak=0;
 const server=http.createServer((req,res)=>{const match=req.headers.range?.match(/bytes=(\d+)-(\d+)/);const start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||payload.length-1),payload.length-1);active++;peak=Math.max(peak,active);setTimeout(()=>{active--;res.writeHead(match?206:200,{'Content-Range':`bytes ${start}-${end}/${payload.length}`});const bytes=payload.subarray(start,end+1),middle=Math.ceil(bytes.length/2);res.write(bytes.subarray(0,middle));setTimeout(()=>res.end(bytes.subarray(middle)),10);},req.url==='/slow'?150:20);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const updates=[],result=await directTransfer({url:base+'/slow',backupUrls:[base+'/fast']},fetch,new AbortController().signal,n=>updates.push(n));assert.deepEqual(result,payload);assert.equal(updates.reduce((sum,n)=>sum+n,0),payload.length);assert.ok(updates.filter(n=>n>0).length>5,'range reads should report incrementally');assert.ok(peak>=2);}finally{await new Promise(r=>server.close(r));}
});
test('A malformed or truncated range never produces a downloadable partial file',async()=>{
 const request=async(url,{headers})=>{const [start,end]=headers.Range.slice(6).split('-').map(Number);return new Response(new Uint8Array(start?3:65536),{status:206,headers:{'content-range':`bytes ${start}-${end}/100000`}});};
 await assert.rejects(directTransfer({url:'https://source/video'},request,new AbortController().signal),/長度不完整/);
});
test('A primary range that fails after partial reads rolls back before backup bytes commit',async()=>{
 const small=Uint8Array.from({length:3*1024*1024+17},(_,i)=>(i*7)%251),updates=[];
 const request=async(url,{headers,signal})=>{const [start,end]=headers.Range.slice(6).split('-').map(Number);if(start===0)return responseFor(small,start,end,small.length,signal);return url.endsWith('/primary')?responseFor(small,start,end,small.length,signal,{failAfterFirst:true}):responseFor(small,start,end,small.length,signal);};
 const result=await directTransfer({url:'https://cdn/primary',backupUrls:['https://cdn/backup']},request,new AbortController().signal,n=>updates.push(n));
 let seen=0;for(const delta of updates){seen+=delta;assert.ok(seen>=0&&seen<=small.length);}assert.equal(seen,small.length);assert.deepEqual(result,small);assert.ok(updates.some(n=>n<0),'failed primary bytes should be rolled back');
});
test('Hedged ranges can both read partially without exceeding total progress',async()=>{
 const small=Uint8Array.from({length:3*1024*1024+17},(_,i)=>(i*11)%251),updates=[];
 const request=async(url,{headers,signal})=>{const [start,end]=headers.Range.slice(6).split('-').map(Number);if(start===0)return responseFor(small,start,end,small.length,signal);if(url.endsWith('/primary'))return responseFor(small,start,end,small.length,signal,{stallAfterFirst:true});return responseFor(small,start,end,small.length,signal);};
 const result=await directTransfer({url:'https://cdn/primary',backupUrls:['https://cdn/backup']},request,new AbortController().signal,n=>updates.push(n));
 let seen=0;for(const delta of updates){seen+=delta;assert.ok(seen>=0&&seen<=small.length);}assert.equal(seen,small.length);assert.deepEqual(result,small);
});
test('Cancellation stops before producing a file',async()=>{
 const controller=new AbortController();controller.abort(new Error('已取消'));
 await assert.rejects(directTransfer({url:'https://source/video'},async()=>{throw Error('offline');},controller.signal),/已取消/);
});

test('a failed fallback chain preserves its first transport error',async()=>{
 const first=new Error('primary unavailable'),second=new Error('backup unavailable');
 const request=async(url,{headers}={})=>{if(headers?.Range==='bytes=0-65535')throw url.includes('primary')?first:second;if(url.includes('primary'))throw first;throw second;};
 await assert.rejects(directTransfer({url:'https://primary',backupUrls:['https://backup']},request,new AbortController().signal),error=>error===first);
});
test('A source without Range support falls back to one complete direct response',async()=>{
 let requests=0;const result=await directTransfer({url:'https://source/video'},async()=>{requests++;return new Response(payload);},new AbortController().signal);assert.equal(requests,2);assert.deepEqual(result,payload);
});
test('Fast small probes cannot trap the download on a CDN with stalled large ranges',async()=>{
 const request=(url,{signal,headers})=>new Promise((resolve,reject)=>{const [start,requestedEnd]=headers.Range.slice(6).split('-').map(Number),end=Math.min(requestedEnd,payload.length-1),delay=url.endsWith('/slow')?(start?3000:5):80;
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve(new Response(payload.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${payload.length}`}}));},delay);
  const abort=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
 });
 const started=performance.now(),result=await directTransfer({url:'https://cdn/slow',backupUrls:['https://cdn/fast']},request,new AbortController().signal);assert.deepEqual(result,payload);assert.ok(performance.now()-started<2500,'The stalled route should lose to the backup');
});
test('Disk sink path never allocates a whole-file Uint8Array and preserves every byte',async()=>{
 const writes=[],original=globalThis.Uint8Array;
 const sink={writeAt:async(bytes,offset)=>writes.push({bytes,offset}),finish:async()=>({path:'temp/file',size:payload.length})};
 const request=async(url,{headers})=>{const [start,requestedEnd]=headers.Range.slice(6).split('-').map(Number),end=Math.min(requestedEnd,payload.length-1);return new Response(payload.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${payload.length}`}});};
 globalThis.Uint8Array=new Proxy(original,{construct(target,args){if(typeof args[0]==='number'&&args[0]>2*1024*1024)throw Error('whole-file allocation forbidden');return Reflect.construct(target,args);}});
 let result;try{result=await directTransfer({url:'https://cdn/video'},request,new AbortController().signal,()=>{},sink);}finally{globalThis.Uint8Array=original;}
 assert.equal(result.size,payload.length);const ordered=writes.sort((a,b)=>a.offset-b.offset);let cursor=0;for(const part of ordered){assert.equal(part.offset,cursor);assert.deepEqual(part.bytes,payload.subarray(cursor,cursor+part.bytes.length));cursor+=part.bytes.length;}assert.equal(cursor,payload.length);
});
