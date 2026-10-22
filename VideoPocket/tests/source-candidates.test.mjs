import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNetworkCandidates,prioritizeMediaVersions} from '../extension/source-candidates.js';

test('a later high quality survives the probe cap even with many low-quality CDN backups',()=>{
 const versions=[...Array.from({length:10},(_,i)=>({url:`https://cdn.test/360-${i}.mp4`,height:360})),{url:'https://cdn.test/1080.mp4',height:1080},{url:'https://cdn.test/720.mp4',height:720}];
 const ordered=prioritizeMediaVersions(versions);
 assert.equal(ordered.length,6);assert.deepEqual(ordered.slice(0,3).map(value=>value.height),[360,1080,720]);
 assert.equal(versions[1].height,360,'source metadata is not mutated');
});

const source=(duration=20)=>({duration,formats:[{kind:'video',videoCodec:'h264'}]});
const platform={expectedDuration:20,versions:['ad','main','other'].map(name=>({url:`https://cdn.test/${name}.mp4`,kind:'progressive'}))};
test('bounded probing verifies the selected duration and rejects an advertisement',async()=>{
 let active=0,peak=0;
 const result=await resolveNetworkCandidates(platform,{probe:async({url})=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;return source(url.includes('main')?20:5);}});
 assert.equal(result.duration,20);assert.equal(result.requiresAudio,true);assert.equal(peak,2);
});
test('two matching sources stay ambiguous and cannot silently pick the most recent request',async()=>{
 await assert.rejects(resolveNetworkCandidates(platform,{probe:async()=>source()}),{code:'SOURCE_UNAVAILABLE'});
});
test('aborting cancels the active probes without starting every remaining candidate',async()=>{
 const controller=new AbortController();let started=0;
 const pending=resolveNetworkCandidates({...platform,versions:[...platform.versions,...platform.versions]},{signal:controller.signal,probe:async(_,signal)=>{
  started++;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }});
 controller.abort(new DOMException('cancelled','AbortError'));await assert.rejects(pending,{name:'AbortError'});assert.equal(started,2);
});
test('transient refusal of one source does not hide another verified source',async()=>{
 const result=await resolveNetworkCandidates(platform,{probe:async({url})=>{if(!url.includes('main'))throw Object.assign(new Error('refused'),{status:403});return source();}});
 assert.equal(result.duration,20);
});

test('same manifest group merges verified qualities into one source',async()=>{
 const versions=[
  {url:'https://cdn.test/low.m3u8',kind:'hls',candidateGroup:{kind:'manifest',id:'https://cdn.test/master.m3u8'}},
  {url:'https://cdn.test/high.m3u8',kind:'hls',candidateGroup:{kind:'manifest',id:'https://cdn.test/master.m3u8'}}
 ];
 const result=await resolveNetworkCandidates({expectedDuration:20,versions},{probe:async({url})=>({...source(),formats:[{kind:'video',videoCodec:'h264',url}]})});
 assert.equal(result.formats.length,2);
});

test('same explicit player media id merges only within the same browser scope',async()=>{
 const versions=[
  {url:'https://cdn.test/low.mp4',candidateGroup:{kind:'player',id:'video-1',scope:{tabId:1,frameId:2,documentId:'doc'}}},
  {url:'https://cdn.test/high.mp4',candidateGroup:{kind:'player',id:'video-1',scope:{tabId:1,frameId:2,documentId:'doc'}}}
 ];
 const result=await resolveNetworkCandidates({expectedDuration:20,versions},{probe:async({url})=>({...source(),formats:[{kind:'video',videoCodec:'h264',url}]})});
 assert.equal(result.formats.length,2);
});

test('different videos with equal duration remain ambiguous',async()=>{
 const versions=[
  {url:'https://cdn.test/a.mp4',candidateGroup:{kind:'player',id:'video-a',scope:{tabId:1,frameId:2,documentId:'doc'}}},
  {url:'https://cdn.test/b.mp4',candidateGroup:{kind:'player',id:'video-b',scope:{tabId:1,frameId:2,documentId:'doc'}}}
 ];
 await assert.rejects(resolveNetworkCandidates({expectedDuration:20,versions},{probe:async()=>source()}),{code:'SOURCE_UNAVAILABLE'});
});

test('progressive validation can reach the seventh candidate',async()=>{
 let calls=0;
 const versions=Array.from({length:7},(_,i)=>({url:`https://cdn.test/${i}.mp4`}));
 await resolveNetworkCandidates({expectedDuration:20,versions},{probe:async()=>{calls++;return source()}}).catch(error=>assert.equal(error.code,'SOURCE_UNAVAILABLE'));
 assert.equal(calls,7);
});

test('player grouping requires a complete scope',async()=>{
 const versions=[1,2].map(i=>({url:`https://cdn.test/${i}.mp4`,candidateGroup:{kind:'player',id:'same',scope:{tabId:1}}}));
 await assert.rejects(resolveNetworkCandidates({expectedDuration:20,versions},{probe:async()=>source()}),{code:'SOURCE_UNAVAILABLE'});
});

test('player grouping rejects non-browser scope types',async()=>{
 const versions=[{url:'https://cdn.test/a.mp4',candidateGroup:{kind:'player',id:'same',scope:{tabId:'1',frameId:0,documentId:'doc'}}},{url:'https://cdn.test/b.mp4',candidateGroup:{kind:'player',id:'same',scope:{tabId:1,frameId:-1,documentId:'doc'}}}];
 await assert.rejects(resolveNetworkCandidates({expectedDuration:20,versions},{probe:async()=>source()}),{code:'SOURCE_UNAVAILABLE'});
});

test('partial deadline is fail closed for ungrouped candidates',async()=>{
 const versions=[1,2].map(i=>({url:`https://cdn.test/${i}.mp4`}));
 await assert.rejects(resolveNetworkCandidates({expectedDuration:20,versions},{totalTimeoutMs:10,probe:async(v,signal)=>{
  if (v.url.endsWith('/1.mp4')) return source();
  await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }}),{code:'SOURCE_UNAVAILABLE'});
});

test('merged formats namespace colliding audio groups and keep pairing',async()=>{
 const versions=[1,2].map(i=>({url:`https://cdn.test/${i}.m3u8`,candidateGroup:{kind:'manifest',id:'https://cdn.test/master.m3u8'}}));
 const result=await resolveNetworkCandidates({expectedDuration:20,versions},{probe:async(v)=>({...source(),formats:[{kind:'video',videoCodec:'h264',id:'video',url:v.url,audioGroup:'audio'}]})});
 assert.deepEqual(result.formats.map(f=>f.audioGroup),['0:audio','1:audio']);
 assert.deepEqual(result.formats.map(f=>f.id),['0:video','1:video']);
});
