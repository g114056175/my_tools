import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRateFromEvent,nativeRateIntentFromEvent} from '../src/native-rate-intent.js';

class Element{
 constructor(tagName,textContent='',attrs={},value=''){
  this.tagName=tagName;this.textContent=textContent;this.attrs={...attrs};this.value=value;this.parentElement=null;this.ownerDocument=null;
 }
 getAttribute(name){return this.attrs[name]??null;}
 closest(selector){
  if(selector!=='[role="menu"],[role="listbox"],[role="radiogroup"]')return null;
  for(let node=this;node;node=node.parentElement)if(['menu','listbox','radiogroup'].includes(node.getAttribute('role')))return node;
  return null;
 }
}
function element(tag,text='',attrs={},value=''){return new Element(tag,text,attrs,value);}
function event(node,overrides={}){
 return {isTrusted:true,type:'click',target:node,composedPath:()=>[node],...overrides};
}
function speedMenu(option,{className='playbackrate-menu'}={}){
 const menu=element('DIV','',{'class':className,'role':'menu'});option.parentElement=menu;
 return {menu,path:[option,menu]};
}

test('trusted explicit speed options expose exact rates and preserve the compatibility API',()=>{
 const cases=[['1.5x',1.5],['2×',2],['1.5倍速',1.5],['1.5',1.5]];
 for(const [text,expected]of cases){
  const option=element('DIV',text,{role:'menuitemradio'});
  const intent=nativeRateIntentFromEvent(event(option));
  assert.deepEqual(intent,{rate:expected},text);
  assert.equal(nativeRateFromEvent(event(option)),expected,text);
 }
 for(const [text,expected]of [['Normal',1],['正常',1],['Normal / 1x',1],['正常（1x）',1],['1',1],['0.75',.75]]){
  const option=element('DIV',text,{role:'menuitemradio'}),{path}=speedMenu(option);
  assert.deepEqual(nativeRateIntentFromEvent(event(option,{composedPath:()=>path})),{rate:expected},text);
 }
 const labelled=element('SPAN','',{role:'menuitem','aria-label':'播放速度：1.25x'});
 assert.deepEqual(nativeRateIntentFromEvent(event(labelled)),{rate:1.25});
});

test('Bilibili class-based playback-rate options accept data-value and visible values',()=>{
 for(const [attrs,text,expected]of [
  [{'class':'bpx-player-ctrl-playbackrate-menu-item','data-value':'1.75'},'1.75',1.75],
  [{'class':'bpx-player-ctrl-playbackrate-menu-item'},'2.0X',2],
 ]){
  const option=element('DIV',text,attrs),menu=element('DIV','',{'class':'bpx-player-ctrl-playbackrate-menu'});
  const path=[element('SPAN',text),option,menu];path[0].parentElement=option;option.parentElement=menu;
  assert.deepEqual(nativeRateIntentFromEvent(event(path[0],{composedPath:()=>path})),{rate:expected});
 }
});

test('trusted labelled input and select changes expose an exact rate',()=>{
 for(const type of ['input','change']){
  assert.deepEqual(nativeRateIntentFromEvent(event(element('INPUT','',{'aria-label':'Playback speed',type:'range'},'1.5'),{type})),{rate:1.5});
  assert.deepEqual(nativeRateIntentFromEvent(event(element('SELECT','',{name:'playbackRate'},'2'),{type})),{rate:2});
 }
});

test('custom speed sliders support aria values, labelledby, dragging, and Arrow keys',()=>{
 const slider=element('DIV','',{'role':'slider','aria-label':'Playback speed','aria-valuenow':'1.25'});
 assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type:'input'})),{rate:1.25});
 slider.attrs['aria-valuetext']='1.5×';
 assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type:'pointerup',button:0})),{rate:null});
 assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type:'pointermove',buttons:1})),{rate:null});
 assert.equal(nativeRateIntentFromEvent(event(slider,{type:'pointermove',buttons:0})),null,'hover is not a drag');
 assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type:'pointerdown',button:0})),{rate:null},'pointerdown must not predict a rate from stale ARIA');
 assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type:'keydown',key:'ArrowRight'})),{rate:null});
 assert.equal(nativeRateIntentFromEvent(event(slider,{type:'keydown',key:'j'})),null);

 const label=element('SPAN','Speed');
 const doc={getElementById:id=>id==='rate-label'?label:null};
 const labelled=element('DIV','',{'role':'slider','aria-labelledby':'rate-label','aria-valuenow':'1.75'});labelled.ownerDocument=doc;
 assert.deepEqual(nativeRateIntentFromEvent(event(labelled,{type:'change'})),{rate:1.75});

 const classSlider=element('DIV','',{'class':'video-speed-slider','aria-valuenow':'2.25'});
 assert.deepEqual(nativeRateIntentFromEvent(event(classSlider,{type:'pointerup',button:0})),{rate:null});
});

test('YouTube variable-speed preset chips work without a menu role or speed aria label',()=>{
 const panel=element('DIV','',{'class':'ytp-variable-speed-panel-content'});
 const button=element('BUTTON','2.0',{'class':'ytp-button ytp-variable-speed-panel-preset-button ytp-variable-speed-panel-button'});
 const span=element('SPAN','2.0');button.parentElement=panel;span.parentElement=button;
 assert.deepEqual(nativeRateIntentFromEvent(event(span,{composedPath:()=>[span,button,panel]})),{rate:2});
});

test('native range values take precedence over delayed ARIA annotations',()=>{
 const slider=element('INPUT','',{'class':'ytp-speedslider','role':'slider','type':'range','aria-valuenow':'2','aria-valuetext':'2.00'},'1.25');
 for(const type of ['input','change'])assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type})),{rate:1.25});
 for(const type of ['pointerdown','pointermove','pointerup','click'])assert.deepEqual(nativeRateIntentFromEvent(event(slider,{type,button:0,buttons:1})),{rate:null},'pointer events never authorize the stale DOM value');
});

test('explicit speed adjustment buttons return an inexact intent',()=>{
 const faster=element('BUTTON','+',{'aria-label':'Increase playback speed'});
 const slower=element('BUTTON','−',{'aria-label':'減慢播放速度'});
 assert.deepEqual(nativeRateIntentFromEvent(event(faster)),{rate:null});
 assert.deepEqual(nativeRateIntentFromEvent(event(slower,{type:'keydown',key:'Enter'})),{rate:null});
 assert.deepEqual(nativeRateIntentFromEvent(event(faster,{type:'pointerup',button:0})),{rate:null});
 assert.equal(nativeRateIntentFromEvent(event(faster,{type:'pointerdown',button:0})),null);
 assert.equal(nativeRateFromEvent(event(faster)),null,'the legacy API still exposes only exact rates');
});

test('menu selection requires click or keyboard activation, never pointerdown or pointerup',()=>{
 const option=element('DIV','1.5x',{role:'menuitemradio'});
 assert.equal(nativeRateIntentFromEvent(event(option,{type:'pointerdown',button:0})),null);
 assert.equal(nativeRateIntentFromEvent(event(option,{type:'pointerup',button:0})),null);
 assert.deepEqual(nativeRateIntentFromEvent(event(option,{type:'keydown',key:'Enter'})),{rate:1.5});
 assert.deepEqual(nativeRateIntentFromEvent(event(option,{type:'keydown',key:' '})),{rate:1.5});
 assert.equal(nativeRateIntentFromEvent(event(option,{type:'keydown',key:'j'})),null);
});

test('ambiguous controls and unrelated page content do not produce intents',()=>{
 const volume=element('DIV','',{'role':'slider','aria-label':'Volume','aria-valuenow':'1.5'});
 const timeline=element('DIV','',{'role':'slider','aria-label':'Seek','aria-valuenow':'50'});
 const plain=element('DIV','1.5');
 const bareNumber=element('DIV','1.5');
 const quality=element('BUTTON','1080p');
 const plus=element('BUTTON','+');
 for(const node of [volume,timeline,plain,bareNumber,quality,plus]){
  assert.equal(nativeRateIntentFromEvent(event(node,{type:node===volume||node===timeline?'input':'click'})),null,node.textContent||node.getAttribute('aria-label'));
 }
 assert.equal(nativeRateIntentFromEvent(event(element('DIV','1.5x',{role:'menuitemradio'}),{isTrusted:false})),null);
 assert.equal(nativeRateIntentFromEvent(event(element('INPUT','',{'aria-label':'Playback speed'},'100'),{type:'input'})),null);
});

test('nested target paths resolve the speed control without parsing unrelated ancestors',()=>{
 const span=element('SPAN','1.5x'),button=element('BUTTON','1.5x',{role:'menuitemradio'});
 assert.deepEqual(nativeRateIntentFromEvent(event(span,{composedPath:()=>[span,button]})),{rate:1.5});
 const unrelated=element('BODY','2x');
 assert.equal(nativeRateIntentFromEvent(event(element('SPAN','2x'),{composedPath:()=>[element('SPAN','2x'),unrelated]})),null);
});

test('volume or progress sliders stay unrelated inside a container mentioning speed',()=>{
 const panel=element('DIV','',{'class':'playback-speed-control'});
 for(const name of ['Volume','Seek','Playback progress']){
  const slider=element('INPUT','',{'type':'range','aria-label':name},'1');
  assert.equal(nativeRateIntentFromEvent(event(slider,{type:'input',composedPath:()=>[slider,panel]})),null,name);
 }
});
