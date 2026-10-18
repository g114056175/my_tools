import test from 'node:test';
import assert from 'node:assert/strict';
import {pageSubtitles} from '../extension/page.js';

const VIDEO_ID = 'abcdefghijk';

function responseBody(text, ok = true, status = 200) {
  return {ok, status, url: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}`, text: async () => text};
}

function youtubeWorld({tracks, fetchResult, activeTrack = null, selector = {}, fetchImpl} = {}) {
  const calls = [];
  const controls = {play: 0, pause: 0, load: 0};
  const video = {currentSrc: 'blob:https://www.youtube.com/media', src: '', textTracks: [], querySelectorAll: () => [], play: () => controls.play++, pause: () => controls.pause++, load: () => controls.load++};
  const player = {
    contains: node => node === video,
    querySelector: name => name === 'video' ? video : null,
    getPlayerResponse: () => ({videoDetails: {videoId: VIDEO_ID, lengthSeconds: '120'}, captions: {playerCaptionsTracklistRenderer: {captionTracks: tracks}}}),
    getOption: () => activeTrack,
    setOption: () => {throw new Error('must not change player caption state');},
    loadModule: () => {throw new Error('must not load caption module');},
    unloadModule: () => {throw new Error('must not unload caption module');}
  };
  const document = {
    querySelector: name => name === '#movie_player' ? player : null,
    querySelectorAll: name => name === 'video' ? [video] : [],
    scripts: []
  };
  const old = {document: globalThis.document, location: globalThis.location, window: globalThis.window, fetch: globalThis.fetch};
  globalThis.document = document;
  globalThis.location = {href: `https://www.youtube.com/watch?v=${VIDEO_ID}`, origin: 'https://www.youtube.com', hostname: 'www.youtube.com', pathname: '/watch', search: `?v=${VIDEO_ID}`};
  globalThis.window = {ytInitialPlayerResponse: undefined, ytcfg: {get: () => undefined}};
  globalThis.fetch = fetchImpl || (async url => {calls.push(String(url)); return typeof fetchResult === 'function' ? fetchResult(url) : fetchResult;});
  return {calls, controls, selector: {pageSource: 'youtube-page', videoId: VIDEO_ID, pageTrackId: selector.pageTrackId, ...selector}, restore() {Object.assign(globalThis, old);}};
}

const track = (vssId, languageCode, name, extra = {}) => ({
  vssId, languageCode, name: {simpleText: name}, baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=${languageCode}&name=${encodeURIComponent(name)}${extra.kind ? '&kind=asr' : ''}`,
  ...extra
});

test('multiple original tracks can be fetched while player captions are closed', async () => {
  const tracks = [track('en-main', 'en', 'English'), track('zh-main', 'zh-TW', '中文（台灣）')];
  const world = youtubeWorld({tracks, fetchResult: responseBody('{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"台灣字幕"}]}]}'), selector: {pageTrackId: 'zh-main'}});
  try {
    const result = await pageSubtitles('zh-TW', true, 0, false, world.selector);
    assert.equal(JSON.parse(result.raw).events[0].segs[0].utf8, '台灣字幕');
    assert.equal(result.language, 'zh-TW');
    assert.match(world.calls[0], /lang=zh-TW/);
  } finally { world.restore(); }
});

test('selected vssId survives list reordering while the player is displaying another language', async () => {
  const tracks = [track('zh-main', 'zh-TW', '中文（台灣）'), track('en-main', 'en', 'English')];
  const world = youtubeWorld({tracks, activeTrack: tracks[0], fetchResult: responseBody('{"events":[{"tStartMs":1000,"dDurationMs":1000,"segs":[{"utf8":"正確來源"}]}]}'), selector: {pageTrackId: 'en-main',pageTrackIndex:0}});
  try {
    const result = await pageSubtitles('en', true, 0, false, world.selector);
    assert.equal(JSON.parse(result.raw).events[0].segs[0].utf8, '正確來源');
    assert.match(world.calls[0], /lang=en/);
    assert.doesNotMatch(world.calls[0], /zh-TW/);
  } finally { world.restore(); }
});

test('same-language author variants require the exact selected vssId', async () => {
  const tracks = [track('zh-author-a', 'zh-TW', '作者版 A'), track('zh-author-b', 'zh-TW', '作者版 B')];
  const world = youtubeWorld({tracks, fetchResult: responseBody('{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"B 版本"}]}]}'), selector: {pageTrackId: 'zh-author-b'}});
  try {
    const result = await pageSubtitles('zh-TW', true, 0, false, world.selector);
    assert.equal(JSON.parse(result.raw).events[0].segs[0].utf8, 'B 版本');
    assert.match(world.calls[0], /name=%E4%BD%9C%E8%80%85%E7%89%88(?:%20|\+)B/);
  } finally { world.restore(); }
});

test('HTTP failure and empty body are reported without falling back to another track', async () => {
  for (const [fetchResult, code] of [[responseBody('', false, 403), 'YT_FILE_HTTP'], [responseBody('   '), 'YT_FILE_EMPTY']]) {
    const tracks = [track('zh-main', 'zh-TW', '中文（台灣）'), track('en-main', 'en', 'English')];
    const world = youtubeWorld({tracks, fetchResult, selector: {pageTrackId: 'zh-main'}});
    try {
      const result = await pageSubtitles('zh-TW', true, 0, false, world.selector);
      assert.equal(result.errorCode, code);
      assert.equal(world.calls.length, 1);
      assert.match(world.calls[0], /lang=zh-TW/);
    } finally { world.restore(); }
  }
});

test('caption capture does not control the player', async () => {
  const tracks = [track('zh-main', 'zh-TW', '中文（台灣）')];
  const world = youtubeWorld({tracks, fetchResult: responseBody('{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"字幕"}]}]}'), selector: {pageTrackId: 'zh-main'}});
  try {
    const result = await pageSubtitles('zh-TW', true, 0, false, world.selector);
    assert.equal(JSON.parse(result.raw).events[0].segs[0].utf8, '字幕');
    assert.equal(world.calls.length, 1);
    assert.deepEqual(world.controls, {play: 0, pause: 0, load: 0});
  } finally { world.restore(); }
});
