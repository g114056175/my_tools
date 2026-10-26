import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRateFromEvent} from '../src/native-rate-intent.js';

function element(tagName,textContent='',attrs={},value=''){
 return {tagName,textContent,value,getAttribute:name=>attrs[name]??null};
}
function event(node,overrides={}){
 return {isTrusted:true,type:'click',target:node,composedPath:()=>[node],...overrides};
}

test('trusted speed options expose an exact expected rate, including 1x',()=>{
 for(const [text,expected]of [['1.5x',1.5],['2×',2],['正常',1],['Normal',1],['Normal / 1x',1],['正常（1x）',1],['1.5倍速',1.5],['1',1],['0.75',.75]]){
  assert.equal(nativeRateFromEvent(event(element('DIV',text,{role:'menuitemradio'}))),expected,text);
 }
 const button=element('BUTTON','2x');button.closest=()=>({});
 assert.equal(nativeRateFromEvent(event(button)),2);
 button.textContent='1.25';assert.equal(nativeRateFromEvent(event(button)),1.25);
 button.textContent='Normal / 1x';assert.equal(nativeRateFromEvent(event(button)),1);
 assert.equal(nativeRateFromEvent(event(element('SPAN','',{role:'menuitem','aria-label':'播放速度：1.25x'}))),1.25);
});

test('scripted clicks, play and quality choices never authorize rate memory',()=>{
 for(const node of [element('BUTTON','播放'),element('BUTTON','1080p'),element('DIV','144p',{role:'menuitemradio'}),element('BUTTON','Normal'),element('BUTTON','影片 2x'),element('BUTTON','2x'),element('DIV','2x',{role:'button','aria-haspopup':'menu'}),element('SPAN','2x')]){
  assert.equal(nativeRateFromEvent(event(node)),null);
 }
 assert.equal(nativeRateFromEvent(event(element('DIV','2x',{role:'menuitemradio'}),{isTrusted:false})),null);
 assert.equal(nativeRateFromEvent(event(element('DIV','2x',{role:'menuitemradio'}),{type:'pointerdown'})),null);
});

test('speed inputs accept trusted values while unrelated sliders do not',()=>{
 for(const type of ['input','change']){
  assert.equal(nativeRateFromEvent(event(element('INPUT','',{'aria-label':'Playback speed'},'1.5'),{type})),1.5);
  assert.equal(nativeRateFromEvent(event(element('SELECT','',{name:'playbackSpeed'},'2'),{type})),2);
  assert.equal(nativeRateFromEvent(event(element('INPUT','',{'aria-label':'Volume'},'1'),{type})),null);
  assert.equal(nativeRateFromEvent(event(element('INPUT','',{'aria-label':'Playback speed'},'100'),{type})),null);
 }
});

test('keyboard activation of a speed option is allowed but ordinary key input is not',()=>{
 const node=element('DIV','1x',{role:'menuitemradio'});
 assert.equal(nativeRateFromEvent(event(node,{type:'keydown',key:'Enter'})),1);
 assert.equal(nativeRateFromEvent(event(node,{type:'keydown',key:' '})),1);
 assert.equal(nativeRateFromEvent(event(node,{type:'keydown',key:'j'})),null);
});

test('nested labels resolve to their control without parsing a surrounding page',()=>{
 const span=element('SPAN','1.5x'),button=element('BUTTON','1.5x',{role:'menuitemradio'});
 assert.equal(nativeRateFromEvent(event(span,{composedPath:()=>[span,button]})),1.5);
 assert.equal(nativeRateFromEvent(event(span,{composedPath:()=>[span,element('BODY','2x')]})),null);
});
