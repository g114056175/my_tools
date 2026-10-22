/* Conservative binding of webRequest observations to the selected video. */
import { networkMediaKind, networkHttpUrl } from './network-media.js';

const KINDS = new Set(['hls', 'dash', 'progressive']);
const KNOWN_RESOLVERS = new Set(['youtube', 'bilibili', 'twitch', 'twitch-clip', 'dailymotion', 'anime1', 'linked-media', 'social-network', 'metadata-media']);
const OWNED_EVIDENCE=/^(?:mse-(?:master-root|progressive-body)|blob-http-body|video\.(?:currentSrc|src)|source-element|player-owned-source)$/;

// These are observed on the selected live element, not inferred from a nearby
// request. Alternative lists explicitly supplied by that player may be grouped.
function ownedSourcePlan(page,selected){
  const {tabId,frameId,documentId}=page;
  if(!Number.isInteger(tabId)||tabId<0||!Number.isInteger(frameId)||frameId<0||typeof documentId!=='string'||!documentId)return null;
  if(selected.documentId!==documentId||selected.frameId!==frameId||selected.mediaKey==null)return null;
  if(page.media?.mediaKey!=null&&page.media.mediaKey!==selected.mediaKey)return null;
  const current=bindingUrl(page.media?.url),captured=bindingUrl(selected.url);
  if(!captured||current&&current!==captured)return null;
  const expectedDuration=Number(page.media?.duration||selected.duration);
  if(!Number.isFinite(expectedDuration)||expectedDuration<=0)return null;
  const versions=[];
  for(const item of (selected.sourceCandidates || []).slice(0,12)){
    if(!http(item?.url)||!KINDS.has(item.kind)||!Array.isArray(item.evidence)||!item.evidence.some(value=>OWNED_EVIDENCE.test(value)))continue;
    const grouped=item.sourceGroup==='player-current-sources'&&item.evidence.includes('player-owned-source') || item.sourceGroup==='source-elements'&&item.evidence.includes('source-element');
    const candidateGroup=grouped?{kind:'player',id:JSON.stringify([selected.mediaKey,captured,item.sourceGroup]),scope:{tabId,frameId,documentId}}:undefined;
    if(!versions.some(v=>v.url===item.url))versions.push({url:http(item.url),kind:item.kind,...(candidateGroup?{candidateGroup}:{})});
  }
  if(!versions.length||versions.length===1&&versions[0].url===http(selected.downloadUrl))return null;
  return {site:'network-media',binding:'player-owned',bindingSource:captured,confidence:'player',expectedDuration,versions};
}

// Serialized into the original MAIN-world document before and after probing.
// A page can reuse a video element during navigation, so its DOM key alone is
// insufficient: require its live source, duration and observed alternatives.
export function validateOwnedSourcePlan({mediaKey,source,duration,versions}={}){
  const observer=window[Symbol.for('video-pocket.mediaObserver')],keys=window[Symbol.for('video-pocket.identities')]?.keys;
  if(!observer?.sourcesFor||!keys||!source||!Array.isArray(versions)||!versions.length)return {valid:false};
  const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const videos=roots.flatMap(root=>[...root.querySelectorAll('video')]);
  const video=videos.find(item=>keys.get(item)===mediaKey);
  if(!video||video.isConnected===false||video.mediaKeys||(video.currentSrc||video.src)!==source||!Number.isFinite(video.duration)||Math.abs(video.duration-duration)>=0.1)return {valid:false};
  const candidates=observer.sourcesFor(video)?.candidates || [];
  const owned=/^(?:mse-(?:master-root|progressive-body)|blob-http-body|video\.(?:currentSrc|src)|source-element|player-owned-source)$/;
  return {valid:versions.every(version=>candidates.some(candidate=>candidate.downloadable!==false&&candidate.url===version.url&&candidate.kind===version.kind&&candidate.evidence?.some(value=>owned.test(value))&&(!version.candidateGroup||version.candidateGroup.id===JSON.stringify([mediaKey,source,candidate.sourceGroup]))))};
}

// Document model groups are only meaningful inside the original validated
// snapshot. The content script cannot manufacture browser document identifiers.
export function scopeDocumentCandidates(page){
  const p=page?.platform,{tabId,frameId,documentId}=page || {};
  if(p?.site!=='metadata-media'||p.binding!=='metadata-unbound'||!p.validationToken||!p.bindingKey||
    !Number.isInteger(tabId)||tabId<0||!Number.isInteger(frameId)||frameId<0||typeof documentId!=='string'||!documentId)return page;
  const versions=(p.versions || []).map(({candidateGroup,...v})=>({...v,...(typeof v.sourceGroup==='string'&&v.sourceGroup.length<=160?{
    candidateGroup:{kind:'player',id:JSON.stringify([p.bindingKey,v.sourceGroup]),scope:{tabId,frameId,documentId}}
  }:{})}));
  return {...page,platform:{...p,versions}};
}

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

function scopedRecords(page, records) {
  return records.filter(record => sameContext(page, record) &&
    (!record.method || String(record.method).toUpperCase() === 'GET') && KINDS.has(recordKind(record)) && http(recordIdentity(record)));
}

function fallbackGuard(page, selected, records, excluded = new Set()) {
  const scoped = scopedRecords(page, records);
  const exact = selectedUrls(page, selected);
  if (scoped.some(record => {
    if (excluded.has(http(record.url)) || excluded.has(http(record.originalUrl))) return false;
    const url = bindingUrl(record.url), original = bindingUrl(record.originalUrl);
    return exact.includes(url) || exact.includes(original);
  })) return { reason: '', exact: true, scoped, candidates: [] };
  // Ambient network activity is not an element binding. Require the complete
  // browser scope before using the single-player/duration verification path.
  if (!Number.isInteger(page.tabId) || page.tabId < 0 || !Number.isInteger(page.frameId) || page.frameId < 0 ||
      typeof page.documentId !== 'string' || !page.documentId) return { reason: 'incomplete-context', scoped, candidates: [] };
  const expectedDuration = Number(page.media?.duration || selected.duration);
  const localVideos = (page.videos || []).filter(video =>
    video.documentId === page.documentId && video.frameId === page.frameId);
  const localPlayerCount = Number.isInteger(page.localPlayerCount) ? page.localPlayerCount : localVideos.length;
  if (localPlayerCount !== 1) return { reason: 'multiple-players', scoped, candidates: [] };
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) return { reason: 'missing-duration', scoped, candidates: [] };
  const otherUrls=new Set((page.videos || []).filter(v=>v!==selected).flatMap(v=>[v.downloadUrl,v.url,v.observedSource?.url]).map(http).filter(Boolean));
  const priority=record=>['hls','dash'].includes(recordKind(record))?1:0;
  const candidates = [...new Map(scoped.filter(record => !excluded.has(http(record.url))&&!otherUrls.has(http(record.url))&&!otherUrls.has(http(record.originalUrl))).sort((a, b) => priority(b)-priority(a)||Number(b.time || 0) - Number(a.time || 0)).map(record => [http(record.url), record])).values()].slice(0, 12);
  if (!candidates.length) return { reason: 'no-exact-binding', scoped, candidates: [] };
  return { reason: '', scoped, candidates, expectedDuration };
}

function scopedFallback(page, selected, scoped, excluded = new Set()) {
  const guard = fallbackGuard(page, selected, scoped, excluded);
  if (guard.reason || guard.exact || !guard.candidates.length) return null;
  const { candidates, expectedDuration } = guard;
  return { expectedDuration, versions: candidates.map(record => ({ url: http(record.url), kind: recordKind(record) })),
    confidence: 'scoped', evidence: candidates.map(record => evidence(record, 'scoped')) };
}

// Keep the diagnostic in lockstep with scopedFallback.  This reports why the
// conservative ambient-network path cannot be used; it never exposes URLs.
export function networkFallbackReason(page, records = []) {
  const selected = page?.videos?.[Number(page?.mediaIndex) || 0];
  if (!page || !selected || page.media?.drm || selected.drm ||
      KNOWN_RESOLVERS.has(page.platform?.site) || selected.downloadUrl) return '';
  if(ownedSourcePlan(page,selected))return '';
  return fallbackGuard(page, selected, records).reason;
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
  if (KNOWN_RESOLVERS.has(page.platform?.site)&&page.platform?.site!=='metadata-media') return page;
  if(!page.platform||['network-media','metadata-media'].includes(page.platform.site)){
    const owned=ownedSourcePlan(page,selected);
    if(owned)return {...page,platform:owned};
  }
  if(page.platform?.site==='metadata-media')return page;
  const embeddedPrimary = page.platform?.site === 'embedded' && sourceAvailable(page, selected);
  const scoped = scopedRecords(page, records);
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
