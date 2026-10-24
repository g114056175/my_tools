import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pageSnapshot } from "../extension/page.js";

function video({ title = "", src = "https://cdn.example/threads.mp4" } = {}) {
  return {
    tagName: "VIDEO", currentSrc: src, src, textContent: "",
    paused: false, readyState: 4, textTracks: [], parentElement: null,
    getAttribute(name) { return name === "title" ? title : null; },
    hasAttribute() { return false; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getRootNode() { return { host: null }; },
  };
}

function context(url, currentVideo, model = null) {
  const document = {
    title: "Threads post copy must not become the media title",
    scripts: [], documentElement: { lang: "en" },
    querySelector: () => null,
    querySelectorAll: selector => selector === "video" ? [currentVideo] : [],
  };
  currentVideo.ownerDocument = document;
  const target = {
    URL, URLSearchParams, Symbol, WeakMap, AbortSignal, setTimeout,
    clearTimeout, location: new URL(url), navigator: { languages: ["en"] },
    performance: { now: () => 0, getEntriesByType: () => [] },
    innerHeight: 900, innerWidth: 1200, document, window: null,
  };
  target.window = target;
  target[Symbol.for("video-pocket.mediaObserver")] = {
    videosSnapshot: () => [currentVideo], scanDocument() {},
    modelFor: () => model, sourcesFor: () => ({ candidates: [] }),
    titleFor: () => "", isGenericTitle: value => /^(?:embedded )?video(?: player)?$/i.test(value),
    canonicalVideo: value => value,
  };
  return target;
}

for (const host of ["threads.net", "threads.com"]) {
  test(`Threads ${host} keeps source binding and ignores post copy`, async () => {
    const source = "https://cdn.example/asset.mp4";
    const current = video({ src: source });
    const page = await vm.runInNewContext(`(${pageSnapshot.toString()})()`, context(`https://${host}/@creator/post/123`, current));
    assert.equal(page.videos[0].title, "asset");
    assert.equal(page.videos[0].url, source);
  });
}

test("Threads explicit media title is preserved with its source", async () => {
  const source = "https://cdn.example/explicit.mp4";
  const current = video({ src: source });
  const page = await vm.runInNewContext(
    `(${pageSnapshot.toString()})()`,
    context("https://www.threads.net/@creator/post/456", current, { title: "Explicit media title" }),
  );
  assert.equal(page.videos[0].title, "Explicit media title");
  assert.equal(page.videos[0].url, source);
});
