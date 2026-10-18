import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePreferences,availableQuality} from '../extension/preferences.js';
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
