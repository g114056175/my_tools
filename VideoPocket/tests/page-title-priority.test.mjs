import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pageSnapshot } from "../extension/page.js";
import { isGenericMediaTitle, titleFor } from "../extension/media-titles.js";

function element({ tag = "div", text = "", attrs = {}, children = [], rootHost = null } = {}) {
  const item = {
    tagName: tag.toUpperCase(), textContent: text, children, parentElement: null,
    textTracks: [], src: "", currentSrc: "", paused: true, readyState: 4,
    ownerDocument: null,
    getAttribute(name) { return attrs[name] ?? null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
    getRootNode() { return { host: rootHost }; },
    contains(other) { return other === item || children.some(child => child.contains(other)); },
    closest(selector) {
      for (let current = item; current; current = current.parentElement) {
        if (selector.includes("shreddit-post") && current.tagName === "SHREDDIT-POST") return current;
        if (selector.includes("article") && current.tagName === "ARTICLE") return current;
        if (selector.includes("[role='article']") && current.getAttribute("role") === "article") return current;
        if (selector.includes("#bilibili-player") && current.getAttribute("id") === "bilibili-player") return current;
        if (selector.includes("[data-a-target=\"video-player\"]") && current.getAttribute("data-a-target") === "video-player") return current;
      }
      return null;
    },
    querySelectorAll(selector) {
      const result = [];
      const match = child => {
        const slot = child.getAttribute("slot");
        return selector === "video" && child.tagName === "VIDEO" ||
          selector === "*" ||
          selector.includes("post-title") && (slot === "post-title" || child.getAttribute("data-testid") === "post-title") ||
          selector.includes("a[href]") && child.tagName === "A" && !!child.getAttribute("href") ||
          selector.includes("[data-a-target='video-title']") && child.getAttribute("data-a-target") === "video-title" ||
          selector.includes("[slot='post-title']") && slot === "post-title";
      };
      const visit = child => { if (match(child)) result.push(child); child.children.forEach(visit); };
      children.forEach(visit);
      return result;
    },
    querySelector(selector) { return item.querySelectorAll(selector)[0] || null; },
  };
  children.forEach(child => { child.parentElement = item; });
  return item;
}

function makeContext({ url, videos, documentTitle = "頁面", documentNodes = [], querySelector, initialState, player } = {}) {
  const document = {
    title: documentTitle,
    scripts: [],
    documentElement: { lang: "zh-Hant" },
    querySelector: querySelector || (selector => selector === "h1.ytd-watch-metadata" ? documentNodes.find(node => node.tagName === "H1") || null : null),
    querySelectorAll: selector => selector === "video" ? videos : documentNodes.flatMap(node => node.querySelectorAll?.(selector) || []),
  };
  const context = {
    URL, URLSearchParams, Symbol, WeakMap, AbortSignal, setTimeout,
    location: new URL(url), navigator: { languages: ["zh-TW"] },
    performance: { now: () => 0, getEntriesByType: () => [] },
    innerHeight: 900, innerWidth: 1200, document, window: null,
  };
  context.window = context;
  if (initialState) context.__INITIAL_STATE__ = initialState;
  if (player) context.document.querySelector = selector => selector === "#movie_player" ? player : null;
  for (const node of [...videos, ...documentNodes]) node.ownerDocument = document;
  return context;
}

function observer() {
  return {
    scanDocument() {},
    modelFor() { return null; },
    sourcesFor() { return { candidates: [] }; },
    titleFor(video) { return titleFor(video); },
    isGenericTitle: isGenericMediaTitle,
  };
}

test("Twitch collection page title is not substituted for an unnamed featured video", async () => {
  const video = element({ tag: "video", attrs: { "aria-label": "Twitch 影片播放器" } });
  const context = makeContext({ url: "https://www.twitch.tv/twitch/clips?range=7d", videos: [video], documentTitle: "Twitch 的剪輯 - Twitch" });
  context[Symbol.for("video-pocket.mediaObserver")] = {...observer(), twitchPlayerFor:()=>({kind:"vod",id:"12345"})};
  for(const mode of ['summary','deep']){
    const page = await vm.runInNewContext(`(${pageSnapshot.toString()})(0,${JSON.stringify(mode)})`, context);
    assert.equal(page.videos[0].title, "Video 1");
    if(mode==='deep')assert.equal(page.platform.title,"Video 1");
  }
});

test("YouTube player API title wins over the actual aria label YouTube 影片播放器", async () => {
  const playerElement = element({ tag: "div", attrs: { id: "movie_player" } });
  const video = element({ tag: "video", attrs: { "aria-label": "YouTube 影片播放器" } });
  playerElement.children.push(video); video.parentElement = playerElement;
  const player = Object.assign(playerElement, { getPlayerResponse: () => ({ videoDetails: { videoId: "abc", title: "API 真實影片標題" } }) });
  const context = makeContext({ url: "https://www.youtube.com/watch?v=abc", videos: [video], player, documentTitle: "YouTube 影片播放器" });
  context[Symbol.for("video-pocket.mediaObserver")] = observer();
  const page = await vm.runInNewContext(`(${pageSnapshot.toString()})()`, context);
  assert.equal(page.videos[0].title, "API 真實影片標題");
});

test("social post headings are not used as media names and do not borrow a sibling", async () => {
  const firstHeading = element({ tag: "h2", text: "社群貼文真實標題", attrs: { slot: "post-title" } });
  const firstVideo = element({ tag: "video", attrs: { "aria-label": "影片播放器" } });
  const secondHeading = element({ tag: "h2", text: "另一則貼文標題", attrs: { slot: "post-title" } });
  const secondVideo = element({ tag: "video", attrs: { "aria-label": "嵌入式影片" } });
  const firstPost = element({ tag: "article", children: [firstHeading, firstVideo] });
  const secondPost = element({ tag: "article", children: [secondHeading, secondVideo] });
  const context = makeContext({ url: "https://social.example/feed", videos: [firstVideo, secondVideo], documentNodes: [firstPost, secondPost] });
  context[Symbol.for("video-pocket.mediaObserver")] = observer();
  const page = await vm.runInNewContext(`(${pageSnapshot.toString()})(0)`, context);
  assert.equal(page.videos[0].title, "Video 1");
  assert.equal(page.videos[1].title, "Video 2");
});

test("Bilibili initial state title survives the Chinese generic video label", async () => {
  const video = element({ tag: "video", attrs: { "aria-label": "影片播放器" } });
  const player = element({ tag: "div", attrs: { id: "bilibili-player" }, children: [video] });
  const url = "https://www.bilibili.com/video/BVtitle01/?p=1";
  const context = makeContext({ url, videos: [video], documentNodes: [player], documentTitle: "影片播放器" , initialState: { videoData: { bvid: "BVtitle01", title: "B站初始真實標題", pages: [{ cid: 11, duration: 60 }] } } });
  context[Symbol.for("video-pocket.mediaObserver")] = observer();
  context.fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { bvid: "BVtitle01", cid: 11, dash: { video: [{ baseUrl: "https://cdn.example/video.m4s" }] } } }) });
  const page = await vm.runInNewContext(`(${pageSnapshot.toString()})()`, context);
  assert.equal(page.videos[0].title, "B站初始真實標題");
});

test("unnamed generic players use their numbered fallback and never cross-name", async () => {
  const first = element({ tag: "video", attrs: { "aria-label": "Video player" } });
  const second = element({ tag: "video", attrs: { "aria-label": "嵌入式影片" } });
  const context = makeContext({ url: "https://player.example/watch", videos: [first, second], documentTitle: "Video player" });
  context[Symbol.for("video-pocket.mediaObserver")] = observer();
  const page = await vm.runInNewContext(`(${pageSnapshot.toString()})(1)`, context);
  assert.equal(page.videos[0].title, "Video 1");
  assert.equal(page.videos[1].title, "Video 2");
});

test("social document title is not treated as a video name", async () => {
  const video = element({ tag: "video", attrs: { "aria-label": "Embedded video" } });
  const context = makeContext({ url: "https://x.com/OpenAIDevs/status/2112242739198959913", videos: [video], documentTitle: "Here’s what we’re cooking with Codex: 以下是..." });
  context[Symbol.for("video-pocket.mediaObserver")] = observer();
  const page = await vm.runInNewContext(`(${pageSnapshot.toString()})()`, context);
  assert.equal(page.videos[0].title, "Video 1");
});
