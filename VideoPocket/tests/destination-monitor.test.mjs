import test from 'node:test';
import assert from 'node:assert/strict';
import {createDestinationMonitor} from '../extension/destination-monitor.js';

function fakeTimers(){
 let nextId=1;const jobs=new Map();
 return {jobs,setTimer(callback,delay){const id=nextId++;jobs.set(id,{callback,delay});return id;},clearTimer(id){jobs.delete(id);},fireNext(){
  const next=jobs.entries().next().value;assert.ok(next,'expected a scheduled fake timer');jobs.delete(next[0]);next[1].callback();return next[1];
 }};
}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function waitFor(predicate,message='expected asynchronous monitor work to finish'){
 for(let i=0;i<50;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}
 assert.ok(predicate(),message);
}

test('idle has no timer; pending starts one check and the last pending item stops it',async()=>{
 const timers=fakeTimers(),checkWait=deferred();let pending=false,checks=0;
 const monitor=createDestinationMonitor({pending:()=>pending,check:()=>{checks++;return checkWait.promise;},intervalMs:37,setTimer:timers.setTimer,clearTimer:timers.clearTimer});
 assert.equal(timers.jobs.size,0);
 monitor.refresh();assert.equal(timers.jobs.size,0,'refresh while idle must not poll');

 pending=true;monitor.refresh();assert.equal(timers.jobs.size,1);assert.equal([...timers.jobs.values()][0].delay,37);
 timers.fireNext();await waitFor(()=>checks===1);
 await monitor.check();assert.equal(checks,1,'an inflight check is not duplicated');assert.equal(timers.jobs.size,0);

 checkWait.resolve();await waitFor(()=>timers.jobs.size===1,'a pending choice should schedule its next check');
 pending=false;monitor.refresh();assert.equal(timers.jobs.size,0,'clearing the final pending item cancels the timer');
 monitor.stop();assert.equal(timers.jobs.size,0);
});

test('a failed check reports once and leaves later pending checks usable',async()=>{
 const timers=fakeTimers(),failure=new Error('destination service unavailable'),errors=[];let pending=true,checks=0;
 const monitor=createDestinationMonitor({pending:()=>pending,check:async()=>{if(++checks===1)throw failure;pending=false;},onError:error=>errors.push(error),intervalMs:21,setTimer:timers.setTimer,clearTimer:timers.clearTimer});
 monitor.refresh();timers.fireNext();await waitFor(()=>checks===1&&timers.jobs.size===1);
 assert.deepEqual(errors,[failure]);
 timers.fireNext();await waitFor(()=>checks===2&&timers.jobs.size===0);
 assert.deepEqual(errors,[failure],'a recovered check must not duplicate the earlier error');
 monitor.stop();assert.equal(timers.jobs.size,0);
});
