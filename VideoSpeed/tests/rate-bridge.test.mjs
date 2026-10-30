import assert from 'node:assert/strict';
import test from 'node:test';
import {RateBridge} from '../src/rate-bridge.js';
import {RateController} from '../src/rate-controller.js';

const fakeMutationObservers=new Set();
class FakeMutationObserver{
 constructor(callback){this.callback=callback;this.target=null;this.options=null;this.records=[];this.scheduled=false;this.active=false;fakeMutationObservers.add(this);}
 observe(target,options){this.target=target;this.options=options;this.active=true;}
 disconnect(){this.active=false;this.records=[];}
 takeRecords(){return this.records.splice(0);}
}
function notifyMutation(target,mutation){
 for(const observer of fakeMutationObservers){
  if(!observer.active||!observer.target)continue;
  const within=target===observer.target||observer.options?.subtree&&observer.target.contains?.(target);
  if(!within)continue;
  if(mutation.type==='attributes'&&(!observer.options?.attributes||observer.options.attributeFilter&&!observer.options.attributeFilter.includes(mutation.attributeName)))continue;
  if(mutation.type==='childList'&&!observer.options?.childList)continue;
  observer.records.push({...mutation,target});
  if(!observer.scheduled){
   observer.scheduled=true;
   queueMicrotask(()=>{observer.scheduled=false;const records=observer.takeRecords();if(observer.active&&records.length)observer.callback(records,observer);});
  }
 }
}

class FakeElement extends EventTarget{
 constructor(tagName='DIV',attributes={},textContent=''){
  super();
  this.tagName=tagName;
  this.attributes={...attributes};
  this.textContent=textContent;
  this.parentElement=null;
  this.value='';
  this.isContentEditable=false;
 }
 getAttribute(name){return this.attributes[name]??null;}
 setAttribute(name,value){const oldValue=this.getAttribute(name);this.attributes[name]=String(value);notifyMutation(this,{type:'attributes',attributeName:name,oldValue});}
 appendChild(node){node.parentElement=this;notifyMutation(this,{type:'childList',addedNodes:[node],removedNodes:[]});return node;}
 removeChild(node){if(node.parentElement===this)node.parentElement=null;notifyMutation(this,{type:'childList',addedNodes:[],removedNodes:[node]});return node;}
 closest(selector){
  if(selector==='[role="menu"],[role="listbox"],[role="radiogroup"]'){
   for(let node=this;node;node=node.parentElement){if(['menu','listbox','radiogroup'].includes(node.getAttribute?.('role')))return node;}
  }
  return null;
 }
 contains(candidate){for(let node=candidate;node;node=node.parentElement)if(node===this)return true;return false;}
}

function makeEnvironment(){
 const document=new EventTarget();
 const target={document,performance:{now:()=>Date.now()},queueMicrotask,MutationObserver:FakeMutationObserver};
 class HTMLMediaElement extends EventTarget{
  constructor(){super();this.tagName='VIDEO';this.attributes={};this.parentElement=null;this._playbackRate=1;this._defaultPlaybackRate=1;this._src='';this._srcObject=null;this.rateGetterError=null;this.defaultGetterError=null;this.rateSetterError=null;this.defaultSetterError=null;this.ignoreRateSetter=false;this.defaultWriteTransform=null;this.defaultWrites=0;}
  get playbackRate(){if(this.rateGetterError)throw this.rateGetterError;return this._playbackRate;}
  set playbackRate(value){if(this.rateSetterError)throw this.rateSetterError;if(this.ignoreRateSetter)return;if(!Number.isFinite(value))throw new TypeError('invalid playback rate');this._playbackRate=value;}
  get defaultPlaybackRate(){if(this.defaultGetterError)throw this.defaultGetterError;return this._defaultPlaybackRate;}
  set defaultPlaybackRate(value){if(this.defaultSetterError)throw this.defaultSetterError;if(!Number.isFinite(value))throw new TypeError('invalid default rate');this.defaultWrites++;this._defaultPlaybackRate=this.defaultWriteTransform?this.defaultWriteTransform(value):value;}
  get src(){return this._src;}
  set src(value){const oldValue=this.getAttribute('src');this._src=String(value);this.attributes.src=this._src;notifyMutation(this,{type:'attributes',attributeName:'src',oldValue});this._playbackRate=this._defaultPlaybackRate;}
  get srcObject(){return this._srcObject;}
  set srcObject(value){this._srcObject=value;this._playbackRate=this._defaultPlaybackRate;}
  getAttribute(name){return this.attributes[name]??null;}
  setAttribute(name,value){const oldValue=this.getAttribute(name);this.attributes[name]=String(value);if(name==='src'){this._src=String(value);this._playbackRate=this._defaultPlaybackRate;}notifyMutation(this,{type:'attributes',attributeName:name,oldValue});}
  appendChild(node){node.parentElement=this;notifyMutation(this,{type:'childList',addedNodes:[node],removedNodes:[]});return node;}
  contains(candidate){for(let node=candidate;node;node=node.parentElement)if(node===this)return true;return false;}
  load(){this._playbackRate=this._defaultPlaybackRate;}
 }
 target.HTMLMediaElement=HTMLMediaElement;
 const video=new HTMLMediaElement();
 const player=new FakeElement('DIV');
 player.contains=()=>true;
 return {target,document,HTMLMediaElement,video,player};
}

function trustedEvent(type,path,extra={}){
 const event=new Event(type,{bubbles:true,cancelable:true});
 Object.defineProperty(event,'isTrusted',{value:true});
 Object.defineProperty(event,'composedPath',{value:()=>path});
 for(const [key,value] of Object.entries(extra))Object.defineProperty(event,key,{value});
 return event;
}

function observations(){const items=[];return {items,callback:(video,info)=>items.push({video,...info})};}

test('a delayed range commit survives its pointerup and click without accepting a later page reset',async()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);bridge.start(seen.callback);
 bridge.execute(env.video,{op:'apply',rate:2,mediaKey:'film',selected:true});
 const slider=new FakeElement('INPUT',{'type':'range','role':'slider','class':'ytp-speedslider','aria-valuenow':'2','aria-valuetext':'2.00'});slider.value='1.25';
 const path=[slider,env.player,env.document];
 env.document.dispatchEvent(trustedEvent('input',path));
 env.document.dispatchEvent(trustedEvent('pointerup',path,{button:0}));
 env.document.dispatchEvent(trustedEvent('click',path));
 await Promise.resolve();env.video.playbackRate=1.25;
 assert.equal(seen.items.at(-1).origin,'user');assert.equal(seen.items.at(-1).evidence,'native-rate-option');assert.equal(seen.items.at(-1).actualRate,1.25);
 env.video.playbackRate=1;assert.notEqual(seen.items.at(-1).origin,'user','the exact proof is consumed by the committed value');bridge.stop();
});

test('read reports native values without emitting observations; getter errors stay read-error',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 const result=bridge.execute(env.video,{op:'read',mediaKey:'one'});
 assert.deepEqual(result,{status:'ready',actualRate:1,defaultRate:1,seq:1,epoch:0});
 assert.equal(seen.items.length,0);
 env.video.rateGetterError=new Error('hidden stack detail');
 const failed=bridge.execute(env.video,{op:'read'});
 assert.equal(failed.status,'read-error');
 assert.equal(failed.actualRate,null);
 assert.equal(failed.defaultRate,1);
 assert.equal(failed.error,'Error');
 assert.equal(seen.items.length,0);
 bridge.stop();
});

test('apply syncs player and native actual/default; release restores only owned default',()=>{
 const env=makeEnvironment(),seen=observations(),calls=[];
 const bridge=new RateBridge(env.target,{syncPlayerRate:(video,rate,target)=>calls.push({video,rate,target})});
 bridge.start(seen.callback);
 const applied=bridge.execute(env.video,{op:'apply',rate:1.5,mediaKey:'film',reason:'follow'});
 assert.equal(applied.status,'ready');
 assert.equal(env.video.playbackRate,1.5);
 assert.equal(env.video.defaultPlaybackRate,1.5);
 assert.deepEqual(calls,[{video:env.video,rate:1.5,target:env.target}]);
 assert.equal(seen.items.length,0,'explicit VC results are returned synchronously, not echoed to the observer');
 assert.ok(bridge.diagnostics(env.video).some(item=>item.origin==='vc'&&item.attemptedRate===1.5));
 const diagnosticCount=bridge.diagnostics(env.video).length;
 env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.length,0,'VC native write ratechange is consumed as expected');
 assert.equal(bridge.diagnostics(env.video).length,diagnosticCount);
 const released=bridge.execute(env.video,{op:'release',reason:'off'});
 assert.equal(released.status,'ready');
 assert.equal(env.video.playbackRate,1.5,'release must not change actual playback rate');
 assert.equal(env.video.defaultPlaybackRate,1,'release restores original default');
 assert.equal(seen.items.length,0,'release is also diagnostics-only');
 bridge.stop();
});

test('suspending a background element preserves values and detaches the rate bridge record',()=>{
 const env=makeEnvironment(),bridge=new RateBridge(env.target);bridge.start(()=>{});
 bridge.execute(env.video,{op:'apply',rate:2,mediaKey:'film'});
 const released=bridge.execute(env.video,{op:'release',preserveDefault:true});
 assert.equal(released.status,'ready');assert.equal(env.video.defaultPlaybackRate,2);
 bridge.stop({preserveDefaults:true});assert.equal(env.video.defaultPlaybackRate,2);assert.equal(env.video.playbackRate,2);
 bridge.stop();assert.equal(env.video.defaultPlaybackRate,1,'power off restores the original default even while suspended');
});

test('returning from suspension retains original ownership, but preserves later page-owned defaults',()=>{
 const env=makeEnvironment(),bridge=new RateBridge(env.target);bridge.start(()=>{});
 bridge.execute(env.video,{op:'apply',rate:2});bridge.execute(env.video,{op:'release',preserveDefault:true});bridge.stop({preserveDefaults:true});
 bridge.start(()=>{});bridge.execute(env.video,{op:'release'});bridge.execute(env.video,{op:'read'});
 bridge.stop();assert.equal(env.video.defaultPlaybackRate,1);
 bridge.start(()=>{});bridge.execute(env.video,{op:'apply',rate:2});bridge.execute(env.video,{op:'release',preserveDefault:true});bridge.stop({preserveDefaults:true});
 env.video.defaultPlaybackRate=1.5;bridge.stop();assert.equal(env.video.defaultPlaybackRate,1.5);
});

test('maintainDefault false still synchronizes an explicit command but bridge does not write or own default',()=>{
 const env=makeEnvironment(),calls=[];
 const bridge=new RateBridge(env.target,{syncPlayerRate:(video,rate)=>calls.push([video,rate])});
 bridge.start(()=>{});
 const result=bridge.execute(env.video,{op:'apply',rate:2,maintainDefault:false,mediaKey:'film'});
 assert.equal(result.status,'ready');
 assert.deepEqual(calls,[[env.video,2]]);
 assert.equal(env.video.playbackRate,2);
 assert.equal(env.video.defaultPlaybackRate,1);
 assert.equal(env.video.defaultWrites,0);
 bridge.execute(env.video,{op:'release'});
 assert.equal(env.video.defaultPlaybackRate,1);
 assert.equal(env.video.playbackRate,2);
 bridge.stop();
});

test('invalid rates and native setter failures report write-error without fallback values',()=>{
 const env=makeEnvironment(),bridge=new RateBridge(env.target);
 bridge.start(()=>{});
 const invalid=bridge.execute(env.video,{op:'apply',rate:NaN});
 assert.equal(invalid.status,'write-error');
 assert.equal(invalid.actualRate,1);
 assert.equal(invalid.defaultRate,1);
 assert.equal(invalid.error,'invalid-rate');
 env.video.rateSetterError=new TypeError('native rejected write');
 const failed=bridge.execute(env.video,{op:'apply',rate:1.75});
 assert.equal(failed.status,'write-error');
 assert.equal(failed.error,'TypeError');
 assert.equal(failed.actualRate,1);
 bridge.stop();
});

test('pre-write getter errors stop all writes; rejected or ignored actual setters never change default',()=>{
 const env=makeEnvironment(),calls=[];
 const bridge=new RateBridge(env.target,{syncPlayerRate:(video,rate)=>calls.push([video,rate])});
 bridge.start(()=>{});
 env.video._playbackRate=NaN;
 const getterNaN=bridge.execute(env.video,{op:'apply',rate:1.5});
 assert.equal(getterNaN.status,'read-error');
 assert.equal(env.video._playbackRate,NaN);
 assert.equal(env.video.defaultWrites,0);
 assert.equal(calls.length,0);
 env.video._playbackRate=1;
 env.video.rateSetterError=new TypeError('rejected');
 const rejected=bridge.execute(env.video,{op:'apply',rate:1.5});
 assert.equal(rejected.status,'write-error');
 assert.equal(env.video.playbackRate,1);
 assert.equal(env.video.defaultPlaybackRate,1);
 assert.equal(env.video.defaultWrites,0);
 env.video.rateSetterError=null;
 env.video.ignoreRateSetter=true;
 const ignored=bridge.execute(env.video,{op:'apply',rate:1.75});
 assert.equal(ignored.status,'mismatch');
 assert.equal(env.video.playbackRate,1);
 assert.equal(env.video.defaultPlaybackRate,1);
 assert.equal(env.video.defaultWrites,0);
 bridge.stop();
});

test('a failed default readback rolls back only the value written by this command',()=>{
 const env=makeEnvironment(),bridge=new RateBridge(env.target);
 bridge.start(()=>{});
 let firstWrite=true;
 env.video.defaultWriteTransform=value=>{if(firstWrite){firstWrite=false;return 1.25;}return value;};
 const result=bridge.execute(env.video,{op:'apply',rate:1.5,mediaKey:'film'});
 assert.equal(result.status,'mismatch');
 assert.equal(env.video.playbackRate,1.5);
 assert.equal(env.video.defaultPlaybackRate,1,'the mismatched default write is rolled back');
 bridge.execute(env.video,{op:'release'});
 assert.equal(env.video.defaultPlaybackRate,1,'rollback clears bridge ownership when it succeeds');
 bridge.stop();
});

test('site setters are forwarded and classified as page; site default becomes the restoration baseline',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'apply',rate:2,mediaKey:'film'});
 env.video.playbackRate=1.25;
 assert.equal(env.video.playbackRate,1.25);
 const override=seen.items.find(item=>item.property==='playbackRate');
 assert.equal(override.origin,'page');
 assert.equal(override.attemptedRate,1.25);
 assert.equal(override.evidence,'main-world-setter');
 const firstStack=bridge.diagnostics(env.video).find(item=>item.origin==='page')?.stack;
 assert.equal(typeof firstStack,'string');
 for(const rate of [1.3,1.4,1.6,1.75,1.875])env.video.playbackRate=rate;
 assert.equal(bridge.diagnostics(env.video).filter(item=>typeof item.stack==='string').length,4,'only four override stacks are retained');
 const setterError=new TypeError('site setter failure');
 env.video.rateSetterError=setterError;
 assert.throws(()=>{env.video.playbackRate=1.9;},error=>error===setterError,'the exact native exception must be rethrown');
 assert.equal(seen.items.at(-1).status,'write-error');
 env.video.rateSetterError=null;
 env.video.defaultPlaybackRate=1.125;
 bridge.execute(env.video,{op:'apply',rate:2.5});
 bridge.execute(env.video,{op:'release'});
 assert.equal(env.video.defaultPlaybackRate,1.125,'release uses the latest site-declared default');
 assert.equal(env.video.playbackRate,2.5);
 bridge.stop();
});

test('trusted exact native speed choices bind by value and same-value choices are confirmed',async()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film'});
 const menu=new FakeElement('DIV',{role:'menu'});
 const option=new FakeElement('DIV',{role:'menuitemradio'},'1.5x');option.parentElement=menu;
 env.document.dispatchEvent(trustedEvent('click',[option,menu,env.video,env.player,env.document]));
 env.video.playbackRate=1.5;
 assert.equal(seen.items.at(-1).origin,'user');
 assert.equal(seen.items.at(-1).evidence,'native-rate-option');
 env.video.playbackRate=1;
 env.document.dispatchEvent(trustedEvent('click',[option,menu,env.video,env.player,env.document]));
 option.textContent='1x';
 env.document.dispatchEvent(trustedEvent('click',[option,menu,env.video,env.player,env.document]));
 await Promise.resolve();
 assert.equal(seen.items.at(-1).origin,'user');
 assert.equal(seen.items.at(-1).attemptedRate,1);
 bridge.stop();
});

test('default-first exact choice stays pending until actual playbackRate reaches the selected value',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film'});
 const menu=new FakeElement('DIV',{role:'menu'});
 const option=new FakeElement('DIV',{role:'menuitemradio'},'1.5x');option.parentElement=menu;
 const event=trustedEvent('click',[option,menu,env.video,env.player,env.document],{eventPhase:1});
 env.target.event=event;
 env.video.defaultPlaybackRate=1.5;
 assert.equal(seen.items.at(-1).origin,'ambiguous');
 assert.equal(seen.items.at(-1).evidence,'rate-option-default-pending');
 assert.equal(env.video.playbackRate,1,'default write alone does not confirm a user speed change');
 env.document.dispatchEvent(event);
 env.video.playbackRate=1.5;
 env.target.event=null;
 assert.equal(seen.items.at(-1).origin,'user');
 assert.equal(seen.items.at(-1).attemptedRate,seen.items.at(-1).actualRate);
 bridge.stop();
});

test('a trusted window-capture setter before document capture keeps exact menu and speed-key evidence',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film',selected:true});
 const menu=new FakeElement('DIV',{role:'menu'});
 const option=new FakeElement('DIV',{role:'menuitemradio'},'1.5x');option.parentElement=menu;
 const click=trustedEvent('click',[option,menu,env.video,env.player,env.document],{eventPhase:1});
 env.target.event=click;
 env.video.playbackRate=1.5;
 env.document.dispatchEvent(click);
 env.target.event=null;
 assert.equal(seen.items.filter(item=>item.origin==='user').length,1);
 assert.equal(seen.items.at(-1).evidence,'native-rate-option');
 const body=new FakeElement('BODY');
 const keydown=trustedEvent('keydown',[body,env.document],{key:'!',eventPhase:1});
 env.target.event=keydown;
 env.video.playbackRate=1.75;
 env.document.dispatchEvent(keydown);
 env.target.event=null;
 assert.equal(seen.items.filter(item=>item.evidence==='direct-key-write').length,1);
 assert.equal(seen.items.filter(item=>item.origin==='user').length,2,'document capture must not echo the window-capture write');
 bridge.stop();
});

test('exact menu token survives delayed handlers and a different rate stays ambiguous',async()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film'});
 const menu=new FakeElement('DIV',{role:'menu'});
 const option=new FakeElement('DIV',{role:'menuitemradio'},'1.5x');option.parentElement=menu;
 env.document.dispatchEvent(trustedEvent('click',[option,menu,env.video,env.player,env.document]));
 await Promise.resolve();
 assert.equal(seen.items.length,0,'the unmatched microtask check leaves the token pending');
 await new Promise(resolve=>setTimeout(resolve,200));
 env.video.playbackRate=1.5;
 assert.equal(seen.items.at(-1).origin,'user');
 assert.equal(seen.items.at(-1).evidence,'native-rate-option');
 bridge.stop();

 const other=makeEnvironment(),otherSeen=observations(),otherBridge=new RateBridge(other.target);
 otherBridge.start(otherSeen.callback);
 otherBridge.execute(other.video,{op:'read',mediaKey:'film'});
 const otherMenu=new FakeElement('DIV',{role:'menu'});
 const otherOption=new FakeElement('DIV',{role:'menuitemradio'},'1.5x');otherOption.parentElement=otherMenu;
 other.document.dispatchEvent(trustedEvent('click',[otherOption,otherMenu,other.video,other.player,other.document]));
 await Promise.resolve();
 await new Promise(resolve=>setTimeout(resolve,25));
 other.video.playbackRate=1.25;
 assert.equal(otherSeen.items.at(-1).origin,'ambiguous');
 assert.equal(otherSeen.items.at(-1).evidence,'rate-option-value-mismatch');
 assert.ok(otherSeen.items.every(item=>item.origin!=='user'));
 other.document.dispatchEvent(trustedEvent('click',[otherOption,otherMenu,other.video,other.player,other.document]));
 await Promise.resolve();
 otherBridge.execute(other.video,{op:'read',mediaKey:'next-media'});
 await new Promise(resolve=>setTimeout(resolve,25));
 other.video.playbackRate=1.5;
 assert.equal(otherSeen.items.at(-1).origin,'page','a media-key change clears the pending choice token');
 otherBridge.stop();
});

test('selected video supports direct full-page speed keys; common play keys do not count as direct speed writes',async()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film',selected:true});
 const body=new FakeElement('BODY');
 const onSpeed=()=>{env.video.playbackRate=1.25;};
 env.document.addEventListener('keydown',onSpeed,{once:true});
 env.document.dispatchEvent(trustedEvent('keydown',[body,env.document],{key:'!'}));
 assert.equal(seen.items.at(-1).origin,'user');
 assert.equal(seen.items.at(-1).evidence,'direct-key-write');
 await Promise.resolve();
 const onPlay=()=>{env.video.playbackRate=1.5;};
 env.document.addEventListener('keydown',onPlay,{once:true});
 env.document.dispatchEvent(trustedEvent('keydown',[body,env.document],{key:' '}));
 assert.equal(seen.items.at(-1).origin,'ambiguous');
 bridge.stop();
});

test('generic nearby player input is ambiguous; known play, quality, and volume controls remain page resets',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film'});
 const generic=new FakeElement('DIV');
 env.document.dispatchEvent(trustedEvent('pointerdown',[generic,env.video,env.player,env.document]));
 env.video.playbackRate=1.25;
 assert.equal(seen.items.at(-1).origin,'ambiguous');
 assert.equal(seen.items.at(-1).evidence,'trusted-player-input-nearby');
 const play=new FakeElement('BUTTON',{},'Play');
 env.document.dispatchEvent(trustedEvent('pointerdown',[play,env.video,env.player,env.document]));
 env.video.playbackRate=1.5;
 assert.equal(seen.items.at(-1).origin,'page');
 assert.equal(seen.items.at(-1).evidence,'non-rate-control-reset');
 const quality=new FakeElement('BUTTON',{ 'aria-label':'Quality' },'');
 env.document.dispatchEvent(trustedEvent('click',[quality,env.video,env.player,env.document]));
 env.video.playbackRate=1.75;
 assert.equal(seen.items.at(-1).evidence,'non-rate-control-reset');
 const volume=new FakeElement('INPUT',{type:'range',name:'volume'});
 env.document.dispatchEvent(trustedEvent('input',[volume,env.video,env.player,env.document]));
 env.video.playbackRate=2;
 assert.equal(seen.items.at(-1).origin,'page');
 assert.equal(seen.items.at(-1).evidence,'non-rate-control-reset');
 bridge.stop();
});

test('load and source changes create epochs and classify resets as load',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'apply',rate:1.5,mediaKey:'film'});
 const before=bridge.execute(env.video,{op:'read'}).epoch;
 env.video._playbackRate=1.75;
 env.video.load();
 assert.ok(bridge.execute(env.video,{op:'read'}).epoch>before);
 assert.equal(env.video.playbackRate,1.5);
 assert.ok(seen.items.some(item=>item.origin==='load'&&item.evidence==='load-reset'));
 env.video.defaultPlaybackRate=1;
 const prior=bridge.execute(env.video,{op:'read'}).epoch;
 env.video.src='/media/a';
 assert.ok(bridge.execute(env.video,{op:'read'}).epoch>prior);
 assert.equal(env.video.playbackRate,1);
 assert.ok(seen.items.some(item=>item.origin==='load'&&item.evidence==='source-load-reset'));
 env.video._playbackRate=2;
 const beforeObject=bridge.execute(env.video,{op:'read'}).epoch;
 env.video.srcObject={kind:'media-stream'};
 assert.ok(bridge.execute(env.video,{op:'read'}).epoch>beforeObject);
 assert.equal(env.video.playbackRate,1);
 assert.ok(seen.items.some(item=>item.origin==='load'&&item.evidence==='source-load-reset'));
 bridge.stop();
});

test('unmatched UA ratechange is unknown and trusted ratechange alone is not user evidence',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film'});
 env.video.paused=false;env.video.readyState=4;env.video.currentTime=1;
 env.video.dispatchEvent(trustedEvent('playing',[env.video]));env.video.currentTime=1.25;
 env.video.dispatchEvent(trustedEvent('timeupdate',[env.video]));
 env.video._playbackRate=1.5;
 env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'unknown');
 assert.equal(seen.items.at(-1).evidence,'unattributed-ua-ratechange');
 bridge.stop();
});

test('startup ends after playback advances, preserving late metadata and playing resets',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);
 env.video.paused=false;env.video.readyState=4;env.video.currentTime=1;
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'film'});
 env.video.dispatchEvent(trustedEvent('loadstart',[env.video]));
 env.video._playbackRate=1.25;
 env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'load');
 assert.equal(seen.items.at(-1).evidence,'load-epoch-ratechange');
 env.video.dispatchEvent(trustedEvent('loadedmetadata',[env.video]));
 env.video._playbackRate=1.5;
 env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'transition');
 assert.equal(seen.items.at(-1).phase,'starting');
 env.video.dispatchEvent(trustedEvent('loadstart',[env.video]));
 env.video.dispatchEvent(trustedEvent('playing',[env.video]));
 env.video._playbackRate=1.75;
 env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'transition');
 env.video.currentTime=1.25;env.video.dispatchEvent(trustedEvent('timeupdate',[env.video]));
 env.video._playbackRate=2;env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'unknown');
 assert.equal(seen.items.at(-1).phase,'playing');
 assert.equal(seen.items.at(-1).evidence,'unattributed-ua-ratechange');
 bridge.stop();
});
test('displayed-frame progress settles short loops without restarting on steady waiting or playing',()=>{
 const env=makeEnvironment(),seen=observations(),bridge=new RateBridge(env.target);let frames=0;
 env.video.paused=false;env.video.readyState=4;env.video.currentTime=0;
 env.video.getVideoPlaybackQuality=()=>({totalVideoFrames:frames,droppedVideoFrames:0});
 bridge.start(seen.callback);bridge.execute(env.video,{op:'read',mediaKey:'film'});
 env.video.dispatchEvent(trustedEvent('play',[env.video]));env.video.dispatchEvent(trustedEvent('playing',[env.video]));
 frames=3;env.video.dispatchEvent(trustedEvent('timeupdate',[env.video]));
 env.video.dispatchEvent(trustedEvent('waiting',[env.video]));env.video.dispatchEvent(trustedEvent('playing',[env.video]));
 env.video._playbackRate=1.5;env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'unknown');assert.equal(seen.items.at(-1).phase,'playing');bridge.stop();
});
test('live MediaStream reports unsupported without writes and other source objects remain controllable',()=>{
 const env=makeEnvironment();env.target.MediaStream=class MediaStream{};env.video.srcObject=new env.target.MediaStream();
 const bridge=new RateBridge(env.target);bridge.start(()=>{});
 env.video.rateSetterError=Error('must not write');env.video.defaultSetterError=Error('must not write');
 const result=bridge.execute(env.video,{op:'apply',rate:8,mediaKey:'live'});
 assert.equal(result.status,'unsupported');assert.equal(result.error,'live-media-stream');assert.equal(result.actualRate,1);assert.equal(env.video.defaultWrites,0);
 env.video.rateSetterError=null;env.video.defaultSetterError=null;env.video.srcObject={};
 assert.equal(bridge.execute(env.video,{op:'apply',rate:8,mediaKey:'other'}).status,'ready');assert.equal(env.video.playbackRate,8);bridge.stop();
});
test('cached native setters during startup preserve intent, while later unclassified changes stay local',async()=>{
 for(const stage of ['loadedmetadata','playing']){
  const env=makeEnvironment(),nativeSetter=Object.getOwnPropertyDescriptor(env.HTMLMediaElement.prototype,'playbackRate').set;
  env.video.paused=false;env.video.ended=false;env.video.readyState=4;env.video.currentTime=1;env.video.currentSrc='film';
  const bridge=new RateBridge(env.target);let controller;
  bridge.start((_video,info)=>controller?.observe({...info,mediaKey:controller.mediaKey}));
  controller=new RateController(env.video,{enabled:true,defaultMode:'follow',steps:[1,2,8]}, {
   selected:true,lastRate:8,signature:()=>env.video.currentSrc,
   readRate:()=>bridge.execute(env.video,{op:'read',mediaKey:'film',selected:true}),
   writeRate:(rate,options)=>bridge.execute(env.video,{...options,rate,mediaKey:'film',selected:true}),
   releaseRate:()=>bridge.execute(env.video,{op:'release',mediaKey:'film',selected:true}),
  });
  env.video.dispatchEvent(trustedEvent(stage,[env.video]));Reflect.apply(nativeSetter,env.video,[1]);
  env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(env.video.playbackRate,8,stage);assert.equal(controller.lastRate,8,stage);
  env.video.dispatchEvent(trustedEvent('playing',[env.video]));env.video.currentTime=1.25;env.video.dispatchEvent(trustedEvent('timeupdate',[env.video]));
  Reflect.apply(nativeSetter,env.video,[1.5]);env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
  assert.equal(env.video.playbackRate,1.5);assert.equal(controller.managedRate,null);assert.equal(controller.lastRate,8);
  controller.command('set',8);Reflect.apply(nativeSetter,env.video,[1]);env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(env.video.playbackRate,8,'a new confirmed command also gets a startup acknowledgement');
  env.video.currentTime=1.5;env.video.dispatchEvent(trustedEvent('timeupdate',[env.video]));
  env.video.dispatchEvent(trustedEvent('playing',[env.video]));Reflect.apply(nativeSetter,env.video,[1.5]);
  env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));assert.equal(env.video.playbackRate,1.5,'a steady playing notification does not restart enforcement');
  controller.dispose();bridge.stop();
 }
});

test('nearest per-video controls beat a shared app scope and portal choices use recent player pointer context',()=>{
 const env=makeEnvironment(),second=new env.HTMLMediaElement(),seen=observations(),bridge=new RateBridge(env.target);
 bridge.start(seen.callback);
 bridge.execute(env.video,{op:'read',mediaKey:'one',selected:true});
 bridge.execute(second,{op:'read',mediaKey:'two',selected:false});
 const app=new FakeElement('DIV');
 app.contains=candidate=>candidate===env.video||candidate===second;
 const firstControls=new FakeElement('DIV');firstControls.contains=candidate=>candidate===env.video;
 const secondControls=new FakeElement('DIV');secondControls.contains=candidate=>candidate===second;
 const firstInput=new FakeElement('DIV'),secondInput=new FakeElement('DIV');
 env.document.dispatchEvent(trustedEvent('pointerdown',[firstInput,firstControls,app,env.document]));
 env.video.playbackRate=1.25;
 assert.equal(seen.items.at(-1).video,env.video);
 assert.equal(seen.items.at(-1).origin,'ambiguous');
 env.document.dispatchEvent(trustedEvent('pointerdown',[secondInput,secondControls,app,env.document]));
 second.playbackRate=1.3;
 assert.equal(seen.items.at(-1).video,second,'the closest controls scope identifies the second video');
 assert.equal(seen.items.at(-1).origin,'ambiguous');
 bridge.execute(env.video,{op:'read',mediaKey:'one',selected:false});
 const menu=new FakeElement('DIV',{role:'menu'});
 const option=new FakeElement('DIV',{role:'menuitemradio'},'1.5x');option.parentElement=menu;
 env.document.dispatchEvent(trustedEvent('click',[option,menu,app,env.document]));
 second.playbackRate=1.5;
 assert.equal(seen.items.at(-1).video,second,'the portal choice follows the latest trusted player pointerdown');
 assert.equal(seen.items.at(-1).origin,'user');
 bridge.execute(env.video,{op:'read',mediaKey:'one',selected:true});
 const body=new FakeElement('BODY');
 const keydown=trustedEvent('keydown',[body,app,env.document],{key:'!',eventPhase:1});
 env.target.event=keydown;
 env.video.playbackRate=1.75;
 env.document.dispatchEvent(keydown);
 env.target.event=null;
 assert.equal(seen.items.at(-1).video,env.video,'one selected video resolves a shared app scope keyboard event');
 assert.equal(seen.items.at(-1).origin,'user');
 bridge.stop();
});

test('same-key attribute reload advances epoch before its queued reset ratechange and preserves off-mode repair',async()=>{
 const env=makeEnvironment(),seen=observations();
 env.video.currentSrc='/same';env.video.paused=false;env.video.ended=false;env.video.readyState=2;
 const bridge=new RateBridge(env.target);
 let controller;
 bridge.start((video,info)=>{
  seen.callback(video,info);
  controller?.observe({...info,mediaKey:controller.mediaKey});
 });
 const settings={enabled:true,defaultMode:'off',preferredRate:2,customRate:2,steps:[1,2]};
 controller=new RateController(env.video,settings,{
  signature:()=>env.video.currentSrc||env.video.src,
  selected:true,
  readRate:()=>bridge.execute(env.video,{op:'read',mediaKey:'same-key',selected:true}),
  writeRate:(rate,options)=>bridge.execute(env.video,{...options,rate,mediaKey:'same-key',selected:true}),
  releaseRate:()=>bridge.execute(env.video,{op:'release',mediaKey:'same-key',selected:true}),
 });
 controller.command('set',2);
 assert.equal(controller.managedRate,2);
 env.video.setAttribute('src','/same');
 await Promise.resolve();
 env.video.readyState=0;
 env.video.dispatchEvent(trustedEvent('ratechange',[env.video]));
 assert.equal(seen.items.at(-1).origin,'load');
 assert.equal(controller.managedRate,2,'the UA reset event is recognized inside the new load epoch');
 env.video.dispatchEvent(trustedEvent('loadstart',[env.video]));
 env.video.readyState=2;
 env.video.dispatchEvent(trustedEvent('loadedmetadata',[env.video]));
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(env.video.playbackRate,2);
 assert.equal(controller.managedRate,2,'load completion repairs the same-key defaultMode-off rate');
 controller.dispose();bridge.stop();
});

test('stop restores only bridge-owned wrappers and leaves website descriptor replacements intact',()=>{
 const env=makeEnvironment(),original=Object.getOwnPropertyDescriptor(env.HTMLMediaElement.prototype,'playbackRate');
 const bridge=new RateBridge(env.target);
 bridge.start(()=>{});
 bridge.stop();
 const restored=Object.getOwnPropertyDescriptor(env.HTMLMediaElement.prototype,'playbackRate');
 assert.equal(restored.get,original.get);
 assert.equal(restored.set,original.set);
 const second=makeEnvironment(),other=new RateBridge(second.target);
 other.start(()=>{});
 const websiteSetter=function(value){this._playbackRate=value+0.5;};
 Object.defineProperty(second.HTMLMediaElement.prototype,'playbackRate',{...original,set:websiteSetter});
 other.stop();
 assert.equal(Object.getOwnPropertyDescriptor(second.HTMLMediaElement.prototype,'playbackRate').set,websiteSetter);
});

test('diagnostic rings are bounded and media key is sanitized',()=>{
 const env=makeEnvironment(),bridge=new RateBridge(env.target);
 bridge.start(()=>{});
 bridge.execute(env.video,{op:'read',mediaKey:'private URL / path'});
 for(let i=0;i<40;i++)env.video.playbackRate=1+(i%4)*0.25;
 const entries=bridge.diagnostics(env.video);
 assert.equal(entries.length,32);
 assert.ok(entries.every(item=>item.mediaKey==='privateURLpath'));
 bridge.stop();
});
