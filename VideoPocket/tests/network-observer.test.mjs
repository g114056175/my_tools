import test from "node:test";
import assert from "node:assert/strict";
import { createNetworkMediaObserver } from "../extension/network-observer.js";
import { networkMediaKind, networkHttpUrl } from "../extension/network-media.js";

function runtime() {
  const event = () => {
    const listeners = new Set();
    return {
      listeners,
      addListener(fn, filter, extra) { listeners.add({ fn, filter, extra }); },
      removeListener(fn) { for (const item of listeners) if (item.fn === fn) listeners.delete(item); },
    };
  };
  const chrome = {
    webRequest: { onSendHeaders: event(), onResponseStarted: event(), onErrorOccurred: event() },
    tabs: { onUpdated: event(), onRemoved: event() },
  };
  return {
    chrome,
    fire: (which, ...args) => [...which.listeners].forEach(({ fn }) => fn(...args)),
  };
}
const headers = (mime = "video/mp4", extra = []) => [{ name: "Content-Type", value: mime }, ...extra];
const send = (rt, details) => rt.fire(rt.chrome.webRequest.onSendHeaders, details);
const response = (rt, details) => rt.fire(rt.chrome.webRequest.onResponseStarted, details);

test("generic registration observes opaque media MIME and extension forms", () => {
  const rt = runtime();
  const observer = createNetworkMediaObserver(rt.chrome);
  const filters = [...rt.chrome.webRequest.onSendHeaders.listeners].map(item => item.filter.urls).flat();
  assert.deepEqual(filters, ["http://*/*", "https://*/*"]);
  assert.equal(networkMediaKind({ url: "https://cdn.example/blob?id=7", mime: "application/octet-stream" }), "");
  assert.equal(networkMediaKind({ url: "https://cdn.example/blob.mp4", mime: "application/octet-stream" }), "progressive");
  assert.equal(networkMediaKind({ url: "https://cdn.example/list.m3u8", mime: "application/octet-stream" }), "hls");
  assert.equal(networkMediaKind({ url: "https://cdn.example/manifest.mpd", mime: "" }), "dash");
  send(rt, { tabId: 1, requestId: "opaque", url: "https://cdn.example/blob.mp4", method: "GET", initiator: "https://unknown.example/", requestHeaders: [] });
  response(rt, { tabId: 1, requestId: "opaque", url: "https://cdn.example/blob.mp4", statusCode: 200, responseHeaders: headers("application/octet-stream") });
  assert.equal(observer.candidates({ tabId: 1 }).length, 1);
  observer.dispose();
});

test("deduplicates same URL across ranges while preserving redirect and safe request headers", () => {
  const rt = runtime();
  const observer = createNetworkMediaObserver(rt.chrome);
  const requestHeaders = [
    { name: "Range", value: "bytes=0-99" },
    { name: "Origin", value: "https://unknown.example" },
    { name: "Referer", value: "https://unknown.example/watch" },
    { name: "Cookie", value: "secret" },
    { name: "Authorization", value: "Bearer secret" },
    { name: "X-Request-Body", value: "private" },
  ];
  send(rt, { tabId: 2, requestId: "r1", url: "https://origin.example/file.mp4", method: "GET", requestHeaders });
  response(rt, { tabId: 2, requestId: "r1", url: "https://cdn.example/file.mp4", statusCode: 206, responseHeaders: headers("video/mp4", [{ name: "Content-Range", value: "bytes 0-99/*" }]) });
  send(rt, { tabId: 2, requestId: "r2", url: "https://origin.example/file.mp4", method: "GET", requestHeaders: [{ name: "Range", value: "bytes=100-199" }] });
  response(rt, { tabId: 2, requestId: "r2", url: "https://cdn.example/file.mp4", statusCode: 206, responseHeaders: headers("video/mp4") });
  const [item] = observer.candidates({ tabId: 2 });
  assert.equal(observer.candidates({ tabId: 2 }).length, 1);
  assert.equal(item.url, "https://cdn.example/file.mp4");
  assert.equal(item.originalUrl, "https://origin.example/file.mp4");
  assert.equal(item.range, "bytes=100-199");
  assert.equal(item.origin, undefined);
  assert.equal(item.referer, undefined);
  assert.equal(Object.hasOwn(item, "cookie"), false);
  assert.equal(Object.hasOwn(item, "authorization"), false);
  assert.equal(Object.hasOwn(item, "body"), false);
  observer.dispose();
});

test("rejects failed, POST, credentialed, non-HTTP, and non-media requests", () => {
  const rt = runtime();
  const observer = createNetworkMediaObserver(rt.chrome);
  const cases = [
    ["401", 401, "GET", "https://cdn.example/a.mp4"],
    ["403", 403, "GET", "https://cdn.example/b.mp4"],
    ["post", 200, "POST", "https://cdn.example/c.mp4"],
    ["credentials", 200, "GET", "https://user:pass@cdn.example/d.mp4"],
    ["non-http", 200, "GET", "blob:https://unknown.example/e"],
    ["json", 200, "GET", "https://cdn.example/data.json"],
  ];
  for (const [requestId, statusCode, method, url] of cases) {
    send(rt, { tabId: 3, requestId, url, method, requestHeaders: [] });
    response(rt, { tabId: 3, requestId, url, statusCode, responseHeaders: headers(method === "GET" && requestId === "json" ? "application/json" : "video/mp4") });
  }
  assert.deepEqual(observer.candidates({ tabId: 3 }), []);
  observer.dispose();
});

test("navigation clears old candidates and document/frame filters isolate current media", () => {
  const rt = runtime();
  const observer = createNetworkMediaObserver(rt.chrome);
  rt.fire(rt.chrome.tabs.onUpdated, 4, { url: "https://unknown.example/old" });
  send(rt, { tabId: 4, requestId: "old", url: "https://cdn.example/old.mp4", method: "GET", documentId: "old-doc", frameId: 0 });
  response(rt, { tabId: 4, requestId: "old", url: "https://cdn.example/old.mp4", statusCode: 200, documentId: "old-doc", frameId: 0, responseHeaders: headers() });
  assert.equal(observer.candidates({ tabId: 4, documentId: "old-doc" }).length, 1);
  rt.fire(rt.chrome.tabs.onUpdated, 4, { url: "https://unknown.example/new" });
  assert.equal(observer.candidates({ tabId: 4 }).length, 0);
  for (const [requestId, documentId, frameId] of [["new-main", "new-doc", 0], ["new-frame", "new-doc", 2], ["other-doc", "other-doc", 0]]) {
    send(rt, { tabId: 4, requestId, url: `https://cdn.example/${requestId}.mp4`, method: "GET", documentId, frameId });
    response(rt, { tabId: 4, requestId, url: `https://cdn.example/${requestId}.mp4`, statusCode: 200, documentId, frameId, responseHeaders: headers() });
  }
  assert.equal(observer.candidates({ tabId: 4, documentId: "new-doc", frameId: 0 }).length, 1);
  assert.equal(observer.candidates({ tabId: 4, documentId: "new-doc", frameId: 2 }).length, 1);
  assert.equal(observer.candidates({ tabId: 4, documentId: "other-doc" }).length, 1);
  assert.equal(observer.candidates({ tabId: 4, pageUrl: "https://other.example/new" }).length, 0);
  observer.dispose();
});

test("pending requests, per-tab/global candidate caps, and TTL remain bounded", () => {
  const rt = runtime();
  let time = 1000;
  const observer = createNetworkMediaObserver(rt.chrome, { now: () => time });
  for (let i = 0; i < 205; i++) send(rt, { tabId: 5, requestId: `pending-${i}`, url: `https://cdn.example/pending-${i}.mp4`, method: "GET" });
  assert.equal(observer.debug().pendingCount, 200);
  for (let i = 0; i < 45; i++) {
    const requestId = `candidate-${i}`;
    send(rt, { tabId: 5, requestId, url: `https://cdn.example/${requestId}.mp4`, method: "GET" });
    response(rt, { tabId: 5, requestId, url: `https://cdn.example/${requestId}.mp4`, statusCode: 200, responseHeaders: headers() });
  }
  assert.equal(observer.candidates({ tabId: 5 }).length, 40);
  time += 121000;
  assert.deepEqual(observer.candidates({ tabId: 5 }), []);
  observer.dispose();
});

test("network URL helper rejects credentials and unsupported schemes", () => {
  assert.equal(networkHttpUrl("https://cdn.example/a.mp4"), "https://cdn.example/a.mp4");
  assert.equal(networkHttpUrl("https://user:pass@cdn.example/a.mp4"), "");
  assert.equal(networkHttpUrl("ftp://cdn.example/a.mp4"), "");
  assert.equal(networkHttpUrl("blob:https://cdn.example/a"), "");
});

test('demand-only starts detached, records only enabled tabs, and detaches after the last disable', () => {
  const rt = runtime(), observer = createNetworkMediaObserver(rt.chrome, {demandOnly: true});
  assert.equal(observer.debug().webRequestAttached, false);
  assert.equal(rt.chrome.webRequest.onSendHeaders.listeners.size, 0);
  send(rt, {tabId: 1, requestId: 'before', url: 'https://cdn.example/before.mp4', method: 'GET'});
  assert.deepEqual(observer.candidates({tabId: 1}), []);

  assert.equal(observer.enableTab(1), true);
  assert.equal(observer.enableTab(2), true);
  assert.equal(observer.enableTab(1), true);
  assert.equal(observer.debug().activeTabCount, 2);
  assert.equal(rt.chrome.webRequest.onSendHeaders.listeners.size, 1);
  assert.equal(rt.chrome.webRequest.onResponseStarted.listeners.size, 1);
  for (const [tabId, requestId] of [[1, 'one'], [2, 'two']]) {
    send(rt, {tabId, requestId, url: `https://cdn.example/${requestId}.mp4`, method: 'GET', initiator: 'https://unknown.example/'});
    response(rt, {tabId, requestId, url: `https://cdn.example/${requestId}.mp4`, statusCode: 200, responseHeaders: headers()});
  }
  assert.equal(observer.candidates({tabId: 1}).length, 1);
  assert.equal(observer.disableTab(1), true);
  assert.equal(observer.candidates({tabId: 1}).length, 0);
  assert.equal(observer.candidates({tabId: 2}).length, 1);
  assert.equal(observer.debug().webRequestAttached, true);
  assert.equal(observer.disableTab(2), true);
  assert.equal(observer.debug().webRequestAttached, false);
  assert.equal(rt.chrome.webRequest.onSendHeaders.listeners.size, 0);
  assert.equal(observer.candidates({tabId: 2}).length, 0);

  assert.equal(observer.enableTab(1), true, 'a later demand can reopen the listener');
  assert.equal(rt.chrome.webRequest.onSendHeaders.listeners.size, 1);
  assert.equal(observer.candidates({tabId: 1}).length, 0, 'disabled records are not restored');
  observer.dispose();
  assert.equal(rt.chrome.webRequest.onSendHeaders.listeners.size, 0);
  assert.equal(rt.chrome.tabs.onUpdated.listeners.size, 0);
});

test('demand-only filters nonactive tabs even while another tab has capture enabled', () => {
  const rt = runtime(), observer = createNetworkMediaObserver(rt.chrome, {demandOnly: true});
  observer.enableTab(7);
  send(rt, {tabId: 8, requestId: 'inactive', url: 'https://cdn.example/inactive.mp4', method: 'GET', initiator: 'https://unknown.example/'});
  response(rt, {tabId: 8, requestId: 'inactive', url: 'https://cdn.example/inactive.mp4', statusCode: 200, responseHeaders: headers()});
  assert.deepEqual(observer.candidates({tabId: 8}), []);
  assert.deepEqual(observer.candidates({tabId: 7}), []);
  observer.dispose();
});

test('seed accepts fresh classified resources with frame/document ownership and rejects stale or unusable entries', () => {
  const rt = runtime(); let time = 1_000_000;
  const observer = createNetworkMediaObserver(rt.chrome, {demandOnly: true, now: () => time});
  const items = [
    {url: 'https://cdn.example/main.m3u8?token=one', pageUrl: 'https://unknown.example/watch', frameId: 0, documentId: 'main', timeStamp: time - 100},
    {url: 'https://cdn.example/frame.mp4', pageUrl: 'https://unknown.example/embed', frameId: 2, documentId: 'frame', timeStamp: time - 90},
    {url: 'https://cdn.example/stale.mp4', pageUrl: 'https://unknown.example/watch', frameId: 0, documentId: 'main', timeStamp: time - 120_001},
    {url: 'blob:https://unknown.example/old', pageUrl: 'https://unknown.example/watch', frameId: 0, documentId: 'main', timeStamp: time - 80},
    {url: 'https://cdn.example/unknown-resource', pageUrl: 'https://unknown.example/watch', frameId: 0, documentId: 'main', timeStamp: time - 70},
    {url: 'https://cdn.example/unowned.mp4', pageUrl: 'https://unknown.example/watch', timeStamp: time - 60},
  ];
  assert.equal(observer.seed(9, items), 0, 'unrequested tabs cannot be seeded');
  observer.enableTab(9);
  assert.equal(observer.seed(9, items), 2);
  const main = observer.candidates({tabId: 9, documentId: 'main', frameId: 0});
  const frame = observer.candidates({tabId: 9, documentId: 'frame', frameId: 2});
  assert.equal(main.length, 1); assert.equal(main[0].kind, 'hls');
  assert.equal(frame.length, 1); assert.equal(frame[0].kind, 'progressive');
  assert.equal(main[0].time, time - 100);
  assert.equal(main[0].mime, '');
  assert.equal(main[0].method, undefined);
  assert.equal(main[0].origin, undefined);
  assert.equal(main[0].referer, undefined);
  assert.equal(observer.candidates({tabId: 9, documentId: 'wrong', frameId: 2}).length, 0);

  time += 120_001;
  assert.equal(observer.candidates({tabId: 9}).length, 0, 'seeded resources still expire under the existing TTL');
  observer.disableTab(9);
  assert.equal(observer.seed(9, items), 0, 'disabled tabs cannot be seeded');
  observer.dispose();
});

test('seed reuses social CDN/page ownership rules and existing candidate capacity', () => {
  const rt = runtime(), observer = createNetworkMediaObserver(rt.chrome, {socialOnly: true, demandOnly: true, now: () => 5000});
  observer.enableTab(3);
  const shared = {frameId: 0, documentId: 'doc', timeStamp: 4900};
  assert.equal(observer.seed(3, [
    {...shared, url: 'https://video.xx.fbcdn.net/valid.mp4', pageUrl: 'https://www.facebook.com/reel/1'},
    {...shared, url: 'https://v16.tiktokcdn.com/wrong.mp4', pageUrl: 'https://www.facebook.com/reel/1'},
    {...shared, url: 'https://video.xx.fbcdn.net/foreign.mp4', pageUrl: 'https://unknown.example/watch'},
  ]), 1);
  assert.equal(observer.candidates({tabId: 3, pageUrl: 'https://www.facebook.com/reel/1'}).length, 1);

  const many = Array.from({length: 45}, (_, index) => ({...shared, url: `https://video.xx.fbcdn.net/${index}.mp4`, pageUrl: 'https://www.facebook.com/reel/1', timeStamp: 4900 + index}));
  assert.equal(observer.seed(3, many), 45);
  const bounded = observer.candidates({tabId: 3, pageUrl: 'https://www.facebook.com/reel/1'});
  assert.equal(bounded.length, 40);
  assert.ok(bounded.every(item => item.service === 'facebook'));
  observer.dispose();
});
