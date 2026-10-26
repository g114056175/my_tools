import test from 'node:test';
import assert from 'node:assert/strict';
import {videoQualityOptions,PRESERVED_QUALITY} from '../src/quality-options.js';
test('quality menu uses best actual resolution and actual available levels',()=>{
 const result=videoQualityOptions(1080,[720,1080,2160,720]);
 assert.equal(result.selected,'1080');assert.deepEqual(result.options.map(item=>item.label),['最佳（2160p）','2160p','1080p','720p','關閉']);
});
test('unavailable preference is preserved while auto selects nearest lower quality',()=>{
 const result=videoQualityOptions(1080,[720,480]);
 assert.equal(result.selected,PRESERVED_QUALITY);assert.equal(result.options[1].label,'720p（自動）');
 assert.equal(result.options[1].title,'偏好 1080p；此影片使用 720p');
});
test('auto quality uses lowest when every available resolution exceeds preference',()=>{
 assert.equal(videoQualityOptions(240,[1080,720]).options[1].label,'720p（自動）');
});
test('best stays distinct from an explicit fixed resolution',()=>{
 assert.equal(videoQualityOptions(0,[1080,720]).selected,'0');
 assert.equal(videoQualityOptions(1080,[1080,720]).selected,'1080');
});
test('without capabilities the selector keeps configurable preferences without inventing best height',()=>{
 const result=videoQualityOptions(540,[]);assert.equal(result.options[0].label,'最佳');assert.equal(result.selected,'540');
 assert.ok(result.options.some(item=>item.value==='540'));
});

test('quality off is the final option and remains selected independently of the stored preferred resolution',()=>{
 const menu=videoQualityOptions(1080,[720,1080],false);assert.equal(menu.selected,'off');assert.equal(menu.options.at(-1).value,'off');assert.equal(menu.options.at(-1).label,'關閉');
});
