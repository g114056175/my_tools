import test from "node:test";
import assert from "node:assert/strict";
import { createSocialNetworkObserver } from "../extension/social-network.js";

function runtime() {
  const makeEvent = () => {
    const listeners = new Set();
    return {
      listeners,
      addListener(fn, filter, extra) { listeners.add({ fn, filter, extra }); },
      removeListener(fn) { for (const item of listeners) if (item.fn === fn) listeners.delete(item); },
    };
  };
  const webRequest = { onSendHeaders: makeEvent(), onResponseStarted: makeEvent(), onErrorOccurred: makeEvent() };
  const tabs = { onUpdated: makeEvent(), onRemoved: makeEvent() };
  const chrome = { webRequest, tabs };
  const fire = (event, ...args) => [...event.listeners].forEach(({ fn }) => fn(...args));
  return { chrome, fire };
}
const send = (rt, details) => fireEvent(rt, rt.chrome.webRequest.onSendHeaders, details);
const fireEvent = (rt, event, ...args) => rt.fire(event, ...args);
const responseHeaders = (mime = "video/mp4", extra = []) => [{ name: "Content-Type", value: mime }, ...extra];

test("isolates Facebook/TikTok services and keeps only successful media responses", () => {
  const rt = runtime();
  const observer = createSocialNetworkObserver(rt.chrome);
  fireEvent(rt, rt.chrome.tabs.onUpdated, 7, { url: "https://www.facebook.com/reel/1" });
  send(rt, { tabId: 7, requestId: "fb", url: "https://video.xx.fbcdn.net/a.mp4", initiator: "https://www.facebook.com/", method: "GET", requestHeaders: [{ name: "Range", value: "bytes=0-" }, { name: "Cookie", value: "secret" }] });
  fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 7, requestId: "fb", url: "https://video.xx.fbcdn.net/a.mp4", statusCode: 200, responseHeaders: responseHeaders() });
  send(rt, { tabId: 7, requestId: "bad", url: "https://v16.tiktokcdn.com/b.mp4", initiator: "https://evil.example/", method: "GET", requestHeaders: [] });
  fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 7, requestId: "bad", url: "https://v16.tiktokcdn.com/b.mp4", statusCode: 200, responseHeaders: responseHeaders() });
  const [item] = observer.candidates({ tabId: 7, pageUrl: "https://www.facebook.com/reel/1" });
  assert.equal(item.service, "facebook");
  assert.equal(item.range, "bytes=0-");
  assert.equal(item.origin, undefined);
  assert.equal(item.cookie, undefined);
  assert.equal(observer.candidates({ tabId: 7, pageUrl: "https://www.tiktok.com/@x/video/2" }).length, 0);
});

test("separates documents, rejects non-media and unauthorized statuses", () => {
  const rt = runtime();
  const observer = createSocialNetworkObserver(rt.chrome);
  fireEvent(rt, rt.chrome.tabs.onUpdated, 8, { url: "https://www.tiktok.com/@x/video/2" });
  for (const [requestId, statusCode, mime] of [["json", 200, "application/json"], ["unauth", 401, "video/mp4"], ["forbid", 403, "video/mp4"]]) {
    send(rt, { tabId: 8, requestId, url: `https://v16.tiktokcdn.com/${requestId}`, initiator: "https://www.tiktok.com/", method: "GET", requestHeaders: [] });
    fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 8, requestId, url: `https://v16.tiktokcdn.com/${requestId}`, statusCode, responseHeaders: responseHeaders(mime) });
  }
  send(rt, { tabId: 8, requestId: "ok", url: "https://v16.tiktokcdn.com/ok.m3u8", initiator: "https://www.tiktok.com/", method: "GET", requestHeaders: [] });
  fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 8, requestId: "ok", url: "https://v16.tiktokcdn.com/ok.m3u8", statusCode: 206, documentId: "new", frameId: 2, responseHeaders: responseHeaders("application/vnd.apple.mpegurl") });
  assert.equal(observer.candidates({ tabId: 8, documentId: "old" }).length, 0);
  assert.equal(observer.candidates({ tabId: 8, documentId: "new", frameId: 2 }).length, 1);
});

test("cleans navigation, enforces TTL and per-tab/global caps", () => {
  const rt = runtime();
  let time = 1000;
  const observer = createSocialNetworkObserver(rt.chrome, { now: () => time });
  fireEvent(rt, rt.chrome.tabs.onUpdated, 9, { url: "https://www.facebook.com/" });
  for (let i = 0; i < 45; i++) {
    const id = `r${i}`;
    send(rt, { tabId: 9, requestId: id, url: `https://cdn.fbcdn.net/${id}.mp4`, initiator: "https://www.facebook.com/", method: "GET", requestHeaders: [] });
    fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 9, requestId: id, url: `https://cdn.fbcdn.net/${id}.mp4`, statusCode: 200, responseHeaders: responseHeaders() });
  }
  assert.equal(observer.candidates({ tabId: 9 }).length, 40);
  fireEvent(rt, rt.chrome.tabs.onUpdated, 9, { status: "loading" });
  assert.equal(observer.candidates({ tabId: 9, pageUrl: "https://www.facebook.com/" }).length, 0);
  time += 121000;
  assert.equal(observer.candidates({ tabId: 9, pageUrl: "https://www.facebook.com/" }).length, 0);
  fireEvent(rt, rt.chrome.tabs.onRemoved, 9);
  assert.deepEqual(observer.candidates({ tabId: -1, pageUrl: "https://www.facebook.com/" }), []);
  observer.dispose();
});

test("keeps origin and referer but rejects a foreign current URL and caps globally", () => {
  const rt = runtime();
  const observer = createSocialNetworkObserver(rt.chrome);
  fireEvent(rt, rt.chrome.tabs.onUpdated, 10, { url: "https://www.facebook.com/" });
  send(rt, { tabId: 10, requestId: "headers", url: "https://cdn.fbcdn.net/h.mp4", initiator: "https://www.facebook.com/", method: "GET", requestHeaders: [
    { name: "Origin", value: "https://www.facebook.com" },
    { name: "Referer", value: "https://www.facebook.com/reel/1" },
    { name: "Authorization", value: "secret" },
  ] });
  fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 10, requestId: "headers", url: "https://cdn.fbcdn.net/h.mp4", statusCode: 200, responseHeaders: responseHeaders() });
  const [headerItem] = observer.candidates({ tabId: 10, pageUrl: "https://www.facebook.com/" });
  assert.equal(headerItem.origin, "https://www.facebook.com");
  assert.equal(headerItem.referer, "https://www.facebook.com/reel/1");
  assert.equal(Object.hasOwn(headerItem, "authorization"), false);
  assert.equal(observer.candidates({ tabId: 10, pageUrl: "https://www.tiktok.com/@x/video/2" }).length, 0);
  for (let tabId = 11; tabId <= 215; tabId++) {
    fireEvent(rt, rt.chrome.tabs.onUpdated, tabId, { url: "https://www.facebook.com/" });
    const requestId = `global-${tabId}`;
    send(rt, { tabId, requestId, url: `https://cdn.fbcdn.net/${requestId}.mp4`, initiator: "https://www.facebook.com/", method: "GET", requestHeaders: [] });
    fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId, requestId, url: `https://cdn.fbcdn.net/${requestId}.mp4`, statusCode: 200, responseHeaders: responseHeaders() });
  }
  const total = [...Array(206).keys()].reduce((sum, index) => sum + observer.candidates({ tabId: index + 10, pageUrl: "https://www.facebook.com/" }).length, 0);
  assert.equal(total, 200);
  observer.dispose();
});

test("bounds unmatched request headers and rejects a known external tab", () => {
  const rt = runtime();
  const observer = createSocialNetworkObserver(rt.chrome);
  const sendListener = [...rt.chrome.webRequest.onSendHeaders.listeners][0];
  assert.deepEqual(sendListener.extra, ["requestHeaders", "extraHeaders"]);
  fireEvent(rt, rt.chrome.tabs.onUpdated, 20, { url: "https://www.facebook.com/" });
  for (let i = 0; i < 205; i++) {
    send(rt, { tabId: 20, requestId: `pending-${i}`, url: `https://cdn.fbcdn.net/pending-${i}.mp4`, initiator: "https://www.facebook.com/", method: "GET", requestHeaders: [] });
  }
  assert.equal(observer.debug().pendingCount, 200);
  fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 20, requestId: "pending-0", url: "https://cdn.fbcdn.net/pending-0.mp4", statusCode: 200, responseHeaders: responseHeaders() });
  assert.equal(observer.debug().pendingCount, 200);
  fireEvent(rt, rt.chrome.tabs.onUpdated, 21, { url: "https://www.example.com/" });
  send(rt, { tabId: 21, requestId: "foreign", url: "https://cdn.fbcdn.net/foreign.mp4", initiator: "https://www.facebook.com/", method: "GET", requestHeaders: [] });
  fireEvent(rt, rt.chrome.webRequest.onResponseStarted, { tabId: 21, requestId: "foreign", url: "https://cdn.fbcdn.net/foreign.mp4", statusCode: 200, responseHeaders: responseHeaders() });
  assert.deepEqual(observer.candidates({ tabId: 21, pageUrl: "https://www.facebook.com/" }), []);
  observer.dispose();
});
