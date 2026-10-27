import test from 'node:test';
import assert from 'node:assert/strict';
import {RateController,MAX_AUTOMATIC_WRITES} from '../src/rate-controller.js';
import {DEFAULT_STEPS,normalizeSettings} from '../src/settings.js';
import {mediaSignature} from '../src/media-registry.js';
class Video extends EventTarget{
 constructor(){super();this.value=1;this.writes=0;this.defaultPlaybackRate=1;this.readyState=4;this.paused=false;this.currentTime=1;this.currentSrc='https://example.test/first.mp4';}
 get playbackRate(){return this.value;}
 set playbackRate(value){this.writes++;this.value=value;queueMicrotask(()=>this.dispatchEvent(new Event('ratechange')));}
}
const task=()=>new Promise(resolve=>setTimeout(resolve,10));
const settings=raw=>normalizeSettings({defaultMode:'custom',customRate:2,...raw});
const controller=(video,s=settings(),options={})=>new RateController(video,s,{selected:true,...options});
function observe(c,v,origin,extra={}){c.observe({origin,status:'ready',actualRate:v.playbackRate,defaultRate:v.defaultPlaybackRate,mediaKey:c.mediaKey,...extra});}
function native(c,v,rate){v.playbackRate=rate;observe(c,v,'user',{evidence:'native-rate-option'});}

test('off leaves website speed and declaration untouched, including after loading',async()=>{
 const v=new Video();v.value=1.7;v.defaultPlaybackRate=1.7;const rates=[],c=controller(v,settings({defaultMode:'off'}),{onRate:r=>rates.push(r)});
 v.dispatchEvent(new Event('loadstart'));v.dispatchEvent(new Event('loadedmetadata'));await task();
 assert.equal(v.playbackRate,1.7);assert.equal(v.defaultPlaybackRate,1.7);assert.equal(v.writes,0);assert.deepEqual(rates,[]);c.dispose();
});
test('paused preload waits for first play and follows the latest confirmed rate',()=>{
 const v=new Video();v.paused=true;const c=controller(v,settings({defaultMode:'follow'}),{lastRate:2});
 v.dispatchEvent(new Event('loadedmetadata'));assert.equal(v.writes,0);c.update(settings({defaultMode:'follow'}),1.5);
 v.paused=false;v.dispatchEvent(new Event('play'));assert.equal(v.playbackRate,1.5);assert.equal(v.defaultPlaybackRate,1.5);c.dispose();
});
test('an explicit preload command survives assignment of its first real source',async()=>{
 const v=new Video();v.currentSrc='';v.src='';v.paused=true;v.readyState=0;
 const c=controller(v,settings({defaultMode:'off'}));assert.equal(c.initialized,false);c.command('set',8);
 v.currentSrc='https://example.test/first-real.mp4';v.value=1;v.readyState=4;v.paused=false;v.dispatchEvent(new Event('playing'));await task();
 assert.equal(v.playbackRate,8);assert.equal(v.defaultPlaybackRate,1);assert.equal(c.lastRate,8);c.dispose();
});
test('only the selected video initializes after media becomes ready',()=>{
 const v=new Video();v.readyState=0;const c=new RateController(v,settings());assert.equal(v.writes,0);
 v.readyState=1;v.dispatchEvent(new Event('loadedmetadata'));assert.equal(v.writes,0);c.select(true);
 assert.equal(v.playbackRate,2);assert.equal(v.defaultPlaybackRate,2);c.dispose();assert.equal(v.defaultPlaybackRate,1);assert.equal(v.playbackRate,2);
});
test('native speed choices stay authoritative through pause, metadata and quality reloads',async()=>{
 const v=new Video(),remembered=[],c=controller(v,settings(),{onRate:(r,source)=>remembered.push({r,source})});
 native(c,v,1.5);await task();v.dispatchEvent(new Event('play'));v.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(v.playbackRate,1.5);assert.equal(v.defaultPlaybackRate,1.5);assert.deepEqual(remembered.at(-1),{r:1.5,source:'native'});
 c.update(settings({customRate:3}));assert.equal(v.playbackRate,1.5);c.dispose();
});
test('bare ratechange never constitutes manual speed evidence on any website',async()=>{
 const v=new Video(),rates=[],c=controller(v,settings({defaultMode:'follow'}),{lastRate:8,onRate:r=>rates.push(r)});
 v.playbackRate=1;await task();assert.equal(c.snapshot().rate,1);assert.equal(c.lastRate,8);assert.deepEqual(rates,[]);c.dispose();
});
test('proven program reset restores actual speed as well as its declaration without changing memory',async()=>{
 const v=new Video(),rates=[],c=controller(v,settings({defaultMode:'follow'}),{lastRate:8,onRate:r=>rates.push(r)});
 v.playbackRate=1;observe(c,v,'page');await task();
 assert.equal(v.playbackRate,8);assert.equal(v.defaultPlaybackRate,8);assert.equal(c.lastRate,8);assert.deepEqual(rates,[]);assert.equal(c.automaticWrites,1);c.dispose();
});
test('program resets deferred by pause, ended, readiness or ownership resume at playback',async()=>{
 for(const stage of ['paused','ended','not-ready','not-eligible']){
  const v=new Video(),rates=[];let eligible=true;
  const c=controller(v,settings({defaultMode:'follow'}),{lastRate:8,onRate:r=>rates.push(r),canInitialize:()=>eligible});
  if(stage==='paused')v.paused=true;
  if(stage==='ended')v.ended=true;
  if(stage==='not-ready')v.readyState=0;
  if(stage==='not-eligible')eligible=false;
  v.value=1;observe(c,v,'page');await task();assert.equal(v.playbackRate,1,stage);
  v.paused=false;v.ended=false;v.readyState=4;eligible=true;v.dispatchEvent(new Event('playing'));await task();
  assert.equal(v.playbackRate,8,stage);assert.equal(c.lastRate,8,stage);assert.deepEqual(rates,[],stage);c.dispose();
 }
});
test('a queued repair survives pause before its timer runs, but a native choice cancels it',async()=>{
 for(const nativeChoice of [false,true]){
  const v=new Video(),c=controller(v,settings({defaultMode:'follow'}),{lastRate:8});
  v.value=1;observe(c,v,'page');v.paused=true;await task();
  if(nativeChoice)native(c,v,1.5);
  v.paused=false;v.dispatchEvent(new Event('playing'));await task();
  assert.equal(v.playbackRate,nativeChoice?1.5:8);c.dispose();
 }
});
test('same-source load reset restores the managed speed once',async()=>{
 const v=new Video(),c=controller(v);v.dispatchEvent(new Event('emptied'));v.readyState=0;v.defaultPlaybackRate=1;v.value=1;
 v.dispatchEvent(new Event('loadstart'));observe(c,v,'load');v.readyState=4;v.dispatchEvent(new Event('loadedmetadata'));await task();
 assert.equal(v.playbackRate,2);assert.equal(v.defaultPlaybackRate,2);assert.equal(c.automaticWrites,1);
 v.dispatchEvent(new Event('loadedmetadata'));await task();assert.equal(c.automaticWrites,1);c.dispose();
});
test('off permits an explicit command without rewriting the website default',async()=>{
 const v=new Video();v.value=1.5;v.defaultPlaybackRate=1.5;const c=controller(v,settings({defaultMode:'off'}));
 c.command('set',2);assert.equal(v.playbackRate,2);assert.equal(v.defaultPlaybackRate,1.5);
 v.value=1.5;v.dispatchEvent(new Event('loadstart'));v.dispatchEvent(new Event('loadedmetadata'));await task();
 assert.equal(v.playbackRate,2);assert.equal(v.defaultPlaybackRate,1.5);
 v.currentSrc='next';v.value=1.5;v.dispatchEvent(new Event('loadedmetadata'));await task();assert.equal(v.playbackRate,1.5);c.dispose();
});
test('a native 1x choice cancels a pending program-reset repair',async()=>{
 const v=new Video(),c=controller(v);v.playbackRate=1;observe(c,v,'page');native(c,v,1);await task();
 assert.equal(v.playbackRate,1);assert.equal(v.defaultPlaybackRate,1);assert.equal(c.lastRate,1);assert.equal(c.automaticWrites,0);c.dispose();
});
test('native paused and already-current 1x choices can be remembered',()=>{
 const v=new Video(),rates=[],c=controller(v,settings(),{onRate:(r,s)=>rates.push([r,s])});
 v.paused=true;native(c,v,1);observe(c,v,'user');assert.equal(c.lastRate,1);assert.deepEqual(rates.at(-1),[1,'native']);c.dispose();
});
test('unknown or ambiguous changes remain local and are not forcibly locked or remembered',async()=>{
 for(const origin of ['unknown','ambiguous']){
  const v=new Video(),c=controller(v);v.playbackRate=1.5;observe(c,v,origin);await task();
  assert.equal(v.playbackRate,1.5);assert.equal(v.defaultPlaybackRate,1.5);assert.equal(c.lastRate,2);assert.equal(c.managedRate,null);assert.equal(c.snapshot().rateOrigin,origin);c.dispose();
 }
});
test('new source identity cancels old recovery rather than applying it to another clip',async()=>{
 const v=new Video(),c=controller(v);v.playbackRate=1;observe(c,v,'page');c.update(settings({customRate:3}));
 v.currentSrc='next';v.value=1;v.dispatchEvent(new Event('loadedmetadata'));await task();
 assert.equal(v.playbackRate,3);assert.equal(c.automaticWrites,0);c.dispose();
});
test('a reused ready element can confirm the next clip with playing and no metadata',()=>{
 const v=new Video(),c=controller(v);v.currentSrc='next';v.value=1;c.sync();assert.equal(v.playbackRate,1);
 v.dispatchEvent(new Event('playing'));assert.equal(v.playbackRate,2);c.dispose();
});
test('continuous hostile writes reach a finite explicit conflict state',async()=>{
 const v=new Video(),c=controller(v);
 for(let n=0;n<MAX_AUTOMATIC_WRITES+3;n++){v.value=1;observe(c,v,'page');await task();}
 assert.equal(c.automaticWrites,MAX_AUTOMATIC_WRITES);assert.equal(c.snapshot().rateStatus,'conflict');assert.equal(c.lastRate,2);
 const writes=v.writes;await task();assert.equal(v.writes,writes);assert.equal(v.playbackRate,1);c.dispose();
});
test('deselection or disposal cancels queued recovery',async()=>{
 for(const stop of [c=>c.select(false),c=>c.dispose()]){
  const v=new Video(),c=controller(v);v.value=1;observe(c,v,'page');const writes=v.writes;stop(c);await task();assert.equal(v.writes,writes);c.dispose();
 }
});
test('read exceptions or NaN never become a fabricated 1x or successful preference',()=>{
 for(const failure of [()=>NaN,()=>{throw Error('read failed');}]){
  const v=new Video();Object.defineProperty(v,'playbackRate',{get:failure,set(){throw Error('must not write');}});
  const rates=[],c=controller(v,settings(),{onRate:r=>rates.push(r)});assert.equal(c.snapshot().rate,null);assert.equal(c.snapshot().rateStatus,'failed');assert.deepEqual(rates,[]);
  assert.throws(()=>c.command('faster'),/Playback speed unavailable/);c.dispose();
 }
});
test('rejected or ignored setters cannot announce or persist success',()=>{
 class Rejects extends Video{get playbackRate(){return this.value;}set playbackRate(_){throw Error('unsupported');}}
 class Ignores extends Video{get playbackRate(){return this.value;}set playbackRate(_){this.writes++;}}
 for(const Type of [Rejects,Ignores]){
  const v=new Type(),rates=[],notices=[],c=controller(v,settings(),{onRate:r=>rates.push(r),onDefaultApplied:r=>notices.push(r)});
  assert.equal(c.snapshot().rateStatus,'failed');assert.equal(c.snapshot().rate,1);assert.deepEqual(rates,[]);assert.deepEqual(notices,[]);c.dispose();
 }
});
test('storage-follow initialization does not send the same old value back as a new preference',()=>{
 const v=new Video(),rates=[],c=controller(v,settings({defaultMode:'follow'}),{lastRate:2,onRate:r=>rates.push(r)});
 assert.deepEqual(rates,[]);c.command('set',1.5);assert.deepEqual(rates,[1.5]);c.dispose();
});
test('invalid follow memory does not silently apply or store 1x',()=>{
 const v=new Video();v.value=1.5;const rates=[],c=controller(v,settings({defaultMode:'follow'}),{lastRate:NaN,onRate:r=>rates.push(r)});
 assert.equal(v.playbackRate,1.5);assert.equal(v.writes,0);assert.equal(c.snapshot().rateOrigin,'memory-error');assert.deepEqual(rates,[]);c.dispose();
});
test('custom default and explicit commands persist only after successful readback',()=>{
 const v=new Video(),rates=[],c=controller(v,settings(),{onRate:(r,s)=>rates.push([r,s])});
 assert.deepEqual(rates,[[2,'default']]);c.command('reset');assert.deepEqual(rates.at(-1),[1,'command']);c.dispose();
});
test('changing preset settings affects the next media and does not override this one',()=>{
 const v=new Video(),c=controller(v);c.update(settings({customRate:3}));assert.equal(v.playbackRate,2);
 v.currentSrc='next';c.sync();assert.equal(v.playbackRate,2);v.dispatchEvent(new Event('loadedmetadata'));assert.equal(v.playbackRate,3);c.dispose();
});
test('commands jump between user ticks and fine steps use their subdivisions',()=>{
 const v=new Video(),c=controller(v);c.command('set',1.05);c.command('fineFaster');assert.equal(v.playbackRate,1.1);
 c.command('fineSlower');assert.equal(v.playbackRate,1.05);c.command('faster');assert.equal(v.playbackRate,1.25);
 c.command('set',1.05);c.command('slower');assert.equal(v.playbackRate,1);c.command('preferred');assert.equal(v.playbackRate,2);c.dispose();
});
test('editing ticks leaves current speed unchanged before the next command',()=>{
 const v=new Video(),c=controller(v),writes=v.writes;c.update(normalizeSettings({schemaVersion:3,steps:DEFAULT_STEPS.filter(r=>r!==2)}));
 assert.equal(v.writes,writes);assert.equal(v.playbackRate,2);c.command('slower');assert.equal(v.playbackRate,1.75);
 c.command('set',2);c.command('faster');assert.equal(v.playbackRate,2.5);c.command('set',2);c.command('fineSlower');assert.equal(v.playbackRate,1.9);
 c.command('set',2);c.command('fineFaster');assert.equal(v.playbackRate,2.05);c.dispose();
});
test('initial notice occurs once per media, never for repairs or later native edits',async()=>{
 const v=new Video(),notices=[],c=controller(v,settings(),{onDefaultApplied:r=>notices.push(r)});
 v.value=1;observe(c,v,'page');await task();native(c,v,1.5);v.dispatchEvent(new Event('loadedmetadata'));
 assert.deepEqual(notices,[2]);v.currentSrc='next';v.dispatchEvent(new Event('loadedmetadata'));assert.deepEqual(notices,[2,2]);c.dispose();
});
test('a preserved playing video keeps its speed and adopts only its default declaration',()=>{
 const v=new Video();v.value=1.65;const notices=[],rates=[],c=controller(v,settings(),{initializedKey:v.currentSrc,onDefaultApplied:r=>notices.push(r),onRate:r=>rates.push(r)});
 assert.equal(v.playbackRate,1.65);assert.equal(v.defaultPlaybackRate,1.65);assert.equal(v.writes,0);assert.deepEqual(notices,[]);assert.deepEqual(rates,[]);c.dispose();
});
test('ad or pending player identity defers all default and recovery writes',async()=>{
 const v=new Video();let ready=false;const c=controller(v,settings(),{canInitialize:()=>ready});assert.equal(v.writes,0);
 ready=true;c.sync(true);assert.equal(v.playbackRate,2);ready=false;v.value=1;observe(c,v,'page');await task();assert.equal(v.playbackRate,1);c.dispose();
});
test('quality source changes retain the chosen speed; a new YouTube identity gets a new default',()=>{
 const v=new Video();v.closest=()=>({});v.getAttribute=()=>null;const target={location:{href:'https://www.youtube.com/watch?v=one'}};
 const c=controller(v,settings(),{signature:()=>mediaSignature(v,target)});c.command('set',1.3);
 v.currentSrc='blob:quality';v.dispatchEvent(new Event('loadedmetadata'));assert.equal(v.playbackRate,1.3);
 target.location.href='https://www.youtube.com/watch?v=two';c.sync();v.dispatchEvent(new Event('loadedmetadata'));assert.equal(v.playbackRate,2);c.dispose();
});
test('currently loaded currentSrc takes precedence over a stale src attribute',()=>{
 const v=new Video();v.src='old';v.currentSrc='blob:current';v.getAttribute=()=>null;
 assert.equal(mediaSignature(v,{location:{href:'https://example.test/'}}),'blob:current');
});
test('srcObject media has a stable identity without a URL and changes identity with its source object',()=>{
 const v=new Video();v.currentSrc='';v.src='stale-url';v.srcObject={};v.getAttribute=()=>null;
 const target={location:{href:'https://example.test/'}};
 const first=mediaSignature(v,target);assert.match(first,/^object:\d+$/);assert.equal(mediaSignature(v,target),first);
 v.srcObject={};assert.notEqual(mediaSignature(v,target),first);
 v.srcObject=null;assert.equal(mediaSignature(v,target),'stale-url');
});
test('disabled controllers do not write or remember observations',()=>{
 const v=new Video(),rates=[],c=controller(v,settings({enabled:false}),{onRate:r=>rates.push(r)});
 v.value=1.5;observe(c,v,'user');assert.equal(v.writes,0);assert.deepEqual(rates,[]);c.dispose();
});
test('a rejected command cancels recovery queued reentrantly for the previous intent',async()=>{
 const v=new Video(),rates=[],c=controller(v,settings(),{onRate:r=>rates.push(r)});
 let attempts=0;c.writeRate=()=>{
  attempts++;v.value=1;
  observe(c,v,'page');
  return {status:'mismatch',actualRate:1,defaultRate:v.defaultPlaybackRate};
 };
 c.command('set',8);await task();
 assert.equal(attempts,1);assert.equal(v.playbackRate,1);assert.equal(c.managedRate,null);
 assert.equal(c.snapshot().desiredRate,8);assert.equal(c.snapshot().rateStatus,'failed');
 assert.deepEqual(rates,[2]);c.dispose();
});
test('a default-first native choice is not adopted back to an earlier page reset',async()=>{
 const v=new Video(),rates=[],c=controller(v,settings({defaultMode:'follow'}),{lastRate:8,onRate:r=>rates.push(r)});
 v.value=1;observe(c,v,'page');v.defaultPlaybackRate=1.5;
 c.observe({origin:'ambiguous',evidence:'rate-option-default-pending',property:'defaultPlaybackRate',status:'ready',actualRate:1,defaultRate:1.5,attemptedRate:1.5,mediaKey:c.mediaKey});
 assert.equal(v.defaultPlaybackRate,1.5);assert.equal(c.managedRate,8);assert.deepEqual(rates,[]);
 native(c,v,1.5);await task();assert.equal(v.playbackRate,1.5);assert.equal(v.defaultPlaybackRate,1.5);assert.deepEqual(rates,[1.5]);c.dispose();
});
