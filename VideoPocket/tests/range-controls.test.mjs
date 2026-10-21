import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTime,formatTime,normalizeRange,createRangeController} from '../extension/range-controls.js';
function fixture(){
 const make=()=>({value:'',open:false,events:{},style:{values:{},setProperty(k,v){this.values[k]=v;}},setCustomValidity(v){this.validationMessage=v;},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;}});
 const elements=Object.fromEntries(['details','start','end','length','startSlider','endSlider','timeline','message'].map(k=>[k,make()]));
 return {...elements,controller:createRangeController(elements)};
}
test('range times use one decimal and reject extra precision or invalid clock minutes',()=>{
 assert.equal(parseTime('00:01:02.3'),62.3);assert.equal(parseTime('00:01:02.34'),null);assert.equal(parseTime('1:02:03'),3723);
 assert.equal(parseTime('00:60:00'),null);assert.equal(parseTime('00:00:60'),null);
 assert.equal(formatTime(62.34),'00:01:02.3');assert.equal(formatTime(62.35),'00:01:02.4');assert.equal(formatTime(59.96),'00:01:00');
 assert.deepEqual(normalizeRange(99,2,10),{start:9.9,end:10});
});
test('single timeline synchronizes handles, three fields and selected span',()=>{
 const f=fixture(),c=f.controller;c.setCapability(undefined);c.setCapability({duration:120,supported:true});
 assert.equal(f.end.value,'00:02:00.0');assert.equal(c.getRange(),undefined);assert.equal(f.startSlider.step,'0.1');
 f.details.open=true;f.details.events.toggle();assert.equal(c.getRange(),undefined);
 f.startSlider.value='30.25';f.startSlider.events.input();f.endSlider.value='90.5';f.endSlider.events.input();
 assert.equal(f.start.value,'00:00:30.3');assert.equal(f.end.value,'00:01:30.5');assert.equal(f.length.value,'00:01:00.2');
 assert.deepEqual(c.getRange(),{start:30.3,end:90.5});assert.equal(f.timeline.style.values['--range-start'],String(30.3/120*100)+'%');
 c.setCapability({duration:120,supported:true});assert.deepEqual(c.getRange(),{start:30.3,end:90.5});
 f.end.value='00:01:00';f.end.events.change();assert.equal(f.endSlider.value,'60');assert.equal(f.length.value,'00:00:29.7');
 f.details.open=false;f.details.events.toggle();assert.equal(c.getRange(),undefined);
 f.details.open=true;f.details.events.toggle();assert.deepEqual(c.getRange(),{start:30.3,end:60});
});
test('handles cannot cross and invalid text restores the valid endpoint',()=>{
 const f=fixture(),c=f.controller;c.setCapability({duration:120,supported:true});c.setEnabled(true);c.setRange({start:30,end:60});
 f.startSlider.value='100';f.startSlider.events.input();assert.equal(Number(f.startSlider.value),59.9);
 f.end.reportValidity=()=>assert.fail('no native validation bubble');
 f.end.value='bad';f.end.events.change();assert.equal(f.end.value,'00:01:00.0');assert.equal(f.end['aria-invalid'],'true');assert.equal(f.end.validationMessage,'');assert.equal(f.message.textContent,'時間格式不正確，已還原');assert.equal(f.message.hidden,false);
 f.endSlider.value='90';f.endSlider.events.input();assert.equal(f.message.hidden,true);assert.equal(f.end['aria-invalid'],'false');
 c.reset();assert.equal(f.details.open,false);assert.equal(c.getRange(),undefined);
});
test('unavailable source disables handles and never emits a download range',()=>{
 const f=fixture(),c=f.controller;c.setCapability({duration:60,supported:true});c.setEnabled(true);c.setRange({start:10,end:20});assert.ok(c.getRange());
 c.setCapability({duration:60,supported:false,reason:'不支援'});assert.equal(c.getRange(),undefined);assert.equal(f.details.open,false);assert.equal(c.getState().start,0);assert.equal(c.getState().end,60);assert.equal(f.startSlider.disabled,true);assert.equal(f.end.disabled,true);assert.equal(f.details.title,'不支援');
 c.setCapability({duration:60,supported:true});assert.equal(c.getRange(),undefined);assert.equal(c.getState().start,0);assert.equal(c.getState().end,60);
});
test('non-tenth duration keeps the exact full-range endpoint while snapping edited values',()=>{
 const f=fixture(),c=f.controller;c.setCapability({duration:103.47,supported:true});c.setEnabled(true);
 assert.equal(c.getState().end,103.47);assert.equal(c.getRange(),undefined);
 f.start.value='00:01:42.3';f.start.events.change();assert.equal(c.getState().start,102.3);
 assert.equal(c.getState().end,103.47);assert.deepEqual(c.getRange(),{start:102.3,end:103.47});
 f.endSlider.value='103.4';f.endSlider.events.input();assert.equal(c.getState().end,103.4);assert.equal(f.end.value,'00:01:43.4');
});
test('range controller works without a middle duration field',()=>{
 const f=fixture();const c=createRangeController({...f,start:f.start,end:f.end,length:undefined,startSlider:f.startSlider,endSlider:f.endSlider,timeline:f.timeline});c.setCapability({duration:30,supported:true});c.setEnabled(true);c.setRange({start:1.1,end:2.2});assert.deepEqual(c.getRange(),{start:1.1,end:2.2});assert.equal(f.start.value,'00:00:01.1');assert.equal(f.end.value,'00:00:02.2');
});
