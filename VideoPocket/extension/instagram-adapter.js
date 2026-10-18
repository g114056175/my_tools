// Read the shortcode-scoped Polaris payload that Instagram embeds in the page.
// This is deliberately limited to the current post; do not scan arbitrary
// JSON for a video URL because Instagram pages contain ads and recommendations.
export function instagramMediaSnapshot(document, shortcode) {
  const wanted = String(shortcode || '');
  if (!document || !wanted) return null;
  const scripts = [...document.querySelectorAll('script[type="application/json"][data-sjs]')];
  const find = (value, depth = 0) => {
    if (!value || depth > 24) return null;
    if (Array.isArray(value)) {
      for (const item of value) { const found = find(item, depth + 1); if (found) return found; }
      return null;
    }
    if (typeof value !== 'object') return null;
    const media = value.xig_polaris_media;
    if (media && typeof media === 'object') {
      const code = String(media.code || media.shortcode || media.pk || '');
      if (code === wanted || wanted === String(media.code || media.shortcode || '')) return media;
      const gated = media.if_not_gated_logged_out;
      if (gated && (String(gated.code || gated.shortcode || '') === wanted || media.code === wanted)) return gated;
    }
    for (const item of Object.values(value)) { const found = find(item, depth + 1); if (found) return found; }
    return null;
  };
  for (const script of scripts) {
    try {
      const root = JSON.parse(script.textContent || '');
      const media = find(root);
      if (!media) continue;
      const product = media.if_not_gated_logged_out || media;
      const versions = Array.isArray(product.video_versions) ? product.video_versions : [];
      const direct = versions
        .map(v => ({ url: typeof v?.url === 'string' ? v.url : '', width: Number(v?.width) || Number(product.original_width) || 0, height: Number(v?.height) || Number(product.original_height) || 0, id: v?.id || v?.type }))
        .filter(v => /^https?:\/\//i.test(v.url))
        .sort((a, b) => (b.width * b.height) - (a.width * a.height));
      return { media: product, versions: direct, dash: typeof product.video_dash_manifest === 'string' ? product.video_dash_manifest : null };
    } catch {}
  }
  return null;
}
