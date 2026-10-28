import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramMediaSnapshot } from '../research/platforms/instagram-adapter.js';
import { twitchVodId, twitchVodManifest } from '../extension/twitch-adapter.js';
import { pageSnapshot } from '../extension/page.js';

test('Instagram adapter selects only the current shortcode Polaris media', () => {
  const product = { code: 'DeQqiYSO5od', video_duration: 12.5, original_width: 1080, original_height: 1920, video_versions: [{ type: 101, url: 'https://cdninstagram.com/low.mp4', width: 360, height: 640 }, { type: 103, url: 'https://cdninstagram.com/high.mp4', width: 1080, height: 1920 }] };
  const document = { querySelectorAll: () => [{ textContent: JSON.stringify({ require: [{ __bbox: { result: { data: { xig_polaris_media: { if_not_gated_logged_out: product } } } } }] }) }] };
  const result = instagramMediaSnapshot(document, 'DeQqiYSO5od');
  assert.equal(result.versions[0].url, 'https://cdninstagram.com/high.mp4');
  assert.equal(result.media.video_duration, 12.5);
});

test('Twitch adapter obtains a VOD token and builds the upstream usher manifest URL', async () => {
  assert.equal(twitchVodId('https://www.twitch.tv/videos/2891894094'), '2891894094');
  let request;
  const result = await twitchVodManifest('https://www.twitch.tv/videos/2891894094', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ data: { videoPlaybackAccessToken: { value: 'token', signature: 'sig' } } }) };
  });
  assert.equal(new URL(result.url).pathname, '/vod/2891894094.m3u8');
  assert.equal(new URL(result.url).searchParams.get('token'), 'token');
  assert.equal(request.url, 'https://gql.twitch.tv/gql');
});

test('serialized page snapshot keeps Instagram adapter output after generic source scan', async () => {
  const product = { code: 'DeQqiYSO5od', video_duration: 12, original_width: 1080, original_height: 1920, video_versions: [{ type: 101, url: 'https://cdninstagram.com/reel.mp4' }], video_dash_manifest: '<MPD />' };
  const script = { textContent: JSON.stringify({ require: [{ __bbox: { result: { data: { xig_polaris_media: { if_not_gated_logged_out: product } } } } }] }) };
  const video = { currentSrc: 'blob:https://www.instagram.com/blob', src: '', textTracks: [], player: null, mediaKeys: null, hasAttribute: () => false, getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [], closest: () => null };
  globalThis.location = { href: 'https://www.instagram.com/reel/DeQqiYSO5od/', pathname: '/reel/DeQqiYSO5od/' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['en-US'] } });
  globalThis.performance = { getEntriesByType: () => [] };
  globalThis.window = {};
  globalThis.document = {
    title: 'Instagram', documentElement: { lang: 'en' }, scripts: [],
    querySelectorAll: selector => selector.includes('script') ? [script] : selector === '*' ? [] : [video],
    querySelector: selector => selector === 'video' ? video : null,
  };
  const page = await pageSnapshot(0);
  assert.equal(page.platform.site, 'instagram');
  assert.equal(page.platform.manifestXml, '<MPD />');
  assert.equal(page.videos[0].downloadUrl, 'https://cdninstagram.com/reel.mp4');
});

test('page snapshot identifies Twitch VOD without calling page fetch', async () => {
  const video = { currentSrc:'',src:'',textTracks:[],duration:20,mediaKeys:null,hasAttribute:()=>false,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null };
  globalThis.location={href:'https://www.twitch.tv/videos/2891894094',pathname:'/videos/2891894094',hostname:'www.twitch.tv'};
  globalThis.window={};globalThis.performance={getEntriesByType:()=>[]};
  globalThis.document={title:'VOD',documentElement:{lang:'en'},scripts:[],querySelectorAll:selector=>selector==='video'?[video]:[],querySelector:()=>null};
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{throw new Error('page fetch must not be used');};
    const snapshot=await pageSnapshot(0);
    assert.equal(snapshot.platform.site,'twitch');assert.equal(snapshot.platform.id,'2891894094');
    assert.equal(snapshot.videos[0].downloadUrl,location.href);
    assert.equal(snapshot.videos[0].mediaIdentity,'twitch-vod:2891894094');
    const ad={...video,src:'https://ads.example/ad.mp4',currentSrc:'https://ads.example/ad.mp4'};
    video.closest=selector=>selector==='[data-a-target="video-player"]'?{}:null;
    document.querySelectorAll=selector=>selector==='video'?[video,ad]:[];
    const multiple=await pageSnapshot(0);assert.equal(multiple.platform.id,'2891894094');assert.equal(multiple.videos[1].downloadUrl,ad.src);
    const selectedAd=await pageSnapshot(1);assert.equal(selectedAd.platform,undefined);
    document.querySelectorAll=selector=>selector==='video'?[ad,video]:[];
    const adFirst=await pageSnapshot(0);assert.equal(adFirst.platform,undefined);assert.equal(adFirst.videos[1].mediaIdentity,'twitch-vod:2891894094');assert.equal(adFirst.videos[1].downloadUrl,location.href);
    const replacement={...video};document.querySelectorAll=selector=>selector==='video'?[video,replacement,ad]:[];
    const switching=await pageSnapshot(1);assert.equal(switching.platform.id,'2891894094');assert.equal(switching.videos[0].mediaIdentity,switching.videos[1].mediaIdentity);
    document.querySelectorAll=()=>[];const beforeMount=await pageSnapshot(0);assert.equal(beforeMount.videos.length,1);assert.equal(beforeMount.platform.id,'2891894094');
  } finally {globalThis.fetch=previous;}
});

test('Twitch token failures preserve HTTP, GraphQL and timeout causes',async()=>{
 const url='https://www.twitch.tv/videos/2891894094';
 await assert.rejects(twitchVodManifest(url,async()=>({ok:false,status:403})),e=>e.status===403);
 await assert.rejects(twitchVodManifest(url,async()=>({ok:true,json:async()=>({errors:[{extensions:{code:'FORBIDDEN'}}]})})),e=>e.code==='HTTP_AUTH');
 await assert.rejects(twitchVodManifest(url,async()=>({ok:true,json:async()=>({data:{videoPlaybackAccessToken:null}})})),e=>e.code==='SOURCE_UNAVAILABLE');
 await assert.rejects(twitchVodManifest(url,async()=>({ok:true,json:async()=>({errors:{}})})),e=>e.code==='SOURCE_UNAVAILABLE');
 await assert.rejects(twitchVodManifest(url,async()=>{throw Object.assign(new Error(),{name:'TimeoutError'});}),e=>e.code==='NETWORK_TIMEOUT');
 await assert.rejects(twitchVodManifest(url,async()=>({ok:true,json:async()=>{throw new SyntaxError();}})),e=>e.code==='SOURCE_UNAVAILABLE');
});

test('blank frame titles fall back to a source filename instead of blank options',async()=>{
 const video={currentSrc:'https://cdn.example/flower.webm',src:'',textTracks:[],mediaKeys:null,hasAttribute:()=>false,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null};
 globalThis.location={href:'https://example.test/frame',hostname:'example.test',pathname:'/frame'};globalThis.window={};globalThis.performance={getEntriesByType:()=>[]};
 globalThis.document={title:'  ',documentElement:{lang:'en'},scripts:[],querySelectorAll:s=>s==='video'?[video]:[],querySelector:()=>null};
 const snapshot=await pageSnapshot();assert.equal(snapshot.videos[0].title,'flower');
 video.currentSrc='';const noName=await pageSnapshot();assert.equal(noName.videos[0].title,'Video 1');
});
