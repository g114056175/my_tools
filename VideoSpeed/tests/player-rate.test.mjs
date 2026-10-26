import test from 'node:test';
import assert from 'node:assert/strict';
import {syncPlayerRate} from '../src/player-rate.js';
function fixture(){
 const video={parentElement:null};
 const owner={contains:item=>item===video,getAvailablePlaybackRates:()=>[1,1.25,1.5,2],calls:[],setPlaybackRate(value){this.calls.push(value);}};
 video.parentElement=owner;return {video,owner};
}
test('selected owner receives a supported speed through its native API',()=>{
 const {video,owner}=fixture();assert.equal(syncPlayerRate(video,2).status,'requested');assert.deepEqual(owner.calls,[2]);
});
test('unsupported rates do not ask the owner to clamp a custom HTML rate',()=>{
 const {video,owner}=fixture();assert.equal(syncPlayerRate(video,1.05).status,'unsupported-rate');assert.deepEqual(owner.calls,[]);
});
test('unrelated global players are never changed',()=>{
 const video={parentElement:null},other={setPlaybackRate(){throw Error('wrong owner');}};
 assert.equal(syncPlayerRate(video,2,{player:other}).status,'unsupported');
});
test('an explicitly bound player may receive the speed',()=>{
 const video={parentElement:null},calls=[];assert.equal(syncPlayerRate(video,2,{player:{media:video,setPlaybackRate:value=>calls.push(value)}}).status,'requested');assert.deepEqual(calls,[2]);
});
test('a failing owner API returns to the HTML video fallback',()=>{
 const {video,owner}=fixture();owner.setPlaybackRate=()=>{throw Error('unavailable');};assert.equal(syncPlayerRate(video,2).status,'failed');
});
test('asynchronous player rejection is contained while HTML fallback remains available',async()=>{
 const {video,owner}=fixture();owner.setPlaybackRate=()=>Promise.reject(Error('player rejected'));
 assert.equal(syncPlayerRate(video,2).status,'requested');await new Promise(resolve=>setImmediate(resolve));
});
