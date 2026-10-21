import test from 'node:test';
import assert from 'node:assert/strict';
import { attachNetworkSources, verifiedNetworkSource } from '../extension/network-source.js';

const record = (url, extra = {}) => ({ url, originalUrl: url, kind: 'progressive', time: 10, service: 'generic', tabId: 1, frameId: 0, documentId: 'doc', method: 'GET', ...extra });

test('exact selected URL binds a source as embedded with evidence', () => {
  const page = { documentId: 'doc', frameId: 0, mediaIndex: 0, videos: [{ url: 'blob:current', downloadUrl: 'https://cdn/x.mp4' }] };
  const result = attachNetworkSources(page, [record('https://cdn/x.mp4')]);
  assert.equal(result.platform.site, 'embedded');
  assert.equal(result.platform.confidence, 'exact');
  assert.equal(result.platform.evidence[0].type, 'exact-url');
});

test('record.originalUrl can exact-bind a redirected observed URL', () => {
  const page = { documentId: 'doc', frameId: 2, mediaIndex: 0, videos: [{ url: 'blob:x' }] };
  const result = attachNetworkSources(page, [record('https://cdn/final.mp4', { originalUrl: 'https://cdn/redirect.mp4', frameId: 2 })]);
  const exact = attachNetworkSources({ ...page, videos: [{ url: 'https://cdn/redirect.mp4' }] }, [record('https://cdn/final.mp4', { originalUrl: 'https://cdn/redirect.mp4', frameId: 2 })]);
  assert.equal(exact.platform.site, 'embedded');
  assert.equal(result.platform, undefined);
});

test('does not borrow another frame or document and requires a single local player', () => {
  const page = { documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 }, videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }, { url: 'blob:y', documentId: 'doc', frameId: 0 }] };
  assert.equal(attachNetworkSources(page, [record('https://cdn/x.mp4', { documentId: 'old', frameId: 0 })]).platform, undefined);
  assert.equal(attachNetworkSources({ ...page, videos: [page.videos[0]] }, [record('https://cdn/x.mp4', { documentId: 'other', frameId: 0 })]).platform, undefined);
});

test('single scoped video creates bounded network-media candidates', () => {
  const page = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 }, videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }] };
  const result = attachNetworkSources(page, [record('https://cdn/a.mp4'), record('https://cdn/b.m3u8', { kind: 'hls', time: 20 }), record('https://cdn/ad.mp4', { documentId: 'other' })]);
  assert.equal(result.platform.site, 'network-media');
  assert.equal(result.platform.expectedDuration, 20);
  assert.equal(result.platform.versions.length, 2);
  assert.equal(result.platform.confidence, 'scoped');
});

test('known resolver source and non-GET/ad-like candidates are preserved or ignored', () => {
  const page = { platform: { site: 'youtube', versions: [{ url: 'https://yt/source.mp4' }] }, mediaIndex: 0, videos: [{ url: 'https://yt/source.mp4' }] };
  assert.equal(attachNetworkSources(page, [record('https://cdn/ad.mp4', { method: 'POST' })]), page);
});

test('a non-core primary source can receive network fallback after source failure', () => {
  const page = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 },
    platform: { site: 'network-media', sourceFailure: { code: 'HTTP_AUTH' } },
    videos: [{ url: 'https://expired.example/old.mp4', documentId: 'doc', frameId: 0 }] };
  const result = attachNetworkSources(page, [record('https://cdn/recovered.mp4')]);
  assert.equal(result.platform.site, 'network-media');
  assert.deepEqual(result.platform.versions.map(value => value.url), ['https://cdn/recovered.mp4']);
});

test('core resolver platforms remain untouched even when matching records exist', () => {
  const page = { documentId: 'doc', frameId: 0, mediaIndex: 0, platform: { site: 'youtube' },
    videos: [{ url: 'blob:youtube', documentId: 'doc', frameId: 0 }] };
  assert.equal(attachNetworkSources(page, [record('https://cdn/recovery.mp4')]), page);
});

test('an already scoped social candidate plan is not rebuilt as generic ambient media', () => {
  const page = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 },
    platform: { site: 'social-network', expectedDuration: 20, versions: [{ url: 'https://cdn/chosen.mp4', kind: 'progressive' }] },
    videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }] };
  assert.equal(attachNetworkSources(page, [record('https://cdn/other.mp4')]), page);
});

test('blob-only embedded metadata does not block fallback, but HTTP embedded source does', () => {
  const base = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 }, videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }], platform: { site: 'embedded' } };
  assert.equal(attachNetworkSources(base, [record('https://cdn/x.mp4')]).platform.confidence, 'scoped');
  const existing = { ...base, platform: { site: 'embedded', manifestUrl: 'https://cdn/master.m3u8' } };
  const preserved = attachNetworkSources(existing, [record('https://cdn/other.mp4')]);
  assert.equal(preserved.platform.site, 'embedded');
  assert.equal(preserved.platform.manifestUrl, existing.platform.manifestUrl);
  assert.equal(preserved.platform.networkFallback.confidence, 'scoped');
});

test('missing context, media segments, audio and DRM are never fallback candidates', () => {
  const page = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 }, videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }] };
  const records = [
    record('https://cdn/segment.m4s', { kind: undefined, mime: 'video/mp4', documentId: 'doc' }),
    record('https://cdn/audio.mp4', { kind: 'audio', documentId: 'doc' }),
    record('https://cdn/unbound.mp4', { documentId: undefined, tabId: undefined, frameId: undefined }),
  ];
  assert.equal(attachNetworkSources(page, records).platform, undefined);
  assert.equal(attachNetworkSources({ ...page, media: { ...page.media, drm: true } }, [record('https://cdn/video.mp4')]).platform, undefined);
});

test('ambient candidates require a full browser scope even when records omit the same context', () => {
  const page = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 }, videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }] };
  for (const field of ['tabId', 'documentId', 'frameId']) {
    const incomplete = { ...page }; delete incomplete[field];
    assert.equal(attachNetworkSources(incomplete, [record('https://cdn/unbound.mp4', { [field]: undefined })]), incomplete);
  }
});

test('ambiguous same-duration candidates are exposed for root inspect to reject', () => {
  const page = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 }, videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }] };
  const result = attachNetworkSources(page, [record('https://cdn/a.mp4', { tabId: 1 }), record('https://cdn/b.mp4', { tabId: 1, time: 11 })]);
  assert.equal(result.platform.site, 'network-media');
  assert.equal(result.platform.versions.length, 2);
  // Both still require root inspect + verifiedNetworkSource; multiple successes are ambiguous.
});

test('verification requires duration tolerance and a video codec', () => {
  assert.equal(verifiedNetworkSource({ duration: 20, formats: [{ kind: 'video', videoCodec: 'avc1' }] }, 20.5), true);
  assert.equal(verifiedNetworkSource({ duration: 23, formats: [{ kind: 'video', videoCodec: 'avc1' }] }, 20), false);
  assert.equal(verifiedNetworkSource({ duration: 20, formats: [{ kind: 'audio', videoCodec: 'x' }] }, 20), false);
});
