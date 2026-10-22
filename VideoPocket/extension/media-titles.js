// Resolve a human title for a media element without borrowing text from a
// neighbouring post.  This module intentionally has no observer or page
// dependencies; callers can use it while constructing their media models.

const GENERIC = new Set([
  "video player",
  "embedded video",
  "twitch video player",
  "影片播放器",
  "视频播放器",
  "視頻播放器",
  "twitch 影片播放器",
  "twitch 视频播放器",
  "twitch 視頻播放器",
  "影片",
  "video",
]);

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 512);

export function isGenericMediaTitle(value) {
  const text = clean(value).toLocaleLowerCase();
  return !text || GENERIC.has(text) ||
    /^(?:twitch\s+)?(?:video|影片|视频|視頻)\s*(?:player|播放器)?\s*\d*$/i.test(text);
}

const textOf = node => {
  try {
    return clean(node?.textContent || node?.innerText || "");
  } catch {
    return "";
  }
};

const attr = (node, name) => {
  try { return clean(node?.getAttribute?.(name)); } catch { return ""; }
};

const query = (node, selector) => {
  try { return [...(node?.querySelectorAll?.(selector) || [])]; } catch { return []; }
};

const closest = (node, selector) => {
  try { return node?.closest?.(selector) || null; } catch { return null; }
};

const parentAcrossShadow = node => {
  try {
    if (node?.parentElement) return node.parentElement;
    const root = node?.getRootNode?.();
    return root?.host || null;
  } catch { return null; }
};

const ownPost = video => {
  for (let node = video, depth = 0; node && depth++ < 32; node = parentAcrossShadow(node)) {
    if (/^SHREDDIT-POST$/.test(node.tagName || "")) return node;
    if (node.tagName === "ARTICLE" || attr(node, "role").toLowerCase() === "article") return node;
  }
  return null;
};

const mediaCount = scope => query(scope, "video").length;
const nearestBoundedScope = video => {
  for (let node = parentAcrossShadow(video), depth = 0; node && depth++ < 16; node = parentAcrossShadow(node)) {
    const marked = /^(FIGURE|SECTION|DIV)$/.test(node.tagName || "") &&
      ["data-video-id", "data-media-id", "data-post-id", "data-a-target"].some(name => attr(node, name)) ||
      /video-js|player/i.test(attr(node, "class"));
    if (marked && mediaCount(node) === 1) return node;
  }
  return null;
};

// Return the closest title-bearing node while excluding nested posts. A
// quoted/embedded post can otherwise make the parent post look like the video
// title, which is especially common in Reddit feeds.
const inScope = (video, post) => {
  if (!post) return nearestBoundedScope(video);
  const nested = query(post, "shreddit-post,article,[role='article']");
  if (!nested.includes(video) && nested.some(node => node !== post && node.contains?.(video))) {
    return nested.find(node => node !== post && node.contains?.(video)) || post;
  }
  return post;
};

const candidate = (value, score, source) => {
  const title = clean(value);
  return isGenericMediaTitle(title) ? null : { title, score, source };
};

export function titleCandidates(video, options = {}) {
  if (!video) return [];
  const post = options.post || ownPost(video);
  const scope = options.scope || inScope(video, post);
  const candidates = [];
  const add = (value, score, source) => {
    const item = candidate(value, score, source);
    if (item && !candidates.some(existing => existing.title === item.title)) candidates.push(item);
  };

  // Reddit's post title is the strongest signal. Prefer attributes on the
  // post itself, then title slots inside that same post.
  if (post) {
    for (const name of ["post-title", "title", "data-post-title", "data-title"]) add(attr(post, name), 100, `post.${name}`);
    for (const node of query(post, ":scope > [slot='post-title'], :scope > .post-title, :scope > [data-testid='post-title']"))
      add(textOf(node), 98, "post-title");
    // Fallback for DOM implementations without :scope support.
    for (const node of query(post, "[slot='post-title'],.post-title,[data-testid='post-title']"))
      if (!node.closest?.("shreddit-post") || node.closest("shreddit-post") === post) add(textOf(node), 98, "post-title");
  }

  // A title link is trusted only when it belongs to this post's bounded
  // container and points at a Reddit post/video route. Generic links and
  // links in a sibling post are intentionally ignored.
  for (const node of query(scope, "a[href]")) {
    const href = attr(node, "href");
    if (!/(?:\/comments\/|\/s\/|\/r\/[^/]+\/comments\/|\/videos?\/)/i.test(href)) continue;
    if (node !== scope && node.closest?.("shreddit-post,article,[role='article']") !== scope) continue;
    add(textOf(node) || attr(node, "aria-label") || attr(node, "title"), 84, "title-link");
  }

  // Platform player titles are useful when no post title exists, but only
  // within the media container and never from a parent document heading.
  for (const selector of [
    "[data-a-target='video-title']",
    "[data-a-target='player-overlay-title']",
    "[data-testid='video-title']",
    "[data-video-title]",
  ]) for (const node of query(scope, selector)) add(textOf(node) || attr(node, "data-video-title"), 72, "player-title");

  // Some players expose their own title only on the media element. This is a
  // fallback after post and bounded-player titles, never document.title.
  if (video) {
    add(attr(video, "title"), 60, "video.title");
    add(attr(video, "aria-label"), 60, "video.aria-label");
  }
  if (scope && scope !== video) {
    add(attr(scope, "title"), 58, "player.title");
    add(attr(scope, "aria-label"), 58, "player.aria-label");
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function titleFor(video, options = {}) {
  return titleCandidates(video, options)[0]?.title || "";
}
