import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaRequestHeaders} from '../extension/media-request-headers.js';
test('Bahamut media receives its normal player origin',()=>{
 const headers=mediaRequestHeaders('https://bahamut.akamaized.net/video/main.m3u8','https://ani.gamer.com.tw/animeVideo.php?sn=1');
 assert.equal(headers.find(h=>h.header==='Origin')?.value,'https://ani.gamer.com.tw');
});
test('origin policy is scoped to exact HTTPS media and page hosts',()=>{
 for(const [url,page] of [['https://cdn.example/a','https://ani.gamer.com.tw/'],['https://bahamut.akamaized.net.evil.example/a','https://ani.gamer.com.tw/'],['http://bahamut.akamaized.net/a','https://ani.gamer.com.tw/'],['https://bahamut.akamaized.net/a','https://example.com/']])assert.equal(mediaRequestHeaders(url,page).some(h=>h.header==='Origin'),false);
});
