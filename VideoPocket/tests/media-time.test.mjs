import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mediaTime} from '../extension/media-time.js';

function setup({content='a',src='blob:a',duration=100}={}){
 const events=new Map();let time=12,plays=0;
 const video={tagName:'VIDEO',isConnected:true,duration,currentSrc:src,play(){plays++;},addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n),get currentTime(){return time;},set currentTime(v){time=v;queueMicrotask(()=>events.get('seeked')?.());}};
 const document={querySelectorAll:()=>[video]},context={document,location:{href:'https://example.test'},Symbol,setTimeout,clearTimeout};
 context[Symbol.for('video-pocket.identities')]={keys:new WeakMap([[video,7]])};
 context[Symbol.for('video-pocket.sourceEvidence')]={collectMediaEvidence:()=>({identity:{id:content}})};
 const run=vm.runInNewContext(`(${mediaTime.toString()})`,context);
 return {run,video,plays:()=>plays};
}
test('preview reads and seeks the exact selected video without autoplay',async()=>{
 const rt=setup();assert.equal((await rt.run({mediaKey:7,contentId:'a'})).time,12);
 const result=await rt.run({mediaKey:7,contentId:'a',time:42.25});assert.equal(result.time,42.25);assert.equal(result.duration,100);assert.equal(rt.plays(),0);
});
test('preview rejects stale content, source, identity, invalid or unbounded time',async()=>{
 await assert.rejects(setup().run({mediaKey:7,contentId:'b',time:10}),{code:'SOURCE_CHANGED'});
 await assert.rejects(setup({content:''}).run({mediaKey:7,sourceUrl:'blob:b'}),{code:'SOURCE_CHANGED'});
 await assert.rejects(setup().run({mediaKey:8,time:10}),{code:'SOURCE_CHANGED'});
 await assert.rejects(setup().run({mediaKey:7,time:101}),{code:'RANGE_INVALID'});
 await assert.rejects(setup({duration:Infinity}).run({mediaKey:7}),{code:'RANGE_UNSUPPORTED'});
});
test('preview rejects a video detached during a seek',async()=>{
 const rt=setup();const add=rt.video.addEventListener;rt.video.addEventListener=(...args)=>{rt.video.isConnected=false;add(...args);};
 await assert.rejects(rt.run({mediaKey:7,time:30}),{code:'SOURCE_CHANGED'});
});
