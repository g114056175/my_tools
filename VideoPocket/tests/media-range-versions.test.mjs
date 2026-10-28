import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaRangeVersions} from '../extension/media-range-versions.js';
import {createMediaTransfer} from '../extension/media-transfer.js';
import {assembleSegments} from '../extension/ordered-segments.js';
import {TransferControl} from '../extension/transfer-control.js';

const response=(etag='"v1"',range='bytes 0-1/4',status=206)=>new Response(new Uint8Array([1,2]),{status,headers:{...(etag?{etag}:{}),'Content-Range':range}});
test('an index and later bytes share one version; independent HLS files keep separate versions',()=>{
 const versions=createMediaRangeVersions();
 versions.verify('file','https://cdn.test/a',response());
 assert.deepEqual(versions.headers('file'),{'If-Range':'"v1"'});
 versions.verify('file','https://cdn.test/a',response('"v1"','bytes 2-3/4'));
 assert.throws(()=>versions.verify('file','https://cdn.test/a',response('"v2"','bytes 2-3/4')),{code:'SOURCE_VERSION_CHANGED'});
 versions.verify('segment2','https://cdn.test/b',response('"another-file"'));
 assert.throws(()=>versions.verify('file','https://cdn.test/a',response('"v1"','bytes 0-3/4',200)),{code:'SOURCE_VERSION_CHANGED'});
});
test('weak or absent validators preserve one-URL range support without pretending to verify the version',()=>{
 for(const etag of ['', 'W/"weak"']){
  const versions=createMediaRangeVersions();versions.verify('file','https://cdn.test/a',response(etag));
  assert.deepEqual(versions.headers('file'),{});
  versions.verify('file','https://cdn.test/a',response(etag,'bytes 2-3/4'));
 }
});
test('a same-size version change during ranged segment assembly aborts and never seals an output',async()=>{
 let finished=0,aborted=0,writes=0,calls=0;
 const sink={append:async()=>{writes++;},writeAt:async()=>{writes++;},finish:async()=>{finished++;return {path:'input',size:4};},abort:async()=>{aborted++;}};
 const disk={createMediaFile:async()=>sink,removeMediaFile:async()=>{}};
 const request=async(url,referer,{headers})=>{calls++;return response(calls===1?'"v1"':'"v2"',headers.Range.replace('=',' ')+'/4');};
 const service=createMediaTransfer({request,disk,directTransfer:async()=>{},assembleSegments});
 const control=new TransferControl(new AbortController().signal,()=>{},{delay:1});
 const format={url:'https://cdn.test/a',segments:[0,2].map(offset=>({resolvedUri:'https://cdn.test/a',byterange:{offset,length:2}}))};
 await assert.rejects(service.downloadTrack(format,'https://page.test/',control.signal,()=>{},'test',control),{code:'SOURCE_VERSION_CHANGED'});
 const settledWrites=writes;await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(writes,settledWrites);assert.equal(finished,0);assert.equal(aborted,1);
});
