import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { attachNetworkSources, networkFallbackReason, verifiedNetworkSource, scopeDocumentCandidates,validateOwnedSourcePlan } from '../extension/network-source.js';

const record = (url, extra = {}) => ({ url, originalUrl: url, kind: 'progressive', time: 10, service: 'generic', tabId: 1, frameId: 0, documentId: 'doc', method: 'GET', ...extra });

test('serialized owned-source verification detects reused players and changed alternatives',()=>{
 const video={currentSrc:'blob:current',duration:20,isConnected:true},other={currentSrc:'blob:ad',duration:20};
 const keys=new WeakMap([[video,4],[other,5]]),url='https://cdn.test/selected.mp4';
 let candidates=[{url,kind:'progressive',evidence:['player-owned-source'],sourceGroup:'player-current-sources'}];
 const document={querySelectorAll:selector=>selector==='video'?[video,other]:[]};
 const window={[Symbol.for('video-pocket.identities')]:{keys},[Symbol.for('video-pocket.mediaObserver')]:{sourcesFor:v=>({candidates:v===video?candidates:[]})}};
 const plan={mediaKey:4,source:'blob:current',duration:20,versions:[{url,kind:'progressive',candidateGroup:{id:JSON.stringify([4,'blob:current','player-current-sources'])}}]};
 const validate=()=>vm.runInNewContext(`(${validateOwnedSourcePlan.toString()})(plan)`,{window,document,plan}).valid;
 assert.equal(validate(),true);
 video.currentSrc='blob:next';assert.equal(validate(),false);video.currentSrc='blob:current';
 video.duration=21;assert.equal(validate(),false);video.duration=20;
 candidates[0].sourceGroup='other-group';assert.equal(validate(),false);candidates[0].sourceGroup='player-current-sources';
 candidates[0].evidence=['ambient'];assert.equal(validate(),false);candidates[0].evidence=['player-owned-source'];
 candidates[0].url='https://cdn.test/ad.mp4';assert.equal(validate(),false);candidates[0].url=url;
 video.isConnected=false;assert.equal(validate(),false);
});

test('metadata hypotheses cannot be promoted to exact sources by an observed matching request',()=>{
 const page={tabId:1,frameId:0,documentId:'doc',mediaIndex:0,videos:[{url:'blob:current'}],media:{duration:60},platform:{site:'metadata-media',expectedDuration:60,versions:[{url:'https://cdn/x.mp4',kind:'progressive'}]}};
 assert.equal(attachNetworkSources(page,[record('https://cdn/x.mp4')]),page);
});

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

test('owned source candidates stay bound to the selected player and group trusted alternatives',()=>{
 const selected={url:'blob:selected',mediaKey:'media-a',documentId:'doc',frameId:0,sourceCandidates:[
  {url:'https://cdn/a-360.m3u8',kind:'hls',evidence:['player-owned-source'],sourceGroup:'player-current-sources'},
  {url:'https://cdn/a-720.m3u8',kind:'hls',evidence:['player-owned-source'],sourceGroup:'player-current-sources'},
  {url:'https://cdn/b.mp4',kind:'progressive',evidence:['player-owned-source'],sourceGroup:'source-elements'}
 ]};
 const page={tabId:1,frameId:0,documentId:'doc',mediaIndex:0,media:{url:'blob:selected',mediaKey:'media-a',duration:20},videos:[selected,{url:'blob:other',mediaKey:'media-b',documentId:'doc',frameId:0}]};
 const result=attachNetworkSources(page);
 assert.equal(result.platform.binding,'player-owned');
 assert.equal(result.platform.versions.length,3);
 assert.equal(result.platform.versions[0].candidateGroup.scope.documentId,'doc');
 assert.equal(result.platform.versions[0].candidateGroup.id,result.platform.versions[1].candidateGroup.id);
 assert.equal(result.platform.versions[2].candidateGroup,undefined,'untrusted source group is not promoted');
 const provisional={...page,platform:{site:'metadata-media',binding:'metadata-unbound',versions:[{url:'https://cdn/ambient.mp4'}]}};
 assert.equal(attachNetworkSources(provisional).platform.binding,'player-owned','live element evidence takes priority over provisional document guesses');
});

test('owned source plan rejects stale document or media identity and unbound multi-player remains blocked',()=>{
 const selected={url:'blob:selected',mediaKey:'media-a',documentId:'doc',frameId:0,sourceCandidates:[{url:'https://cdn/a.mp4',kind:'progressive',evidence:['player-owned-source'],sourceGroup:'player-current-sources'}]};
 const base={tabId:1,frameId:0,documentId:'doc',mediaIndex:0,media:{url:'blob:selected',mediaKey:'media-a',duration:20},videos:[selected,{url:'blob:other',documentId:'doc',frameId:0}]};
 assert.equal(attachNetworkSources({...base,documentId:'new-doc'}).platform,undefined);
 assert.equal(attachNetworkSources({...base,media:{...base.media,mediaKey:'media-b'}}).platform,undefined);
 assert.equal(attachNetworkSources({...base,videos:base.videos.map(v=>({...v,sourceCandidates:undefined}))},[record('https://cdn/ambient.mp4')]).platform,undefined);
});

test('document candidates are scoped only with a validated full browser context',()=>{
 const page={tabId:3,frameId:2,documentId:'doc',platform:{site:'metadata-media',binding:'metadata-unbound',bindingKey:'bind',validationToken:'token',versions:[{url:'https://cdn/a.mp4',sourceGroup:'opaque'}]}};
 const scoped=scopeDocumentCandidates(page);
 assert.equal(scoped.platform.versions[0].candidateGroup.scope.tabId,3);
 assert.notEqual(scoped.platform.versions[0].candidateGroup.id,page.platform.versions[0].sourceGroup);
 const incomplete={...page};delete incomplete.documentId;
 assert.equal(scopeDocumentCandidates(incomplete),incomplete);
});

test('fallback diagnostics explain the same guards that reject ambient binding', () => {
  const base = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 },
    videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }, { url: 'blob:y', documentId: 'doc', frameId: 0 }] };
  assert.equal(networkFallbackReason(base, [record('https://cdn/x.mp4')]), 'multiple-players');
  assert.equal(attachNetworkSources(base, [record('https://cdn/x.mp4')]).platform, undefined);
  assert.equal(networkFallbackReason({ ...base, videos: [base.videos[0]], media: {} }, [record('https://cdn/x.mp4')]), 'missing-duration');
  const incomplete = { ...base, videos: [base.videos[0]] }; delete incomplete.documentId;
  assert.equal(networkFallbackReason(incomplete, [record('https://cdn/x.mp4', { documentId: undefined })]), 'incomplete-context');
  const single = { ...base, videos: [base.videos[0]] };
  assert.equal(networkFallbackReason(single, [record('https://cdn/x.mp4')]), '');
  assert.equal(networkFallbackReason(single, [record('https://cdn/x.mp4', { url: 'blob:x', originalUrl: 'blob:x' })]), 'no-exact-binding');
});

test('exact binding wins over multi-player and scoped candidates are eligible for verification', () => {
  const multi = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: {},
    videos: [{ url: 'https://cdn/exact.mp4', documentId: 'doc', frameId: 0 }, { url: 'blob:y', documentId: 'doc', frameId: 0 }] };
  assert.equal(networkFallbackReason(multi, [record('https://cdn/exact.mp4')]), '');
  const scoped = { tabId: 1, documentId: 'doc', frameId: 0, mediaIndex: 0, media: { duration: 20 },
    videos: [{ url: 'blob:x', documentId: 'doc', frameId: 0 }] };
  assert.equal(networkFallbackReason(scoped, [record('https://cdn/other.mp4')]), '');
  assert.equal(networkFallbackReason(scoped, []), 'no-exact-binding');
});
