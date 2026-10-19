// Short lived, non intrusive highlight for a media item selected by mediaKey.
// The exported function is self contained so it can be serialized by
// chrome.scripting.executeScript({world: 'MAIN'}).
export function highlightMedia(options = {}) {
  const stateKey = Symbol.for('video-pocket.media-highlight');
  const old = globalThis[stateKey];
  if (old?.clear) old.clear();
  if (options.clear) return {highlighted: false};

  const identities = globalThis[Symbol.for('video-pocket.identities')];
  const registry = globalThis[Symbol.for('video-pocket.selection')];
  const wanted = options.mediaKey;
  if (wanted == null || !identities?.keys?.get) return {highlighted: false};

  const videos = [];
  const add = video => {
    if (!video || videos.includes(video)) return;
    if (String(video.tagName || '').toLowerCase() === 'video') videos.push(video);
  };
  for (const video of Array.isArray(registry?.videos) ? registry.videos : []) add(video);
  const walk = root => {
    try { root?.querySelectorAll?.('video').forEach(add); } catch {}
    try {
      root?.querySelectorAll?.('*').forEach(node => { if (node.shadowRoot) walk(node.shadowRoot); });
    } catch {}
  };
  walk(globalThis.document);
  const video = videos.find(item => identities.keys.get(item) === wanted);
  if (!video) return {highlighted: false};
  try {
    const root = globalThis.document?.documentElement;
    if (typeof video.isConnected === 'boolean') {
      if (!video.isConnected) return {highlighted: false};
    } else {
      const composedRoot = video.getRootNode?.({composed: true});
      if (composedRoot && composedRoot !== globalThis.document) return {highlighted: false};
      if (!composedRoot && root?.contains && !root.contains(video)) return {highlighted: false};
    }
  } catch { return {highlighted: false}; }

  const host = globalThis.document?.body || globalThis.document?.documentElement;
  if (!host?.append || !globalThis.document?.createElement) return {highlighted: false};
  const frame = globalThis.document.createElement('div');
  frame.setAttribute?.('data-video-pocket-media-highlight', '1');
  Object.assign(frame.style, {
    position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
    border: '2px solid #16a34a', boxSizing: 'border-box', display: 'none',
  });
  const rect = () => {
    try {
      const value = video.getBoundingClientRect?.();
      return value && value.width > 0 && value.height > 0 ? value : null;
    } catch { return null; }
  };
  const paint = () => {
    const value = rect();
    if (!value) { frame.style.display = 'none'; return; }
    Object.assign(frame.style, {display: 'block', left: `${value.left}px`, top: `${value.top}px`, width: `${value.width}px`, height: `${value.height}px`});
  };
  const clear = () => {
    clearTimeout(timer);
    globalThis.removeEventListener?.('scroll', paint, true);
    globalThis.removeEventListener?.('resize', paint, true);
    frame.remove?.();
    if (globalThis[stateKey]?.clear === clear) delete globalThis[stateKey];
  };
  host.append(frame);
  globalThis.addEventListener?.('scroll', paint, true);
  globalThis.addEventListener?.('resize', paint, true);
  paint();
  const timer = setTimeout(clear, 1800);
  globalThis[stateKey] = {clear, timer};
  return {highlighted: true};
}
