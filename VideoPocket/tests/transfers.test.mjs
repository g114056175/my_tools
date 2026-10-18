import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {directTransfer} from '../extension/transfers.js';
const payload=Uint8Array.from({length:6*1024*1024+237},(_,i)=>i%251);
test('Parallel ranges preserve every byte, select a fast backup, and report only committed data',async()=>{
 let active=0,peak=0;
 const server=http.createServer((req,res)=>{const match=req.headers.range?.match(/bytes=(\d+)-(\d+)/);const start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||payload.length-1),payload.length-1);active++;peak=Math.max(peak,active);setTimeout(()=>{active--;res.writeHead(match?206:200,{'Content-Range':`bytes ${start}-${end}/${payload.length}`});res.end(payload.subarray(start,end+1));},req.url==='/slow'?150:20);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{let received=0;const result=await directTransfer({url:base+'/slow',backupUrls:[base+'/fast']},fetch,new AbortController().signal,n=>received+=n);assert.deepEqual(result,payload);assert.equal(received,payload.length);assert.ok(peak>=2);}finally{await new Promise(r=>server.close(r));}
});
test('A malformed or truncated range never produces a downloadable partial file',async()=>{
 const request=async(url,{headers})=>{const [start,end]=headers.Range.slice(6).split('-').map(Number);return new Response(new Uint8Array(start?3:65536),{status:206,headers:{'content-range':`bytes ${start}-${end}/100000`}});};
 await assert.rejects(directTransfer({url:'https://source/video'},request,new AbortController().signal),/長度不完整/);
});
test('Cancellation stops before producing a file',async()=>{
 const controller=new AbortController();controller.abort(new Error('已取消'));
 await assert.rejects(directTransfer({url:'https://source/video'},async()=>{throw Error('offline');},controller.signal),/已取消/);
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
