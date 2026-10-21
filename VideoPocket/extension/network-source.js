/* Conservative binding of webRequest observations to the selected video. */
import { networkMediaKind, networkHttpUrl } from './network-media.js';

const KINDS = new Set(['hls', 'dash', 'progressive']);
const KNOWN_RESOLVERS = new Set(['youtube', 'bilibili', 'twitch', 'dailymotion', 'anime1', 'linked-media', 'social-network']);

function http(value) {
  return networkHttpUrl(value);
}

function bindingUrl(value) {
  const normalized = http(value);
  if (normalized) return normalized;
  const raw = String(value || '').trim();
  return /^blob:/i.test(raw) ? raw : '';
}

function sameContext(page, record) {
  if (page?.tabId != null && (record?.tabId == null || page.tabId !== record.tabId)) return false;
  if (page?.frameId != null && (record?.frameId == null || page.frameId !== record.frameId)) return false;
  if (page?.documentId && (record?.documentId == null || page.documentId !== record.documentId)) return false;
  return true;
}

function recordKind(record) {
  const detected = networkMediaKind({url: record?.url || record?.originalUrl, mime: record?.mime});
  if (record?.kind != null) {
    if (!KINDS.has(record.kind)) return '';
    // Explicit kind is advisory. Segment/audio MIME and URL evidence still wins.
    if (detected === 'audio' || (detected && detected !== record.kind)) return '';
    return record.kind;
  }
  return KINDS.has(detected) ? detected : '';
}

function selectedUrls(page, selected) {
  return [...new Set([
    page?.media?.url, selected?.url, selected?.downloadUrl,
    selected?.observedSource?.url
  ].map(bindingUrl).filter(Boolean))];
}

function sourceAvailable(page, selected) {
  const platformUrls = [page?.platform?.manifestUrl, ...(page?.platform?.versions || []).map(value => value?.url)];
  return [...selectedUrls(page, selected), ...platformUrls].some(value => !!http(value)) ||
    !!page?.platform?.apiRequest || !!page?.platform?.data;
}

function scopedFallback(page, selected, scoped, excluded = new Set()) {
  // Ambient network activity is not an element binding. Require the complete
  // browser scope before using the single-player/duration verification path.
  if (!Number.isInteger(page.tabId) || page.tabId < 0 || !Number.isInteger(page.frameId) || page.frameId < 0 ||
      typeof page.documentId !== 'string' || !page.documentId) return null;
  const expectedDuration = Number(page.media?.duration || selected.duration);
  const localVideos = (page.videos || []).filter(video =>
    video.documentId === page.documentId && video.frameId === page.frameId);
  const localPlayerCount = Number.isInteger(page.localPlayerCount) ? page.localPlayerCount : localVideos.length;
  if (localPlayerCount !== 1 || !Number.isFinite(expectedDuration) || expectedDuration <= 0) return null;
  const candidates = [...new Map(scoped.filter(record => !excluded.has(http(record.url))).sort((a, b) => Number(b.time || 0) - Number(a.time || 0)).map(record => [http(record.url), record])).values()].slice(0, 6);
  if (!candidates.length) return null;
  return { expectedDuration, versions: candidates.map(record => ({ url: http(record.url), kind: recordKind(record) })),
    confidence: 'scoped', evidence: candidates.map(record => evidence(record, 'scoped')) };
}

function recordIdentity(record) {
  return http(record?.url) || http(record?.originalUrl) || bindingUrl(record?.url) || bindingUrl(record?.originalUrl);
}

function evidence(record, mode) {
  return { type: mode === 'exact' ? 'exact-url' : 'scoped-network', url: recordIdentity(record),
    originalUrl: http(record?.originalUrl) || null, documentId: record?.documentId ?? null,
    frameId: record?.frameId ?? null, method: record?.method || 'GET' };
}

/**
 * Attach bounded network observations to one selected page snapshot.
 * This is intentionally pure: inspection remains responsible for verifying duration/codecs.
 */
export function attachNetworkSources(page, records = []) {
  if (!page || page.selectionExpired) return page;
  const selected = page.videos?.[Number(page.mediaIndex) || 0];
  if (!selected) return page;
  if (page.media?.drm || selected.drm) return page;
  // Core resolvers and already scoped social candidates retain their own
  // verification route instead of being replaced by a second ambient plan.
  if (KNOWN_RESOLVERS.has(page.platform?.site)) return page;
  const embeddedPrimary = page.platform?.site === 'embedded' && sourceAvailable(page, selected);
  const scoped = records.filter(record => sameContext(page, record) &&
    (!record.method || String(record.method).toUpperCase() === 'GET') && KINDS.has(recordKind(record)) && http(recordIdentity(record)));
  if (!scoped.length) return page;
  const exact = selectedUrls(page, selected);
  const primaryUrls = new Set([...exact, page?.platform?.manifestUrl, ...(page?.platform?.versions || []).map(value => value?.url)].map(http).filter(Boolean));
  if (embeddedPrimary) {
    const fallback = scopedFallback(page, selected, scoped, primaryUrls);
    return fallback ? { ...page, platform: { ...page.platform, networkFallback: fallback } } : page;
  }
  const exactMatches = scoped.filter(record => {
    const url = bindingUrl(record.url), original = bindingUrl(record.originalUrl);
    return exact.includes(url) || exact.includes(original);
  });
  if (exactMatches.length) {
    const matches = [...new Map(exactMatches.map(record => [http(record.url), record])).values()].slice(0, 6);
    const manifests = matches.filter(record => ['hls', 'dash'].includes(recordKind(record)));
    const versions = matches.filter(record => recordKind(record) === 'progressive').map(record => ({ url: http(record.url), kind: 'progressive' }));
    const platform = { ...(page.platform || {}), site: 'embedded', networkSources: matches.map(record => http(record.url)),
      confidence: 'exact', evidence: matches.map(record => evidence(record, 'exact')) };
    if (manifests[0]) { platform.manifestUrl = http(manifests[0].url); platform.manifestType = recordKind(manifests[0]); }
    if (versions.length) platform.versions = [...versions, ...(platform.versions || [])].filter((item, i, all) => all.findIndex(other => other.url === item.url) === i).slice(0, 6);
    return { ...page, platform };
  }
  // A single local player and finite duration only constrain the search scope;
  // they do not identify a URL. The root inspect stage must reject ambiguity
  // when more than one candidate independently verifies successfully.
  const fallback = scopedFallback(page, selected, scoped);
  return fallback ? { ...page, platform: { site: 'network-media', ...fallback } } : page;
}

export function verifiedNetworkSource(source, expectedDuration) {
  const duration = Number(source?.duration), expected = Number(expectedDuration);
  return Number.isFinite(duration) && duration > 0 && Number.isFinite(expected) && expected > 0 &&
    Math.abs(duration - expected) <= Math.max(0.75, Math.min(2, expected * 0.005)) &&
    Array.isArray(source?.formats) && source.formats.some(format => format?.kind !== 'audio' && format?.videoCodec);
}
