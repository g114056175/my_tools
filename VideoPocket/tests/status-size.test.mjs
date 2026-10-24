import test from 'node:test';import assert from 'node:assert/strict';
import {formatBytes,formatSize} from '../extension/sizes.js';
import {visibleJobs,jobLabel} from '../extension/jobs.js';
import {sourceSize,videoSize,audioSize,progressTracker} from '../native/sizes.mjs';
import {buildCapabilities} from '../native/capabilities.mjs';
test('KB/MB/GB use one decimal and rounding promotes the next unit',()=>{
  assert.equal(formatSize({bytes:123.4*1024**2,approximate:false}),'約 123.4 MB');
  assert.equal(formatBytes(1536),'1.5 KB');assert.equal(formatBytes(1.25*1024**2),'1.3 MB');assert.equal(formatBytes(3*1024**3),'3.0 GB');assert.equal(formatBytes(1024**2-1),'1.0 MB');assert.equal(formatBytes(NaN),null);assert.equal(formatSize(null),'大小未知');assert.equal(formatSize({bytes:2048,approximate:true}),'約 2.0 KB');
});
test('Exact filesize wins, otherwise use approximate size or duration/bitrate',()=>{
  assert.deepEqual(sourceSize({filesize:1000,filesize_approx:2000,tbr:500},10),{bytes:1000,approximate:false});assert.deepEqual(sourceSize({filesize_approx:2000},10),{bytes:2000,approximate:true});assert.equal(sourceSize({tbr:800},10).bytes,1000000);assert.equal(sourceSize({},10),null);
});
test('Merged video combines separate streams, extraction excludes video bytes',()=>{
  const v={filesize:8000},a={filesize:2000};assert.deepEqual(videoSize(v,a,1),{bytes:10000,approximate:true});assert.equal(videoSize(v,{},1),null);assert.equal(audioSize({filesize:900000,abr:64,acodec:'aac'},'original','best',10,true).bytes,80000);
});
test('Fixed audio output estimates follow quality, best variable MP3 is unknown',()=>{
  const a={acodec:'opus'};assert.equal(audioSize(a,'mp3','128',60).bytes,960000);assert.equal(audioSize(a,'mp3','320',60).bytes,2400000);assert.equal(audioSize(a,'m4a','best',60).bytes,1440000);assert.equal(audioSize(a,'mp3','best',60),null);assert.equal(audioSize(a,'m4a','192',null),null);
});
test('Capability sizes correspond to the selected height and audio quality',()=>{
  const f=(id,height,bytes)=>({format_id:id,vcodec:'h264',acodec:'aac',height,ext:'mp4',url:'https://example.com/'+id,filesize:bytes,abr:64});
  const c=buildCapabilities([f('a',360,100000),f('b',720,300000)],{muxers:['mp4','matroska','mp3','ipod'],encoders:['aac','libmp3lame'],decoders:['aac']},60);
  assert.equal(c.choices.video.mp4.sizes[0].bytes,300000);assert.equal(c.choices.video.mp4.sizes[360].bytes,100000);assert.equal(c.choices.audio.mp3.sizes[128].bytes,960000);
});
test('Progress combines two streams instead of resetting after the video',()=>{
  const tracker=progressTracker({selector:'v+a'},[{format_id:'v',filesize:800},{format_id:'a',filesize:200}],10);assert.equal(tracker('v',50),40);assert.equal(tracker('v',100),80);assert.equal(tracker('a',50),90);assert.equal(tracker('a',100),100);assert.equal(tracker('a',NaN),null);
  const unknown=progressTracker({selector:'v+a'},[{format_id:'a',filesize:200}],10);assert.equal(unknown('v',50),25);
});
test('Terminal notifications expire and do not reappear in a new popup',()=>{
  const jobs=[{id:'old',state:'done',finishedAt:900},{id:'new',state:'done',finishedAt:1100},{id:'queue',state:'queued',createdAt:1},{id:'running',state:'running',createdAt:2}];
  assert.deepEqual(visibleJobs(jobs,1000,1200).map(j=>j.id),['running','queue','new']);assert.deepEqual(visibleJobs(jobs,1000,5200).map(j=>j.id),['running','queue']);assert.equal(jobLabel({state:'queued'}),'等待中');
});
