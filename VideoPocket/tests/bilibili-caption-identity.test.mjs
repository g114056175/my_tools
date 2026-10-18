import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBilibiliIdentity} from '../extension/page.js';

const state={videoData:{bvid:'BV1bzpd6eE6e',pages:[
  {page:1,cid:42682680877,part:'第一段'},
  {page:2,cid:42682680878,part:'第二段'}
]}};

test('Bilibili subtitle identity follows current URL bvid and p cid',()=>{
  assert.deepEqual(resolveBilibiliIdentity('https://www.bilibili.com/video/BV1bzpd6eE6e/?p=2',state),{
    valid:true,bvid:'BV1bzpd6eE6e',cid:42682680878,page:2
  });
});

test('stale SPA state from another Bilibili video is rejected',()=>{
  const stale={videoData:{bvid:'BVoldVideo01',pages:[{page:1,cid:12345}]}};
  const result=resolveBilibiliIdentity('https://www.bilibili.com/video/BV1bzpd6eE6e/',stale);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'bvid-mismatch');
});
test('Case-sensitive video IDs cannot collide in caption identity',()=>{
 const different={videoData:{bvid:'BV1BZpd6eE6e',pages:[{cid:42682680877}]}};assert.equal(resolveBilibiliIdentity('https://www.bilibili.com/video/BV1bzpd6eE6e/',different).valid,false);
});

test('missing requested page cid is rejected instead of falling back to old cid',()=>{
  const stale={videoData:{bvid:'BV1bzpd6eE6e',pages:[{page:1,cid:42682680877}]},cid:42682680877};
  const result=resolveBilibiliIdentity('https://www.bilibili.com/video/BV1bzpd6eE6e/?p=2',stale);
  assert.equal(result.valid,false);
  assert.equal(result.reason,'cid-missing');
});

test('re-resolving without an explicit page uses the current URL page',()=>{
  const result=resolveBilibiliIdentity('https://www.bilibili.com/video/BV1bzpd6eE6e/?p=2',state);
  assert.equal(result.page,2);
  assert.equal(result.cid,42682680878);
});

test('a floating global CID cannot override videoData CID',()=>{
 const state={cid:99,videoData:{bvid:'BVfixture01',cid:11}};
 assert.equal(resolveBilibiliIdentity('https://www.bilibili.com/video/BVfixture01/',state).cid,11);
});
