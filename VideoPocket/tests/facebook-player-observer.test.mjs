import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import {
  installMediaObserver,
  OBSERVER_SYMBOL,
} from "../extension/media-observer-source.js";

const pageUrl = "https://www.facebook.com/kfctaiwan/";
const firstId = "1659919149203096";
const secondId = "1129269426460957";
const replacementId = "1567947907969374";
const firstManifest = `<MPD id="${firstId}"></MPD>`;
const secondManifest = `<MPD id="${secondId}"></MPD>`;
const replacementManifest = `<MPD id="${replacementId}"></MPD>`;

function createPlayer(id, xml, parent, document) {
  const propsAtFiberLevel2 = {
    coreVideoPlayerMetaData: { videoFBID: id },
    manifest: xml,
  };
  const video = {
    tagName: "VIDEO",
    nodeType: 1,
    isConnected: true,
    ownerDocument: document,
    parentElement: parent,
    currentSrc: "",
    src: "",
    getAttribute: () => null,
    closest: () => parent,
    querySelectorAll: () => [],
  };
  const fiberLevel2 = { memoizedProps: propsAtFiberLevel2, return: null };
  const fiberLevel1 = { memoizedProps: {}, return: fiberLevel2 };
  const fiberLevel0 = { memoizedProps: {}, return: fiberLevel1, stateNode: video };
  Object.defineProperty(video, "__reactFiber$fixture", {
    configurable: true,
    value: fiberLevel0,
  });
  return { video, propsAtFiberLevel2 };
}

function createPage() {
  const videos = [];
  const parent = {
    tagName: "DIV",
    nodeType: 1,
    children: videos,
    parentElement: null,
    getAttribute: () => null,
    querySelectorAll: (selector) => selector === "video" ? videos : [],
  };
  const document = {
    documentElement: parent,
    querySelectorAll: (selector) => selector === "video" ? videos : [],
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const first = createPlayer(firstId, firstManifest, parent, document);
  const second = createPlayer(secondId, secondManifest, parent, document);
  videos.push(first.video, second.video);

  let nextTimer = 0;
  const timers = new Map();
  const setTimeout = (callback) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  const target = {
    location: { href: pageUrl, hostname: "www.facebook.com" },
    document,
    URL,
    JSON,
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  return { target, document, first, second, timers, setTimeout, clearTimeout };
}

function assertBoundModel(observer, video, id, xml) {
  const model = observer.modelFor(video);
  assert.ok(model, `expected a model for ${id}`);
  assert.ok(model.aliases.includes(id), `expected the selected ID ${id}`);
  assert.equal(model.id, id);
  assert.equal(model.manifestXml, xml);
  return model;
}

function exerciseLatePlayerLifecycle(observer, page, reinstallObserver) {
  const first = assertBoundModel(observer, page.first.video, firstId, firstManifest);
  const second = assertBoundModel(observer, page.second.video, secondId, secondManifest);
  assert.ok(!second.aliases.includes(firstId));
  assert.notEqual(second.manifestXml, first.manifestXml);

  observer.dispose();
  const reinstalled = reinstallObserver();
  assertBoundModel(reinstalled, page.second.video, secondId, secondManifest);

  page.second.propsAtFiberLevel2.coreVideoPlayerMetaData = { videoFBID: replacementId };
  page.second.propsAtFiberLevel2.manifest = replacementManifest;
  const replacement = assertBoundModel(
    reinstalled,
    page.second.video,
    replacementId,
    replacementManifest,
  );
  assert.ok(!replacement.aliases.includes(firstId));
  assert.ok(!replacement.aliases.includes(secondId));

  reinstalled.dispose();
}

test("late source observer binds the selected second Facebook Fiber player and refreshes on reuse", () => {
  const page = createPage();
  // Both rendered players and their Fiber metadata exist before observation;
  // the page supplies no JSON or Worker events for the observer to consume.
  const observer = installMediaObserver(page.target);
  try {
    exerciseLatePlayerLifecycle(observer, page, () => installMediaObserver(page.target));
  } finally {
    page.target[OBSERVER_SYMBOL]?.dispose?.();
    for (const id of page.timers.keys()) page.clearTimeout(id);
  }
});

test("shipped observer bundle binds the selected second Facebook Fiber player and refreshes on reuse", async () => {
  const page = createPage();
  const bundle = await fs.readFile(new URL("../extension/media-observer.js", import.meta.url), "utf8");
  const context = vm.createContext({
    URL,
    JSON,
    TextEncoder,
    TextDecoder,
    WeakRef,
    setTimeout: page.setTimeout,
    clearTimeout: page.clearTimeout,
  });
  context.location = page.target.location;
  context.document = page.document;
  context.addEventListener = page.target.addEventListener;
  context.removeEventListener = page.target.removeEventListener;
  vm.runInContext(bundle, context);

  const observer = vm.runInContext(
    `globalThis[Symbol.for("video-pocket.mediaObserver")]`,
    context,
  );
  assert.ok(observer);
  const bundledPage = { ...page, target: context };
  const reinstallBundleObserver = () => {
    vm.runInContext(bundle, context);
    return vm.runInContext(
      `globalThis[Symbol.for("video-pocket.mediaObserver")]`,
      context,
    );
  };
  try {
    exerciseLatePlayerLifecycle(observer, bundledPage, reinstallBundleObserver);
  } finally {
    vm.runInContext(
      `globalThis[Symbol.for("video-pocket.mediaObserver")]?.dispose?.()`,
      context,
    );
    for (const id of page.timers.keys()) page.clearTimeout(id);
  }
});
