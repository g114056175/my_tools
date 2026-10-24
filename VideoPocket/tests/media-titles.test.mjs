import test from "node:test";
import assert from "node:assert/strict";
import { isGenericMediaTitle, titleCandidates, titleFor } from "../extension/media-titles.js";

function node({tag = "div", text = "", attrs = {}, children = [], rootHost = null} = {}) {
  const item = {
    tagName: tag.toUpperCase(), textContent: text, children, parentElement: null,
    getAttribute(name) { return attrs[name] ?? ""; },
    getRootNode() { return rootHost ? {host: rootHost} : {host: null}; },
    contains(other) { return other === item || children.some(child => child.contains(other)); },
    closest(selector) {
      let current = item;
      while (current) {
        if ((selector.includes("shreddit-post") && current.tagName === "SHREDDIT-POST") ||
            (selector.includes("article") && current.tagName === "ARTICLE") ||
            (selector.includes("[role='article']") && current.getAttribute("role") === "article")) return current;
        current = current.parentElement;
      }
      return null;
    },
    querySelectorAll(selector) {
      const result = [];
      const visit = child => {
        const slot = child.getAttribute("slot");
        const test = selector === "video" && child.tagName === "VIDEO" ||
          selector.includes("a[href]") && child.tagName === "A" && !!child.getAttribute("href") ||
          selector.includes("post-title") && (slot === "post-title" || child.getAttribute("data-testid") === "post-title") ||
          selector.includes("tweetText") && child.getAttribute("data-testid") === "tweetText" ||
          selector.includes("video-title") && child.getAttribute("data-testid") === "video-title" ||
          selector.includes("data-a-target='video-title'") && child.getAttribute("data-a-target") === "video-title";
        if (test) result.push(child);
        child.children.forEach(visit);
      };
      children.forEach(visit); return result;
    },
  };
  children.forEach(child => { child.parentElement = item; });
  return item;
}

test("generic player labels are rejected", () => {
  assert.equal(isGenericMediaTitle(" Twitch video player "), true);
  assert.equal(isGenericMediaTitle("影片 2"), true);
  assert.equal(isGenericMediaTitle("Twitch 影片播放器 21"), true);
  assert.equal(isGenericMediaTitle("Twitch 視頻播放器"), true);
  assert.equal(isGenericMediaTitle("Live concert — encore"), false);
});

test("Reddit title is found through a real shadow-root host chain", () => {
  const post = node({tag: "shreddit-post", attrs: {title: "Shadow 貼文標題"}});
  const host = node({tag: "shreddit-player", rootHost: post});
  const video = node({tag: "video", attrs: {"aria-label": "影片播放器"}, rootHost: host});
  assert.equal(titleFor(video), "Shadow 貼文標題");
});

test("social post copy and translations are never used as a media title", () => {
  const copy = node({tag: "div", text: "Here’s what we’re cooking with Codex: 以下是...", attrs: {"data-testid": "tweetText"}});
  const video = node({tag: "video", attrs: {"aria-label": "Embedded video"}});
  const post = node({tag: "article", children: [copy, video]});
  assert.equal(titleFor(video), "");
  const card = node({tag: "div", text: "COOKED: Ep. 1", attrs: {"data-testid": "video-title"}});
  const cardVideo = node({tag: "video"});
  node({tag: "article", children: [node({tag: "div", children: [card, cardVideo]})]});
  assert.equal(titleFor(cardVideo), "COOKED: Ep. 1");
});

test("X broadcast aria title is scoped to the owning card", () => {
  const link = node({tag: "a", text: "", attrs: {href: "/i/broadcasts/1RKZzBELBbXKB", "aria-label": "Open broadcast: COOKED: Ep. 1 🧑‍🍳"}});
  const video = node({tag: "video"});
  node({tag: "article", children: [link, video]});
  assert.equal(titleFor(video), "COOKED: Ep. 1 🧑‍🍳");
});

test("X broadcast titles do not cross between cards in one article", () => {
  const a = node({tag: "a", attrs: {href: "/i/broadcasts/a111", "aria-label": "Open broadcast: Card A"}});
  const b = node({tag: "a", attrs: {href: "/i/broadcasts/b222", "aria-label": "Open broadcast: Card B"}});
  const va = node({tag: "video"}), vb = node({tag: "video"});
  const cardA = node({tag: "div", children: [a, va]}), cardB = node({tag: "div", children: [b, vb]});
  node({tag: "article", children: [cardA, cardB]});
  assert.equal(titleFor(va), "Card A");
  assert.equal(titleFor(vb), "Card B");
});

test("a shared video container with different broadcast IDs is ambiguous", () => {
  const a = node({tag: "a", attrs: {href: "/i/broadcasts/a111", "aria-label": "Open broadcast: A"}});
  const b = node({tag: "a", attrs: {href: "/i/broadcasts/b222", "aria-label": "Open broadcast: B"}});
  const video = node({tag: "video"});
  node({tag: "div", children: [a, b, video]});
  assert.equal(titleFor(video), "");
});

test("explicit card titles stay bound to each video in a multi-video article", () => {
  const titleA = node({tag: "div", text: "Card A", attrs: {"data-testid": "video-title"}});
  const titleB = node({tag: "div", text: "Card B", attrs: {"data-testid": "video-title"}});
  const va = node({tag: "video"}), vb = node({tag: "video"});
  const cardA = node({tag: "div", children: [titleA, va]}), cardB = node({tag: "div", children: [titleB, vb]});
  node({tag: "article", children: [cardA, cardB]});
  assert.equal(titleFor(va), "Card A");
  assert.equal(titleFor(vb), "Card B");
});

test("a sibling-only card title is ignored", () => {
  const title = node({tag: "div", text: "Other card", attrs: {"data-testid": "video-title"}});
  const video = node({tag: "video"}), siblingVideo = node({tag: "video"});
  node({tag: "article", children: [title, video, siblingVideo]});
  assert.equal(titleFor(video), "");
});

test("Reddit post title wins over generic player aria text", () => {
  const title = node({tag: "h1", text: "  夜市現場演出  ", attrs: {slot: "post-title"}});
  const video = node({tag: "video", attrs: {"aria-label": "影片播放器"}});
  const post = node({tag: "shreddit-post", attrs: {"post-title": "夜市現場演出"}, children: [title, video]});
  assert.equal(titleFor(video), "夜市現場演出");
  assert.equal(titleCandidates(video)[0].source, "post.post-title");
  assert.equal(titleCandidates(video).length, 1);
  assert.equal(post.contains(video), true);
});

test("a nearby Reddit title link is bounded to the owning post", () => {
  const link = node({tag: "a", text: "街頭魔術", attrs: {href: "/r/videos/comments/abc/"}});
  const video = node({tag: "video"});
  const post = node({tag: "shreddit-post", children: [link, video]});
  assert.equal(titleFor(video), "街頭魔術");
  assert.equal(post.contains(video), true);
});

test("nested quoted post uses its own title and never the outer title", () => {
  const video = node({tag: "video"});
  const inner = node({tag: "shreddit-post", attrs: {title: "引用內文標題"}, children: [video]});
  node({tag: "shreddit-post", attrs: {title: "外層貼文標題"}, children: [inner]});
  assert.equal(titleFor(video), "引用內文標題");
});

test("without a post, title is limited to the owning single-video wrapper", () => {
  const video = node({tag: "video", attrs: {title: "播放器自己的標題"}});
  const wrapper = node({tag: "div", attrs: {class: "player-shell"}, children: [video]});
  const neighbour = node({tag: "div", attrs: {class: "player-shell"}, children: [node({tag: "video"}), node({tag: "h2", text: "鄰居標題"})]});
  const document = node({tag: "main", children: [wrapper, neighbour]});
  video.ownerDocument = document;
  assert.equal(titleFor(video), "播放器自己的標題");
  assert.equal(titleCandidates(video).some(item => item.title === "鄰居標題"), false);
});
