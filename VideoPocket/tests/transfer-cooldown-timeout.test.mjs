import test from 'node:test';
import assert from 'node:assert/strict';
import {directTransfer} from '../extension/transfers.js';

test('a permitted server wait longer than the network stall timeout does not consume that timeout',async()=>{
 const bytes=new Uint8Array(100000).fill(7);let gates=0;
 const request=async(url,{headers}={})=>{
  const match=headers?.Range?.match(/bytes=(\d+)-(\d+)/),start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||bytes.length-1),bytes.length-1);
  return new Response(bytes.subarray(start,end+1),{status:match?206:200,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':end-start+1,etag:'"one"'}});
 };
 request.waitForOrigin=async()=>{gates++;await new Promise(resolve=>setTimeout(resolve,40));};
 const result=await directTransfer({url:'https://cdn.test/media'},request,new AbortController().signal,()=>{},undefined,undefined,{readTimeoutMs:10});
 assert.deepEqual(result,bytes);assert.ok(gates>=2);
});
