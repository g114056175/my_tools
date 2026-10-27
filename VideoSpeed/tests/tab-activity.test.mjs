import test from 'node:test';
import assert from 'node:assert/strict';
import {TabActivity,replayTabActivityEvents} from '../src/tab-activity.js';

function clockAt(start=0){let value=start;return {now:()=>value,set:next=>{value=next;}};}

test('starts unvisited tabs inactive and tracks only the focused window active tab',()=>{
 const clock=clockAt(100),activity=new TabActivity({now:clock.now});
 assert.deepEqual(activity.activity(1),{focused:false,until:0,revision:0});
 assert.deepEqual(activity.reconcile({windowId:4,tabId:10}),[10]);
 assert.deepEqual(activity.activity(10),{focused:true,until:0,revision:2});
 assert.deepEqual(activity.setActiveTab(8,20),[]);
 assert.deepEqual(activity.activity(10),{focused:true,until:0,revision:2});
 assert.deepEqual(activity.activity(20),{focused:false,until:0,revision:2});
});

test('tab switch grants the previous tab ten seconds and expires at the deadline',()=>{
 const clock=clockAt(1_000),activity=new TabActivity({now:clock.now});
 activity.reconcile({windowId:2,tabId:10});
 clock.set(2_000);assert.deepEqual(activity.setActiveTab(2,11),[10,11]);
 assert.deepEqual(activity.activity(10),{focused:false,until:12_000,revision:3});
 assert.deepEqual(activity.activity(11),{focused:true,until:0,revision:3});
 clock.set(11_999);assert.deepEqual(activity.activity(10),{focused:false,until:12_000,revision:3});
 clock.set(12_000);assert.deepEqual(activity.activity(10),{focused:false,until:0,revision:3});
 assert.equal(activity.snapshot().revision,3,'expiry does not advance the focus revision');
});

test('window focus loss blurs its active tab; activation in another window cannot authorize it',()=>{
 const clock=clockAt(50),activity=new TabActivity({now:clock.now});
 activity.reconcile({windowId:1,tabId:5});
 clock.set(100);assert.deepEqual(activity.setFocusedWindow(null),[5]);
 assert.deepEqual(activity.setActiveTab(2,8),[]);
 assert.deepEqual(activity.activity(5),{focused:false,until:10_100,revision:3});
 assert.deepEqual(activity.activity(8),{focused:false,until:0,revision:3});
 clock.set(200);activity.setFocusedWindow(2);activity.setActiveTab(2,8);
 assert.deepEqual(activity.activity(8),{focused:true,until:0,revision:5});
});

test('navigation on a tab keeps its recent deadline across session recovery',()=>{
 const clock=clockAt(100),activity=new TabActivity({now:clock.now});
 activity.reconcile({windowId:3,tabId:30});
 clock.set(150);activity.setActiveTab(3,31);
 const deadline=activity.activity(30).until;
 const restored=new TabActivity({now:clock.now}).restore(activity.snapshot());
 assert.equal(restored.activity(30).until,deadline);
 assert.deepEqual(restored.activity(31),{focused:true,until:0,revision:3});
});

test('closing a tab removes its focus and recent activity state',()=>{
 const clock=clockAt(500),activity=new TabActivity({now:clock.now});
 activity.reconcile({windowId:4,tabId:40});
 clock.set(600);activity.setActiveTab(4,41);
 assert.equal(activity.forget(40),true);
 assert.deepEqual(activity.activity(40),{focused:false,until:0,revision:3});
 assert.equal(activity.forget(41),true);
 assert.deepEqual(activity.activity(41),{focused:false,until:0,revision:4});
 assert.equal(activity.snapshot().revision,4);
 assert.equal(activity.snapshot().focusedTabId,null);
});

test('restores tabId deadlines from session, drops expired entries, and reconciles the actual focused tab',()=>{
 const clock=clockAt(1_000),activity=new TabActivity({now:clock.now});
 activity.restore({version:1,focusedWindowId:6,focusedTabId:60,revision:5,untilByTab:{'59':1_500,'58':999}});
 assert.deepEqual(activity.activity(59),{focused:false,until:1_500,revision:5});
 assert.deepEqual(activity.activity(58),{focused:false,until:0,revision:5});
 const affected=activity.reconcile({windowId:7,tabId:70});
 assert.deepEqual(affected,[60,70]);
 assert.deepEqual(activity.activity(60),{focused:false,until:11_000,revision:7});
 assert.deepEqual(activity.activity(70),{focused:true,until:0,revision:7});
 assert.deepEqual(activity.snapshot().untilByTab,{'59':1_500,'60':11_000});
 assert.equal(activity.snapshot().revision,7);
 clock.set(1_500);assert.deepEqual(activity.activity(59),{focused:false,until:0,revision:7});
 assert.equal(Object.hasOwn(activity.snapshot().untilByTab,'59'),false);
 assert.equal(activity.snapshot().revision,7,'expired entries do not advance the focus revision');
});

test('restored revision remains monotonic when the focused context matches',()=>{
 const clock=clockAt(4_000),activity=new TabActivity({now:clock.now});
 activity.restore({version:1,focusedWindowId:9,focusedTabId:90,revision:12,untilByTab:{}});
 assert.deepEqual(activity.reconcile({windowId:9,tabId:90}),[]);
 assert.deepEqual(activity.activity(90),{focused:true,until:0,revision:12});
 clock.set(4_500);activity.setActiveTab(9,91);
 assert.deepEqual(activity.activity(90),{focused:false,until:14_500,revision:13});
});

test('window focus transitions without an active tab still persist their revision',()=>{
 const activity=new TabActivity();
 assert.deepEqual(activity.setFocusedWindow(12),[]);
 assert.equal(activity.snapshot().revision,1);
 assert.deepEqual(activity.setFocusedWindow(12),[]);
 assert.equal(activity.snapshot().revision,1);
});

test('replays startup transitions in order and ignores activation from a background window',()=>{
 const clock=clockAt(0),activity=new TabActivity({now:clock.now});
 activity.restore({version:1,focusedWindowId:1,focusedTabId:10,revision:8,untilByTab:{}});
 const events=[
  {type:'activated',windowId:1,tabId:11,at:100},
  {type:'activated',windowId:1,tabId:12,at:200},
  {type:'activated',windowId:2,tabId:99,at:250},
  {type:'focus',windowId:2,at:300},
  {type:'activated',windowId:2,tabId:20,at:350},
 ];
 assert.deepEqual(replayTabActivityEvents(activity,events),[10,11,12,20]);
 assert.deepEqual(activity.reconcile({windowId:2,tabId:20},400),[]);
 assert.deepEqual(activity.activity(10),{focused:false,until:10_100,revision:12});
 assert.deepEqual(activity.activity(11),{focused:false,until:10_200,revision:12});
 assert.deepEqual(activity.activity(12),{focused:false,until:10_300,revision:12});
 assert.deepEqual(activity.activity(99),{focused:false,until:0,revision:12});
 assert.deepEqual(activity.activity(20),{focused:true,until:0,revision:12});
});

test('a later stable focus query does not refresh leases for intermediate tabs',()=>{
 const clock=clockAt(0),activity=new TabActivity({now:clock.now});
 activity.restore({version:1,focusedWindowId:3,focusedTabId:30,revision:2,untilByTab:{}});
 replayTabActivityEvents(activity,[
  {type:'activated',windowId:3,tabId:31,at:100},
  {type:'activated',windowId:3,tabId:32,at:200},
 ]);
 assert.deepEqual(activity.reconcile({windowId:3,tabId:32},20_000),[]);
 assert.deepEqual(activity.activity(30,20_000),{focused:false,until:0,revision:4});
 assert.deepEqual(activity.activity(31,20_000),{focused:false,until:0,revision:4});
 assert.deepEqual(activity.activity(32,20_000),{focused:true,until:0,revision:4});
 assert.deepEqual(activity.snapshot(20_000).untilByTab,{});
 assert.equal(activity.snapshot(20_000).revision,4);
});
