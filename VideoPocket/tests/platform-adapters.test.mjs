import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramMediaSnapshot } from '../extension/instagram-adapter.js';
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

test('page snapshot exposes the Twitch VOD manifest, not the empty MSE source', async () => {
  const video = { currentSrc:'',src:'',textTracks:[],duration:20,mediaKeys:null,hasAttribute:()=>false,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null };
  globalThis.location={href:'https://www.twitch.tv/videos/2891894094',pathname:'/videos/2891894094',hostname:'www.twitch.tv'};
  globalThis.window={};globalThis.performance={getEntriesByType:()=>[]};
  globalThis.document={title:'VOD',documentElement:{lang:'en'},scripts:[],querySelectorAll:selector=>selector==='video'?[video]:[],querySelector:()=>null};
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async url=>{assert.equal(url,'https://gql.twitch.tv/gql');return {ok:true,json:async()=>({data:{videoPlaybackAccessToken:{value:'test-token',signature:'test-sig'}}})};};
    const snapshot=await pageSnapshot(0);
    assert.equal(snapshot.platform.site,'twitch');assert.equal(snapshot.platform.id,'2891894094');
    assert.equal(new URL(snapshot.videos[0].downloadUrl).pathname,'/vod/2891894094.m3u8');
  } finally {globalThis.fetch=previous;}
});
