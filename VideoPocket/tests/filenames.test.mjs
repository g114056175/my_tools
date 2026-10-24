import test from 'node:test';
import assert from 'node:assert/strict';
import {fileStem,suggestedFilename} from '../extension/filenames.js';

test('Filename suggestion is deterministic and leaves conflict handling to the browser',()=>{
 assert.equal(suggestedFilename('影片','mp4'),'影片.mp4');
 assert.equal(suggestedFilename('影片','m4a'),'影片.m4a');
 assert.equal(suggestedFilename('影片','webm'),'影片.webm');
});
test('A title with an old media extension never acquires duplicate extensions',()=>{
 assert.equal(suggestedFilename('影片.mp4.mp4','mp4'),'影片.mp4');
 assert.equal(suggestedFilename('影片.mp4','m4a'),'影片.m4a');
 assert.equal(fileStem('CON.mp4'),'_CON');
 assert.equal(suggestedFilename('測試 / "影片"','mp4'),'測試 _ _影片_.mp4');
 assert.throws(()=>suggestedFilename('影片','../mp4'));
});

test('browser download names remove invisible formatting while retaining Chinese and ordinary emoji',()=>{
 assert.equal(suggestedFilename('COOKED: Ep. 1 🧑‍🍳','mp4'),'COOKED_ Ep. 1 🧑🍳.mp4');
 assert.equal(suggestedFilename('中\u200B文\u202E標題\u2066','srt'),'中文標題.srt');
 assert.equal(suggestedFilename('影片 🐱 ❤️','mp4'),'影片 🐱 ❤️.mp4');
 assert.equal(suggestedFilename('a\u007Fb\u0085c','m4a'),'a_b_c.m4a');
 const long=suggestedFilename('a'.repeat(99)+'🧑尾巴','mp4');
 assert.equal(long,'a'.repeat(99)+'🧑.mp4');assert.equal(long.isWellFormed(),true);
 assert.equal(suggestedFilename('\u200D\u202E','mp4'),'video.mp4');
});
