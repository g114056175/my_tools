import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedVimeoConfiguration} from '../extension/vimeo-player.js';
import {extractMediaModels} from '../extension/media-models.js';

const route = 'https://vimeo.com/1084537';
const manifest = 'https://vod.example.test/master.m3u8?token=fixture';

function fixture({config, routeUrl = route, wrapperUrl = '', playerCount = 1} = {}) {
  const video = {mediaKeys: null, isConnected: true};
  function Node() {}
  Node.prototype.contains = function(node) { return node === this.ownedVideo; };
  const target = {document: {scripts: []}, Node};
  const wrapper = Object.assign(Object.create(Node.prototype), {
    isConnected: true, ownedVideo: video, ...(wrapperUrl ? {'data-config-url': wrapperUrl} : {}),
  });
  const players = [{element: wrapper}];
  for (let index = 1; index < playerCount; index++) {
    players.push({element: Object.assign(Object.create(Node.prototype), {isConnected: true, ownedVideo: video})});
  }
  if (config !== undefined) target.playerConfig = config;
  return {video, wrapper, players, target, routeUrl};
}

function vimeoConfig(id = '1084537') {
  return {
    video: {id, title: 'Big Buck Bunny', duration: 597, unrelated: 'omit'},
    request: {files: {
      hls: {default_cdn: 'fastly', cdns: {fastly: {url: manifest, secret: 'omit'}}},
      dash: {default_cdn: 'akamai', cdns: {akamai: {url: 'https://vod.example.test/master.mpd'}}},
      progressive: [{url: 'https://vod.example.test/720.mp4', width: 1280, height: 720, quality: '720p', token: 'omit'}],
      drm: false,
    }, privateData: 'omit'},
    analytics: {url: 'https://analytics.example.test/omit'},
  };
}

const read = (f, options = {}) => ownedVimeoConfiguration(f.video, f.target, {
  pageUrl: f.routeUrl,
  players: f.players,
  ...options,
});

test('late popup reads only the selected player\'s loaded Vimeo config and returns media fields', () => {
  const f = fixture({config: vimeoConfig()});
  let networkCalls = 0;
  f.target.fetch = () => { networkCalls++; throw new Error('must not fetch'); };
  const result = read(f);
  assert.equal(result.video.id, '1084537');
  assert.equal(result.video.title, 'Big Buck Bunny');
  assert.equal(result.video.duration, 597);
  assert.equal(result.request.files.hls.default_cdn, 'fastly');
  assert.equal(result.request.files.hls.cdns.fastly.url, manifest);
  assert.equal(result.request.files.dash.cdns.akamai.url, 'https://vod.example.test/master.mpd');
  assert.deepEqual(result.request.files.progressive[0], {
    url: 'https://vod.example.test/720.mp4', width: 1280, height: 720, quality: '720p',
  });
  assert.equal('analytics' in result, false);
  assert.equal('privateData' in result.request, false);
  assert.equal('secret' in result.request.files.hls.cdns.fastly, false);
  assert.equal('token' in result.request.files.progressive[0], false);
  const [model] = extractMediaModels(result, {baseUrl: route});
  assert.equal(model.id, '1084537');
  assert.equal(model.manifestUrl, manifest);
  assert.equal(model.versions[0].url, 'https://vod.example.test/720.mp4');
  assert.equal(networkCalls, 0);
});

test('an ordinary Creative Commons license is not mistaken for DRM protection',()=>{
 const data=vimeoConfig();data.video.license='cc-by';
 assert.equal(read(fixture({config:data})).video.id,'1084537');
});

test('an exact owner is required and multiple player objects owning the video are ambiguous', () => {
  const f = fixture({config: vimeoConfig(), playerCount: 2});
  assert.equal(read(f), null);
  assert.equal(read({...f, players: []}), null);
  const otherVideo = {mediaKeys: null};
  const Node = f.target.Node;
  const other = {element: Object.assign(Object.create(Node.prototype), {ownedVideo: otherVideo})};
  assert.equal(read({...f, players: [f.players[0], other]}).video.id, '1084537');
});

test('SPA navigation and mismatched config IDs cannot reuse an old source', () => {
  const oldConfig = fixture({config: vimeoConfig('1084537')});
  assert.equal(read(oldConfig, {pageUrl: 'https://vimeo.com/999999'}), null);
  const staleConfig = fixture({config: vimeoConfig('999999')});
  assert.equal(read(staleConfig), null);
  const wrongClip = fixture({config: undefined});
  wrongClip.target.clip_page_config = {
    clip: {id: '999999'}, player: {config_url: 'https://player.vimeo.com/video/1084537/config'},
  };
  assert.equal(read(wrongClip), null);
});

test('clip page config URL requires matching clip ID and exact Vimeo config path', () => {
  const f = fixture({config: undefined});
  f.target.vimeo = {clip_page_config: {
    clip: {id: 1084537},
    player: {config_url: 'https://player.vimeo.com/video/1084537/config?autoplay=1'},
  }};
  assert.deepEqual(read(f), {
    id: '1084537',
    configUrl: 'https://player.vimeo.com/video/1084537/config?autoplay=1',
  });
});

test('top-level clip_page_config can provide an ID-authenticated loaded config', () => {
  const f = fixture({config: undefined});
  f.target.clip_page_config = {
    clip: {id: '1084537'},
    player: {config: vimeoConfig()},
  };
  const result = read(f);
  assert.equal(result.video.id, '1084537');
  assert.equal(result.request.files.hls.cdns.fastly.url, manifest);
});

test('selected wrapper config URL is accepted only for the same Vimeo video', () => {
  const good = fixture({wrapperUrl: 'https://player.vimeo.com/video/1084537/config?ref=player'});
  assert.deepEqual(read(good), {
    id: '1084537', configUrl: 'https://player.vimeo.com/video/1084537/config?ref=player',
  });
  for (const wrapperUrl of [
    'https://evil.example/video/1084537/config',
    'https://player.vimeo.com/video/999999/config',
    'https://player.vimeo.com/video/1084537/config/extra',
    'https://user:pass@player.vimeo.com/video/1084537/config',
  ]) {
    assert.equal(read(fixture({wrapperUrl})), null, wrapperUrl);
  }
});

test('page URL must identify a Vimeo video on an allowed HTTPS host', () => {
  const f = fixture({config: vimeoConfig()});
  for (const pageUrl of [
    'https://example.test/1084537',
    'http://vimeo.com/1084537',
    'https://player.vimeo.com/video/999999',
    'https://vimeo.com/channels/staffpicks/1084537',
  ]) assert.equal(read(f, {pageUrl}), null, pageUrl);
});

test('inline playerConfig JSON is read late, without evaluating JavaScript', () => {
  const f = fixture({config: undefined});
  const literal = JSON.stringify(vimeoConfig());
  f.target.document.scripts = [{textContent: `window.playerConfig = ${literal};`, src: ''}];
  assert.equal(read(f).video.id, '1084537');

  let parseCalls = 0, executed = false;
  const malicious = fixture({config: undefined});
  malicious.target.document.scripts = [{
    textContent: 'var playerConfig = (() => { globalThis.__vimeoFixtureExecuted = true; return {}; })();', src: '',
  }];
  const result = read(malicious, {parseJson: value => { parseCalls++; return JSON.parse(value); }});
  executed = Object.hasOwn(globalThis, '__vimeoFixtureExecuted');
  delete globalThis.__vimeoFixtureExecuted;
  assert.equal(result, null);
  assert.equal(parseCalls, 0);
  assert.equal(executed, false);
});

test('script-like text in comments or strings is not treated as a config assignment', () => {
  const f = fixture({config: undefined});
  let parseCalls = 0;
  f.target.document.scripts = [{
    textContent: `// var playerConfig = ${JSON.stringify(vimeoConfig())};\nconst note = "var config = {}";`, src: '',
  }];
  assert.equal(read(f, {parseJson: value => { parseCalls++; return JSON.parse(value); }}), null);
  assert.equal(parseCalls, 0);
});

test('oversized or excessively nested inline config is skipped within bounds', () => {
  const oversized = fixture({config: undefined});
  let parseCalls = 0;
  oversized.target.document.scripts = [{
    textContent: `var playerConfig = ${JSON.stringify(vimeoConfig())};${' '.repeat(512 * 1024)}`, src: '',
  }];
  assert.equal(read(oversized, {parseJson: value => { parseCalls++; return JSON.parse(value); }}), null);
  assert.equal(parseCalls, 0);

  const nested = fixture({config: undefined});
  nested.target.document.scripts = [{
    textContent: `var config = ${'{'.repeat(20)}"video":{}}${'}'.repeat(20)};`, src: '',
  }];
  assert.equal(read(nested), null);
});

test('page-defined config getters and mediaKeys are rejected without invoking config getters', () => {
  const f = fixture({config: undefined});
  let reads = 0;
  Object.defineProperty(f.target, 'playerConfig', {get() { reads++; return vimeoConfig(); }});
  assert.equal(read(f), null);
  assert.equal(reads, 0);

  const fakeDocumentGetter = fixture({config: undefined});
  let documentReads = 0;
  fakeDocumentGetter.target.Window = function Window() {};
  Object.defineProperty(fakeDocumentGetter.target, 'document', {
    configurable: false,
    get() { documentReads++; return {scripts: []}; },
  });
  assert.equal(read(fakeDocumentGetter), null);
  assert.equal(documentReads, 0);

  const drm = fixture({config: vimeoConfig()});
  drm.target.playerConfig.video.drm = true;
  assert.equal(read(drm), null);
  const encrypted = fixture({config: vimeoConfig()});
  encrypted.video.mediaKeys = {keys: true};
  assert.equal(read(encrypted), null);
});

