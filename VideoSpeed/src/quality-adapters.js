/* Quality adapters for a selected HTMLVideoElement.
 *
 * Adapters deliberately make one best effort per call.  They do not poll,
 * change src, or attempt to obtain a manifest/stream for a player.
 */

const YOUTUBE_HEIGHTS = {
  highres: 2160,
  hd2160: 2160,
  hd1440: 1440,
  hd1080: 1080,
  hd720: 720,
  large: 480,
  medium: 360,
  small: 240,
  tiny: 144,
};

function numberHeight(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== 'string') return undefined;
  const match = value.match(/(?:^|[^0-9])(\d{2,4})(?:p)?(?:[^0-9]|$)/i);
  return match ? Number(match[1]) : undefined;
}

function qualityHeight(width, height) {
  const w=numberHeight(width),h=numberHeight(height);
  return w&&h?Math.min(w,h):h;
}

export function chooseHeight(heights, preferred = 1080) {
  const values = [...new Set((Array.isArray(heights) ? heights : [])
    .map(numberHeight).filter((height) => Number.isFinite(height) && height > 0))];
  if (!values.length) return undefined;
  if (Number(preferred) === 0) return Math.max(...values);
  const wanted = numberHeight(preferred) ?? 1080;
  return values.includes(wanted) ? wanted : Math.max(...values.filter(value=>value<=wanted),Math.min(...values));
}

function result(status, adapter, requestedHeight, extra = {}) {
  return { status, adapter, requestedHeight, ...extra };
}

function contains(owner, video) {
  if (owner === video) return true;
  if (typeof owner?.contains === 'function') {
    try { return owner.contains(video); } catch { return false; }
  }
  return false;
}

function ancestors(video) {
  const found = [];
  const seen = new Set();
  let node = video;
  for (let depth = 0; node && depth < 32 && !seen.has(node); depth += 1) {
    seen.add(node);
    found.push(node);
    node = node.parentElement || node.parentNode || node.getRootNode?.()?.host;
  }
  return found;
}

function youtubeOwner(video, target) {
  const direct = ancestors(video).find((node) => typeof node?.getAvailableQualityLevels === 'function');
  if (direct) return direct;
  const doc = target?.document;
  if (!doc?.querySelector) return undefined;
  for (const selector of ['#movie_player', '#player', '.html5-video-player']) {
    let node;
    try { node = doc.querySelector(selector); } catch { node = undefined; }
    if (node && contains(node, video) && typeof node.getAvailableQualityLevels === 'function') return node;
  }
  return undefined;
}

function youtubeHeight(level) {
  if (typeof level !== 'string') return numberHeight(level);
  return YOUTUBE_HEIGHTS[level.toLowerCase()] ?? numberHeight(level);
}

function youtubeRouteVideoId(target) {
  try {
    const location = target?.location;
    if (!/(^|\.)youtube\.com$/i.test(String(location?.hostname || ''))) return undefined;
    const url = new URL(location.href);
    return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
  } catch { return undefined; }
}

function youtubeStreamMetadata(player, target) {
  let videoData, response;
  try {
    if (typeof player?.getVideoData !== 'function' || typeof player?.getPlayerResponse !== 'function') return { matched: false };
    videoData = player.getVideoData();
    response = player.getPlayerResponse();
  } catch { return { matched: false } }
  const videoId = videoData?.video_id;
  const responseId = response?.videoDetails?.videoId;
  if (typeof videoId !== 'string' || !/^[\w-]{1,64}$/.test(videoId) || typeof responseId !== 'string') return { matched: false };
  if (responseId !== videoId) return { matched: false, stale: true };
  const routeId = youtubeRouteVideoId(target);
  if (routeId && routeId !== videoId) return { matched: false, stale: true };
  const streamingData = response?.streamingData;
  const formats = [
    ...(Array.isArray(streamingData?.adaptiveFormats) ? streamingData.adaptiveFormats : []),
    ...(Array.isArray(streamingData?.formats) ? streamingData.formats : []),
  ].slice(0, 256);
  return {
    matched: true,
    heights: [...new Set(formats.map((format) => qualityHeight(format?.width, format?.height)).filter(Boolean))],
  };
}

async function applyYoutube(video, preferred, target) {
  const player = youtubeOwner(video, target);
  if (!player) return undefined;
  let levels;
  try { levels = player.getAvailableQualityLevels(); } catch (error) {
    return result('unavailable', 'youtube', preferred, { availableHeights: [], reason: String(error?.message || error) });
  }
  const availableHeights = [...new Set((Array.isArray(levels) ? levels : []).map(youtubeHeight).filter(Boolean))];
  const selectedHeight = chooseHeight(availableHeights, preferred);
  const streamMetadata = youtubeStreamMetadata(player, target);
  if (streamMetadata.stale) return result('unavailable', 'youtube', preferred, { availableHeights });
  if (!selectedHeight) return result('unavailable', 'youtube', preferred, { availableHeights });
  // A newly navigated video can briefly expose only `tiny` while its quality
  // list is still loading.  A matching local player response can signal that
  // discovery is incomplete, but its format list is not treated as a setter
  // capability; wait for the player's own list to catch up.
  const metadataHeight = streamMetadata.matched ? chooseHeight(streamMetadata.heights, preferred) : undefined;
  if (metadataHeight && metadataHeight > selectedHeight) {
    return result('unavailable', 'youtube', preferred, { availableHeights });
  }
  // Preserve the exact level name returned by this player.  `highres` and
  // `hd2160` both mean 2160p but are not interchangeable to every player.
  const quality = levels.find((level) => youtubeHeight(level) === selectedHeight) || `hd${selectedHeight}`;
  // Prefer the range setter when this player exposes it.  The legacy
  // setPlaybackQuality API may be a no-op, so never call both paths.
  const setter = typeof player.setPlaybackQualityRange === 'function'
    ? player.setPlaybackQualityRange
    : player.setPlaybackQuality;
  if (typeof setter !== 'function') return result('unavailable', 'youtube', preferred, { availableHeights });
  try {
    if (setter === player.setPlaybackQualityRange) await setter.call(player, quality, quality);
    else await setter.call(player, quality);
    // A player API readback can report the requested level without the video
    // stream changing.  Confirm against the selected media element instead.
    const actualHeight = qualityHeight(video.videoWidth, video.videoHeight);
    return actualHeight === selectedHeight
      ? result('applied', 'youtube', preferred, { selectedHeight: actualHeight, availableHeights })
      : result('requested', 'youtube', selectedHeight, { selectedHeight: actualHeight, availableHeights });
  } catch (error) {
    return result('failed', 'youtube', preferred, { availableHeights, reason: String(error?.message || error) });
  }
}

function attribute(item, name) {
  try { return item?.dataset?.[name] ?? item?.getAttribute?.(`data-${name}`) ?? item?.getAttribute?.(name); } catch { return undefined; }
}

const BILIBILI_QN_HEIGHTS = { 6: 240, 16: 360, 32: 480, 64: 720, 74: 720, 80: 1080, 112: 1080, 116: 1080, 120: 2160, 125: 2160, 126: 2160, 127: 4320 };

function bilibiliHeight(item) {
  // Visible labels are authoritative; data-value is commonly a QN code.
  const visible = item?.textContent ?? item?.innerText;
  const fromText = numberHeight(visible);
  if (fromText) return fromText;
  const raw = attribute(item, 'height') ?? attribute(item, 'quality');
  const qnRaw = Number(attribute(item, 'value'));
  if (BILIBILI_QN_HEIGHTS[qnRaw]) return BILIBILI_QN_HEIGHTS[qnRaw];
  const rawQn = Number(raw);
  if (BILIBILI_QN_HEIGHTS[rawQn] && /^(?:16|32|64|80|112|120|127)$/.test(String(raw).trim())) return BILIBILI_QN_HEIGHTS[rawQn];
  const direct = numberHeight(raw);
  if (direct) return direct;
  const qn = Number(raw);
  return BILIBILI_QN_HEIGHTS[qn];
}

function disabled(item) {
  let classes = '';
  try { classes = String(item.className?.baseVal ?? item.className ?? '').toLowerCase(); } catch { /* ignored */ }
  const explicit = item?.disabled === true || item?.getAttribute?.('aria-disabled') === 'true' ||
    item?.getAttribute?.('data-vip') === 'true' || item?.getAttribute?.('data-login') === 'true' ||
    item?.getAttribute?.('data-require-login') === 'true' || /\b(?:disabled|vip|login|premium)\b/.test(classes);
  const text = String(item?.textContent ?? item?.innerText ?? '').toLowerCase();
  return explicit || /大会员|付费|登录后|vip/.test(text);
}

function hasClassToken(item, token) {
  try { return item?.classList?.contains(token) || new Set(String(item?.className || '').split(/\s+/)).has(token); } catch { return false; }
}

function bilibiliContainer(video) {
  return ancestors(video).find((node) => {
    return hasClassToken(node, 'bpx-player-container') || hasClassToken(node, 'bpx-player') ||
      hasClassToken(node, 'bilibili-player');
  });
}

async function applyBilibili(video, preferred, target) {
  const hostname = String(target?.location?.hostname || '').toLowerCase();
  const container = bilibiliContainer(video);
  if (!container && !/(^|\.)bilibili\.com$/.test(hostname)) return undefined;
  const root = container || video?.parentElement;
  if (!root?.querySelectorAll) return undefined;
  let items = [];
  try {
    items = [...root.querySelectorAll('.bpx-player-ctrl-quality-menu-item, .bpx-player-ctrl-quality-menu [data-value], .quality-item')]
      .filter((item) => !disabled(item));
  } catch { return undefined; }
  if (!items.length) return undefined;
  const availableHeights = [...new Set(items.map(bilibiliHeight).filter(Boolean))];
  const selected = chooseHeight(availableHeights, preferred);
  if (!selected) return result('unavailable', 'bilibili', preferred, { availableHeights });
  const item = items.find((candidate) => bilibiliHeight(candidate) === selected);
  try { item.click?.(); } catch (error) {
    return result('failed', 'bilibili', preferred, { availableHeights, reason: String(error?.message || error) });
  }
  let confirmed = false;
  try {
    confirmed = ['true', '1'].includes(String(item.getAttribute?.('aria-checked') || '').toLowerCase()) ||
      hasClassToken(item, 'active') || hasClassToken(item, 'selected') || hasClassToken(item, 'current');
  } catch { /* no readback */ }
  const actual = qualityHeight(video.videoWidth, video.videoHeight);
  return confirmed && actual === selected
    ? result('applied', 'bilibili', preferred, { selectedHeight: actual, availableHeights })
    : result('requested', 'bilibili', selected, { selectedHeight: actual, availableHeights });
}

async function applyHls(video, preferred, target) {
  const hls = [video?.hls, video?._hls, video?.__hls, video?.hlsjs, target?.hls]
    .find((candidate) => candidate?.media === video);
  if (!hls) return undefined;
  const levels = Array.isArray(hls.levels) ? hls.levels : [];
  const availableHeights = [...new Set(levels.map((level) => qualityHeight(level?.width,level?.height)).filter(Boolean))];
  const selected = chooseHeight(availableHeights, preferred);
  if (!selected) return result('unavailable', 'hls.js', preferred, { availableHeights });
  const index = levels.findIndex((level) => qualityHeight(level?.width,level?.height) === selected);
  try {
    hls.currentLevel = index;
    const readIndex = hls.currentLevel;
    const videoHeight = qualityHeight(video.videoWidth,video.videoHeight);
    return readIndex === index && videoHeight === selected
      ? result('applied', 'hls.js', preferred, { selectedHeight: videoHeight, availableHeights })
      : result('requested', 'hls.js', selected, { selectedHeight: videoHeight || selected, availableHeights });
  } catch (error) {
    return result('failed', 'hls.js', preferred, { availableHeights, reason: String(error?.message || error) });
  }
}

export async function applyPreferredQuality(video, preferred = 1080, target = globalThis) {
  const requestedHeight = Number(preferred) === 0 ? 0 : numberHeight(preferred) ?? 1080;
  if (!video) return result('unavailable', 'unknown', requestedHeight, { availableHeights: [] });
  try {
    const hls = await applyHls(video, requestedHeight, target);
    if (hls) return hls;
    const youtube = await applyYoutube(video, requestedHeight, target);
    if (youtube) return youtube;
    const bilibili = await applyBilibili(video, requestedHeight, target);
    if (bilibili) return bilibili;
    return result('unsupported', 'unknown', requestedHeight, { availableHeights: [], reason: 'No supported quality control is exposed for this video' });
  } catch (error) {
    return result('failed', 'unknown', requestedHeight, { availableHeights: [], reason: String(error?.message || error) });
  }
}

// Capability lookup is read-only and reserved for explicit popup refreshes.
export function inspectQuality(video, target = globalThis) {
  try {
    const hls = [video?.hls, video?._hls, video?.__hls, video?.hlsjs, target?.hls].find(item => item?.media === video);
    if (hls) return { status:'inspected', adapter:'hls.js', availableHeights:[...new Set((hls.levels||[]).map(level=>qualityHeight(level.width,level.height)).filter(Boolean))] };
    const player = youtubeOwner(video, target);
    if (player) return { status:'inspected', adapter:'youtube', availableHeights:[...new Set((player.getAvailableQualityLevels()||[]).map(youtubeHeight).filter(Boolean))] };
    const container = bilibiliContainer(video);
    if (container) return { status:'inspected', adapter:'bilibili', availableHeights:[...new Set([...container.querySelectorAll('.bpx-player-ctrl-quality-menu-item, .bpx-player-ctrl-quality-menu [data-value], .quality-item')].filter(item=>!disabled(item)).map(bilibiliHeight).filter(Boolean))] };
  } catch { /* An unavailable player API is not a reason to mutate playback. */ }
  return { status:'inspected', adapter:'unknown', availableHeights:[] };
}
