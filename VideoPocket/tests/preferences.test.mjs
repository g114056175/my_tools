import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePreferences,availableQuality,videoQualityOptions,resolvedVideoQuality,PRESERVED_QUALITY} from '../extension/preferences.js';
test('Stored video/audio preferences are validated without losing valid selections',()=>{
 const value=normalizePreferences({kind:'audio',videoFormat:'mp4',height:720,audioFormat:'mp3',audioQuality:'192',subtitleFormat:'vtt'});
 assert.deepEqual(value,{kind:'audio',videoFormat:'mp4',height:'720',audioFormat:'mp3',audioQuality:'192',subtitleFormat:'vtt'});
 assert.equal(normalizePreferences({height:'script',videoFormat:'exe',kind:'anything'}).videoFormat,'auto');
});
test('A unavailable preferred quality falls back below its ceiling without changing the preference',()=>{
 const value=normalizePreferences({height:'720'});
 assert.equal(availableQuality(value.height,['0','1080','480','360'],'0'),'480');
 assert.equal(value.height,'720');
 assert.equal(availableQuality(value.height,['0','1080','720','480'],'0'),'720');
 assert.equal(availableQuality('best',['best'],'best'),'best');
});

test('quality policy distinguishes best, preserved fallback and an explicit numeric preference',()=>{
 const stored={height:'1080'},menu=videoQualityOptions(stored.height,[480,720]);
 assert.deepEqual(menu.options.map(o=>[o.value,o.label]),[['0','最佳（720p）'],[PRESERVED_QUALITY,'720p（自動）'],['720','720p'],['480','480p']]);
 assert.equal(menu.selected,PRESERVED_QUALITY);assert.equal(resolvedVideoQuality(menu.selected,stored.height,[720,480]),'720');assert.equal(stored.height,'1080');
 assert.equal(videoQualityOptions(stored.height,[1080,720]).selected,'1080');
 assert.equal(videoQualityOptions('0',[720,480]).selected,'0');assert.equal(videoQualityOptions('720',[720,480]).selected,'720');
 assert.ok(!videoQualityOptions('720',[720,480]).options.some(o=>o.value===PRESERVED_QUALITY));
});

test('when every tier is above the target the automatic option uses the smallest available tier',()=>{
 const menu=videoQualityOptions('1080',[2160,1440]);
 assert.equal(menu.options[1].label,'1440p（自動）');assert.equal(resolvedVideoQuality(menu.selected,'1080',[2160,1440]),'1440');
});

test('one real quality stays compact except when preserving a missing numeric preference needs an action',()=>{
 assert.deepEqual(videoQualityOptions('0',[720]),{options:[{value:'720',label:'720p'}],selected:'720'});
 assert.equal(videoQualityOptions('1080',[720]).options.length,3);
 assert.equal(normalizePreferences({height:PRESERVED_QUALITY}).height,'0');
});
