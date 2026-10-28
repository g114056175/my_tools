// Stable identity for a media item across popup instances and inspect calls.
// Deliberately excludes title, URL, quality and kind: video and audio share a lock.
export function downloadIdentity(descriptor = {}) {
  const platform = descriptor.platform || {};
  const site = String(platform.site || '').toLowerCase();
  const ownedContent=descriptor.recoveryIdentity===true?String(descriptor.mediaContentId || descriptor.linkedMedia?.id || ''):'';
  const identity = site === 'youtube' && platform.id
    ? ['youtube', platform.id]
    : site === 'twitch-clip' && platform.slug
      ? ['twitch-clip', String(platform.slug)]
    : ['instagram','twitch','embedded'].includes(site) && platform.id
      ? [site, String(platform.id)]
    : site === 'dailymotion' && platform.id
      ? ['dailymotion', String(platform.id), descriptor.tabId ?? '', descriptor.documentId ?? '', descriptor.frameId ?? '']
    : site === 'bilibili' && (platform.bvid || platform.cid)
      ? ['bilibili', platform.bvid || '', Number(platform.cid) || 0, Number(platform.page) || 1]
    : site === 'metadata-media' && platform.bindingKey
      ? ['metadata-media', platform.bindingKey, descriptor.mediaKey ?? '', descriptor.frameId ?? '']
    : site === 'network-media' && platform.binding === 'player-owned' && ownedContent && descriptor.selectionIdentity
      ? ['player-owned-content',ownedContent,descriptor.selectionIdentity,descriptor.mediaKey ?? '',descriptor.frameId ?? '']
    : site === 'network-media' && platform.binding === 'player-owned'
      ? ['player-owned', platform.bindingSource || '', stableHash(platform.versions || []), descriptor.mediaKey ?? '', descriptor.frameId ?? '']
    : descriptor.linkedMedia?.id
      ? ['linked-media', String(descriptor.linkedMedia.id), descriptor.frameId ?? '']
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
    get size() { return claims.size; },
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
