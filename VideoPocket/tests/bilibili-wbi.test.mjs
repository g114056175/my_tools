import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {md5,wbiQuery} from '../extension/bilibili-wbi.js';

test('local MD5 matches independent crypto for UTF-8 and block boundary lengths',()=>{
 for(const value of ['', 'abc', '字幕 😀', ...[55,56,63,64,65,127,128,1000].map(n=>'a'.repeat(n))])assert.equal(md5(value),createHash('md5').update(value).digest('hex'));
});
test('WBI signature matches the reference mixin key and independent digest and percent encodes spaces',()=>{
 const img='7cd084941338484aae1ad9425b84077c',sub='4932caff0ff746eab6f01bf08b70ac45';
 assert.equal(wbiQuery({foo:114,bar:514,baz:1919810},img,sub,1702204169),'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=6149fdadf571698ca7e6a567265cd0ee');
 const signed=wbiQuery({foo:'中 文!()*\''},img,sub,1);assert.match(signed,/foo=%E4%B8%AD%20%E6%96%87/);assert.ok(!signed.includes('+'));
});
