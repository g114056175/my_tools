import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeBilibiliSubtitleUrl} from '../extension/bilibili-subtitle-url.js';

const paths=[
 'S%13%1BP.%1D()X%2CR%5Ej%1F%25w%0E%02H%5EHO4%14%7B4%08K%40%3C%7B%00M%0B%0A%1AM%08%056N6%24%0C0%26%02%1E%01%09%0E%1A2V~%16FY%17%12%0B%08%14%0DY',
 '%01%1B%5C%3D_%04%12%12%049f%2F%07H%08)~%16%245%0D.%0B%0AL%03%2C%01%1A%00M%3A%1Ce%00%0F%1FF%03%003%1A6%17%0A%25U%14%16Q%16%2CI%16o%16D%5B%0C%40%3C%13%18%01%00%08'
];
test('both current player URL encodings restore the CDN path and preserve signed query exactly',()=>{
 for(const path of paths)assert.equal(decodeBilibiliSubtitleUrl('//subtitle.bilibili.com/'+path+'?auth_key=SECRET%2Bvalue&lang=zh'),'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/12311abcdef?auth_key=SECRET%2Bvalue&lang=zh');
});
test('already resolved URLs pass through; unrecognized encoded paths never become downloadable garbage',()=>{
 const url='https://aisubtitle.hdslb.com/bfs/ai_subtitle/file?auth_key=value';assert.equal(decodeBilibiliSubtitleUrl(url),url);
 for(const path of ['%ff','%00random'])assert.throws(()=>decodeBilibiliSubtitleUrl('//subtitle.bilibili.com/'+path),e=>e.code==='BILI_SOURCE_REJECTED');
});
