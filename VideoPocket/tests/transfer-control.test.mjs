import test from 'node:test';import assert from 'node:assert/strict';
import {TransferControl} from '../extension/transfer-control.js';import {directTransfer} from '../extension/transfers.js';import {createHttpRequestPolicy,parseRetryAfter} from '../extension/http-resilience.js';
import {classifyFailure} from '../extension/diagnostics.js';
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

test('Retry-After parses delta seconds and HTTP dates, and rejects invalid values',()=>{
 const now=Date.parse('Wed, 21 Oct 2015 07:27:00 GMT');
 assert.equal(parseRetryAfter('2',now),2000);assert.equal(parseRetryAfter('1.25',now),null);
 assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:27:03 GMT',now),3000);
 assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:26:59 GMT',now),0);
 assert.equal(parseRetryAfter('later',now),null);assert.equal(parseRetryAfter('-1',now),null);assert.equal(parseRetryAfter('999999999999999999999',now),null);
});

test('parallel retries share a cooldown by request origin',async()=>{
 const origin='https://cooldown.example',policy=createHttpRequestPolicy(),firstAbort=new AbortController(),secondAbort=new AbortController();let hit429,signal429=new Promise(resolve=>hit429=resolve),firstAttempts=0,secondAttempts=0;
 const first=new TransferControl(firstAbort.signal,()=>{},{delay:1,requestPolicy:policy}),second=new TransferControl(secondAbort.signal,()=>{},{delay:1,requestPolicy:policy});
 const firstResult=first.run(()=>{if(firstAttempts++===0){hit429();throw Object.assign(new Error('HTTP 429'),{httpStatus:429,retryAfterMs:140,requestOrigin:origin});}return Date.now();});
 await signal429;while(!policy.cooldownUntil(origin))await sleep(1);const deadline=policy.cooldownUntil(origin);
 const secondResult=second.run(()=>{if(secondAttempts++===0)throw Object.assign(new TypeError('Failed to fetch'),{requestOrigin:`${origin}/segment`});return Date.now();});
 const [firstRetryAt,secondRetryAt]=await Promise.all([firstResult,secondResult]);
 assert.ok(firstRetryAt>=deadline);assert.ok(secondRetryAt>=deadline);
});

test('cancelling during a server cooldown aborts the pending retry promptly',async()=>{
 const abort=new AbortController(),policy=createHttpRequestPolicy(),control=new TransferControl(abort.signal,()=>{},{delay:1,requestPolicy:policy});let attempts=0;
 const pending=control.run(()=>{attempts++;throw Object.assign(new Error('HTTP 429'),{httpStatus:429,retryAfterMs:10_000,requestOrigin:'https://cancel.example'});});
 while(!policy.cooldownUntil('https://cancel.example'))await sleep(1);
 const reason=new DOMException('已取消','AbortError'),started=Date.now();abort.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.ok(Date.now()-started<250);assert.equal(attempts,1);
});

test('invalid Retry-After falls back to the existing exponential retry delay',async()=>{
 const control=new TransferControl(new AbortController().signal,()=>{},{delay:35,requestPolicy:createHttpRequestPolicy()});let attempts=0;const started=Date.now();
 const result=await control.run(()=>{attempts++;if(attempts===1)throw Object.assign(new Error('HTTP 429'),{httpStatus:429,retryAfter:'not a date',requestOrigin:'https://fallback.example'});return 'ok';});
 assert.equal(result,'ok');assert.equal(attempts,2);assert.ok(Date.now()-started>=30);
});

test('503 Retry-After also gates retries, and cooldown storage stays bounded safely',async()=>{
 const origin='https://unavailable.example',policy=createHttpRequestPolicy({maxOrigins:1}),abort=new AbortController(),control=new TransferControl(abort.signal,()=>{},{delay:1,requestPolicy:policy});let attempts=0;
 const started=Date.now(),result=await control.run(()=>{attempts++;if(attempts===1)throw Object.assign(new Error('HTTP 503'),{httpStatus:503,retryAfterMs:55,requestOrigin:origin});return 'ok';});
 assert.equal(result,'ok');assert.equal(attempts,2);assert.ok(Date.now()-started>=45);
 policy.observe({httpStatus:429,retryAfterMs:1000,requestOrigin:'https://one.example'});
 policy.observe({httpStatus:429,retryAfterMs:2000,requestOrigin:'https://two.example'});
 assert.ok(policy.cooldownUntil('https://one.example')>=Date.now()+1900);assert.ok(policy.cooldownUntil('https://two.example')>=Date.now()+1900);
});

test('normal origin admission is immediate; cooldown release spaces requests by 100ms',async()=>{
 const origin='https://spread.example',policy=createHttpRequestPolicy(),start=Date.now();
 await Promise.all(Array.from({length:8},()=>policy.waitForOrigin(origin)));
 assert.ok(Date.now()-start<50);
 policy.observe({httpStatus:429,retryAfterMs:40,requestOrigin:origin});const deadline=policy.cooldownUntil(origin),released=[];
 await Promise.all(Array.from({length:5},()=>policy.waitForOrigin(origin).then(()=>released.push(Date.now()))));
 assert.equal(released.length,5);assert.ok(released.every(time=>time>=deadline));
 const ordered=[...released].sort((a,b)=>a-b);for(let i=1;i<ordered.length;i++)assert.ok(ordered[i]-ordered[i-1]>=75);
 assert.ok(ordered.at(-1)-ordered[0]<2000);
});

test('the same request signal can pass both transfer and fetch gates without a second slot',async()=>{
 const origin='https://same-request.example',policy=createHttpRequestPolicy(),signal=new AbortController().signal;
 policy.observe({httpStatus:429,retryAfterMs:0,requestOrigin:origin});
 await policy.waitForOrigin(origin,signal);const passed=Date.now();
 await policy.waitForOrigin(origin,signal);assert.ok(Date.now()-passed<50);
});

test('control cooldown waits do not consume request admission slots',async()=>{
 const origin='https://control-admission.example',policy=createHttpRequestPolicy();
 policy.observe({httpStatus:429,retryAfterMs:0,requestOrigin:origin});
 const start=Date.now();await policy.waitForOrigin(origin,new AbortController().signal,{admission:false});
 const issued=[];await Promise.all([0,1].map(()=>policy.waitForOrigin(origin,new AbortController().signal).then(()=>issued.push(Date.now()))));
 const ordered=issued.sort((a,b)=>a-b);assert.ok(ordered[0]-start<75);assert.ok(ordered[1]-ordered[0]>=75);
});

test('admission queue overflow is bounded and non-retryable',async()=>{
 const origin='https://bounded-admission.example',policy=createHttpRequestPolicy({maxPendingPerOrigin:1});
 policy.observe({httpStatus:429,retryAfterMs:0,requestOrigin:origin});
 const first=policy.waitForOrigin(origin);
 await assert.rejects(policy.waitForOrigin(origin),error=>error.code==='HTTP_RETRY_ADMISSION_BUSY'&&classifyFailure(error).retryable===false);
 await first;
});

test('expired admission records free origin capacity',async()=>{
 const first='https://expired-admission.example',second='https://next-admission.example',policy=createHttpRequestPolicy({maxOrigins:1,releaseWindowMs:10});
 policy.observe({httpStatus:429,retryAfterMs:0,requestOrigin:first});await policy.waitForOrigin(first);await sleep(20);
 policy.observe({httpStatus:429,retryAfterMs:0,requestOrigin:second});
 const started=Date.now();await Promise.all([policy.waitForOrigin(first),policy.waitForOrigin(first)]);
 assert.ok(Date.now()-started<50);
});

test('cancelled admission releases promptly and unsupported waits permanently fail closed',async()=>{
 const origin='https://failgate.example',policy=createHttpRequestPolicy({maxOrigins:1});
 policy.observe({httpStatus:429,retryAfterMs:0,requestOrigin:origin});
 const queuedAbort=new AbortController(),first=policy.waitForOrigin(origin),queued=policy.waitForOrigin(origin,queuedAbort.signal);
 await sleep(10);const reason=new DOMException('已取消','AbortError'),cancelAt=Date.now();queuedAbort.abort(reason);
 await assert.rejects(queued,error=>error===reason);assert.ok(Date.now()-cancelAt<80);await first;
 const detail=policy.observe({httpStatus:429,requestOrigin:origin,retryAfterUnsupported:true});
 assert.equal(detail.retryAfterUnsupported,true);assert.equal(classifyFailure(detail.error).retryable,false);
 await assert.rejects(policy.waitForOrigin(origin),error=>error===detail.error);
 policy.observe({httpStatus:429,requestOrigin:'https://overflow-failgate.example',retryAfterUnsupported:true});
 await assert.rejects(policy.waitForOrigin('https://third.example'),error=>error.code==='HTTP_RETRY_AFTER_UNSUPPORTED');
 assert.equal(policy.unsupportedError(origin),detail.error);
});
