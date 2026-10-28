import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {createRangeVersionGuard,directTransfer} from '../extension/transfers.js';
const payload=Uint8Array.from({length:6*1024*1024+237},(_,i)=>i%251);

test('Range version guard accepts unknown totals only when no size is pinned',()=>{
 const unbounded=createRangeVersionGuard({sourceUrl:'https://cdn/video',etag:'"v1"'});
 assert.deepEqual(unbounded.headers('https://cdn/video'),{'If-Range':'"v1"'});
 assert.deepEqual(unbounded.verify('https://cdn/video',new Response('',{status:206,headers:{'content-range':'bytes 4-8/*','etag':'"v1"'}}),{start:4,end:8}),{start:4,end:8,total:null});
 const sized=createRangeVersionGuard({sourceUrl:'https://cdn/video',etag:'"v1"',total:100});
 assert.throws(()=>sized.verify('https://cdn/video',new Response('',{status:206,headers:{'content-range':'bytes 4-8/*','etag':'"v1"'}}),{start:4,end:8}),error=>error.code==='SOURCE_VERSION_CHANGED');
 const malformed=createRangeVersionGuard({sourceUrl:'https://cdn/video',etag:`"${'a'.repeat(4095)}"`});
 assert.deepEqual(malformed.headers('https://cdn/video'),{});
});

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
const responseFor=(bytes,start,end,total,signal,{failAfterFirst=false,stallAfterFirst=false,etag='"v1"'}={})=>{
 const body=bytes.subarray(start,end+1),half=Math.max(1,Math.ceil(body.length/2));
 const headers={'content-range':`bytes ${start}-${end}/${total}`,...(etag?{etag}:{})};
 return new Response(new ReadableStream({start(controller){
  controller.enqueue(body.subarray(0,half));
  if(failAfterFirst){setTimeout(()=>controller.error(new Error('mid-range failure')),0);return;}
  if(stallAfterFirst){const abort=()=>controller.error(signal?.reason || new Error('aborted'));signal?.addEventListener('abort',abort,{once:true});return;}
  setTimeout(()=>{try{controller.enqueue(body.subarray(half));}catch{}},0);setTimeout(()=>{try{controller.close();}catch{}},1);
 }}),{status:206,headers});
};
test('Parallel ranges preserve every byte, select a fast backup, and report only committed data',async()=>{
 let active=0,peak=0;
 const server=http.createServer((req,res)=>{const match=req.headers.range?.match(/bytes=(\d+)-(\d+)/);const start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||payload.length-1),payload.length-1);active++;peak=Math.max(peak,active);setTimeout(()=>{active--;res.writeHead(match?206:200,{'Content-Range':`bytes ${start}-${end}/${payload.length}`,'ETag':'"v1"'});const bytes=payload.subarray(start,end+1),middle=Math.ceil(bytes.length/2);res.write(bytes.subarray(0,middle));setTimeout(()=>res.end(bytes.subarray(middle)),10);},req.url==='/slow'?150:20);});
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

test('Weak or missing ETags remain supported without becoming If-Range validators',async()=>{
 const small=Uint8Array.from({length:2*1024*1024+91},(_,i)=>i%239);
 for(const etag of ['W/"weak-v1"',null]){
  const seen=[];
  const request=async(url,{headers})=>{
   seen.push(headers);
   const [start,end]=headers.Range.slice(6).split('-').map(Number);
   return responseFor(small,start,end,small.length,undefined,{etag});
  };
  const result=await directTransfer({url:'https://source/video'},request,new AbortController().signal);
  assert.deepEqual(result,small);
  assert.ok(seen.every(headers=>headers['If-Range']===undefined));
 }
});

test('Without a strong validator, a failed range restarts the backup as one complete file',async()=>{
 const primary=Uint8Array.from({length:2*1024*1024+53},(_,i)=>i%241);
 const backup=Uint8Array.from(primary,byte=>(byte+11)%251);
 let backupRangeChunks=0,finished=0;
 const updates=[];let stored=new Uint8Array();
 const request=async(url,{headers}={})=>{
  if(!headers?.Range)return new Response(backup);
  const [start,end]=headers.Range.slice(6).split('-').map(Number);
  if(url.endsWith('/backup')&&start===0)await new Promise(resolve=>setTimeout(resolve,20));
  if(url.endsWith('/backup')&&start!==0)backupRangeChunks++;
  if(url.endsWith('/primary')&&start!==0)throw new TypeError('primary range unavailable');
  const bytes=url.endsWith('/backup')?backup:primary;
  return responseFor(bytes,start,end,bytes.length,undefined,{etag:null});
 };
 const sink={
  async truncate(size){stored=stored.slice(0,Math.min(stored.length,size));},
  async append(bytes){const next=new Uint8Array(stored.length+bytes.length);next.set(stored);next.set(bytes,stored.length);stored=next;},
  async writeAt(bytes,offset){const next=new Uint8Array(Math.max(stored.length,offset+bytes.length));next.set(stored);next.set(bytes,offset);stored=next;},
  async finish(){finished++;return {size:stored.length};},
 };
 const result=await directTransfer({url:'https://cdn/primary',backupUrls:['https://cdn/backup']},request,new AbortController().signal,n=>updates.push(n),sink);
 assert.equal(result.size,backup.length);
 assert.deepEqual(stored,backup);
 assert.equal(backupRangeChunks,0);
 assert.equal(finished,1);
 assert.equal(updates.reduce((sum,delta)=>sum+delta,0),backup.length);
});

test('A same-size version swap is fatal and leaves no background sink writes',async()=>{
 const original=Uint8Array.from({length:4*1024*1024+257},(_,i)=>(i*13)%251);
 const replacement=Uint8Array.from(original,byte=>(byte+1)%251);
 const seenIfRange=[];
 let writes=0,finished=false,stalledRangeStarted;
 const rangeStarted=new Promise(resolve=>stalledRangeStarted=resolve);
 const request=async(url,{headers,signal})=>{
  const [start,end]=headers.Range.slice(6).split('-').map(Number);
  if(start===0)return responseFor(original,start,end,original.length,signal);
  seenIfRange.push(headers['If-Range']);
  if(start===65536)return responseFor(replacement,start,end,replacement.length,signal,{etag:'"v2"'});
  stalledRangeStarted();
  return new Response(new ReadableStream({start(controller){
   signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
  }}),{status:206,headers:{'content-range':`bytes ${start}-${end}/${original.length}`,'etag':'"v1"'}});
 };
 const sink={writeAt:async()=>{writes++;},finish:async()=>{finished=true;return {size:original.length};}};
 const pending=directTransfer({url:'https://cdn/video'},request,new AbortController().signal,()=>{},sink);
 await rangeStarted;
 await assert.rejects(pending,error=>error.code==='SOURCE_VERSION_CHANGED');
 const stoppedWrites=writes;
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(writes,stoppedWrites);
 assert.equal(writes,1,'only the verified probe prefix may have been written');
 assert.equal(finished,false);
 assert.ok(seenIfRange.every(value=>value==='"v1"'));
});

test('If-Range returning 200 stops the transfer before a new version is appended',async()=>{
 const original=Uint8Array.from({length:3*1024*1024+9},(_,i)=>i%239);
 const changed=Uint8Array.from(original,byte=>(byte+3)%251);
 let finished=false,writes=0,ifRange;
 const request=async(url,{headers,signal})=>{
  const [start,end]=headers.Range.slice(6).split('-').map(Number);
  if(start===0)return responseFor(original,start,end,original.length,signal);
  ifRange=headers['If-Range'];
  return new Response(changed,{status:200,headers:{etag:'"v2"'}});
 };
 const sink={writeAt:async()=>{writes++;},finish:async()=>{finished=true;return {size:original.length};}};
 await assert.rejects(directTransfer({url:'https://cdn/video'},request,new AbortController().signal,()=>{},sink),error=>error.code==='SOURCE_VERSION_CHANGED');
 assert.equal(ifRange,'"v1"');
 assert.equal(writes,1);
 assert.equal(finished,false);
});

test('A mismatched backup CDN is rejected while the pinned source can still finish',async()=>{
 const original=Uint8Array.from({length:3*1024*1024+13},(_,i)=>(i*5)%251);
 const replacement=Uint8Array.from(original,byte=>(byte+7)%251);
 const backupIfRange=[];
 const request=async(url,{headers,signal})=>{
  const [start,end]=headers.Range.slice(6).split('-').map(Number);
  if(start===0)return responseFor(original,start,end,original.length,signal,{etag:url.endsWith('/backup')?'"other"':'"v1"'});
  if(url.endsWith('/backup')){
   backupIfRange.push(headers['If-Range']);
   return responseFor(replacement,start,end,replacement.length,signal,{etag:'"other"'});
  }
  await new Promise(resolve=>setTimeout(resolve,1350));
  return responseFor(original,start,end,original.length,signal);
 };
 const result=await directTransfer({url:'https://cdn/primary',backupUrls:['https://cdn/backup']},request,new AbortController().signal);
 assert.deepEqual(result,original);
 assert.ok(backupIfRange.length>0);
 assert.ok(backupIfRange.every(value=>value==='"v1"'));
});

test('Cancellation during a range read prevents finish and later writes',async()=>{
 const small=Uint8Array.from({length:3*1024*1024+31},(_,i)=>i%241);
 const controller=new AbortController(),reason=new Error('已取消');
 let rangeStartedResolve,writes=0,finished=false;
 const rangeStarted=new Promise(resolve=>rangeStartedResolve=resolve);
 const request=async(url,{headers,signal})=>{
  const [start,end]=headers.Range.slice(6).split('-').map(Number);
  if(start===0)return responseFor(small,start,end,small.length,signal);
  rangeStartedResolve();
  return responseFor(small,start,end,small.length,signal,{stallAfterFirst:true});
 };
 const sink={writeAt:async()=>{writes++;},finish:async()=>{finished=true;return {size:small.length};}};
 const pending=directTransfer({url:'https://cdn/video'},request,controller.signal,()=>{},sink);
 await rangeStarted;
 controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);
 const stoppedWrites=writes;
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(writes,stoppedWrites);
 assert.equal(finished,false);
});

test('HTTP 429 does not trigger an immediate backup range request',async()=>{
 const small=Uint8Array.from({length:2*1024*1024+3},(_,i)=>i%251);
 let backupChunks=0;
 const request=async(url,{headers,signal})=>{
  const [start,end]=headers.Range.slice(6).split('-').map(Number);
  if(start===0)return responseFor(small,start,end,small.length,signal);
  if(url.endsWith('/backup'))backupChunks++;
  return new Response('',{status:429});
 };
 await assert.rejects(directTransfer({url:'https://cdn/primary',backupUrls:['https://cdn/backup']},request,new AbortController().signal),error=>error.errors?.some(item=>item.status===429));
 assert.equal(backupChunks,0);
});

test('a terminal 401/403 range failure aborts sibling reads and preserves its status',async()=>{
 const bytes=Uint8Array.from({length:12*1024*1024+100},(_,i)=>i%239);
 for(const status of [401,403]){
  const primaryStarts=[],aborted=[],backupStarts=[];let resolveWorkersStarted;
  const workersStarted=new Promise(resolve=>resolveWorkersStarted=resolve);
  const request=async(url,{headers,signal})=>{
   const [start,end]=headers.Range.slice(6).split('-').map(Number);
   if(start===0){
    if(url.endsWith('/backup'))await new Promise(resolve=>setTimeout(resolve,20));
    signal.throwIfAborted();
    return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"same"'}});
   }
   if(url.endsWith('/backup')){backupStarts.push(start);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"same"'}});}
   primaryStarts.push(start);
   if(primaryStarts.length===4)resolveWorkersStarted();
   if(start===65536){
    await Promise.race([workersStarted,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);
    signal.throwIfAborted();
    return new Response('',{status});
   }
   return new Response(new ReadableStream({start(controller){
    controller.enqueue(new Uint8Array([1]));
    const stop=()=>{aborted.push(start);try{controller.error(signal.reason);}catch{}};
    if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
   }}),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"same"'}});
  };
  const controller=new AbortController(),watchdog=setTimeout(()=>controller.abort(new Error('range fail-fast test timed out')),3000);
  try{
   await assert.rejects(directTransfer({url:'https://cdn/primary',backupUrls:['https://cdn/backup']},request,controller.signal),error=>error.status===status||error.errors?.some(item=>item.status===status));
  }finally{clearTimeout(watchdog);}
  assert.equal(primaryStarts.length,4,'only the four initially assigned parts should be requested');
  assert.equal(aborted.length,3,'every pending sibling body should be cancelled');
  assert.deepEqual(backupStarts,[],'401/403 must retain the existing no-backup policy');
 }
});

test('a terminal range failure also aborts sibling cooldown waits',async()=>{
 const bytes=Uint8Array.from({length:12*1024*1024+100},(_,i)=>i%241);
 let gateCalls=0,abortedGates=0;const requestedStarts=[];
 const request=async(url,{headers,signal})=>{
  const [start,end]=headers.Range.slice(6).split('-').map(Number);requestedStarts.push(start);
  if(start===0)return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"same"'}});
  return new Response('',{status:403});
 };
 request.waitForOrigin=async(url,signal)=>{
  gateCalls++;
  if(gateCalls<=2)return;
  await new Promise((resolve,reject)=>{
   const abort=()=>{abortedGates++;reject(signal.reason);};
   if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
 };
 await assert.rejects(directTransfer({url:'https://cdn/primary'},request,new AbortController().signal),error=>error.status===403||error.errors?.some(item=>item.status===403));
 assert.equal(gateCalls,5,'all four assigned parts should reach the request gate');
 assert.equal(abortedGates,3,'the three sibling cooldown waits should be cancelled');
 assert.deepEqual(requestedStarts,[0,65536],'no sibling should issue a range request after the first part fails');
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
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve(new Response(payload.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${payload.length}`,'etag':'"v1"'}}));},delay);
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
