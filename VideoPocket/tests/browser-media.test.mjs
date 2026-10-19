import test from 'node:test';import assert from 'node:assert/strict';
import {mediaChoices,selectedPlan,metadataCodecs,parseMp4Codecs} from '../extension/browser-media.js';
import {assertComplete} from '../extension/youtube-download.js';
test('Split Bilibili MP4 preserves original codecs and pairs AAC; only real qualities are offered',()=>{
 const s={duration:90,requiresAudio:true,formats:[{id:'v480',url:'https://cdn/v',height:480,videoCodec:'h264',ext:'mp4',bitrate:400000},{id:'v360',url:'https://cdn/v2',height:360,videoCodec:'h264',ext:'mp4',bitrate:180000},{id:'a',url:'https://cdn/a',audioCodec:'aac',ext:'mp4',bitrate:132000}]};
 const c=mediaChoices(s);assert.deepEqual(c.choices.video.auto.heights,[480,360]);assert.equal(selectedPlan(c,{kind:'video',height:360}).audio.id,'a');assert.equal(selectedPlan(c,{kind:'audio',audioQuality:'best'}).ext,'m4a');assert.throws(()=>selectedPlan(c,{kind:'video',height:720}));
});
test('Muxed HLS does not advertise video bandwidth as audio bitrate or download 1080p to extract the same audio',()=>{
 const c=mediaChoices({duration:600,formats:[{id:'hd',segments:[{}],ext:'mp4',height:1080,videoCodec:'h264',audioCodec:'aac',bitrate:6000000},{id:'low',segments:[{}],ext:'mp4',height:180,videoCodec:'h264',audioCodec:'aac',bitrate:300000}]});
 assert.deepEqual(c.choices.audio.original.qualities,['best']);assert.equal(c.plans.audio.original.best.audio.id,'low');assert.equal(c.choices.audio.original.sizes.best,null);
});
test('DRM formats never enter choices, unknown audio is not offered for extraction',()=>{
 const c=mediaChoices({formats:[{url:'https://cdn/x',height:720,ext:'mp4',drm:true},{url:'https://cdn/y',height:360,ext:'mp4'}]});assert.deepEqual(c.choices.video.auto.heights,[360]);assert.equal(c.choices.audio.original.enabled,false);
});
test('Codec metadata is retained for original-container handling',()=>{
 assert.deepEqual(metadataCodecs('video/mp4; codecs="avc1.64001f, mp4a.40.2"'),{videoCodec:'h264',audioCodec:'aac'});assert.equal(parseMp4Codecs(new TextEncoder().encode('moov..avc1...mp4a')).audioCodec,'aac');
});
test('Large sources remain available for both disk merge and extraction without an application size cap',()=>{
 const formats=[{url:'https://cdn/video',height:720,ext:'mp4',videoCodec:'h264',audioCodec:'aac',filesize:2*1024*1024*1024,audioBitrate:128000}];const direct=mediaChoices({duration:1000,formats});assert.equal(direct.choices.video.auto.enabled,true);assert.equal(direct.choices.audio.original.enabled,true);const disk=mediaChoices({duration:1000,formats,forceDisk:true});assert.equal(disk.choices.video.auto.enabled,true);assert.equal(disk.choices.audio.original.enabled,true);
});
test('YouTube completeness requires init data and uninterrupted coverage, not just the last timestamp',()=>{
 const track={formatInitializationMetadata:{endSegmentNumber:3,durationUnits:20000,durationTimescale:1000},downloadedSegments:new Map([[0,{durationMs:0}],[1,{durationMs:5000}],[3,{durationMs:5000}]])};assert.throws(()=>assertComplete(track,20000),/片段不完整/);track.downloadedSegments.set(2,{durationMs:10000});assert.doesNotThrow(()=>assertComplete(track,20000));track.downloadedSegments.delete(0);assert.throws(()=>assertComplete(track,20000),/片段不完整/);
});

test('separate HLS audio follows the selected video rendition group',()=>{
 const source={requiresAudio:true,duration:10,formats:[{id:'v',url:'v',kind:'video',ext:'mp4',videoCodec:'h264',height:360,audioGroup:'correct'},{id:'wrong',url:'wrong',kind:'audio',ext:'mp4',audioCodec:'aac',audioGroup:'other',bitrate:900000},{id:'right',url:'right',kind:'audio',ext:'mp4',audioCodec:'aac',audioGroup:'correct',bitrate:128000}]};
 const c=mediaChoices(source),p=selectedPlan(c,{kind:'video',height:360});assert.equal(p.audio.id,'right');assert.equal(p.direct,false);
});
