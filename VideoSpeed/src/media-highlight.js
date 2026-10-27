// Short lived, non intrusive highlight for a media item selected by mediaKey.
// The exported function is self contained so it can be serialized by
// chrome.scripting.executeScript({world: 'MAIN'}).
export function highlightMedia(options = {}) {
  const stateKey = Symbol.for('video-control.media-highlight');
  const markerSelector = '[data-video-control-media-highlight]';
  const old = globalThis[stateKey];
  const removeMarkers = () => {
    try { globalThis.document?.querySelectorAll?.(markerSelector)?.forEach?.(node => node.remove?.()); } catch {}
  };
  const clearOld = () => {
    try { old?.clear?.(); } catch {}
    removeMarkers();
  };

  if ((options.clear || options.renew) && options.requestId && old?.requestId !== options.requestId) return {highlighted: false};
  if (options.clear) {
    clearOld();
    return {highlighted: false};
  }
  if (options.renew) {
    if (!old?.frame?.isConnected) return {highlighted: false};
    old.renew?.();
    old.paint?.();
    return {highlighted: true};
  }

  const identities = globalThis[Symbol.for('video-control.identities')];
  const registry = globalThis[Symbol.for('video-control.selection')];
  const wanted = options.mediaKey;
  if (wanted == null || !identities?.keys?.get) {
    if (old) clearOld();
    return {highlighted: false};
  }

  const videos = [];
  const add = video => {
    if (!video || videos.includes(video)) return;
    if (String(video.tagName || '').toLowerCase() === 'video') videos.push(video);
  };
  for (const video of Array.isArray(registry?.videos) ? registry.videos : []) add(video);
  // Registry already resolved the selected video; no additional document walk.
  const video = videos.find(item => identities.keys.get(item) === wanted);
  if (!video) {
    if (old) clearOld();
    return {highlighted: false};
  }
  try {
    const root = globalThis.document?.documentElement;
    if (typeof video.isConnected === 'boolean') {
      if (!video.isConnected) { if (old) clearOld(); return {highlighted: false}; }
    } else {
      const composedRoot = video.getRootNode?.({composed: true});
      if (composedRoot && composedRoot !== globalThis.document) { if (old) clearOld(); return {highlighted: false}; }
      if (!composedRoot && root?.contains && !root.contains(video)) { if (old) clearOld(); return {highlighted: false}; }
    }
  } catch {
    if (old) clearOld();
    return {highlighted: false};
  }

  // Only an explicit dropdown change requests scrolling. Opening/refreshing
  // the popup or renewing its marker must leave the page position alone.
  if (options.scrollIntoView === true) try { video.scrollIntoView?.({behavior: 'instant', block: 'center', inline: 'nearest'}); } catch {}

  const host = video.parentElement || globalThis.document?.body || globalThis.document?.documentElement;
  const sameTarget = old?.video === video && old.mediaKey === wanted && old.frame?.isConnected;
  if (sameTarget) {
    const title = String(options.title ?? '').trim() || "Video";
    if (old.titleNode && old.titleNode.textContent !== title) old.titleNode.textContent = title;
    old.requestId = options.requestId;
    if (host?.append && old.frame.parentElement !== host) {
      try { host.append(old.frame); old.host = host; } catch {}
    }
    old.renew?.();
    old.paint?.();
    return {highlighted: true};
  }

  // Remove stale markers only when the target actually changes, disappears,
  // or the existing frame has been detached by the page.
  clearOld();
  if (!host?.append || !globalThis.document?.createElement) return {highlighted: false};

  const frame = globalThis.document.createElement('div');
  frame.setAttribute?.('data-video-control-media-highlight', '1');
  Object.assign(frame.style, {
    position: 'absolute', zIndex: '4', pointerEvents: 'none',
    border: '3px solid #2b85bf', outline: '1px solid #ffffffb3', boxSizing: 'border-box', display: 'block', visibility: 'hidden',
    margin: '0', padding: '0', transition: 'none', animation: 'none', transform: 'none',
  });
  const label = globalThis.document.createElement('div');
  // Labels are presentation-only. Only a caller-supplied title is trusted;
  // generic aria/title/document strings frequently describe the page rather
  // than this media element.
  const titleNode = globalThis.document.createElement('span'), rate = globalThis.document.createElement('span');
  titleNode.textContent = String(options.title ?? '').trim() || "Video";
  Object.assign(titleNode.style, {minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis'});
  Object.assign(rate.style, {flexShrink: '0', fontVariantNumeric: 'tabular-nums'});
  label.append(titleNode, rate);
  Object.assign(label.style, {position: 'absolute', left: '3px', top: '3px', display: 'flex', alignItems: 'center', gap: '8px', maxWidth: 'min(calc(100% - 6px), calc(100vw - 12px))', boxSizing: 'border-box', padding: '3px 6px', borderRadius: '3px', background: '#2b85bf', color: '#fff', font: '600 12px/1.4 "Segoe UI",sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none'});
  frame.append(label);
  const blockedByDialog = () => {
    try {
      return [...globalThis.document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]')].some(dialog => {
        if (dialog.contains?.(video)) return false;
        const r = dialog.getBoundingClientRect?.(); if (!r || r.width <= 0 || r.height <= 0) return false;
        const style = globalThis.getComputedStyle?.(dialog);
        return !style || style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
      });
    } catch { return false; }
  };
  let timer, updateTimer;
  const paint = () => {
    try {
      const nextRate = String(Number(Number(video.playbackRate || 1).toFixed(2))) + '×';
      if (rate.textContent !== nextRate) rate.textContent = nextRate;
      const value = video.getBoundingClientRect?.();
      if (video.isConnected === false || !value || value.width <= 0 || value.height <= 0 || blockedByDialog()) { frame.style.display = 'none'; return; }
      // display:none has no offsetParent. Measure in the real containing block
      // before showing the marker, including when returning from a hidden state.
      Object.assign(frame.style, {display: 'block', visibility: 'hidden'});
      let parent = frame.offsetParent;
      if (parent === globalThis.document.body && globalThis.getComputedStyle?.(parent)?.position === 'static') parent = null;
      const bounds = parent?.getBoundingClientRect?.();
      const sx = bounds && parent.offsetWidth ? bounds.width / parent.offsetWidth : 1, sy = bounds && parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
      const left = parent ? (value.left - (bounds?.left || 0)) / sx + (parent.scrollLeft || 0) - (parent.clientLeft || 0) : value.left + (globalThis.scrollX || 0);
      const top = parent ? (value.top - (bounds?.top || 0)) / sy + (parent.scrollTop || 0) - (parent.clientTop || 0) : value.top + (globalThis.scrollY || 0);
      const viewportRight = Number.isFinite(globalThis.innerWidth) ? globalThis.innerWidth - value.left - 6 : Infinity;
      const frameWidth = value.width / sx;
      label.style.maxWidth = `${Math.max(0, Math.min(frameWidth - 6, viewportRight / sx))}px`;
      Object.assign(frame.style, {left: `${left}px`, top: `${top}px`, width: `${frameWidth}px`, height: `${value.height / sy}px`, visibility: 'visible'});
    } catch { frame.style.display = 'none'; }
  };
  const clear = () => {
    clearTimeout(timer); clearInterval(updateTimer);
    globalThis.removeEventListener?.('scroll', paint, true);
    globalThis.removeEventListener?.('resize', paint, true);
    frame.remove?.();
    if (globalThis[stateKey]?.clear === clear) delete globalThis[stateKey];
  };
  const renew = () => { clearTimeout(timer); timer = setTimeout(clear, 8000); };
  host.append(frame);
  globalThis.addEventListener?.('scroll', paint, true);
  globalThis.addEventListener?.('resize', paint, true);
  paint();
  updateTimer = setInterval(paint, 200);
  renew();
  globalThis[stateKey] = {clear, renew, paint, frame, video, mediaKey: wanted, requestId: options.requestId, titleNode, rate, host};
  return {highlighted: true};
}
