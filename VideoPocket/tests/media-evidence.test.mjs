import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMediaEvidence, associateNetworkCandidates, postIdentity, exposeSourceEvidence } from '../extension/media-evidence.js';

function node(attrs = {}, children = [], textContent = '') {
  return {
    textContent,
    currentSrc: attrs.currentSrc || '', src: attrs.src || '',
    getAttribute: key => attrs[key] || '',
    querySelectorAll: selector => selector === 'source' ? children : [],
    closest: () => attrs.scope || null,
    contains: child => children.includes(child),
  };
}

test('native currentSrc and source tracks are ranked above scoped config', () => {
  const source = node({ src: '/video-720.mp4' });
  const scope = node({ 'data-video-url': '/container.mp4' }, [source]);
  const video = node({ currentSrc: 'https://cdn.example/video-1080.mp4', scope }, [source]);
  const result = collectMediaEvidence({ video, pageUrl: 'https://social.example/reel/abc' });
  assert.equal(result.best.url, 'https://cdn.example/video-1080.mp4');
  assert.equal(result.best.evidence[0], 'video.currentSrc');
  assert.ok(result.candidates.some(c => c.url.endsWith('/video-720.mp4') && c.evidence.includes('source-element')));
});

test('network manifests require an explicit per-video association', () => {
  const first = node({ currentSrc: 'https://cdn.example/first.mp4', scope: node({ 'data-post-id': 'one' }) });
  const second = node({ currentSrc: 'https://cdn.example/second.mp4', scope: node({ 'data-post-id': 'two' }) });
  const network = [{ url: 'https://cdn.example/second.m3u8', postKey: 'example:two' }];
  const results = associateNetworkCandidates(network, [first, second], { pageUrl: 'https://example/reel/one' });
  assert.equal(results[0].candidates.some(c => c.url.endsWith('second.m3u8')), false);
  assert.equal(results[1].candidates.some(c => c.url.endsWith('second.m3u8')), true);
  const associated = collectMediaEvidence({ video: second, pageUrl: 'https://example/reel/two', network: [{ ...network[0], postKey: 'example:two' }] });
  assert.equal(associated.candidates.some(c => c.url.endsWith('second.m3u8')), true);
});

test('VideoObject is read only inside the video scope and rejects unrelated JSON-LD', () => {
  const script = { textContent: JSON.stringify({ '@type': 'VideoObject', contentUrl: '/scoped.mp4', name: 'post video' }) };
  const scope = node({}, []); scope.querySelectorAll = selector => selector === 'script[type="application/ld+json"]' ? [script] : [];
  const video = node({ scope });
  const result = collectMediaEvidence({ video, pageUrl: 'https://example/p/post-1' });
  assert.equal(result.best.url, 'https://example/scoped.mp4');
  const outside = node({ scope: node({}, []) });
  assert.equal(collectMediaEvidence({ video: outside, pageUrl: 'https://example/p/post-1' }).candidates.length, 0);
});

test('Instagram and Facebook style URL identities are stable post keys', () => {
  assert.equal(postIdentity({ pageUrl: 'https://www.instagram.com/reel/CODE123/' }).key, 'www.instagram.com:CODE123');
  assert.equal(postIdentity({ pageUrl: 'https://www.facebook.com/reel/12345' }).id, '12345');
  assert.equal(postIdentity({ pageUrl: 'https://www.facebook.com/watch/?v=987' }).id, '987');
});

test('network-only candidate remains non-downloadable without association', () => {
  const video = node({ scope: node({}) });
  const result = collectMediaEvidence({ video, pageUrl: 'https://example/p/one', network: [{ url: 'https://cdn.example/ad.mp4' }] });
  assert.equal(result.candidates.length, 0);
});

test('request mediaKey is preserved and cannot be replaced by a caller key', () => {
  const video = node({ scope: node({}) });
  const result = collectMediaEvidence({ video, mediaKey: 'wrong-key', network: [{ url: 'https://cdn.example/video.m3u8', mediaKey: 'other-video' }] });
  assert.equal(result.candidates.length, 0);
});

test('multi-video article does not borrow sibling data-src or JSON-LD', () => {
  const article = node({ 'data-src': '/sibling.mp4' });
  const first = node({ scope: article });
  const second = node({ scope: article });
  first.closest = selector => selector.includes('article') ? article : null;
  second.closest = selector => selector.includes('article') ? article : null;
  article.querySelectorAll = selector => selector === 'video' ? [first, second] : [];
  const result = collectMediaEvidence({ video: first, pageUrl: 'https://example/p/post' });
  assert.equal(result.candidates.length, 0);
});

test('multi-video figure is equally ambiguous and JSON-LD IDs require exact matching',()=>{
 const figure=node({'data-video-url':'https://cdn/sibling.mp4'}),a=node({scope:figure}),b=node({scope:figure});
 figure.querySelectorAll=selector=>selector==='video'?[a,b]:[];
 assert.equal(collectMediaEvidence({video:a,pageUrl:'https://example/reel/1'}).candidates.length,0);
 figure.querySelectorAll=selector=>selector==='video'?[a]:selector.includes('script')?[{textContent:JSON.stringify({'@type':'VideoObject',identifier:'10',contentUrl:'https://cdn/10.mp4'})}]:[];
 assert.equal(collectMediaEvidence({video:a,pageUrl:'https://example/reel/1'}).candidates.some(c=>c.url==='https://cdn/10.mp4'),false);
});

test('page URL identity is withheld when a root contains multiple unlabelled videos', () => {
  const first = node({});
  const second = node({});
  const root = { querySelectorAll: selector => selector === 'video' ? [first, second] : [] };
  const result = collectMediaEvidence({ video: first, root, pageUrl: 'https://example/reel/post-1' });
  assert.equal(result.identity.id, undefined);
});

test('player getter sources are read and embedUrl is guidance only', () => {
  const video = node({ scope: node({}) });
  const player = { currentSrc: () => 'https://cdn.example/player.m3u8' };
  const scope = video.closest();
  scope.querySelectorAll = selector => selector === 'script[type="application/ld+json"]'
    ? [{ textContent: JSON.stringify({ '@type': 'VideoObject', embedUrl: 'https://example/embed/1' }) }]
    : [];
  const result = collectMediaEvidence({ video, player, pageUrl: 'https://example/p/1' });
  assert.equal(result.best.url, 'https://cdn.example/player.m3u8');
  assert.equal(result.candidates.find(c => c.url.includes('/embed/1')).downloadable, false);
});

test('MAIN observer API is explicitly exposed through a stable symbol', () => {
  const target = {};
  const api = exposeSourceEvidence(target);
  assert.equal(target[Symbol.for('video-pocket.sourceEvidence')], api);
  assert.equal(api.collectMediaEvidence, collectMediaEvidence);
});

test('a feed video can use one local permalink, but not competing or foreign post links',()=>{
  const scope=node(),video=node({scope});
  let links=[{href:'https://social.example/reel/one/'}];
  scope.querySelectorAll=selector=>selector==='video'?[video]:selector==='a[href]'?links:[];
  const root={querySelectorAll:()=>[video,node()]};
  const read=()=>collectMediaEvidence({video,root,pageUrl:'https://social.example/feed/'}).identity;
  assert.equal(read().id,'one');
  links.push({href:'https://social.example/reel/two/'});assert.equal(read().id,undefined);
  links=[{href:'https://other.example/reel/one/'}];assert.equal(read().id,undefined);
});
