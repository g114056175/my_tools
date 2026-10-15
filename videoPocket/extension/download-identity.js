// Stable identity for a media item across popup instances and inspect calls.
// Deliberately excludes title, URL, quality and kind: video and audio share a lock.
export function downloadIdentity(descriptor = {}) {
  const platform = descriptor.platform || {};
  const site = String(platform.site || '').toLowerCase();
  const identity = site === 'youtube' && platform.id
    ? ['youtube', platform.id]
    : site === 'bilibili' && (platform.bvid || platform.cid)
      ? ['bilibili', platform.bvid || '', Number(platform.cid) || 0, Number(platform.page) || 1]
      : [
          'media',
          descriptor.tabId ?? '', descriptor.documentId ?? '',
          descriptor.mediaKey ?? descriptor.media?.mediaKey ?? '',
          descriptor.frameId ?? '',
          descriptor.localMediaIndex ?? descriptor.mediaIndex ?? '',
          // A page supplied mediaKey/frame/index is stable across CDN/quality
          // refreshes. URL is only a fallback when no page identity exists.
          (descriptor.mediaKey ?? descriptor.media?.mediaKey ?? descriptor.frameId ?? descriptor.localMediaIndex ?? descriptor.mediaIndex) == null
            ? descriptor.url || '' : ''
        ];
  return stableHash([descriptor.tabId ?? '', descriptor.documentId ?? '', ...identity]);
}

export function downloadKey(descriptor = {}) {
  return descriptor.downloadKey || downloadIdentity(descriptor);
}

// FNV-1a is synchronous and available in the MV3 service worker and popup.
export function stableHash(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `media-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createDownloadClaims() {
  const claims = new Map();
  return {
    claim(key, id) {
      if (!key) return {claimed: false};
      const existing = claims.get(key);
      if (existing) return {claimed: false, duplicate: true, id: existing};
      claims.set(key, id);
      return {claimed: true, id};
    },
    release(key, id) {
      if (key && (!id || claims.get(key) === id)) claims.delete(key);
    },
    get(key) { return claims.get(key); },
    clear() { claims.clear(); }
  };
}
