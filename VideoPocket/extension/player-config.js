// Read known, element-owned player configurations. Never evaluate inline
// scripts, enumerate page globals, or borrow the next video's configuration.
const own = (object, key) => {
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
};
const text = value => typeof value === 'string' ? value.trim() : '';
const positive = value => (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
const attr = (node, key) => { try { return text(node?.getAttribute?.(key)); } catch { return ''; } };
const definitionsOf = value => {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (let i = 0; i < Math.min(value.length, 32); i++) {
    const entry = own(value, String(i));
    if (!entry || typeof entry !== 'object' || own(entry, 'remote')) continue;
    const format = text(own(entry, 'format')).toLowerCase(), videoUrl = text(own(entry, 'videoUrl'));
    if (!['hls', 'dash', 'mp4', 'webm'].includes(format) || !videoUrl || videoUrl.length > 16384) continue;
    const quality = own(entry, 'quality'), defaultQuality = own(entry, 'defaultQuality');
    result.push({format, videoUrl, width: positive(own(entry, 'width')), height: positive(own(entry, 'height')),
      quality: typeof quality === 'string' || typeof quality === 'number' ? quality : undefined,
      adaptive: own(entry, 'adaptive') === true || (Array.isArray(quality) && quality.length > 1) || (Array.isArray(defaultQuality) && defaultQuality.length > 1),
      defaultQuality: defaultQuality === true});
  }
  return result;
};

export function definitionMediaSources(definitions, baseUrl) {
  const sources = [];
  for (const entry of definitionsOf(definitions)) {
    let url;
    try { url = new URL(entry.videoUrl, baseUrl || undefined); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    const manifest = entry.format === 'hls' || entry.format === 'dash';
    // A format label is insufficient for remote API endpoints returning JSON.
    if (!manifest && !/\.(?:mp4|m4v|webm)(?:$)/i.test(url.pathname)) continue;
    sources.push({...entry, url: url.href, height: entry.height || positive(entry.quality)});
  }
  sources.sort((a,b) => Number(b.adaptive)-Number(a.adaptive) || (b.height || 0)-(a.height || 0) || Number(b.defaultQuality)-Number(a.defaultQuality));
  const manifest = sources.find(item => item.format === 'hls' || item.format === 'dash');
  return {manifestUrl: manifest?.url, manifestType: manifest?.format,
    versions: sources.filter(item => item.format === 'mp4' || item.format === 'webm').map(({url,width,height}) => ({url,width,height}))};
}

function hasMedia(video) {
  try {
    return !!(video.currentSrc || attr(video, 'src') || video.srcObject || video.mediaKeys || video.readyState > 0 ||
      [...(video.querySelectorAll?.('source') || [])].some(node => attr(node, 'src')));
  } catch { return true; } // Unknown playback state must not be discarded as a placeholder.
}

export function ownedPlayerConfiguration(video, target) {
  let wrapper;
  try { wrapper = video?.closest?.('[id^="playerDiv_"]'); } catch { return null; }
  const id = attr(wrapper, 'id').match(/^playerDiv_(\d{1,24})$/)?.[1];
  if (!id || !wrapper?.contains?.(video)) return null;
  const unbound = {id, video: null, payload: null};
  const config = own(target, `flashvars_${id}`), definitions = own(config, 'mediaDefinitions');
  if (!config || !Array.isArray(definitions)) return unbound;

  // Return a recognized but unbound result on conflicting IDs. This prevents
  // an older cached model from rescuing a recycled/ambiguous player element.
  const record = own(own(target, 'playerObjList'), `playerDiv_${id}`);
  const explicitIds = ['video_id', 'videoId', 'videoID'].map(key => own(config, key));
  explicitIds.push(own(own(config, 'playbackTracking'), 'video_id'), own(own(record, 'flashvars'), 'embedId'));
  if (explicitIds.some(value => value != null && (!['string','number'].includes(typeof value) || String(value) !== id))) return unbound;
  for (let node = video, depth = 0; node && depth < 16; node = node.parentElement, depth++) {
    const declared = attr(node, 'data-video-id');
    if (declared && declared !== id) return unbound;
    if (declared || /^(BODY|HTML)$/.test(node.tagName || '')) break;
  }
  let videos;
  try { videos = [...wrapper.querySelectorAll('video')]; } catch { return unbound; }
  if (!videos.includes(video) || videos.length > 8) return unbound;
  const active = videos.filter(hasMedia);
  const selected = active.length === 1 ? active[0] : videos.length === 1 ? video : null;
  if (!selected) return unbound;
  return {id, video: selected, payload: {
    video_id: id,
    video_title: text(own(config, 'video_title')).slice(0,512),
    video_duration: positive(own(config, 'video_duration')),
    mediaDefinitions: definitionsOf(definitions),
  }};
}
