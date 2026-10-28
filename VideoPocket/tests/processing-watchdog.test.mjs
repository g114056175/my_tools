import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessingWatchdog} from '../extension/processing-watchdog.js';

function fakeTimers() {
 let now=0,nextId=1;
 const pending=new Map(),history=new Map();
 return {
  setTimer(callback,delay){const id=nextId++,task={id,at:now+delay,callback};pending.set(id,task);history.set(id,task);return id;},
  clearTimer(id){pending.delete(id);},
  tick(milliseconds){
   const target=now+milliseconds;
   for(;;){
    const task=[...pending.values()].filter(item=>item.at<=target).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
    if(!task)break;
    pending.delete(task.id);now=task.at;task.callback();
   }
   now=target;
  },
  fireEvenIfCleared(id){history.get(id)?.callback();},
  latestId(){return nextId-1;},
  get pendingCount(){return pending.size;},
 };
}

const withTimers=timers=>({setTimer:timers.setTimer,clearTimer:timers.clearTimer});

test('watchdog starts immediately and reports one timeout with the current safe stage',()=>{
 const timers=fakeTimers(),errors=[];
 const watchdog=createProcessingWatchdog({timeoutMs:50,onTimeout:error=>errors.push(error),...withTimers(timers)});
 assert.equal(timers.pendingCount,1);
 assert.equal(watchdog.activity('cutting',.25),true);
 const stale=1;
 timers.fireEvenIfCleared(stale);
 assert.equal(errors.length,0,'a cleared timer callback cannot fire after a stage update');
 timers.tick(50);
 assert.equal(errors.length,1);
 assert.equal(errors[0].code,'RANGE_PROCESSING_TIMEOUT');
 assert.equal(errors[0].processingStage,'cutting');
 timers.fireEvenIfCleared(timers.latestId());
 assert.equal(errors.length,1,'timeout is one-shot');
 assert.equal(watchdog.activity('validating',1),false,'expired watchdog ignores later activity');
});

test('only advancing progress or a stage change renews the timer',()=>{
 const timers=fakeTimers(),errors=[];
 const watchdog=createProcessingWatchdog({timeoutMs:100,onTimeout:error=>errors.push(error),...withTimers(timers)});
 watchdog.activity('normalizing',.2);
 const afterStageChange=timers.latestId();
 timers.tick(60);
 assert.equal(watchdog.activity('normalizing',.2),false,'repeated progress is not activity');
 assert.equal(watchdog.activity('normalizing',.1),false,'regressing progress is not activity');
 assert.equal(timers.latestId(),afterStageChange);
 timers.tick(30);
 assert.equal(watchdog.activity('normalizing',.3),true,'advancing progress renews the timeout');
 timers.tick(99);
 assert.equal(errors.length,0);
 timers.tick(1);
 assert.equal(errors.length,1);
 assert.equal(errors[0].processingStage,'normalizing');
});

test('stage transitions renew the timer and timeout reports only an allowed stage',()=>{
 const timers=fakeTimers(),errors=[];
 const watchdog=createProcessingWatchdog({timeoutMs:25,onTimeout:error=>errors.push(error),...withTimers(timers)});
 watchdog.activity('cutting',.8);
 timers.tick(20);
 const beforeTransition=timers.latestId();
 assert.equal(watchdog.activity('validating',0),true);
 assert.notEqual(timers.latestId(),beforeTransition);
 assert.equal(watchdog.activity('unexpected',100),false,'unrecognized stages are ignored');
 timers.tick(25);
 assert.equal(errors.length,1);
 assert.equal(errors[0].processingStage,'validating');
});

test('stop cancels the timer and makes stale callbacks harmless',()=>{
 const timers=fakeTimers(),errors=[];
 const watchdog=createProcessingWatchdog({timeoutMs:10,onTimeout:error=>errors.push(error),...withTimers(timers)});
 const timerId=timers.latestId();
 assert.equal(watchdog.stop(),true);
 assert.equal(watchdog.stop(),false);
 assert.equal(timers.pendingCount,0);
 timers.fireEvenIfCleared(timerId);
 timers.tick(100);
 assert.equal(errors.length,0);
 assert.equal(watchdog.activity('cutting',1),false);
});
