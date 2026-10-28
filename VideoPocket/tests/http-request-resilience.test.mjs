import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHttpRequestPolicy,parseRetryAfter} from '../extension/http-resilience.js';
import {createIndexedRoutes} from '../extension/indexed-routes.js';
import {classifyFailure} from '../extension/diagnostics.js';

async function runtime(fetchImpl=fetch,{pageResponse}={}){
 const source=await readFile(new URL('../extension/offscreen.js',import.meta.url),'utf8');
 const start=source.indexOf('async function request('),end=source.indexOf('\nconst absolute=',start);
 const sharedHttpRequestPolicy=createHttpRequestPolicy();
 const context={URL,AbortSignal,AbortController,DOMException,Response,fetch:fetchImpl,setTimeout,clearTimeout,parseRetryAfter,sharedHttpRequestPolicy,mediaCredentials:()=>undefined,rpc:async()=>({}),socialPageResponse:async()=>pageResponse};
 vm.runInNewContext(source.slice(start,end)+';globalThis.read=request;',context);
 return {request:context.read,policy:sharedHttpRequestPolicy};
}

test('production HTTP request coordinates real 429 Retry-After across concurrent requests and cancellation',async t=>{
 const hits=[];
 const server=http.createServer((req,res)=>{hits.push({url:req.url,at:Date.now()});if(req.url==='/limit'){res.writeHead(429,{'Retry-After':'1'});res.end();}else{res.end('media');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`,r=await runtime();
 await assert.rejects(r.request(origin+'/limit','https://page.test'),error=>error.httpStatus===429&&error.retryAfterMs===1000&&error.requestOrigin===origin);
 const deadline=r.policy.cooldownUntil(origin),abort=new AbortController();
 const cancelled=r.request(origin+'/cancel','https://page.test',{signal:abort.signal});
 const reason=new DOMException('已取消','AbortError');abort.abort(reason);
 await assert.rejects(cancelled,error=>error===reason);
 const responses=await Promise.all([r.request(origin+'/one','https://page.test'),r.request(origin+'/two','https://page.test')]);
 assert.deepEqual(await Promise.all(responses.map(response=>response.text())),['media','media']);
 assert.equal(hits.some(hit=>hit.url==='/cancel'),false);
 assert.ok(hits.filter(hit=>hit.url!=='/limit').every(hit=>hit.at>=deadline));
});

test('request preserves date-form 503 waits and safe diagnostics without leaking retry URLs',async()=>{
 const date=new Date(Date.now()+4000).toUTCString(),r=await runtime(async()=>new Response('',{status:503,headers:{'Retry-After':date}}));
 let failure;try{await r.request('https://cdn.test/video?signature=SECRET','https://page.test');}catch(error){failure=error;}
 assert.equal(failure.httpStatus,503);assert.ok(failure.retryAfterMs>2000);
 assert.ok(r.policy.cooldownUntil('https://cdn.test')>=Date.parse(date));
 assert.doesNotMatch(JSON.stringify(classifyFailure(failure)),/SECRET|signature|retryAfter|requestOrigin/);
});

test('social page fallback carries Retry-After into the same request policy',async()=>{
 const pageResponse=new Response('',{status:429,headers:{'Retry-After':'2'}});
 const r=await runtime(async()=>new Response('',{status:403}),{pageResponse});
 await assert.rejects(r.request('https://video.fbcdn.net/file','https://www.facebook.com/',{pageContext:{documentId:'doc'}}),error=>error.httpStatus===429&&error.retryAfterMs===2000);
 assert.ok(r.policy.cooldownUntil('https://video.fbcdn.net')>Date.now()+1500);
});

test('a redirected refusal gates both its original URL and the actual limiting origin',async()=>{
 const response=new Response('',{status:429,headers:{'Retry-After':'2'}});Object.defineProperty(response,'url',{value:'https://actual-cdn.test/media'});
 const r=await runtime(async()=>response);
 await assert.rejects(r.request('https://redirect.test/media','https://page.test'),error=>error.requestOrigin==='https://actual-cdn.test');
 assert.ok(r.policy.cooldownUntil('https://actual-cdn.test')>Date.now()+1500);
 assert.ok(r.policy.cooldownUntil('https://redirect.test')>Date.now()+1500);
});

test('an unrepresentably large server wait is not converted to a short automatic retry',async()=>{
 const r=await runtime(async()=>new Response('',{status:429,headers:{'Retry-After':'9999999999999999999999999999999999999'}}));
 await assert.rejects(r.request('https://long-wait.test/media','https://page.test'),error=>error.code==='HTTP_RETRY_AFTER_UNSUPPORTED'&&classifyFailure(error).retryable===false);
 await assert.rejects(r.policy.waitForOrigin('https://long-wait.test'),{code:'HTTP_RETRY_AFTER_UNSUPPORTED'});
});

test('indexed backup aliases wait for redirected 429 and 503 Retry-After deadlines',async t=>{
 for(const status of [429,503]){
  const hits=[];let firstFailureResolve;
  const firstFailure=new Promise(resolve=>{firstFailureResolve=resolve;});
  const limited=http.createServer((req,res)=>{
   hits.push({url:req.url,at:Date.now()});
   if(hits.length===1){res.writeHead(status,{'Retry-After':'1'});res.end();return;}
   res.writeHead(206,{'Content-Range':'bytes 0-0/1'});res.end('x');
  });
  await new Promise(resolve=>limited.listen(0,'127.0.0.1',resolve));
  const limitedOrigin=`http://127.0.0.1:${limited.address().port}`;
  const aliases=[0,1].map(()=>http.createServer((_req,res)=>{res.writeHead(302,{Location:`${limitedOrigin}/media`});res.end();}));
  await Promise.all(aliases.map(server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))));
  const urls=aliases.map(server=>`http://127.0.0.1:${server.address().port}/alias`);
  t.after(()=>{for(const server of [...aliases,limited]){server.closeAllConnections();server.close();}});

  const r=await runtime(),routes=createIndexedRoutes(urls,{
   maxHedges:0,
   retryOrigin:error=>[429,503].includes(Number(error?.httpStatus??error?.status))&&(error.retryAfterMs!==undefined||error.retryAfterUnsupported===true)?error.requestOrigin:null,
   waitForRetryOrigin:(origin,signal)=>r.policy.waitForOrigin(origin,signal)
  });
  const pending=routes.run(async(url,signal)=>{
   try{return await (await r.request(url,'https://page.test',{signal})).text();}
   catch(error){if(url===urls[0])firstFailureResolve(error);throw error;}
  });
  const failure=await firstFailure;
  assert.equal(failure.httpStatus,status);
  assert.equal(failure.requestOrigin,limitedOrigin);
  const deadline=r.policy.cooldownUntil(limitedOrigin);
  const result=await pending;
  assert.deepEqual(result,{value:'x',url:urls[1]});
  assert.equal(hits.length,2);
  assert.ok(hits[1].at>=deadline,`${status} backup reached limiting server before Retry-After deadline`);
 }
});
