// Generic, evidence-first media discovery.  This module is deliberately
// side-effect free: callers provide the element/player/network observations.
// A URL alone is never enough to associate a network request with a video.

const MEDIA_RE = /\.(?:mp4|m4v|webm|mov|mkv|ts|m3u8|mpd)(?:[?#]|$)/i;
const MANIFEST_RE = /\.(?:m3u8|mpd)(?:[?#]|$)/i;
const HTTP_RE = /^https?:$/i;
const MEDIA_ATTRIBUTES = ['src', 'currentSrc', 'data-src', 'data-video-url', 'data-media-url', 'data-hls-url', 'data-dash-url'];
const PLAYER_KEYS = ['player', '__player', 'videojsPlayer', '__videojsPlayer', 'mediaPlayer'];

function asString(value) { return typeof value === 'string' ? value.trim() : ''; }

function absolute(raw, base) {
  const text = asString(raw); if (!text) return '';
  try { const url = new URL(text, base || undefined); return HTTP_RE.test(url.protocol) ? url.href : ''; } catch { return ''; }
}

function urlKind(url) {
  if (!url) return '';
  return MANIFEST_RE.test(url) ? (/[.]mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'hls') : 'progressive';
}

function safeAttr(node, name) { try { return asString(node?.getAttribute?.(name)); } catch { return ''; } }
export function mediaElementSource(node) {
  try {
    const raw=node?.getAttribute?.('src');
    // HTML resolves an explicitly empty src property to the document URL.
    // That is a placeholder, not a request for downloadable media.
    return typeof raw==='string'&&!raw.trim()?'':node?.src || raw || '';
  } catch { return ''; }
}
function closest(node, selectors) { try { return node?.closest?.(selectors) || null; } catch { return null; } }
function contains(parent, child) { try { return !!parent?.contains?.(child); } catch { return false; } }
function nodes(root, selector) { try { return [...(root?.querySelectorAll?.(selector) || [])]; } catch { return []; } }
function targetScope(video) {
  const narrow = closest(video, 'figure,[data-video-id],[data-media-id],[data-post-id],.video-js');
  if (narrow) return nodes(narrow,'video').length<=1?narrow:video;
  const article = closest(video, 'article,[role="article"]');
  if (!article) {
    // Feeds can use plain div/section wrappers rather than semantic articles.
    // Stop before a shared container so a neighbour's permalink is never used.
    let scope=video;
    for(let parent=video?.parentElement,depth=0;parent&&depth<16;parent=parent.parentElement,depth++){
      if(/^(BODY|HTML|MAIN)$/.test(parent.tagName || ''))break;
      if(nodes(parent,'video').length!==1)break;
      scope=parent;
    }
    return scope;
  }
  const siblings = nodes(article, 'video');
  // A feed article can contain several videos; its metadata is ambiguous.
  // Keep the element as scope unless the article has one unambiguous target.
  return siblings.length <= 1 ? article : video;
}

function identityFromUrl(pageUrl) {
  let url; try { url = new URL(pageUrl); } catch { return {}; }
  const host = url.hostname.toLowerCase();
  let id = url.searchParams.get('v') || url.searchParams.get('video_id') || url.searchParams.get('video') || '';
  let kind = '';
  const parts = url.pathname.split('/').filter(Boolean);
  const match = url.pathname.match(/\/(?:reel|p|tv|videos?|watch)\/([^/?#]+)/i);
  if (match) { id ||= match[1]; kind = /reel/i.test(match[0]) ? 'reel' : /watch/i.test(match[0]) ? 'watch' : 'post'; }
  const creatorVideo = url.pathname.match(/\/@[^/]+\/video\/([^/?#]+)/i);
  if (!id && creatorVideo) { id = creatorVideo[1]; kind = 'video'; }
  if(/(^|\.)(?:x|twitter)\.com$/i.test(host)){
    const status=url.pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/i);
    if(status){id=status[1];kind='post';}
  }
  if(!id&&/(^|\.)vimeo\.com$/i.test(host))id=url.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1] || '';
  if (!id && /instagram\.com$/i.test(host)) id = parts.find(p => p && !/^(reel|p|tv)$/i.test(p)) || '';
  return id ? { id, kind, host, key: `${host}:${id}` } : { host };
}

function dataIdentity(node) {
  for (const key of ['data-video-id', 'data-media-id', 'data-reel-id', 'data-post-id', 'data-content-id']) {
    const value = safeAttr(node, key); if (value) return value;
  }
  // XGPlayer's wrapper includes the real media ID, unlike media-card-0 (a
  // recycled feed position). Do not use arbitrary numeric element IDs.
  const wrapper=safeAttr(node,'id').match(/^xgwrapper-\d+-(\d{8,24})$/);
  if(wrapper)return wrapper[1];
  return '';
}

function localPlayerIdentity(video){
  let node=video;
  for(let depth=0;node&&depth<12;node=node.parentElement,depth++){
    if(depth&&nodes(node,'video').length!==1)break;
    const id=dataIdentity(node);if(id)return id;
  }
  return '';
}

export function postIdentity({ pageUrl = '', video, container } = {}) {
  const page = identityFromUrl(pageUrl);
  let anchor = (() => { try { return video?.closest?.('a[href*="/reel/"],a[href*="/p/"],a[href*="/videos/"],a[href*="/watch"],a[href*="/video/"],a[href*="/status/"]')?.href || ''; } catch { return ''; } })();
  // Feed post links need not wrap the video. Accept a sibling permalink only
  // inside its unambiguous one-video container, with exactly one media ID.
  if(!anchor && container && container!==video && nodes(container,'video').length===1){
    const links=nodes(container,'a[href]'), ids=new Map();
    for(const link of links){const href=absolute(link.href || safeAttr(link,'href'),pageUrl);if(!/\/(?:reel|p|tv|videos?|watch|status)(?:\/|\?)/i.test(href)&&!/@[^/]+\/video\//i.test(href))continue;const identity=identityFromUrl(href);if(identity.id && identity.host===page.host)ids.set(identity.id,href);}
    if(ids.size===1)anchor=ids.values().next().value;
  }
  const anchorPage = anchor ? identityFromUrl(anchor) : {};
  const id = localPlayerIdentity(video) || dataIdentity(container) || anchorPage.id || page.id;
  const host = anchorPage.host || page.host;
  return id ? { ...page, id, host, key: `${host || ''}:${id}`, anchor: absolute(anchor, pageUrl) } : page;
}

function add(out, raw, type, evidence, base, extra = {}) {
  const url = absolute(raw, base); if (!url) return;
  const existing = out.find(x => x.url === url);
  if (existing) { existing.evidence.push(evidence); existing.score = Math.max(existing.score, extra.score || 0); Object.assign(existing, extra); return; }
  out.push({ url, kind: urlKind(url), evidence: [evidence], score: extra.score || 0, downloadable: false, ...extra });
}

function readPlayer(player, base, out) {
  if (!player) return;
  const read = value => { try { return typeof value === 'function' ? value.call(player) : value; } catch { return ''; } };
  const currentSource = (() => { try { return typeof player.currentSource === 'function' ? player.currentSource() : player.currentSource; } catch { return ''; } })();
  const currentSources = (() => { try { return typeof player.currentSources === 'function' ? player.currentSources() : player.currentSources; } catch { return []; } })();
  for (const value of [read(player.currentSrc), read(player.src), read(player.source_), currentSource, currentSources]) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) add(out, typeof item === 'object' ? (item.src || item.uri || item.url) : item, 'player', 'player-owned-source', base, { score: .86,
      ...(Array.isArray(value)&&value===currentSources?{sourceGroup:'player-current-sources'}:{}) });
  }
  for (const key of ['url', 'uri', 'resolvedUri', 'masterPlaylist_', 'mainPlaylist_', 'playlist']) {
    const value = read(player[key]); add(out, typeof value === 'object' ? (value.src || value.uri || value.url) : value, 'player', `player.${key}`, base, { score: .84 });
  }
}

function scopedJsonLd(scope, base, out, identity) {
  for (const script of nodes(scope, 'script[type="application/ld+json"]')) {
    let value; try { value = JSON.parse(script.textContent || ''); } catch { continue; }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (!item || typeof item !== 'object' || !/VideoObject/i.test(String(item['@type'] || ''))) continue;
      const candidateId = asString(item.identifier || item.videoId);
      if (identity.id && candidateId && candidateId!==identity.id && identityFromUrl(candidateId).id!==identity.id) continue;
      add(out, item.contentUrl, 'json-ld', 'VideoObject.contentUrl', base, { score: .83, metadata: { name: item.name || '', duration: item.duration || '' } });
      add(out, item.embedUrl, 'json-ld', 'VideoObject.embedUrl', base, { score: .52, direct: false, metadata: { name: item.name || '' } });
    }
  }
}

function scopedConfig(scope, base, out) {
  // Only known media attributes in the video container are considered. This
  // intentionally avoids recursively parsing arbitrary application JSON.
  const scoped = [scope, ...nodes(scope, '[data-video-url],[data-media-url],[data-hls-url],[data-dash-url],[data-src]')];
  for (const node of scoped) for (const attr of ['data-video-url', 'data-media-url', 'data-hls-url', 'data-dash-url', 'data-src']) {
    const raw = safeAttr(node, attr); if (raw) add(out, raw, 'container-config', `container.${attr}`, base, { score: .68 });
  }
}

function networkMatch(observation, video, scope, identity, expectedMediaKey = '') {
  if (!observation || typeof observation !== 'object') return false;
  if (observation.video === video || observation.element === video) return true;
  if (observation.mediaKey && (observation.mediaKey === video.mediaKey || observation.mediaKey === safeAttr(video, 'data-media-key') || observation.mediaKey === expectedMediaKey)) return true;
  if (observation.containerKey && (observation.containerKey === safeAttr(scope, 'data-media-key') || observation.containerKey === safeAttr(scope, 'data-post-id'))) return true;
  if (observation.postKey && identity.key && observation.postKey === identity.key) return true;
  return false;
}

export function collectMediaEvidence({ video, root, pageUrl = '', network = [], player, mediaKey = '' } = {}) {
  const scope = targetScope(video);
  let identity = postIdentity({ pageUrl, video, container: scope });
  const page = identityFromUrl(pageUrl);
  const localId = localPlayerIdentity(video) || dataIdentity(scope) || identityFromUrl(identity.anchor || '').id;
  const allVideos = nodes(root, 'video');
  if (!localId && allVideos.length > 1) identity = { host: page.host };
  const candidates = [];
  if (video) {
    for (const attr of MEDIA_ATTRIBUTES) add(candidates, attr === 'currentSrc' ? video.currentSrc : attr === 'src' ? mediaElementSource(video) : safeAttr(video, attr), 'native', `video.${attr}`, pageUrl, { score: attr === 'currentSrc' ? .98 : .94 });
    for (const source of nodes(video, 'source')) add(candidates, mediaElementSource(source), 'native-track', 'source-element', pageUrl, { score: .93, type: safeAttr(source, 'type'), sourceGroup:'source-elements' });
    const owned = player || PLAYER_KEYS.map(key => { try { return video[key]; } catch { return null; } }).find(Boolean);
    readPlayer(owned, pageUrl, candidates);
  }
  scopedJsonLd(scope, pageUrl, candidates, identity);
  scopedConfig(scope, pageUrl, candidates);
  for (const request of network || []) if (networkMatch(request, video, scope, identity, mediaKey)) add(candidates, request.url, 'network', 'associated-network-request', pageUrl, { score: .63, requestId: request.requestId, tabId: request.tabId });
  for (const candidate of candidates) {
    candidate.confidence = Math.min(1, candidate.score + (candidate.evidence.length - 1) * .03);
    candidate.downloadable = candidate.direct !== false && candidate.confidence >= .7 && !!candidate.url;
  }
  candidates.sort((a, b) => b.confidence - a.confidence || a.url.localeCompare(b.url));
  return { identity, candidates, best: candidates.find(c => c.downloadable) || null };
}

export function associateNetworkCandidates(network, videos, context = {}) {
  return (videos || []).map(video => collectMediaEvidence({ video, network, ...context })).map((result, index) => ({ index, ...result }));
}

// MAIN-world observers can opt in explicitly without importing extension
// globals. The symbol is stable across separately bundled observer chunks.
export function exposeSourceEvidence(target = globalThis) {
  const key = Symbol.for('video-pocket.sourceEvidence');
  const api = target[key] || (target[key] = {});
  api.collectMediaEvidence = collectMediaEvidence;
  api.associateNetworkCandidates = associateNetworkCandidates;
  api.postIdentity = postIdentity;
  return api;
}

export const _internals = { absolute, identityFromUrl, networkMatch, urlKind };
