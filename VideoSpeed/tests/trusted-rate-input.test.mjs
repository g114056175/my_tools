import test from 'node:test';
import assert from 'node:assert/strict';
import {TrustedRateInput} from '../src/trusted-rate-input.js';

class FakeElement{
 constructor(tagName='DIV',attrs={},textContent=''){this.tagName=tagName;this.attrs={...attrs};this.textContent=textContent;this.value='';this.parentElement=null;this.isContentEditable=false;this.playbackRate=1;}
 getAttribute(name){return this.attrs[name]??null;}
 contains(candidate){for(let node=candidate;node;node=node.parentElement)if(node===this)return true;return false;}
 closest(selector){
  if(selector!=='[role="menu"],[role="listbox"],[role="radiogroup"]')return null;
  for(let node=this;node;node=node.parentElement)if(['menu','listbox','radiogroup'].includes(node.getAttribute('role')))return node;
  return null;
 }
}
function event(type,path,{trusted=true,...extra}={}){
 const result=new Event(type);
 Object.defineProperty(result,'isTrusted',{value:trusted});
 Object.defineProperty(result,'composedPath',{value:()=>path});
 for(const [key,value]of Object.entries(extra))Object.defineProperty(result,key,{value});
 return result;
}
function setup(records=[{video:new FakeElement('VIDEO'),selected:true,mediaKey:'v1:k1'}]){
 const document=new EventTarget();let now=100;
 const dispatch=document.dispatchEvent.bind(document);
 document.dispatchEvent=value=>{
  Object.defineProperty(value,'eventPhase',{configurable:true,value:2});
  try{return dispatch(value);}finally{Object.defineProperty(value,'eventPhase',{configurable:true,value:0});}
 };
 const helper=new TrustedRateInput(document,{getRecords:()=>records,now:()=>now});helper.start();
 return {document,helper,records,advance(ms){now+=ms;}};
}
function userInfo(mediaKey,rate,evidence='native-rate-option'){
 return {origin:'user',evidence,status:'ready',mediaKey,attemptedRate:rate,actualRate:rate};
}
function speedOption(text='1.5x'){
 const player=new FakeElement('DIV'),menu=new FakeElement('DIV',{role:'menu'}),option=new FakeElement('DIV',{role:'menuitemradio'},text);
 menu.parentElement=player;option.parentElement=menu;
 return {player,menu,option};
}

test('a trusted exact speed menu choice authorizes only its matching media and rate once',()=>{
 const state=setup(),video=state.records[0].video,{player,menu,option}=speedOption();player.contains=candidate=>candidate===video;video.playbackRate=1.5;
 state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 assert.equal(state.helper.consume(video,userInfo('v1:k1',1.5)),true);
 assert.equal(state.helper.consume(video,userInfo('v1:k1',1.5)),false);
 state.helper.dispose();
});

test('trusted speed slider input and change events are exact choices; forged events create no proof',()=>{
 for(const type of ['input','change']){
  const state=setup(),video=state.records[0].video,player=new FakeElement('DIV');player.contains=candidate=>candidate===video;
  const slider=new FakeElement('INPUT',{'aria-label':'Playback speed'});slider.value='1.75';slider.parentElement=player;video.playbackRate=1.75;
  state.document.dispatchEvent(event(type,[slider,player,state.document]));
  assert.equal(state.helper.consume(video,userInfo('v1:k1',1.75)),true,`${type} should authorize the exact slider value`);
  state.document.dispatchEvent(event('change',[slider,player,state.document],{trusted:false}));
  assert.equal(state.helper.consume(video,userInfo('v1:k1',8)),false);
  state.helper.dispose();
 }
});

test('ordinary pointer and play controls do not authorize an unrelated rate change',()=>{
 const state=setup(),video=state.records[0].video,player=new FakeElement('DIV');player.contains=candidate=>candidate===video;
 const play=new FakeElement('BUTTON',{},'Play');play.parentElement=player;video.playbackRate=8;
 state.document.dispatchEvent(event('pointerdown',[play,player,state.document]));
 state.document.dispatchEvent(event('click',[play,player,state.document]));
 assert.equal(state.helper.consume(video,userInfo('v1:k1',8)),false);
 state.helper.dispose();
});

test('a held speed-slider move authorizes only a synchronous actual write, never its stale ARIA value',()=>{
 const state=setup(),video=state.records[0].video,player=new FakeElement('DIV');player.contains=node=>node===video;
 const slider=new FakeElement('DIV',{'role':'slider','aria-label':'Playback speed','aria-valuenow':'2'});slider.parentElement=player;
 let during=false;
 state.document.addEventListener('pointermove',()=>{video.playbackRate=1.25;during=state.helper.consume(video,userInfo('v1:k1',1.25,'native-rate-control'));});
 state.document.dispatchEvent(event('pointermove',[slider,player,state.document],{buttons:1}));
 assert.equal(during,true);assert.equal(state.helper.consume(video,userInfo('v1:k1',2)),false);
 video.playbackRate=1;assert.equal(state.helper.consume(video,userInfo('v1:k1',1,'native-rate-control')),false,'a later page reset is not the drag');state.helper.dispose();
});

test('hovering a slider creates no input proof or media lookup',()=>{
 let lookups=0;const document=new EventTarget(),helper=new TrustedRateInput(document,{getRecords:()=>{lookups++;return [];}});helper.start();
 const slider=new FakeElement('DIV',{'role':'slider','aria-label':'Playback speed','aria-valuenow':'2'});
 document.dispatchEvent(event('pointermove',[slider,document],{buttons:0}));assert.equal(lookups,0);assert.equal(helper.proofs.length,0);helper.dispose();
});

test('a trusted range input exposes its current value for feedback before the player commits',()=>{
 const video=new FakeElement('VIDEO'),player=new FakeElement('DIV'),slider=new FakeElement('INPUT',{'type':'range','role':'slider','class':'ytp-speedslider','aria-valuenow':'2','aria-valuetext':'2.00'});
 player.contains=node=>node===video;slider.parentElement=player;slider.value='1.25';video.playbackRate=2;
 const records=[{video,selected:true,mediaKey:'v1:k1'}],document=new EventTarget(),shown=[];
 const helper=new TrustedRateInput(document,{getRecords:()=>records,onSliderInput:info=>shown.push(info)});helper.start();
 document.dispatchEvent(event('input',[slider,player,document]));
 assert.deepEqual(shown,[{video,mediaKey:'v1:k1',rate:1.25}]);
 assert.equal(video.playbackRate,2,'visual feedback never changes the player itself');
 assert.equal(helper.consume(video,userInfo('v1:k1',1.25)),false,'an uncommitted slider value is not a confirmed rate');
 document.dispatchEvent(event('input',[slider,player,document],{trusted:false}));assert.equal(shown.length,1);helper.dispose();
});

test('trusted direct media keys preserve ! and @ only during the key event while blocking play and editable keys',async()=>{
 const state=setup(),video=state.records[0].video,body=new FakeElement('BODY');
 let accepted=[];
 state.document.addEventListener('keydown',e=>{
  if(e.key==='!')video.playbackRate=1.75;
  if(e.key==='@')video.playbackRate=2.25;
  if(e.key==='!'||e.key==='@')accepted.push(state.helper.consume(video,userInfo('v1:k1',video.playbackRate,'direct-key-write')));
 });
 state.document.dispatchEvent(event('keydown',[body,state.document],{key:'!'}));
 state.document.dispatchEvent(event('keydown',[body,state.document],{key:'@'}));
 assert.deepEqual(accepted,[true,true]);
 await Promise.resolve();
 video.playbackRate=3;
 assert.equal(state.helper.consume(video,userInfo('v1:k1',3,'direct-key-write')),false,'a previous key must not authorize a later write');
 state.document.dispatchEvent(event('keydown',[body,state.document],{key:' '}));video.playbackRate=3;
 assert.equal(state.helper.consume(video,userInfo('v1:k1',3,'direct-key-write')),false);
 const input=new FakeElement('INPUT');input.playbackRate=4;
 state.document.dispatchEvent(event('keydown',[input,state.document],{key:'!'}));video.playbackRate=4;
 assert.equal(state.helper.consume(video,userInfo('v1:k1',4,'direct-key-write')),false);
 state.helper.dispose();
});

test('proofs cannot cross media or source identity, match the exact rate, and expire',()=>{
 const first={video:new FakeElement('VIDEO'),selected:true,mediaKey:'v1:k1'},second={video:new FakeElement('VIDEO'),selected:false,mediaKey:'v2:k1'};
 const state=setup([first,second]),{player,menu,option}=speedOption();player.contains=candidate=>candidate===first.video;first.video.playbackRate=1.5;
 state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 assert.equal(state.helper.consume(second.video,userInfo('v2:k1',1.5)),false);
 assert.equal(state.helper.consume(first.video,userInfo('old-key',1.5)),false);
 assert.equal(state.helper.consume(first.video,userInfo('v1:k1',2)),false,'a proof must match the observed rate');
 assert.equal(state.helper.consume(first.video,userInfo('v1:k1',1.5)),true,'a mismatched observation must not consume a valid proof');
 assert.equal(state.helper.consume(first.video,userInfo('v1:k1',1.5)),false);
 state.document.dispatchEvent(event('click',[option,menu,player,state.document]));state.advance(1201);
 assert.equal(state.helper.consume(first.video,userInfo('v1:k1',1.5)),false);
 state.helper.dispose();
});

test('an older exact-rate proof cannot consume a newer choice with a different rate',()=>{
 const state=setup(),video=state.records[0].video,{player,menu,option}=speedOption('1.25x');player.contains=candidate=>candidate===video;
 video.playbackRate=1.25;state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 option.textContent='1.5x';video.playbackRate=1.5;state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 assert.equal(state.helper.consume(video,userInfo('v1:k1',1.5)),true);
 assert.equal(state.helper.proofs.length,1);
 assert.equal(state.helper.proofs[0].rate,1.25,'the newer rate must match the newer proof without consuming the older one');
 state.helper.dispose();
});

test('the pending proof queue stays bounded',()=>{
 const state=setup(),video=state.records[0].video,{player,menu,option}=speedOption();player.contains=candidate=>candidate===video;
 for(let index=0;index<40;index++)state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 assert.equal(state.helper.proofs.length,16);
 state.helper.dispose();
 assert.equal(state.helper.proofs.length,0);
});

test('an observation from an earlier player capture listener waits for the same trusted input',()=>{
 const state=setup(),video=state.records[0].video,{player,menu,option}=speedOption();player.contains=node=>node===video;video.playbackRate=1.5;
 let accepted=0;state.helper.verify(video,userInfo('v1:k1',1.5),()=>accepted++);
 assert.equal(accepted,0);
 state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 assert.equal(accepted,1);assert.equal(state.helper.pending.length,0);state.helper.dispose();
});

test('unverified page observations expire and cannot wait for an unrelated later choice',async()=>{
 const state=setup(),video=state.records[0].video,{player,menu,option}=speedOption();player.contains=node=>node===video;video.playbackRate=1.5;
 let accepted=0;state.helper.verify(video,userInfo('v1:k1',1.5),()=>accepted++);
 await new Promise(resolve=>setTimeout(resolve,5));
 state.document.dispatchEvent(event('click',[option,menu,player,state.document]));
 assert.equal(accepted,0);assert.equal(state.helper.pending.length,0);state.helper.dispose();
});

test('direct-key proof survives listener microtasks but is invalid as soon as dispatch ends',async()=>{
 const state=setup(),video=state.records[0].video,body=new FakeElement('BODY');video.playbackRate=1.75;
 let accepted=0;state.helper.verify(video,userInfo('v1:k1',1.75,'direct-key-write'),()=>accepted++);
 state.document.dispatchEvent(event('keydown',[body,state.document],{key:'!'}));
 assert.equal(accepted,1);
 state.document.dispatchEvent(event('keydown',[body,state.document],{key:'@'}));
 video.playbackRate=2;assert.equal(state.helper.consume(video,userInfo('v1:k1',2,'direct-key-write')),false);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(state.helper.proofs.some(p=>p.kind==='key'),false);state.helper.dispose();
});
