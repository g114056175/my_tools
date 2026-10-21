import test from "node:test";
import assert from "node:assert/strict";
import { dailymotionVideoId, dailymotionContext, qualityMediaSources, resolveDailymotion } from "../extension/dailymotion.js";

const url = "https://cdn.example/video";
const response = (value, status = 200) => {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  let used = false, cancelled = false;
  return { ok: status >= 200 && status < 300, status, body: { getReader() { return { read: async () => used ? { done: true } : (used = true, { done: false, value: bytes }), cancel: async () => { cancelled = true; } }; } }, get cancelled() { return cancelled; } };
};
const documentFor = (title, links) => ({ querySelector: s => s === "#media-title" ? { textContent: title } : null, querySelectorAll: () => links.map(link => ({ textContent: link.text, href: link.href, getAttribute: () => link.href })) });

test("strict route ID accepts video/player and rejects playlist/config IDs", () => {
  assert.equal(dailymotionVideoId("https://www.dailymotion.com/video/x9qh9tw"), "x9qh9tw");
  assert.equal(dailymotionVideoId("https://geo.dailymotion.com/player/xtv3w.html?video=x9qh9tw"), "x9qh9tw");
  assert.equal(dailymotionVideoId("https://dai.ly/x9qh9tw"), "x9qh9tw");
  assert.equal(dailymotionVideoId("https://www.dailymotion.com/playlist/x9qh9tw"), "");
  assert.equal(dailymotionVideoId("https://www.dailymotion.com/player/xtv3w.html?video=xtv3w"), "xtv3w");
});

test("playlist context requires exact title and one unique video ID", () => {
  const page = "https://www.dailymotion.com/playlist/xa8h2y";
  assert.equal(dailymotionContext(documentFor("PART 1 [BLENDED LOVE]", [{ text: "PART 1 [BLENDED LOVE]", href: "https://www.dailymotion.com/video/x9qh9tw" }]), page).id, "x9qh9tw");
  assert.equal(dailymotionContext(documentFor("PART 1 [BLENDED LOVE]", [{ text: "PART 1 [BLENDED LOVE]", href: "https://www.dailymotion.com/video/x9qh9tw" }, { text: "PART 1 [BLENDED LOVE]", href: "https://www.dailymotion.com/video/xother" }]), page), null);
  assert.equal(dailymotionContext(documentFor("PART 1 [BLENDED LOVE]", [{ text: "PART 1", href: "https://www.dailymotion.com/video/x9qh9tw" }]), page), null);
});

test("qualities maps progressive formats and prefers DASH over HLS", () => {
  const result = qualityMediaSources({ auto: [{ type: "application/x-mpegURL", url: "https://cdn.example/a.m3u8" }, { type: "video/mp4", url, height: 720 }, { type: "video/webm", url: "https://cdn.example/v.webm", width: 640, height: 360 }, { type: "application/vnd.lumberjack.manifest", url: "https://cdn.example/no" }, { type: "video/unknown", url: "https://cdn.example/no2" }, { type: "application/dash+xml", url: "https://cdn.example/a.mpd" }] });
  assert.equal(result.manifestType, "dash"); assert.equal(result.manifestUrl, "https://cdn.example/a.mpd");
  assert.deepEqual(result.versions, [{ url, height: 720 }, { url: "https://cdn.example/v.webm", width: 640, height: 360 }]);
  assert.equal(qualityMediaSources({'720':[{type:'video/mp4',url}]}).versions[0].height,720);
  const large=qualityMediaSources({auto:Array.from({length:200},(_,i)=>({type:'video/mp4',url:`https://cdn.example/${i}.mp4`}))});
  assert.equal(large.versions.length,32);
});

test("resolve validates response ID, bounded GET metadata and returns embedded descriptor", async () => {
  let called;
  const descriptor = await resolveDailymotion({ id: "x9qh9tw" }, async (requestUrl, options) => { called = [requestUrl, options]; return response({ id: "x9qh9tw", title: "PART 1", duration: 14, qualities: { auto: [{ type: "video/mp4", url, height: 720 }] } }); });
  assert.match(called[0], /\/player\/metadata\/video\/x9qh9tw\?app=/); assert.deepEqual(called[1], { method: "GET" });
  assert.equal(descriptor.site, "embedded"); assert.equal(descriptor.duration, 14); assert.equal(descriptor.versions[0].height, 720);
  await assert.rejects(resolveDailymotion({ id: "x9qh9tw" }, async () => response({ id: "other", qualities: { auto: [{ type: "video/mp4", url }] } })), { code: "SOURCE_UNAVAILABLE" });
  await assert.rejects(resolveDailymotion({ id: "x9qh9tw" }, async () => response("x".repeat(1024 * 1024 + 1))), { code: "SOURCE_UNAVAILABLE" });
});
