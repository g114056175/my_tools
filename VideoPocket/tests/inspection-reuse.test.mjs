import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionReuseKey,inspectionReusable} from '../extension/inspection-reuse.js';

const descriptor={
 tabId:7,documentId:'document-a',mediaKey:'media-key-a',
 referer:'https://example.test/watch/1',url:'https://cdn.example/video-a.mp4',
 sourceType:'progressive',mediaContentId:'media-id-a',title:'Selected video',
 platform:{site:'network-media',id:'media-id-a',versions:[{url:'https://cdn.example/video-a.mp4',kind:'progressive'}]}
};

test('inspection reuse key hashes the complete selection, source, title and platform identity',async()=>{
 const key=await inspectionReuseKey(descriptor);
 assert.match(key,/^[a-f0-9]{64}$/);
 assert.equal(await inspectionReuseKey({...descriptor,frameId:0}),key,'frameId defaults to zero');
 for(const patch of [
  {tabId:8},{documentId:'document-b'},{frameId:1},{mediaKey:'media-key-b'},
  {url:'https://cdn.example/video-b.mp4'},{sourceType:'hls'},
  {mediaContentId:'media-id-b'},{title:'Different title'},
  {height:720},{requestOptions:{mode:'cors'}},
  {platform:{...descriptor.platform,id:'media-id-b'}},
  {platform:{...descriptor.platform,site:'embedded'}},
  {platform:{...descriptor.platform,versions:[{url:'https://cdn.example/other.mp4',kind:'progressive'}]}}
 ])assert.notEqual(await inspectionReuseKey({...descriptor,...patch}),key,JSON.stringify(patch));
 assert.equal(await inspectionReuseKey({...descriptor,downloadKey:'another-lock',mediaIndex:4,localMediaIndex:2}),key,'list order and download lock are not source inputs');
});

test('inspection reuse key rejects DRM, invalid scope, cyclic and oversized descriptors',async()=>{
 assert.equal(await inspectionReuseKey({...descriptor,drm:true}),'');
 assert.equal(await inspectionReuseKey({...descriptor,tabId:-1}),'');
 assert.equal(await inspectionReuseKey({...descriptor,documentId:''}),'');
 assert.equal(await inspectionReuseKey({...descriptor,mediaKey:null}),'');
 assert.equal(await inspectionReuseKey(null),'');
 assert.equal(await inspectionReuseKey({...descriptor,duration:Infinity}),'');
 const cyclic={...descriptor};cyclic.platform={site:'network-media',self:cyclic};
 assert.equal(await inspectionReuseKey(cyclic),'');
 assert.equal(await inspectionReuseKey({...descriptor,title:'x'.repeat(512*1024+1)}),'');
});

test('only a retained finite source with the exact key is reusable; retention owns its lifetime',()=>{
 const source={inspectionKey:'key-a',inspectedAt:1000,duration:12,live:false};
 assert.equal(inspectionReusable(source,'key-a',1000),true);
 assert.equal(inspectionReusable(source,'key-a',60999),true);
 assert.equal(inspectionReusable(source,'key-a',61000),true,'an active popup or job is not expired by inspection age');
 assert.equal(inspectionReusable(source,'key-a',999),true,'the retention controller handles idle deadlines and clock changes');
 assert.equal(inspectionReusable(source,'key-b',1001),false);
 assert.equal(inspectionReusable({...source,dropOnRelease:true},'key-a',1001),false);
 assert.equal(inspectionReusable({...source,duration:0},'key-a',1001),false);
 assert.equal(source.inspectedAt,1000,'checking reuse does not extend the original inspection time');
});
