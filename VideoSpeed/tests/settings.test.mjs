import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STEPS,DEFAULT_SHORTCUTS,normalizeSettings,normalizeSteps,formatRate,normalizeRate,validateSettings,validateSteps,stepRate,fineStepRate,defaultRate,shortcutFromEvent,shortcutAction,editingEvent,rankTargets,rateAtPosition,positionAtRate} from '../src/settings.js';
test('malformed stored settings recover to usable defaults',()=>{for(const raw of [null,'broken',42,[]])assert.deepEqual(normalizeSettings(raw),normalizeSettings());});
test('global disabled state persists and legacy preferences migrate',()=>{
 assert.equal(normalizeSettings({enabled:false}).enabled,false);
 assert.equal(normalizeSettings({defaultMode:'original'}).defaultMode,'off');
 const old=normalizeSettings({defaultMode:'preferred',preferredRate:2.5,customRate:1.2});assert.equal(old.defaultMode,'custom');assert.equal(old.customRate,2.5);
});
test('schema v2 default steps migrate once while customized and schema v3 steps stay user-owned',()=>{
 const legacy=[.25,.5,.75,1,1.25,1.5,2,2.5,3,3.5,4];
 const migrated=normalizeSettings({schemaVersion:2,steps:legacy});
 assert.equal(migrated.schemaVersion,3);assert.deepEqual(migrated.steps,[.25,.5,.75,1,1.25,1.5,1.75,2,2.5,3,3.5,4]);
 assert.deepEqual(normalizeSettings({schemaVersion:2,steps:[...legacy,1.8]}).steps,[.25,.5,.75,1,1.25,1.5,1.8,2,2.5,3,3.5,4]);
 assert.deepEqual(normalizeSettings({schemaVersion:3,steps:legacy}).steps,legacy);
 assert.ok(DEFAULT_STEPS.includes(1.75));
});
test('off does not declare 1x; follow and custom are independent from preferred',()=>{
 const s=normalizeSettings({preferredRate:3});assert.equal(defaultRate(s),null);
 assert.equal(defaultRate({...s,defaultMode:'follow'},1.5),1.5);assert.equal(defaultRate({...s,defaultMode:'custom',customRate:1.75}),1.75);
});
test('dragging snaps each interval into fifths with simple rounded speeds',()=>{
 const steps=[.25,.5,1,2,3,3.5,4,16];assert.equal(rateAtPosition(6.2,steps),6.4);assert.equal(rateAtPosition(6.4,steps),8.8);
 assert.equal(rateAtPosition(.2,[1,1.25]),1.05);assert.equal(rateAtPosition(.4,[1,1.25]),1.1);assert.equal(rateAtPosition(.8,[1,1.25]),1.2);
 assert.equal(rateAtPosition(.26,[1,1.25]),1.05);assert.equal(rateAtPosition(.37,[1,1.25]),1.1);
 for(let p=0;p<=7;p+=.025){const rate=rateAtPosition(p,steps);assert.ok(Number.isInteger(rate*100)||Math.abs(rate*100-Math.round(rate*100))<1e-8);}
 assert.ok(Math.abs(positionAtRate(1.05,[1,1.25])-.2)<1e-8);
 assert.equal(rateAtPosition(-1,steps),.25);assert.equal(rateAtPosition(99,steps),16);assert.equal(rateAtPosition(10,[2]),2);
});
test('keyboard and outer buttons jump to adjacent declared ticks from fractional rates',()=>{
 assert.equal(stepRate(1.05,[.25,.75,1,1.25,2,4],1),1.25);assert.equal(stepRate(1.05,[.25,.75,1,1.25,2,4],-1),1);
 assert.equal(stepRate(1,[.25,.75,1,1.25,2,4],1),1.25);assert.equal(stepRate(1,[.25,.75,1,1.25,2,4],-1),.75);
 assert.equal(stepRate(3.99,[.25,4],1),4);assert.equal(stepRate(.25,[.25,4],-1),.25);
 assert.equal(stepRate(8,[.25,4],1),8);assert.equal(stepRate(8,[.25,4],-1),4);
});
test('steps normalize and invalid settings do not save silently',()=>{
 assert.deepEqual(validateSettings({...normalizeSettings(),steps:'3, 1, 1.25, .25, 2, 1.25'}).steps,[.25,1,1.25,2,3]);
 for(const steps of ['','0,1','1,-2','1,NaN','1,17'])assert.throws(()=>validateSettings({...normalizeSettings(),steps}));
 assert.throws(()=>validateSettings({...normalizeSettings(),preferredRate:''}));
 assert.throws(()=>validateSettings({...normalizeSettings(),shortcuts:{slower:'x',faster:'x',reset:':',preferred:'"'}}));
});
test('validation failures expose canonical English messages',()=>{
 const settings=normalizeSettings();
 assert.throws(()=>validateSettings({...settings,preferredRate:0}),{message:'Enter a speed between 0.06 and 16'});
 assert.throws(()=>validateSteps(''),{message:'Use 1–64 ticks between 0.06 and 16'});
 assert.throws(()=>validateSettings({...settings,shortcuts:{...settings.shortcuts,slower:' '}}),{message:'Use a character key with optional modifiers'});
 assert.throws(()=>validateSettings({...settings,shortcuts:{...settings.shortcuts,faster:settings.shortcuts.slower}}),{message:'Shortcuts must be unique'});
});
test('legacy four-shortcut settings migrate with fine controls unbound',()=>{
 const legacy=normalizeSettings({schemaVersion:2,shortcuts:{slower:'<',faster:'>',reset:':',preferred:'"'}});
 assert.deepEqual(legacy.shortcuts,{...DEFAULT_SHORTCUTS});
 const validated=validateSettings({schemaVersion:2,preferredRate:2,customRate:2,steps:DEFAULT_STEPS,shortcuts:{slower:'<',faster:'>',reset:':',preferred:'"'}});
 assert.equal(validated.shortcuts.fineSlower,'');assert.equal(validated.shortcuts.fineFaster,'');
});
test('shortcut recording preserves symbols and formats letters and modifiers canonically',()=>{
 assert.equal(shortcutFromEvent({key:'<',shiftKey:true}),'<');
 assert.equal(shortcutFromEvent({key:'>',shiftKey:true}),'>');
 assert.equal(shortcutFromEvent({key:':',shiftKey:true}),':');
 assert.equal(shortcutFromEvent({key:'"',shiftKey:true}),'"');
 assert.equal(shortcutFromEvent({key:'+',shiftKey:true}),'+');
 assert.equal(shortcutFromEvent({key:'-'}),'-');
 assert.equal(shortcutFromEvent({key:'a'}),'A');
 assert.equal(shortcutFromEvent({key:'A',shiftKey:true}),'Shift+A');
 assert.equal(shortcutFromEvent({key:'A',ctrlKey:true,shiftKey:true}),'Ctrl+Shift+A');
 assert.equal(shortcutFromEvent({key:'b',ctrlKey:true,altKey:true,metaKey:true}),'Ctrl+Alt+Meta+B');
 assert.equal(shortcutFromEvent({key:'Control',ctrlKey:true}),null);
 assert.equal(shortcutFromEvent({key:'a',isComposing:true}),null);
 assert.equal(shortcutFromEvent({key:'a',keyCode:229}),null);
});
test('shortcuts allow unbinding and reject duplicate nonempty combinations',()=>{
 const settings=normalizeSettings();
 const unbound=validateSettings({...settings,shortcuts:{slower:'',faster:'',reset:'',preferred:'',fineSlower:'',fineFaster:''}});
 assert.deepEqual(Object.values(unbound.shortcuts),['','','','','','']);
 assert.throws(()=>validateSettings({...settings,shortcuts:{...settings.shortcuts,fineSlower:'Ctrl+Shift+A',fineFaster:'ctrl+shift+a'}}));
 const remapped=validateSettings({...settings,shortcuts:{slower:'x',faster:'>',reset:':',preferred:'"',fineSlower:'Ctrl+Shift+A',fineFaster:''}});
 assert.equal(remapped.shortcuts.slower,'X');assert.equal(remapped.shortcuts.fineSlower,'Ctrl+Shift+A');assert.equal(remapped.shortcuts.fineFaster,'');
});
test('shortcut actions match the recorded format, including modifiers and old symbol bindings',()=>{
 assert.equal(shortcutAction({key:':',shiftKey:true}),'reset');assert.equal(shortcutAction({key:'"',shiftKey:true}),'preferred');
 assert.equal(shortcutAction({key:'>',shiftKey:true}),'faster');assert.equal(shortcutAction({key:'!',shiftKey:true}),null);assert.equal(shortcutAction({key:'@',shiftKey:true}),null);
 assert.equal(shortcutAction({key:'>',ctrlKey:true}),null);assert.equal(shortcutAction({key:'>',isComposing:true}),null);
 assert.equal(shortcutAction({key:'x'},{reset:'x'}),'reset');
 assert.equal(shortcutAction({key:'A',ctrlKey:true,shiftKey:true},{fineSlower:'Ctrl+Shift+A'}),'fineSlower');
 assert.equal(shortcutAction({key:'a'},{fineFaster:''}),null);
 assert.equal(editingEvent({target:{tagName:'INPUT'}}),true);assert.equal(editingEvent({composedPath:()=>[{isContentEditable:true}]}),true);
});
test('single target uses current playback, then last actual playback, with explicit pick available',()=>{
 const items=[{key:'ad',visible:false,area:999999,playing:true},{key:'main',visible:true,area:60000,playing:true},{key:'paused',visible:true,area:20000,interactedAt:100}];
 assert.equal(rankTargets(items)[0].key,'main');assert.equal(rankTargets(items,'paused')[0].key,'paused');
 assert.equal(rankTargets([{key:'a',visible:true,lastPlayedAt:10},{key:'b',visible:false,lastPlayedAt:20}])[0].key,'b');
 assert.equal(rankTargets([{key:'only',visible:false}])[0].key,'only');
 assert.equal(rankTargets([{key:'a',visible:true,playing:true,lastPlayedAt:10},{key:'b',visible:true,playing:true,lastPlayedAt:20}])[0].key,'b');
});

test('fine controls follow the same fifth-interval grid as dragging',()=>{
 const steps=[.25,.5,.75,1,1.25,1.5,2,4,16];
 assert.equal(fineStepRate(1.05,steps,1),1.1);assert.equal(fineStepRate(1.05,steps,-1),1);
 assert.equal(fineStepRate(1.07,steps,1),1.1);assert.equal(fineStepRate(1.07,steps,-1),1.05);
 assert.equal(fineStepRate(1.5,steps,1),1.6);assert.equal(fineStepRate(1.5,steps,-1),1.45);
 assert.equal(fineStepRate(4,steps,1),6.4);assert.equal(fineStepRate(16,steps,1),16);
});

test('fine stepping retains all subdivision points for a large custom scale',()=>{
 const steps=Array.from({length:64},(_,index)=>(index+1)*.25);
 assert.equal(fineStepRate(15,steps,1),15.05);assert.equal(fineStepRate(15.05,steps,-1),15);
 assert.equal(fineStepRate(16,steps,-1),15.95);
});

test('rates and subdivisions use two decimals while preserving the playable minimum',()=>{
 assert.deepEqual(normalizeSteps([.0625,.125,.13,1.237]),[.0625,.13,1.24]);
 assert.equal(formatRate(.0625),'0.06');assert.equal(formatRate(.125),'0.13');assert.equal(formatRate(2),'2');
 assert.equal(normalizeRate(.06),.0625);assert.equal(normalizeRate(.125),.13);
 assert.equal(fineStepRate(.13,[.0625,.125,.25],-1),.12);
 assert.equal(fineStepRate(.0625,[.0625,.125,.25],1),.08);
 for(let p=0;p<=2;p+=.2){const value=rateAtPosition(p,[.0625,.125,.25]);assert.ok(value===.0625||Math.abs(value*100-Math.round(value*100))<1e-7);}
 assert.equal(normalizeSettings({customRate:.125,preferredRate:.0625}).customRate,.13);
});
