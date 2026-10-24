import test from 'node:test';import assert from 'node:assert/strict';
import {sizeOf,mediaChoices} from '../extension/browser-media.js';

const duration=1473.914;

test('An unbound average cannot be treated as a format average',()=>{
 assert.equal(sizeOf({averageBitrate:482170},60),null);
 assert.equal(sizeOf({averageBitrate:482170,averageBitrateScope:'variant'},60),null);
});

test('A variant average is counted once only for its uniquely bound audio',()=>{
 const video={id:'v',url:'https://cdn/v',height:144,ext:'mp4',videoCodec:'h264',averageBitrate:482170,averageBitrateScope:'variant',averageAudioId:'a',audioGroup:'g'};
 const audio={id:'a',url:'https://cdn/a',ext:'mp4',audioCodec:'aac',audioGroup:'g',filesize:900_000};
 const make=(v=video,a=audio)=>mediaChoices({duration:60,requiresAudio:true,formats:[v,a]});
 assert.deepEqual(make().plans.video.auto[144].size,{bytes:3_616_275,approximate:true});
 assert.equal(make({...video,averageAudioId:undefined}).plans.video.auto[144].size,null);
 assert.equal(make(video,{...audio,id:'other'}).plans.video.auto[144].size,null);
 assert.equal(make().plans.audio.original.best.size.bytes,900_000);
});

test('Segmented formats do not estimate from peak bitrate alone',()=>{
 assert.equal(sizeOf({segments:[{}],bitrate:2_000_000},duration),null);
 const estimated=sizeOf({segments:[{}],bitrate:2_000_000,averageBitrate:900_000,averageBitrateScope:'format'},duration);
 assert.deepEqual(estimated,{bytes:900_000*duration/8,approximate:true});
 assert.ok(estimated.bytes/1024**2>158&&estimated.bytes/1024**2<159);
});

test('Segmented exact filesize takes precedence over average bitrate',()=>{
 assert.deepEqual(sizeOf({segments:[{}],filesize:123_456_789,averageBitrate:900_000,averageBitrateScope:'format'},duration),{bytes:123_456_789,approximate:false});
});

test('Non-segmented estimates also require an explicit average; known size still wins',()=>{
 assert.equal(sizeOf({bitrate:2_000_000},duration),null);
 assert.deepEqual(sizeOf({bitrate:2_000_000,averageBitrate:900_000,averageBitrateScope:'format'},duration),{bytes:900_000*duration/8,approximate:true});
 assert.deepEqual(sizeOf({filesize:123_456_789,bitrate:2_000_000},duration),{bytes:123_456_789,approximate:false});
});

test('Incomplete split-track sizes stay unknown without affecting format availability',()=>{
 const video={url:'https://cdn/v',height:720,ext:'mp4',videoCodec:'h264',filesize:1000};
 const audio={url:'https://cdn/a',ext:'mp4',audioCodec:'aac',bitrate:128_000};
 const source={duration:10,requiresAudio:true,formats:[video,audio]};
 const unknown=mediaChoices(source);
 assert.equal(unknown.choices.video.auto.enabled,true);
 assert.equal(unknown.choices.audio.original.enabled,true);
 assert.equal(unknown.plans.video.auto[720].size,null);
 const known=mediaChoices({...source,formats:[video,{...audio,averageBitrate:100_000,averageBitrateScope:'format'}]});
 assert.deepEqual(known.plans.video.auto[720].size,{bytes:126_000,approximate:true});
});

test('Extracted audio never treats muxed filesize or nominal audio bitrate as its size',()=>{
 const video={url:'https://cdn/v',height:720,ext:'mp4',videoCodec:'h264',audioCodec:'aac',filesize:1_000_000,audioBitrate:128_000};
 assert.equal(mediaChoices({duration:10,formats:[video]}).plans.audio.original.best.size,null);
 assert.deepEqual(mediaChoices({duration:10,formats:[{...video,audioAverageBitrate:100_000,audioAverageBitrateScope:'track'}]}).plans.audio.original.best.size,{bytes:125_000,approximate:true});
});

test('Invalid size metadata cannot create infinite or negative estimates',()=>{
 for(const invalid of [undefined,0,-1,NaN,Infinity]){
  assert.equal(sizeOf({averageBitrate:invalid,averageBitrateScope:'format'},10),null);
  assert.equal(sizeOf({averageBitrate:100_000,averageBitrateScope:'format'},invalid),null);
 }
 assert.equal(sizeOf({filesize:Infinity},10),null);
 assert.equal(sizeOf({averageBitrate:Number.MAX_VALUE,averageBitrateScope:'format'},Number.MAX_VALUE),null);
 assert.deepEqual(sizeOf({filesize:'12345'},NaN),{bytes:12345,approximate:false});
});
