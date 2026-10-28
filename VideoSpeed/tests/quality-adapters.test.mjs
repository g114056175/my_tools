import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreferredQuality, chooseHeight } from '../src/quality-adapters.js';

test('media identity or policy invalidation between adapters cancels the pending setter',async()=>{
 let current=true,writes=0;
 const player={getAvailableQualityLevels:()=>['hd1080'],setPlaybackQualityRange:()=>writes++};
 const video={parentElement:player,videoWidth:1920,videoHeight:1080};
 const pending=applyPreferredQuality(video,1080,{}, {isCurrent:()=>current});current=false;
 assert.equal((await pending).reason,'cancelled');assert.equal(writes,0);
});

test('chooseHeight prefers exact 1080', () => assert.equal(chooseHeight([360, 1080, 2160]), 1080));
test('chooseHeight follows the nearest lower available quality', () => {assert.equal(chooseHeight([360,720]),720);assert.equal(chooseHeight([720,2160],1080),720);assert.equal(chooseHeight([720,1080],240),720);});
test('chooseHeight handles one quality and no qualities', () => {
  assert.equal(chooseHeight([480], 1080), 480);
  assert.equal(chooseHeight([]), undefined);
});

test('YouTube only controls the selected video owner', async () => {
  const video = { parentElement: null, videoWidth: 1920, videoHeight: 1080 };
  const other = { contains: () => false, getAvailableQualityLevels: () => ['hd1080'] };
  const player = {
    contains: (candidate) => candidate === video,
    getAvailableQualityLevels: () => ['hd720', 'hd1080'],
    setPlaybackQuality: (quality) => { player.current = quality; },
    getPlaybackQuality: () => player.current,
  };
  const document = { querySelector: (selector) => selector === '#movie_player' ? other : selector === '#player' ? player : null };
  const result = await applyPreferredQuality(video, 1080, { document });
  assert.equal(result.status, 'applied');
  assert.equal(result.adapter, 'youtube');
});

test('YouTube preserves the original level string and range setter arguments', async () => {
  const video = { parentElement: null, videoWidth: 1280, videoHeight: 720 };
  const player = {
    contains: (candidate) => candidate === video,
    getAvailableQualityLevels: () => ['hd2160', 'hd720'],
    setPlaybackQualityRange: (from, to) => { player.current = from; player.range = [from, to]; },
    getPlaybackQuality: () => player.current,
  };
  const result = await applyPreferredQuality(video, 1080, { document: { querySelector: (s) => s === '#player' ? player : null } });
  assert.equal(result.status, 'applied');
  assert.deepEqual(player.range, ['hd720', 'hd720']);
});

test('unsupported video is explicit and does not claim applied', async () => {
  const result = await applyPreferredQuality({ videoHeight: 720 }, 1080, { document: {} });
  assert.equal(result.status, 'unsupported');
  assert.notEqual(result.status, 'applied');
});

test('quality fallback reports the height actually requested', async () => {
  const video = { videoHeight: 360 };
  video.hls = { media: video, levels: [{ height: 480 }, { height: 720 }], currentLevel: -1 };
  const result = await applyPreferredQuality(video, 1080, {});
  assert.equal(result.status, 'requested');assert.equal(result.requestedHeight, 720);
});

test('hls.js requires media identity and actual video height', async () => {
  const video = { videoHeight: 720 };
  video.hls = { media: video, levels: [{ height: 720 }, { height: 1080 }], currentLevel: -1 };
  const result = await applyPreferredQuality(video, 1080, { document: {} });
  assert.equal(result.status, 'requested');
  assert.equal(result.adapter, 'hls.js');
});

test('Bilibili maps QN and only applies after selection plus videoHeight readback', async () => {
  const container = { className: 'bpx-player-container', contains: (node) => node === video };
  const video = { videoHeight: 2160, parentElement: container };
  const makeItem = (value, text, classes = '') => ({
    dataset: { value: String(value) }, textContent: text, className: classes,
    click() { this.className = `${this.className} selected`; },
    getAttribute(name) { return name === 'aria-checked' && this.className.includes('selected') ? 'true' : null; },
  });
  const disabled = makeItem(80, '1080P', 'vip');
  const qn2160 = makeItem(120, '', '');
  container.querySelectorAll = () => [disabled, qn2160];
  const result = await applyPreferredQuality(video, 1080, { document: {}, location: { hostname: 'www.bilibili.com' } });
  assert.equal(result.adapter, 'bilibili');
  assert.equal(result.status, 'applied');
  assert.equal(result.selectedHeight, 2160);
  assert.equal(disabled.className, 'vip');
});

test('Bilibili selection without matching videoHeight stays requested', async () => {
  const video = { videoHeight: 720 };
  const container = { className: 'bpx-player-container', contains: (node) => node === video };
  video.parentElement = container;
  const item = { dataset: { value: '80' }, textContent: '1080P', className: '',
    click() { this.className = 'selected'; }, getAttribute(name) { return name === 'aria-checked' ? 'true' : null; } };
  container.querySelectorAll = () => [item];
  const result = await applyPreferredQuality(video, 1080, { location: { hostname: 'bilibili.com' } });
  assert.equal(result.status, 'requested');
});


test('best quality chooses highest without changing saved preference',()=>{
 assert.equal(chooseHeight([720,1080,2160],0),2160);
});
test('read-only inspection lists capabilities without calling setters',async()=>{
 const {inspectQuality}=await import('../src/quality-adapters.js');let calls=0;
 const video={parentElement:null},player={contains:item=>item===video,getAvailableQualityLevels:()=>['hd720','hd1080'],setPlaybackQuality:()=>{calls++;}};
 const capabilities=inspectQuality(video,{document:{querySelector:()=>player}});
 assert.deepEqual(capabilities.availableHeights,[720,1080]);assert.equal(calls,0);
});
test('YouTube prefers one range call when both setters exist and confirms rendered height',async()=>{
 const video={parentElement:null,videoWidth:256,videoHeight:144};let legacyCalls=0,rangeCalls=0;
 const player={contains:item=>item===video,getAvailableQualityLevels:()=>['hd1080'],setPlaybackQuality:()=>{legacyCalls++;},setPlaybackQualityRange:(from,to)=>{rangeCalls++;player.range=[from,to];video.videoWidth=1920;video.videoHeight=1080;}};
 const result=await applyPreferredQuality(video,1080,{document:{querySelector:()=>player}});
 assert.equal(legacyCalls,0);assert.equal(rangeCalls,1);assert.deepEqual(player.range,['hd1080','hd1080']);assert.equal(result.status,'applied');assert.equal(result.selectedHeight,1080);
});

test('YouTube legacy setter no-op is not applied even when player readback claims the target',async()=>{
 const video={parentElement:null,videoWidth:256,videoHeight:144};let calls=0;
 const player={contains:item=>item===video,getAvailableQualityLevels:()=>['tiny','hd720','hd1080'],setPlaybackQuality:()=>{calls++;},getPlaybackQuality:()=> 'hd1080'};
 const result=await applyPreferredQuality(video,1080,{document:{querySelector:()=>player}});
 assert.equal(calls,1);assert.equal(result.status,'requested');assert.equal(result.selectedHeight,144);assert.equal(result.requestedHeight,1080);
});

test('YouTube defers tiny-only levels when matching local stream metadata shows a better quality',async()=>{
 const video={parentElement:null,videoWidth:256,videoHeight:144};let levels=['tiny'],rangeCalls=0;
 const player={contains:item=>item===video,getAvailableQualityLevels:()=>levels,getVideoData:()=>({video_id:'video-new'}),getPlayerResponse:()=>({videoDetails:{videoId:'video-new'},streamingData:{adaptiveFormats:[{width:1920,height:1080}]}}),setPlaybackQualityRange:(from,to)=>{rangeCalls++;video.videoWidth=1920;video.videoHeight=1080;}};
 const target={document:{querySelector:()=>player},location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=video-new'}};
 const pending=await applyPreferredQuality(video,1080,target);
 assert.equal(pending.status,'unavailable');assert.deepEqual(pending.availableHeights,[144]);assert.equal(rangeCalls,0);
 levels=['tiny','hd1080'];
 const retried=await applyPreferredQuality(video,1080,target);
 assert.equal(retried.status,'applied');assert.equal(rangeCalls,1);assert.equal(retried.selectedHeight,1080);
});

test('YouTube ignores stream metadata when its video identity is stale',async()=>{
 const video={parentElement:null,videoWidth:256,videoHeight:144};let calls=0;
 const player={contains:item=>item===video,getAvailableQualityLevels:()=>['tiny','hd1080'],getVideoData:()=>({video_id:'video-new'}),getPlayerResponse:()=>({videoDetails:{videoId:'video-old'},streamingData:{adaptiveFormats:[{width:1920,height:1080}]}}),setPlaybackQualityRange:()=>{calls++;}};
 const target={document:{querySelector:()=>player},location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=video-new'}};
 const result=await applyPreferredQuality(video,1080,target);
 assert.equal(result.status,'unavailable');assert.equal(calls,0);
});

test('YouTube route identity rejects a locally matching but stale player response',async()=>{
 const video={parentElement:null,videoWidth:256,videoHeight:144};let calls=0;
 const player={contains:item=>item===video,getAvailableQualityLevels:()=>['tiny','hd1080'],getVideoData:()=>({video_id:'video-old'}),getPlayerResponse:()=>({videoDetails:{videoId:'video-old'},streamingData:{adaptiveFormats:[{width:1920,height:1080}]}}),setPlaybackQualityRange:()=>{calls++;}};
 const target={document:{querySelector:()=>player},location:{hostname:'www.youtube.com',href:'https://www.youtube.com/watch?v=video-new'}};
 const result=await applyPreferredQuality(video,1080,target);
 assert.equal(result.status,'unavailable');assert.equal(calls,0);
});

test('YouTube quality-list read errors stay retryable and never call a setter',async()=>{
 const video={parentElement:null,videoWidth:256,videoHeight:144};let calls=0;
 const player={contains:item=>item===video,getAvailableQualityLevels:()=>{throw Error('player is loading');},setPlaybackQualityRange:()=>{calls++;}};
 const result=await applyPreferredQuality(video,1080,{document:{querySelector:()=>player}});
 assert.equal(result.status,'unavailable');assert.equal(calls,0);
});

test('portrait HLS quality uses the short edge for both selection and readback',async()=>{
 const video={videoWidth:720,videoHeight:1280};
 video.hls={media:video,levels:[{width:360,height:640},{width:720,height:1280}],currentLevel:-1};
 const result=await applyPreferredQuality(video,720,{});
 assert.equal(result.status,'applied');assert.equal(result.selectedHeight,720);assert.deepEqual(result.availableHeights,[360,720]);
});
