import test from 'node:test';
import assert from 'node:assert/strict';
import {originalTracks,selectTrack} from '../extension/tracks.js';
import {buildCapabilities,choosePlan} from '../native/capabilities.mjs';
import {summarize,downloadArgs} from '../native/core.mjs';
const tools={muxers:['mp4','matroska','webm','ipod','mp3','opus','ogg'],encoders:['aac','libmp3lame'],decoders:['aac','opus','mp3','vorbis']};
const media=(format_id,vcodec,acodec,height,ext='mp4',abr=128)=>({format_id,vcodec,acodec,height,ext,abr,url:'https://example.com/'+format_id});
test('Chinese original beats first English track and translated tracks are excluded',()=>{
  const tracks=originalTracks([{source:'native',language:'en',name:'English'},{source:'native',language:'zh-CN',name:'Chinese'},{source:'native',language:'zh-TW',url:'https://example.com/?lang=en&tlang=zh-TW'}]);
  assert.equal(tracks.length,2);assert.equal(selectTrack(tracks,['zh-Hant','en']).language,'zh-cn');
});
test('One original ASR track stays English; -orig wins over bare duplicate',()=>{
  const raw=[{language:'en',automatic:true,source:'native',url:'https://example.com/?lang=en'},{language:'en-orig',automatic:true,source:'native',url:'https://example.com/?lang=en'},{language:'zh',automatic:true,source:'native',url:'https://example.com/?lang=en&tlang=zh'}];
  const tracks=originalTracks(raw);assert.equal(tracks.length,1);assert.equal(selectTrack(tracks,['zh']).nativeLanguage,'en-orig');
});
test('Native summary never offers translated caption URL',()=>{
  const result=summarize({automatic_captions:{'en-orig':[{url:'https://example.com/?lang=en'}],zh:[{url:'https://example.com/?lang=en&tlang=zh'}]}});assert.deepEqual(result.tracks.map(t=>t.nativeLanguage),['en-orig']);
});
test('Translated language embedded in HLS timedtext URL is excluded',()=>{
  const encoded=encodeURIComponent('lang=en&tlang=zh&caps=asr');const tracks=originalTracks([{language:'zh',automatic:true,source:'native',url:'https://manifest.googlevideo.com/api/tts_params/'+encoded+'/playlist/index.m3u8'}]);assert.equal(tracks.length,0);
});
test('VP9/Opus only: MP4 disabled, MKV and source enabled',()=>{
  const c=buildCapabilities([media('v','vp09.00','none',720,'webm'),media('a','none','opus',null,'webm')],tools);
  assert.equal(c.choices.video.mp4.enabled,false);assert.equal(c.choices.video.mkv.enabled,true);assert.deepEqual(c.choices.video.mkv.heights,[720]);
  assert.throws(()=>choosePlan(c,{kind:'video',videoFormat:'mp4',height:0}));
});
test('MP4 heights require compatible audio; unavailable 720p cannot be requested',()=>{
  const c=buildCapabilities([media('h','avc1.64001F','none',540),media('v','vp9','none',1080,'webm'),media('o','none','opus',null,'webm'),media('a','none','mp4a.40.2',null,'m4a')],tools);
  assert.deepEqual(c.choices.video.mp4.heights,[1080,540]); // VP9/AAC is a compatible MP4 pair.
  const p=choosePlan(c,{kind:'video',videoFormat:'mp4',height:540});assert.equal(p.selector,'h+a');assert.throws(()=>choosePlan(c,{kind:'video',videoFormat:'mp4',height:720}));
  assert.equal(downloadArgs({kind:'video',videoFormat:'mp4'},'C:/test',p)[downloadArgs({kind:'video',videoFormat:'mp4'},'C:/test',p).indexOf('-f')+1],'h+a');
});
test('Missing AAC encoder disables M4A conversion; known MP3 encoder stays available',()=>{
  const c=buildCapabilities([media('a','none','opus',null,'webm')],{...tools,encoders:['libmp3lame']});assert.equal(c.choices.audio.mp3.enabled,true);assert.equal(c.choices.audio.m4a.enabled,false);
});
test('No source audio means all audio outputs disabled',()=>{
  const c=buildCapabilities([media('v','h264','none',360)],tools);assert.ok(Object.values(c.choices.audio).every(o=>!o.enabled));assert.deepEqual(c.choices.video.mp4.heights,[360]);
});
test('Unknown codecs offer direct original but do not pretend to support remux/conversion',()=>{
  const c=buildCapabilities([media('v','unknown','unknown',0)],tools);assert.equal(c.choices.video.auto.enabled,true);assert.equal(c.choices.video.mp4.enabled,false);assert.equal(c.choices.audio.mp3.enabled,false);
});
test('Different video containers and qualities never reuse intermediate filenames',()=>{
  const template=m=>{const args=downloadArgs({kind:'video',...m},'C:/test');return args[args.indexOf('--output')+1];};
  assert.notEqual(template({videoFormat:'auto',height:720}),template({videoFormat:'mkv',height:720}));assert.notEqual(template({videoFormat:'mp4',height:360}),template({videoFormat:'mp4',height:720}));
});
