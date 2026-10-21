import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaRequestHeaders} from '../extension/media-request-headers.js';
import {mediaCredentials} from '../extension/media-credentials.js';
test('Bahamut media receives its normal player origin',()=>{
 const headers=mediaRequestHeaders('https://bahamut.akamaized.net/video/main.m3u8','https://ani.gamer.com.tw/animeVideo.php?sn=1');
 assert.equal(headers.find(h=>h.header==='Origin')?.value,'https://ani.gamer.com.tw');
});
test('origin policy is scoped to exact HTTPS media and page hosts',()=>{
 for(const [url,page] of [['https://cdn.example/a','https://ani.gamer.com.tw/'],['https://bahamut.akamaized.net.evil.example/a','https://ani.gamer.com.tw/'],['http://bahamut.akamaized.net/a','https://ani.gamer.com.tw/'],['https://bahamut.akamaized.net/a','https://example.com/']])assert.equal(mediaRequestHeaders(url,page).some(h=>h.header==='Origin'),false);
});

test('TikTok CDN fetch uses player origin and an origin-only cross-site Referer',()=>{
 const headers=mediaRequestHeaders('https://v16-webapp-prime.tiktok.com/video/file.mp4','https://www.tiktok.com/@creator/video/123');
 assert.equal(headers.find(h=>h.header==='Referer').value,'https://www.tiktok.com/');
 assert.equal(headers.find(h=>h.header==='Origin').value,'https://www.tiktok.com');
 for(const url of ['https://cdn.example/file.mp4','https://tiktokcdn.com.evil.example/file.mp4','http://v16.tiktokcdn.com/file.mp4']){
  assert.equal(mediaRequestHeaders(url,'https://www.tiktok.com/feed').some(h=>h.header==='Origin'),false);
  assert.equal(mediaCredentials(url,'https://www.tiktok.com/feed'),'omit');
 }
});

test('Facebook credentials stay scoped to its HTTPS media CDNs',()=>{
 assert.equal(mediaCredentials('https://www.facebook.com/reel/123/','https://www.facebook.com/kfctaiwan/'),'include');
 assert.equal(mediaCredentials('https://m.facebook.com/reel/123/','https://www.facebook.com/kfctaiwan/'),'omit');
 for(const url of ['https://video.xx.fbcdn.net/a.mp4','https://video.fbsbx.com/a.mp4'])assert.equal(mediaCredentials(url,'https://www.facebook.com/kfctaiwan/'),'include');
 for(const url of ['https://fbcdn.net.evil.example/a.mp4','https://cdn.example/a.mp4','http://video.xx.fbcdn.net/a.mp4'])assert.equal(mediaCredentials(url,'https://www.facebook.com/'),'omit');
 assert.equal(mediaCredentials('https://video.xx.fbcdn.net/a.mp4','https://evil.example/'),'omit');
});
