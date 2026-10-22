import test from 'node:test';
import assert from 'node:assert/strict';
import { extractXMediaModels, ownedXPlayerMetadata, xMediaPayloadsFromScript, xBroadcastIdFromUrl } from '../extension/x-media.js';

const media = (id, url, extra = {}) => ({ id_str: id, type: 'video', video_info: { variants: [{ content_type: 'video/mp4', url, bitrate: 500000 }, { content_type: 'application/x-mpegURL', url: url.replace('.mp4', '.m3u8') }], duration_millis: 33000, ...extra } });

const broadcastCard=(post,bid='broadcast-123')=>({rest_id:post,legacy:{full_text:'Selected broadcast'},card:{legacy:{binding_values:Object.entries({broadcast_id:bid,broadcast_url:'https://x.com/i/broadcasts/'+bid,broadcast_media_key:'28_123456789',broadcast_media_id:'123456789',broadcast_title:'Replay title'}).map(([key,string_value])=>({key,value:{string_value}}))}}});

test('broadcast cards bind the post, broadcast and media IDs without claiming a source',()=>{
 const [model]=extractXMediaModels(broadcastCard('post-123'));
 assert.deepEqual(model.aliases,['broadcast-123','28_123456789','post-123','123456789']);
 assert.equal(model.broadcastId,'broadcast-123');assert.equal(model.title,'Replay title');assert.equal(model.bindingOnly,true);assert.equal(model.manifestUrl,undefined);
 const [query]=extractXMediaModels({data:{broadcast_by_rest_id:{broadcast_id:'broadcast-123',media_key:'28_123456789',status:'Replay title',width:1280,height:720}}});
 assert.ok(query.aliases.includes('123456789'));assert.equal(query.height,720);
});

test('quoted broadcast cards retain their own post and ambiguous broadcast links have no post alias',()=>{
 const quoted=broadcastCard('inner-post');
 const models=extractXMediaModels({rest_id:'outer-post',legacy:{full_text:'Outer'},quoted_status_result:{result:quoted}});
 assert.equal(models.length,1);assert.ok(!models[0].aliases.includes('outer-post'));assert.ok(models[0].aliases.includes('inner-post'));
 const ambiguous={rest_id:'multiple-post',legacy:{entities:{urls:[{expanded_url:'https://x.com/i/broadcasts/broadcast-123'},{expanded_url:'https://x.com/i/broadcasts/broadcast-456'}]}}};
 assert.equal(extractXMediaModels(ambiguous).length,0);
 const mismatch=broadcastCard('wrong');mismatch.card.legacy.binding_values.find(v=>v.key==='broadcast_url').value.string_value='https://x.com/i/broadcasts/other-broadcast';
 assert.equal(extractXMediaModels(mismatch).length,0);
});

test('React streamed X metadata is decoded as data across separate scripts without executing JavaScript',()=>{
 const payload={data:{tweet_result:{result:broadcastCard('streamed-post')}}};
 const source='$_TSR.x.push({kind:"Result.Ok",value:'+JSON.stringify(JSON.stringify(payload))+'});throw new Error("must not run");';
 assert.deepEqual(xMediaPayloadsFromScript(source),[payload]);
 assert.equal(xMediaPayloadsFromScript('const request={name:"BroadcastQuery"}').length,0);
 assert.equal(xMediaPayloadsFromScript('value:"not valid broadcast_id JSON"').length,0);
 assert.equal(xMediaPayloadsFromScript('x'.repeat(1024*1024+1)+source).length,0);
 assert.equal(xBroadcastIdFromUrl('https://x.com/i/broadcasts/broadcast-123'),'broadcast-123');
 for(const url of ['https://evil.example/i/broadcasts/broadcast-123','https://x.com.evil.example/i/broadcasts/broadcast-123','https://user@x.com/i/broadcasts/broadcast-123'])assert.equal(xBroadcastIdFromUrl(url),'');
});

test('X animated GIF metadata retains its real MP4 rendition',()=>{
 const gif={id_str:'gif-1',type:'animated_gif',video_info:{variants:[{content_type:'video/mp4',url:'https://video.example/tweet_video/loop.mp4',bitrate:0}]}};
 const [model]=extractXMediaModels({rest_id:'gif-post',legacy:{extended_entities:{media:[gif]}}});
 assert.equal(model.versions[0].contentType,'video/mp4');assert.equal(model.versions[0].url.endsWith('.mp4'),true);
});

test('extracts one legacy video and adds its tweet alias', () => {
  const [m] = extractXMediaModels({ rest_id: 'tweet-1', legacy: { id_str: 'tweet-1', full_text: 'tweet body', extended_entities: { media: [media('media-1', 'https://video.example/a.mp4')] } } });
  assert.deepEqual(m.aliases, ['media-1', 'tweet-1']); assert.equal(m.provider, 'x'); assert.equal(m.ownerPostId, 'tweet-1');
  assert.equal(m.duration, 33); assert.equal(m.manifestType, 'hls'); assert.equal(m.versions[0].bitrate, 500000);
  assert.equal(m.title, 'tweet body'); assert.equal(m.versions.some(v => /m3u8/.test(v.url)), false);
});

test('quoted tweet has its own owner and outer tweet is never borrowed', () => {
  const value = { rest_id: 'outer', legacy: { id_str: 'outer', extended_entities: { media: [media('outer-media', 'https://video.example/o.mp4')] }, quoted_status_result: { result: { rest_id: 'quoted', legacy: { id_str: 'quoted', extended_entities: { media: [media('quoted-media', 'https://video.example/q.mp4')] } } } } } };
  const result = extractXMediaModels(value); const quoted = result.find(m => m.aliases.includes('quoted-media'));
  assert.equal(quoted.ownerPostId, 'quoted'); assert.equal(quoted.aliases.includes('outer'), false);
});

test('multiple videos in one tweet do not use tweet ID as unique media identity', () => {
  const result = extractXMediaModels({ rest_id: 'tweet', legacy: { extended_entities: { media: [media('a', 'https://video.example/a.mp4'), media('b', 'https://video.example/b.mp4')] } } });
  assert.equal(result.length, 2); assert.ok(result.every(m => !m.aliases.includes('tweet')));
});

test('entities duplicate is deduplicated and live HLS remains a manifest', () => {
  const item = media('live-media', 'https://video.example/live.m3u8', { variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.example/live.m3u8' }] });
  const [m] = extractXMediaModels({ rest_id: 'live-post', legacy: { entities: { media: [item] }, extended_entities: { media: [item] } } });
  assert.equal(m.versions.length, 0); assert.equal(m.manifestUrl, 'https://video.example/live.m3u8');
});

test('thumbnail URL is never used as title and nested standalone media is emitted once', () => {
  const item = media('nested-media', 'https://video.example/nested.mp4'); item.media_url_https = 'https://pbs.twimg.example/thumb.jpg';
  const result = extractXMediaModels({ player: { config: { media: item } } });
  assert.equal(result.length, 1); assert.equal(result[0].title, undefined);
});

test('player helper reads nearest props without invoking getters', () => {
  let reads = 0; const props = {}; Object.defineProperty(props, 'videoId', { enumerable: true, get() { reads++; throw new Error('getter'); } });
  const video = {}; Object.defineProperty(video, '__reactProps$fixture', { value: { videoId: 'media-1', nested:props,media:media('media-1','https://video.example/main.mp4') } });
  Object.defineProperty(video.__reactProps$fixture.media,'unused',{enumerable:true,get(){reads++;throw Error('getter');}});
  assert.deepEqual(ownedXPlayerMetadata(video).ids, ['media-1']); assert.equal(reads, 0);
});

test('a standalone media descriptor is unique even at the root',()=>{
 assert.equal(extractXMediaModels(media('single','https://video.example/single.mp4')).length,1);
});

test('player helper stops at multi-video fiber host and does not borrow its sibling payload', () => {
  const siblingHost = { nodeType: 1, querySelectorAll: () => [{}, {}] };
  const fiber = { memoizedProps: { videoId: 'outer', video_info: { variants: [{ url: 'https://video.example/outer.mp4' }] } }, stateNode: siblingHost, return: null };
  const video = { nodeType: 1, querySelectorAll: () => [{}] };
  Object.defineProperty(video, '__reactFiber$fixture', { value: { memoizedProps: { videoId: 'nearest' }, stateNode: null, return: fiber } });
  assert.deepEqual(ownedXPlayerMetadata(video).ids, ['nearest']);
});

test('broadcast mapping is binding-only until the matching live status response arrives', () => {
  const metadata = { broadcasts: { 'broadcast-1': { id: 'broadcast-1', media_key: '7_abc' } } };
  const pending = extractXMediaModels(metadata);
  assert.equal(pending.length, 1); assert.deepEqual(pending[0].aliases, ['broadcast-1', '7_abc']); assert.equal(pending[0].bindingOnly, true); assert.equal(pending[0].versions.length, 0);
  const ready = extractXMediaModels({ source: { noRedirectPlaybackUrl: 'https://video.twimg.example/live.m3u8' } }, { baseUrl: 'https://x.com/i/api/live_video_stream/status/7_abc' });
  assert.equal(ready[0].bindingOnly, false); assert.equal(ready[0].manifestUrl, 'https://video.twimg.example/live.m3u8'); assert.ok(ready[0].aliases.includes('7_abc'));
});

test('live status cannot borrow a different media key or arbitrary source.location', () => {
  const wrongKey = extractXMediaModels({ broadcasts: [{ id: 'b', media_key: '7_right' }], source: { noRedirectPlaybackUrl: 'https://video.twimg.example/wrong.m3u8' } }, { baseUrl: 'https://x.com/i/api/live_video_stream/status/7_wrong' });
  assert.equal(wrongKey.length, 1); assert.equal(wrongKey[0].bindingOnly, true);
  const arbitrary = extractXMediaModels({ source: { location: 'https://video.twimg.example/live.m3u8' } }, { baseUrl: 'https://api.example/live_video_stream/status/7_abc' });
  assert.equal(arbitrary.length, 0);
});

test('broadcast metadata is parsed before status payload and only HTTP HLS is retained', () => {
  const value = { broadcasts: [{ id: 'b', media_key: 'm' }], source: { location: 'javascript:alert(1)' } };
  const result = extractXMediaModels(value, { baseUrl: 'https://twitter.com/i/api/live_video_stream/status/m' });
  assert.equal(result.length, 1); assert.equal(result[0].bindingOnly, true); assert.equal(result[0].manifestUrl, undefined);
});
