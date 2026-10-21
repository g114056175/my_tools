import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNetworkCandidates} from '../extension/source-candidates.js';

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
