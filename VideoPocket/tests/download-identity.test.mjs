import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadIdentity,createDownloadClaims} from '../extension/download-identity.js';

test('a recycled feed player cannot reuse another permalink download',()=>{
 const d={tabId:7,documentId:'feed',frameId:0,mediaKey:1,linkedMedia:{id:'first',url:'https://example.test/reel/first'}};
 assert.notEqual(downloadIdentity(d),downloadIdentity({...d,linkedMedia:{id:'second',url:'https://example.test/reel/second'}}));
 assert.equal(downloadIdentity(d),downloadIdentity({...d,linkedMedia:{...d.linkedMedia,url:d.linkedMedia.url+'?tracking=changed'}}));
});
import {downloadLocked} from '../extension/jobs.js';

const base={tabId:4,documentId:'doc-a',frameId:0,localMediaIndex:1,mediaKey:9,platform:{site:'youtube',id:'yt-1'}};

test('same page media keeps identity across inspect ids, quality, and URL refresh',()=>{
  const one=downloadIdentity({...base,url:'https://cdn/a',height:360});
  const two=downloadIdentity({...base,url:'https://cdn/b',height:1080});
  assert.equal(one,two);
});

test('video and audio share a media identity while different media and titles do not merge',()=>{
  assert.equal(downloadIdentity({...base,kind:'video'}),downloadIdentity({...base,kind:'audio'}));
  assert.notEqual(downloadIdentity(base),downloadIdentity({...base,platform:{site:'youtube',id:'yt-2'}}));
  assert.equal(downloadIdentity({...base,title:'same'}),downloadIdentity({...base,title:'other'}));
});

test('claim is atomic, duplicate returns original job, and release permits retry',()=>{
  const claims=createDownloadClaims();
  assert.deepEqual(claims.claim('k','job-1'),{claimed:true,id:'job-1'});
  assert.deepEqual(claims.claim('k','job-2'),{claimed:false,duplicate:true,id:'job-1'});
  claims.release('k','job-2');
  assert.equal(claims.get('k'),'job-1');
  claims.release('k','job-1');
  assert.deepEqual(claims.claim('k','job-3'),{claimed:true,id:'job-3'});
});

test('Instagram and Twitch SPA routes separate posts but retain locks across token refresh',()=>{
  for(const site of ['instagram','twitch']){
    const descriptor={...base,platform:{site,id:'post-1'}};
    assert.equal(downloadIdentity(descriptor),downloadIdentity({...descriptor,url:'https://cdn/new-token',mediaKey:99}));
    assert.notEqual(downloadIdentity(descriptor),downloadIdentity({...descriptor,platform:{site,id:'post-2'}}));
  }
});

test('Dailymotion identity includes the current video and frame document',()=>{
  const descriptor={...base,platform:{site:'dailymotion',id:'dm-1'}};
  assert.equal(downloadIdentity(descriptor),downloadIdentity({...descriptor,url:'https://cdn/new-token'}));
  assert.notEqual(downloadIdentity(descriptor),downloadIdentity({...descriptor,platform:{site:'dailymotion',id:'dm-2'}}));
  assert.notEqual(downloadIdentity(descriptor),downloadIdentity({...descriptor,documentId:'doc-b'}));
});

test('popup reopen/refresh keeps the current media locked while another media is available',()=>{
  const jobs=[{id:'job-1',downloadKey:'current',state:'processing'}];
  assert.equal(downloadLocked(jobs,'current'),true);
  assert.equal(downloadLocked([...jobs],'current'),true); // reopened popup reads the same session jobs
  assert.equal(downloadLocked(jobs,'other-media'),false); // media selector changed
  assert.equal(downloadLocked([{...jobs[0],state:'done'}],'current'),false);
});
