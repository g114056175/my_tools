import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaPresenceMonitor,mediaTargetKey} from '../extension/media-presence-monitor.js';

function fakeTimers(){
 let nextId=1;const jobs=new Map();
 return {jobs,setTimer(callback,delay){const id=nextId++;jobs.set(id,{callback,delay});return id;},clearTimer(id){jobs.delete(id);},fireNext(){const next=jobs.entries().next().value;assert.ok(next,'expected a scheduled fake timer');jobs.delete(next[0]);next[1].callback();return next[1];}};
}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function waitFor(predicate,message='expected asynchronous monitor work to finish'){
 for(let i=0;i<50;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}
 assert.ok(predicate(),message);
}

const target=(mediaKey,frameId=0,documentId='doc')=>({tabId:4,documentId,frameId,mediaKey});

test('monitor is intent-gated, uses fake interval timers, and permits one inflight read',async()=>{
 const timers=fakeTimers(),item=target('player-a'),reads=[];
 const monitor=createMediaPresenceMonitor({targets:()=>[item],read:current=>{reads.push(current);return pending.promise;},onMissing:()=>{},intervalMs:500,setTimer:timers.setTimer,clearTimer:timers.clearTimer});
 const pending=deferred();
 await monitor.check();assert.equal(reads.length,0);assert.equal(timers.jobs.size,0,'no timer or read exists before start intent');
 monitor.start();monitor.start();assert.equal(timers.jobs.size,1);assert.equal([...timers.jobs.values()][0].delay,500);
 timers.fireNext();await waitFor(()=>reads.length===1);
 await monitor.check();await monitor.check();assert.equal(reads.length,1,'concurrent checks do not start another request');
 pending.resolve({checked:true,missing:[]});await waitFor(()=>timers.jobs.size===1);
 monitor.stop();assert.equal(timers.jobs.size,0,'stop clears the next scheduled interval');
 monitor.start();assert.equal(timers.jobs.size,1,'a later intent can restart the monitor');monitor.stop();assert.equal(timers.jobs.size,0);
});

test('target changes during a read ignore stale results and pass only current targets',async()=>{
 const timers=fakeTimers(),first=target('player-a'),second=target('player-b',2,'doc-b'),unknown=target('other',9,'other-doc');
 let current=[first],missing=[];const readCalls=[],pending=[];
 const monitor=createMediaPresenceMonitor({targets:()=>current,read:targets=>{readCalls.push([...targets]);const next=deferred();pending.push(next);return next.promise;},onMissing:async items=>missing.push(items),intervalMs:50,setTimer:timers.setTimer,clearTimer:timers.clearTimer});
 monitor.start();timers.fireNext();await waitFor(()=>readCalls.length===1);
 assert.deepEqual(readCalls[0],[first]);current=[second];
 pending[0].resolve({checked:true,missing:[first]});await waitFor(()=>timers.jobs.size===1);
 assert.deepEqual(missing,[],'a missing result for the previous target set is ignored');
 timers.fireNext();await waitFor(()=>readCalls.length===2);
 assert.deepEqual(readCalls[1],[second]);
 pending[1].resolve({checked:true,missing:[second,unknown]});await waitFor(()=>missing.length===1);
 assert.deepEqual(missing,[[second]],'unknown targets are filtered before cleanup callback');
 assert.equal(mediaTargetKey(readCalls[1][0]),mediaTargetKey(second));
 monitor.stop();assert.equal(timers.jobs.size,0);
});

test('stop during an inflight read ignores its late missing result and leaves no timer',async()=>{
 const timers=fakeTimers(),item=target('player-a'),pending=deferred();let missing=[],reads=0;
 const monitor=createMediaPresenceMonitor({targets:()=>[item],read:()=>{reads++;return pending.promise;},onMissing:items=>missing.push(items),setTimer:timers.setTimer,clearTimer:timers.clearTimer});
 monitor.start();timers.fireNext();await waitFor(()=>reads===1);
 monitor.stop();assert.equal(timers.jobs.size,0);
 pending.resolve({checked:true,missing:[item]});await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(missing,[]);assert.equal(timers.jobs.size,0,'late completion cannot restart a stopped monitor');
});

test('unchecked, malformed, unknown, and failed reads never trigger removal',async()=>{
 const item=target('player-a'),outsiders=target('unrequested',8,'other-doc');
 const cases=[
  {result:{checked:false,missing:[item]}},
  {result:{checked:true,present:[]}},
  {result:{checked:true,missing:[outsiders]}},
  {error:new Error('frame unavailable')},
 ];
 for(const scenario of cases){
  const timers=fakeTimers(),removed=[];
  const monitor=createMediaPresenceMonitor({targets:()=>[item],read:async()=>{if(scenario.error)throw scenario.error;return scenario.result;},onMissing:missing=>removed.push(missing),setTimer:timers.setTimer,clearTimer:timers.clearTimer});
  monitor.start();timers.fireNext();await waitFor(()=>timers.jobs.size===1);
  assert.deepEqual(removed,[],'unknown or incomplete presence evidence is not absence');
  monitor.stop();assert.equal(timers.jobs.size,0);
 }
});
