import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadStallGuard} from '../extension/download-stall.js';

function harness(timeoutMs=120_000){
 let time=10_000;
 const guard=createDownloadStallGuard({now:()=>time,timeoutMs});
 return {guard,setTime:value=>{time=value;},advance:delta=>{time+=delta;},get time(){return time;}};
}

const item=(id,bytesReceived,state='in_progress',paused=false)=>({id,bytesReceived,state,paused});

test('stalls only at the timeout boundary after an unchanged in-progress sample',()=>{
 const h=harness(),download=item(1,50);
 assert.equal(h.guard.update(download),false);
 h.advance(119_999);assert.equal(h.guard.update(download),false);
 h.advance(1);assert.equal(h.guard.update(download),true);
});

test('ongoing byte progress keeps a long download alive',()=>{
 const h=harness(),download=item(2,0);
 assert.equal(h.guard.update(download),false);
 for(let i=1;i<=8;i++){
  h.advance(119_000);
  assert.equal(h.guard.update(item(2,i*10)),false);
 }
 h.advance(119_999);assert.equal(h.guard.update(item(2,80)),false);
 h.advance(1);assert.equal(h.guard.update(item(2,80)),true);
});

test('item pause, job pause, and destination selection reset the stall clock',()=>{
 const h=harness();
 assert.equal(h.guard.update(item(3,100)),false);
 h.advance(119_000);assert.equal(h.guard.update(item(3,100,'in_progress',true)),false);
 h.advance(300_000);assert.equal(h.guard.update(item(3,100)),false,'resume starts a fresh interval');
 h.advance(119_000);assert.equal(h.guard.update(item(3,100),{paused:true}),false);
 h.advance(300_000);assert.equal(h.guard.update(item(3,100)),false,'job resume starts a fresh interval');
 h.advance(119_000);assert.equal(h.guard.update(item(3,100),{choosing:true}),false);
 h.advance(300_000);assert.equal(h.guard.update(item(3,100)),false,'leaving destination selection starts a fresh interval');
 h.advance(120_000);assert.equal(h.guard.update(item(3,100)),true);
});

test('non-progress states stop the timer, and resumed transfers start over',()=>{
 const h=harness();
 assert.equal(h.guard.update(item(4,400)),false);
 h.advance(119_000);assert.equal(h.guard.update(item(4,400,'interrupted')),false);
 h.advance(500_000);assert.equal(h.guard.update(item(4,400)),false);
 h.advance(120_000);assert.equal(h.guard.update(item(4,400,'complete')),false);
 h.advance(500_000);assert.equal(h.guard.update(item(4,400)),false);
});

test('a clock rollback rebases the timer instead of causing a false stall',()=>{
 const h=harness();
 assert.equal(h.guard.update(item(5,20)),false);
 h.advance(120_000);h.setTime(h.time-120_001);
 assert.equal(h.guard.update(item(5,20)),false,'the backwards sample becomes the new baseline');
 h.advance(119_999);assert.equal(h.guard.update(item(5,20)),false);
 h.advance(1);assert.equal(h.guard.update(item(5,20)),true);
});

test('downloads maintain independent progress clocks',()=>{
 const h=harness();
 assert.equal(h.guard.update(item(6,10)),false);
 h.advance(60_000);assert.equal(h.guard.update(item(7,100)),false);
 h.advance(60_000);
 assert.equal(h.guard.update(item(6,10)),true,'progress on another ID does not reset this download');
 assert.equal(h.guard.update(item(7,100)),false,'the other download keeps its own start time');
 h.advance(60_000);assert.equal(h.guard.update(item(7,100)),true);
});

test('only byte increases count as progress and explicit reset forgets an ID',()=>{
 const h=harness();
 assert.equal(h.guard.update(item(8,100)),false);
 h.advance(90_000);assert.equal(h.guard.update(item(8,80)),false,'a byte decrease does not refresh the clock');
 h.advance(30_000);assert.equal(h.guard.update(item(8,80)),true);
 h.guard.reset(8);assert.equal(h.guard.update(item(8,80)),false);
 h.guard.clear();assert.equal(h.guard.update(item(8,80)),false);
});

test('invalid byte samples and invalid thresholds are handled safely',()=>{
 const h=harness();
 assert.equal(h.guard.update({id:9,state:'in_progress',bytesReceived:NaN}),false);
 h.advance(300_000);assert.equal(h.guard.update(item(9,0)),false,'missing measurements never create a false timeout');
 assert.throws(()=>createDownloadStallGuard({timeoutMs:0}),RangeError);
 assert.throws(()=>createDownloadStallGuard({timeoutMs:Infinity}),RangeError);
 assert.throws(()=>createDownloadStallGuard({now:1}),TypeError);
});
