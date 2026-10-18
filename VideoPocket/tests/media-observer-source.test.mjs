import test from "node:test";
import assert from "node:assert/strict";
import {
  installMediaObserver,
  OBSERVER_SYMBOL,
} from "../extension/media-observer-source.js";

function browser() {
  let serial = 0;
  class FakeResponse {
    constructor(url, value, type = "") {
      this.url = url;
      this.value = value;
      this.headers = {
        get: (key) => (key.toLowerCase() === "content-type" ? type : ""),
      };
    }
    arrayBuffer() {
      return Promise.resolve(this.value);
    }
    blob() {
      return Promise.resolve(this.value);
    }
    text() {
      return Promise.resolve(this.value);
    }
  }
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.responseType = "arraybuffer";
    }
    addEventListener(name, cb) {
      this.listeners[name] = cb;
    }
    open(method, url) {
      this.url = url;
    }
    send() {
      this.response = new ArrayBuffer(4);
      this.listeners.load?.();
    }
  }
  class FakeSourceBuffer {
    appendBuffer(value) {
      this.value = value;
    }
  }
  class FakeMediaSource {
    addSourceBuffer() {
      return new FakeSourceBuffer();
    }
  }
  const blobs = new Map();
  const URLApi = {
    createObjectURL(value) {
      const url = `blob:test/${++serial}`;
      blobs.set(url, value);
      return url;
    },
    revokeObjectURL(url) {
      blobs.delete(url);
    },
  };
  return {
    Response: FakeResponse,
    XMLHttpRequest: FakeXHR,
    MediaSource: FakeMediaSource,
    SourceBuffer: FakeSourceBuffer,
    URL: URLApi,
    location: { href: "https://social.example/reel/post" },
    blobs,
  };
}

test("MSE playlist parents stay associated per MediaSource and segments are excluded", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const body1 = new ArrayBuffer(4),
    body2 = new ArrayBuffer(4);
  const hls1 = new target.Response(
    "https://cdn.example/a/master.m3u8",
    "video/a.m3u8\n",
  );
  const hls2 = new target.Response(
    "https://cdn.example/b/master.m3u8",
    "video/b.m3u8\n",
  );
  await hls1.text();
  await hls2.text();
  const a = new Uint8Array(
    await new target.Response(
      "https://cdn.example/a/video.m3u8",
      body1,
    ).arrayBuffer(),
  );
  const b = new Uint8Array(
    await new target.Response(
      "https://cdn.example/b/video.m3u8",
      body2,
    ).arrayBuffer(),
  );
  const ms1 = new target.MediaSource(),
    ms2 = new target.MediaSource();
  const sb1 = ms1.addSourceBuffer("video/mp4"),
    sb2 = ms2.addSourceBuffer("video/mp4");
  const url1 = target.URL.createObjectURL(ms1),
    url2 = target.URL.createObjectURL(ms2);
  sb1.appendBuffer(a);
  sb2.appendBuffer(b);
  const one = observer.sourcesFor({ currentSrc: url1 });
  const two = observer.sourcesFor({ currentSrc: url2 });
  assert.deepEqual(
    one.candidates.map((c) => c.url),
    ["https://cdn.example/a/video.m3u8"],
  );
  assert.deepEqual(
    two.candidates.map((c) => c.url),
    ["https://cdn.example/b/video.m3u8"],
  );
  observer.dispose();
});

test("observed manifest text builds playlist parent graph without fetching", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const response = new target.Response(
    "https://cdn.example/master.m3u8",
    "child.m3u8\n",
  );
  await response.text();
  // Child response is never observed, so it cannot be mistaken for a complete source.
  assert.equal(
    observer.sourcesFor({ currentSrc: "https://cdn.example/segment.ts" })
      .candidates.length,
    0,
  );
  observer.dispose();
});

test("object URL of a page-read Blob resolves to its original HTTP media", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const bytes = new ArrayBuffer(8);
  const response = new target.Response("https://cdn.example/video.mp4", bytes);
  const blob = await response.blob();
  const url = target.URL.createObjectURL(blob);
  assert.equal(
    observer.sourcesFor({ currentSrc: url }).candidates[0].url,
    "https://cdn.example/video.mp4",
  );
  target.URL.revokeObjectURL(url);
  assert.equal(observer.sourcesFor({ currentSrc: url }).pending, false);
  observer.dispose();
});

test("observer is idempotent and preserves original method errors", () => {
  const target = browser();
  const original = target.Response.prototype.text;
  const first = installMediaObserver(target);
  const second = installMediaObserver(target);
  assert.equal(first, second);
  assert.equal(typeof target[OBSERVER_SYMBOL].sourcesFor, "function");
  target.Response.prototype.text = function () {
    throw new Error("page error");
  };
  assert.throws(
    () => new target.Response("https://cdn.example/a.m3u8", "").text(),
    /page error/,
  );
  first.dispose();
  assert.equal(target.Response.prototype.text !== original, true); // test replacement is external and must survive disposal
});

test("content type identifies suffixless manifests and cleanup permits reinstall", async () => {
  const target = browser();
  const first = installMediaObserver(target);
  await new target.Response(
    "https://cdn.example/master",
    "#EXTM3U\nchild\n",
    "application/vnd.apple.mpegurl",
  ).text();
  await new target.Response(
    "https://cdn.example/child",
    new ArrayBuffer(3),
    "video/mp2t",
  ).arrayBuffer();
  assert.deepEqual(
    first
      .sourcesFor({ currentSrc: "https://cdn.example/child" })
      .candidates.map((c) => c.url),
    ["https://cdn.example/master"],
  );
  first.dispose();
  const second = installMediaObserver(target);
  assert.notEqual(second, first);
  second.dispose();
});

test("suffixless Blob media uses Content-Type and a typed append keeps its body URL", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const bytes = await new target.Response(
    "https://cdn.example/media",
    new ArrayBuffer(8),
    "video/mp4",
  ).blob();
  const url = target.URL.createObjectURL(bytes);
  assert.equal(
    observer.sourcesFor({ currentSrc: url }).candidates[0].url,
    "https://cdn.example/media",
  );
  const response = new target.Response(
    "https://cdn.example/track",
    new ArrayBuffer(8),
    "video/mp4",
  );
  const view = new Uint8Array(await response.arrayBuffer());
  const ms = new target.MediaSource(),
    sb = ms.addSourceBuffer("video/mp4");
  const mseUrl = target.URL.createObjectURL(ms);
  sb.appendBuffer(view);
  assert.equal(
    observer.sourcesFor({ currentSrc: mseUrl }).candidates.length,
    0,
  );
  observer.dispose();
});

test("text/plain manifest bodies are sniffed and DASH templates remain scoped to their parent", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  await new target.Response(
    "https://cdn.example/master",
    '<MPD><Period><AdaptationSet><Representation id="v"><SegmentTemplate media="v-$Number$.m4s" /></Representation></AdaptationSet></Period></MPD>',
    "text/plain",
  ).text();
  assert.equal(
    observer.sourcesFor({ currentSrc: "https://cdn.example/v-4.m4s" })
      .candidates.length,
    0,
  );
  assert.equal(
    observer.sourcesFor({ currentSrc: "https://cdn.example/other.m4s" })
      .candidates.length,
    0,
  );
  observer.dispose();
});
