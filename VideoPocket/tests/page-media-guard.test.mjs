import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPageMediaGuard,pageMediaLease} from '../extension/page-media-guard.js';

function fakeClock(start=1000){
 let now=start,nextId=1;const jobs=new Map();
 return {jobs,now:()=>now,setTimer(callback,delay){const id=nextId++;jobs.set(id,{callback,delay,at:now+delay});return id;},clearTimer(id){jobs.delete(id);},fireNext(){
  const next=[...jobs.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];assert.ok(next,'expected a scheduled fake timer');jobs.delete(next[0]);now=next[1].at;next[1].callback();return next[1];
 }};
}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function waitFor(predicate,message='expected asynchronous guard work to finish'){
 for(let i=0;i<50;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}
 assert.ok(predicate(),message);
}

function pageHarness(initialVideos=[]){
 const clock=fakeClock(),videos=[...initialVideos];let scans=0;
 const document={querySelectorAll(selector){assert.equal(selector,'video');scans++;return [...videos];}};
 const ids={keys:new WeakMap()};
 const observer={videosSnapshot:()=>[],isPresent:()=>true};
 const evidence={collectMediaEvidence:({video})=>({identity:{id:video.contentId||''}})};
 const context={Symbol,Date:{now:clock.now},Math,Set,WeakMap,Promise,URL,document,location:{href:'https://video.test/watch/one'},setTimeout:clock.setTimer,clearTimeout:clock.clearTimer};
 context[Symbol.for('video-pocket.identities')]=ids;
 context[Symbol.for('video-pocket.mediaObserver')]=observer;
 context[Symbol.for('video-pocket.sourceEvidence')]=evidence;
 context[Symbol.for('video-pocket.selection')]={videos:[]};
 const lease=vm.runInNewContext(`(${pageMediaLease.toString()})`,context);
 const makeVideo=({key='media-a',contentId='content-a',src='https://cdn.test/a.mp4',paused=false,rects=true}={})=>{
  const video={isConnected:true,ownerDocument:document,currentSrc:src,paused,contentId,querySelector:()=>null,getClientRects:()=>rects?[{}]:[]};
  if(key!=null)ids.keys.set(video,key);
  videos.push(video);return video;
 };
 return {clock,context,document,ids,observer,evidence,videos,lease,makeVideo,get scans(){return scans;}};
}

const target=(overrides={})=>({mediaKey:'media-a',contentId:'content-a',playerUrl:'https://cdn.test/a.mp4',timeoutMs:0,...overrides});
const boundContext=(overrides={})=>({tabId:7,documentId:'document-a',mediaKey:'media-a',contentId:'content-a',playerUrl:'https://cdn.test/a.mp4',...overrides});
const localValue=value=>JSON.parse(JSON.stringify(value));

test('unbound page media lease and transfer skip DOM checks',async()=>{
 const page=pageHarness(),result=await page.lease({});
 assert.deepEqual(localValue(result),{valid:true,unbound:true});assert.equal(page.scans,0,'an unbound target must not inspect videos');
 const timers=fakeClock();let checked=0,operated=0;
 const guard=createPageMediaGuard({check:async()=>{checked++;return {valid:true};},setTimer:timers.setTimer,clearTimer:timers.clearTimer,now:timers.now});
 assert.equal(await guard.run(boundContext({mediaKey:null}),async()=>{operated++;return 'independent';}),'independent');
 assert.equal(checked,0);assert.equal(operated,1);assert.equal(timers.jobs.size,0);
});

test('a bound Shadow DOM player remains valid after the popup registry is released',async()=>{
 const page=pageHarness(),video=page.makeVideo();page.videos.length=0;
 const shadow={querySelectorAll:()=>[video]},host={shadowRoot:shadow};
 page.document.createTreeWalker=root=>{let read=false;return {nextNode(){if(root===page.document&&!read){read=true;return host;}return null;}};};
 assert.equal((await page.lease(target())).valid,true);
});

test('a missing keyed video waits for same-key recovery; absent timeout is reported',async()=>{
 const page=pageHarness(),pending=page.lease(target({timeoutMs:250}));
 assert.equal(page.clock.jobs.size,1);assert.equal([...page.clock.jobs.values()][0].delay,100);
 const recovered=page.makeVideo();page.clock.fireNext();
 assert.deepEqual(localValue(await pending),{valid:true});
 assert.equal(page.ids.keys.get(recovered),'media-a');assert.equal(page.clock.jobs.size,0);
 const absent=pageHarness();assert.deepEqual(localValue(await absent.lease(target({timeoutMs:0}))),{valid:false,missing:true});
});

test('changed content is rejected; explicit same content may recover on a replacement node even paused/offscreen',async()=>{
 const changed=pageHarness();changed.makeVideo({contentId:'different-content'});
 assert.deepEqual(localValue(await changed.lease(target())),{valid:false,changed:true});

 const replacement=pageHarness();replacement.makeVideo({key:'old-key',contentId:'content-a',paused:true,rects:false});
 const result=await replacement.lease(target({mediaKey:'old-key'}));
 assert.deepEqual(localValue(result),{valid:true},'paused or offscreen players remain valid while connected');

 const swapped=pageHarness();swapped.makeVideo({key:'new-node-key',contentId:'content-a',paused:true,rects:false});
 assert.deepEqual(localValue(await swapped.lease(target())),{valid:true},'an explicit matching content ID supports node replacement');
});

test('bound guard checks once, polls only during the operation, and stops after success',async()=>{
 const timers=fakeClock();let checks=0;
 const guard=createPageMediaGuard({check:async()=>{checks++;return {valid:true};},intervalMs:40,setTimer:timers.setTimer,clearTimer:timers.clearTimer,now:timers.now});
 assert.equal(await guard.run(boundContext(),async()=>'downloaded'),'downloaded');
 assert.equal(checks,1);assert.equal(timers.jobs.size,0,'successful completion clears its scheduled poll');
 assert.equal(await guard.run(boundContext(),async()=>'cached'),'cached');
 assert.equal(checks,1,'a recent successful validation is reused');assert.equal(timers.jobs.size,0);
});

test('loss during a read cancels it and preserves PAGE_MEDIA_GONE over the operation abort',async()=>{
 const timers=fakeClock();let checks=0,cancels=0,rejectOperation;
 const guard=createPageMediaGuard({check:async()=>({valid:++checks===1}),intervalMs:25,setTimer:timers.setTimer,clearTimer:timers.clearTimer,now:timers.now});
 const operation=new Promise((_,reject)=>{rejectOperation=reject;});
 const running=guard.run(boundContext(),async()=>operation,async()=>{cancels++;const error=new Error('request aborted');error.name='AbortError';rejectOperation(error);});
 await waitFor(()=>timers.jobs.size===1);
 timers.fireNext();
 await assert.rejects(running,error=>error?.code==='PAGE_MEDIA_GONE');
 await waitFor(()=>cancels===1);
 assert.equal(checks,2,'a cancelled operation must not repeat the failed presence check');assert.equal(cancels,1);assert.equal(timers.jobs.size,0);
});

test('a late failed poll cannot cancel or replace an already successful operation',async()=>{
 const timers=fakeClock(),late=deferred(),operation=deferred();let checks=0,cancels=0,started=false;
 const guard=createPageMediaGuard({check:()=>++checks===1?Promise.resolve({valid:true}):late.promise,intervalMs:30,setTimer:timers.setTimer,clearTimer:timers.clearTimer,now:timers.now});
 const running=guard.run(boundContext(),()=>{started=true;return operation.promise;},async()=>{cancels++;});
 await waitFor(()=>started&&timers.jobs.size===1);
 timers.fireNext();await waitFor(()=>checks===2);
 operation.resolve('saved');assert.equal(await running,'saved');assert.equal(timers.jobs.size,0);
 late.resolve({valid:false});await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cancels,0);assert.equal(checks,2);assert.equal(timers.jobs.size,0);
});
