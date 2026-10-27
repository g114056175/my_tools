const PLATFORM = /^(?:youtube|twitch|bilibili|facebook|instagram|tiktok|twitter|x|哔哩哔哩|嗶哩嗶哩)$/iu;
const GENERIC = /^(?:(?:youtube|twitch|bilibili|facebook|instagram|tiktok)\s*[-|·:]?\s*)?(?:(?:html5|embedded)\s*)?(?:video|media|影片|视频|視頻|嵌入(?:式)?影片|嵌入(?:式)?視頻)(?:\s*(?:player|播放器))?$/iu;
const CONTROL = /^(?:播放器|播放|暫停|暂停|播放影片|播放视频|全螢幕|全屏|首頁|首页|home|play|pause|fullscreen|(?:video|影片)\s*\d+)$/iu;
const SOCIAL_HOST = /(^|\.)(?:x|twitter|tiktok|instagram|facebook|reddit)\.com$/i;
const CARD_SELECTOR = [
  'ytd-video-renderer',
  'ytd-rich-item-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-playlist-video-renderer',
  'ytd-reel-item-renderer',
  'bili-video-card',
  '.bili-video-card'
].join(',');
const CARD_TITLE_SELECTOR = [
  '[data-e2e="video-title"]',
  '[data-e2e="browse-video-card-title"]',
  '[data-video-title]',
  '.video-title',
  '#video-title',
  '[itemprop="name"]'
].join(',');
const PLAYER_TITLE_SELECTOR = [
  '.ytp-title-link',
  '.bpx-player-title',
  'h1.video-title',
  '.video-info-title',
  '.video-title',
  '[data-video-title]'
].join(',');
const MAIN_HEADING_SELECTOR = [
  'ytd-watch-metadata h1 yt-formatted-string',
  'ytd-watch-metadata h1',
  '#title h1',
  'h1.video-title',
  '.video-info-title'
].join(',');
const MAX_CARD_ELEMENTS = 96;

export function cleanMediaTitle(value) {
  if (value == null) return '';
  const title = String(value).replace(/\s+/gu, ' ').trim();
  return title && !PLATFORM.test(title) && !GENERIC.test(title) && !CONTROL.test(title) ? title : '';
}

function nodeTitle(node) {
  if (!node) return '';
  for (const attribute of ['data-video-title', 'data-title', 'post-title', 'content', 'title']) {
    const value = cleanMediaTitle(node.getAttribute?.(attribute));
    if (value) return value;
  }
  return cleanMediaTitle(node.textContent);
}

function firstTitle(root, selector) {
  return nodeTitle(root?.querySelector?.(selector));
}

function routeId(document) {
  try {
    const url = new URL(document.location.href);
    return /(^|\.)youtube\.com$/i.test(url.hostname)
      ? url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1] || ''
      : '';
  } catch {
    return '';
  }
}

function boundTitle(video, document) {
  const value = cleanMediaTitle(video.getAttribute?.('data-video-control-title'));
  if (!value) return '';
  const identity = video.getAttribute?.('data-video-control-title-id');
  if (!identity) return '';
  const current = video.getAttribute?.('data-video-control-content-id');
  const route = routeId(document);
  return identity === current && (!route || identity === `yt:${route}` || video.getAttribute?.('data-video-control-preview-id') === identity)
    ? value
    : '';
}

function isSocialPage(document) {
  try {
    return SOCIAL_HOST.test(new URL(document.location.href).hostname);
  } catch {
    return false;
  }
}

function pageTitle(document) {
  if (isSocialPage(document)) return '';
  const values = [document?.title];
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[name="title"]']) {
    values.push(document?.querySelector?.(selector)?.getAttribute?.('content'));
  }
  for (const value of values) {
    const title = cleanMediaTitle(String(value || '')
      .replace(/\s*[-|｜/]\s*(?:YouTube|Twitch|Facebook|Instagram|X)\s*$/iu, '')
      .replace(/[_\s]*哔哩哔哩[_\s]*bilibili\s*$/iu, ''));
    if (title) return title;
  }
  return '';
}

function isSmallSingleVideoCard(card, video, document) {
  if (!card || typeof document?.createTreeWalker !== 'function') return false;
  try {
    const walker = document.createTreeWalker(card, 1);
    let node;
    let count = 0;
    let containsVideo = false;
    while ((node = walker.nextNode())) {
      if (++count > MAX_CARD_ELEMENTS) return false;
      if (node === video) containsVideo = true;
      else if (String(node.tagName || '').toUpperCase() === 'VIDEO') return false;
    }
    return containsVideo;
  } catch {
    return false;
  }
}

function trustedCardTitle(video, document) {
  const card = video.closest?.(CARD_SELECTOR);
  if (!isSmallSingleVideoCard(card, video, document)) return '';
  return cleanMediaTitle(card.getAttribute?.('data-video-title')) || firstTitle(card, CARD_TITLE_SELECTOR);
}

/** Resolve a title using local, bounded sources; unknown media gets a stable numbered fallback. */
export function mediaTitle(video, { document = video?.ownerDocument, index = 0, total = 1 } = {}) {
  const bound = boundTitle(video, document);
  if (bound) return bound;

  const direct = cleanMediaTitle(video.getAttribute?.('data-video-title'))
    || cleanMediaTitle(video.getAttribute?.('data-title'))
    || cleanMediaTitle(video.getAttribute?.('title'));
  if (direct) return direct;

  const player = video.closest?.('#movie_player,.html5-video-player,.bpx-player-container,#bilibili-player,[data-player]');
  const playerTitle = cleanMediaTitle(player?.getAttribute?.('data-video-title'))
    || cleanMediaTitle(player?.getAttribute?.('data-title'))
    || firstTitle(player, PLAYER_TITLE_SELECTOR);
  if (playerTitle) return playerTitle;

  const cardTitle = trustedCardTitle(video, document);
  if (cardTitle) return cardTitle;

  const label = cleanMediaTitle(video.getAttribute?.('aria-label'));
  if (label) return label;

  const post = video.closest?.('shreddit-post,article,[role="article"],[data-testid="tweet"]');
  const mainPlayer = video.closest?.('#movie_player,.bpx-player-container,#bilibili-player');
  if (mainPlayer && !post) {
    const heading = firstTitle(document, MAIN_HEADING_SELECTOR);
    if (heading) return heading;
  }
  if (total === 1 && !post) {
    const title = pageTitle(document);
    if (title) return title;
  }

  return `Video ${index + 1}`;
}

export { GENERIC as GENERIC_MEDIA_TITLE };
