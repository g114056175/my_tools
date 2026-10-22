import test from 'node:test';
import assert from 'node:assert/strict';
import { twitchClipSlug, extractTwitchPlayerMetadata, tokenizedTwitchClipUrl, twitchClipManifest } from '../extension/twitch-clips.js';

test('Twitch clip metadata is read from the selected element owner chain', () => {
  const card = { parentElement: null, __reactProps$: { clip: { slug: 'InterestingClip', id: 'c1', title: 'hello', videoQualities: [{ quality: '720p', sourceURL: 'https://clips-media-assets.example/a.mp4' }] } } };
  const video = { parentElement: card };
  const result = extractTwitchPlayerMetadata(video, { url: 'https://www.twitch.tv/twitch/clips?range=7d' });
  assert.equal(result.kind, 'clip'); assert.equal(result.slug, 'InterestingClip'); assert.equal(result.qualities[0].quality, '720p');
});

test('clip URL slug is accepted only as the current page identity and does not scan siblings', () => {
  assert.equal(twitchClipSlug('https://www.twitch.tv/clip/FriendlySlug'), 'FriendlySlug');
  assert.equal(twitchClipSlug('https://www.twitch.tv/twitch/clip/FriendlySlug'), 'FriendlySlug');
  assert.equal(twitchClipSlug('https://clips.twitch.tv/FriendlySlug'), 'FriendlySlug');
  assert.equal(twitchClipSlug('https://clips.twitch.tv/embed?clip=FriendlySlug'), 'FriendlySlug');
  assert.equal(twitchClipSlug('https://www.twitch.tv/embed/x?clip=FriendlySlug'), 'FriendlySlug');
  const video = { parentElement: null };
  const result = extractTwitchPlayerMetadata(video, { url: 'https://www.twitch.tv/streamer/clip/FriendlySlug' });
  assert.equal(result, null);
  const direct = extractTwitchPlayerMetadata(video, { url: 'https://www.twitch.tv/clip/FriendlySlug', playerOwner: true });
  assert.equal(direct.slug, 'FriendlySlug');
});

test('channel trailer VOD identity stays distinct from a nearby clip', () => {
  const video = { parentElement: { parentElement: null, __reactProps$: { player: { video: { __typename: 'Video', id: '2891894094', title: 'Trailer', durationSeconds: 58 } } } } };
  const result = extractTwitchPlayerMetadata(video);
  assert.equal(result.kind, 'vod'); assert.equal(result.id, '2891894094'); assert.equal(result.title, 'Trailer'); assert.equal(result.duration, 58);
});

test('Clip GraphQL response preserves qualities and tokenizes URLs', async () => {
  let request;
  const result = await twitchClipManifest('FriendlySlug', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ data: { clip: { id: 'c1', slug: 'FriendlySlug', title: 'hello', durationSeconds: 4, playbackAccessToken: { signature: 'sig', value: 'tok' }, videoQualities: [{ quality: '1080p', height: 1080, frameRate: 60, sourceURL: 'https://clips-media-assets.example/a.mp4' }] } } }) };
  });
  assert.equal(request.url, 'https://gql.twitch.tv/gql');
  assert.equal(JSON.parse(request.options.body).variables.slug, 'FriendlySlug');
  const parsed = new URL(result.qualities[0].url);
  assert.equal(parsed.searchParams.get('sig'), 'sig'); assert.equal(parsed.searchParams.get('token'), 'tok');
  assert.equal(result.qualities[0].height, 1080);
  assert.equal(tokenizedTwitchClipUrl('blob:https://www.twitch.tv/x', { signature: 's', token: 't' }), '');
});

test('ShareClipRenderStatus uses only primary asset qualities and excludes portrait asset', async () => {
  const result = await twitchClipManifest('AssetSlug', async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.operationName, 'ShareClipRenderStatus');
    assert.equal(body.extensions.persistedQuery.sha256Hash, '2db6a3b20eabf510bd3cf465ae2408834b59eb6b8af89ca73ab1486cacecfb63');
    return { ok: true, json: async () => ({ data: { clip: { slug: 'AssetSlug', playbackAccessToken: { signature: 's', value: 't' }, assets: [ { videoQualities: [{ quality: '720p', frameRate: 30, sourceURL: 'https://cdn.example/landscape.mp4' }] }, { videoQualities: [{ quality: '1080p', frameRate: 30, sourceURL: 'https://cdn.example/portrait.mp4' }] } ] } } }) };
  });
  assert.equal(result.qualities.length, 1);
  assert.equal(result.qualities[0].url.includes('landscape'), true);
});

test('React fiber reads memoized props but stops before multi-video ancestors', () => {
  const fiber = { memoizedProps: { clip: { slug: 'Owned', title: 'ok' } }, return: null };
  const video = { parentElement: null };
  Object.defineProperty(video, '__reactFiber$test', { value: fiber });
  assert.equal(extractTwitchPlayerMetadata(video).slug, 'Owned');
  const outer = { parentElement: null, querySelectorAll: () => [{}, {}], __reactProps$: { clip: { slug: 'Neighbour', title: 'bad' } } };
  const child = { parentElement: outer };
  assert.equal(extractTwitchPlayerMetadata(child), null);
});

test('complete element metadata avoids an unnecessary GraphQL lookup and passes signal/timeout', async () => {
  const complete = { kind: 'clip', slug: 'Known',signature:'sig',token:'token', qualities: [{ url: 'https://cdn.example/a.mp4', height: 720 }] };
  let called = false;
  assert.equal(await twitchClipManifest(complete, async () => { called = true; }), complete);
  assert.equal(called, false);
  const signal = new AbortController().signal; let options;
  await twitchClipManifest('Known', async (_url, request) => { options = request; return { ok: true, json: async () => ({ data: { clip: { slug: 'Known', videoQualities: [] } } }) }; }, { signal });
  assert.ok(options.signal);
});

test('native DOM parentElement is followed and open shadow host is accepted', () => {
  const owner = { tagName: 'DIV', __reactProps$: { clip: { slug: 'NativeOwner', title: 'ok' } }, parentElement: null };
  const video = Object.create({ get parentElement() { return owner; } });
  Object.defineProperty(video, 'parentElement', { configurable: true, get() { return owner; } });
  assert.equal(extractTwitchPlayerMetadata(video).slug, 'NativeOwner');
  const unrelated = { tagName: 'BODY', __reactProps$: { clip: { slug: 'root', title: 'bad' } }, parentElement: null };
  assert.equal(extractTwitchPlayerMetadata({ parentElement: unrelated }), null);
});

test('Clip schema fallback is bounded to one retry and keeps the selected slug',async()=>{
 let calls=0;
 const result=await twitchClipManifest('SelectedSlug',async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.variables.slug,'SelectedSlug');
  return new Response(JSON.stringify(calls===1?{errors:[{message:'PersistedQueryNotFound'}]}:{data:{clip:{slug:'SelectedSlug',assets:[{videoQualities:[{quality:'720',sourceURL:'https://cdn.example/clip.mp4'}]}]}}}));
 });
 assert.equal(calls,2);assert.equal(result.qualities[0].height,720);
});

test('unsigned element qualities must acquire the current clip signature before download',async()=>{
 let called=false;
 const result=await twitchClipManifest({kind:'clip',slug:'Known',qualities:[{url:'https://cdn.example/a.mp4'}]},async()=>{
  called=true;return new Response(JSON.stringify({data:{clip:{slug:'Known',playbackAccessToken:{signature:'new-sig',value:'new-token'},assets:[{videoQualities:[{quality:'720',sourceURL:'https://cdn.example/a.mp4'}]}]}}}));
 });
 assert.equal(called,true);assert.equal(new URL(result.qualities[0].url).searchParams.get('sig'),'new-sig');
});

test('Clip metadata readers cancel oversized bodies without probing another endpoint',async()=>{
 let calls=0,cancelled=false;
 await assert.rejects(twitchClipManifest('SelectedSlug',async()=>{
  calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(262145));},cancel(){cancelled=true;}}));
 }),{code:'SOURCE_UNAVAILABLE'});
 assert.equal(calls,1);assert.equal(cancelled,true);
});

test('a foreign URL or a recommendation list cannot identify the selected Clip',()=>{
 assert.equal(twitchClipSlug('https://other.example/?clip=Neighbour'),'');
 const video={__reactProps$test:{data:[{clip:{slug:'Neighbour',title:'Not the selected clip'}}]}};
 assert.equal(extractTwitchPlayerMetadata(video,{url:'https://www.twitch.tv/twitch/clips'}),null);
});
