import test from "node:test";
import assert from "node:assert/strict";
import { facebookPlayerPayload } from "../extension/facebook-player.js";

const pageUrl = "https://www.facebook.com/reel/1129269426460957/";
const videoFBID = "1129269426460957";
const manifest = "<?xml version=\"1.0\"?><MPD type=\"static\"></MPD>";

function player(value = {}, metadata = { videoFBID }) {
  return { coreVideoPlayerMetaData: metadata, ...value };
}

function assertIdentity(payload, expectedId = videoFBID) {
  assert.ok(payload);
  assert.equal(payload.id, expectedId);
  assert.equal(payload.videoFBID, expectedId);
}

test("Facebook player XML manifest produces an ID-bound canonical payload", () => {
  const result = facebookPlayerPayload(
    player({ manifest, manifestUrl: "https://cdn.example.test/manifest" }),
    { pageUrl },
  );

  assertIdentity(result);
  assert.equal(result.video_dash_manifest, manifest);
});

test("Facebook apex and subdomains are accepted", () => {
  for (const url of [
    "https://facebook.com/watch/",
    "https://m.facebook.com/watch/",
  ]) {
    const result = facebookPlayerPayload(player({ manifest }), { pageUrl: url });
    assertIdentity(result);
    assert.equal(result.video_dash_manifest, manifest);
  }
});

test("lookalike and non-Facebook page hosts are rejected", () => {
  for (const url of [
    "https://facebook.com.example.test/reel/1",
    "https://notfacebook.com/reel/1",
    "https://example.test/reel/1",
  ]) {
    assert.equal(
      facebookPlayerPayload(player({ manifest }), { pageUrl: url }),
      null,
      url,
    );
  }
});

test("safe integer videoFBID is converted to a decimal string", () => {
  const result = facebookPlayerPayload(
    player(
      { manifestUrl: "https://cdn.example.test/video.mpd" },
      { videoFBID: 1129269426460957 },
    ),
    { pageUrl },
  );

  assertIdentity(result, videoFBID);
  assert.equal(result.video_dash_manifest_url, "https://cdn.example.test/video.mpd");
});

test("MPD and HLS manifest URLs are accepted without XML", () => {
  for (const extension of ["mpd", "m3u8"]) {
    const url = `https://cdn.example.test/video.${extension}?sig=fixture`;
    const result = facebookPlayerPayload(player({ manifestUrl: url }), { pageUrl });

    assertIdentity(result);
    assert.equal(result.video_dash_manifest_url, url);
  }
});

test("videoFBID must be a 5–24 digit string or a safe integer", () => {
  const invalidIds = [
    undefined,
    null,
    "1234",
    "12345x",
    "1".repeat(25),
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    -12345,
  ];

  for (const id of invalidIds) {
    const result = facebookPlayerPayload(
      player({ manifest }, { videoFBID: id }),
      { pageUrl },
    );
    assert.equal(result, null, `videoFBID=${String(id)}`);
  }
});

test("inherited player metadata is ignored", () => {
  const value = Object.assign(Object.create({
    coreVideoPlayerMetaData: { videoFBID },
  }), { manifest });

  assert.equal(facebookPlayerPayload(value, { pageUrl }), null);
});

test("player metadata accessors are never invoked", () => {
  const reads = { core: 0, id: 0, manifest: 0, manifestUrl: 0 };
  const withGetter = (object, key, onRead) => Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    get() {
      reads[onRead]++;
      throw new Error(`${key} getter invoked`);
    },
  });

  const coreGetter = {};
  withGetter(coreGetter, "coreVideoPlayerMetaData", "core");
  withGetter(coreGetter, "manifest", "manifest");
  withGetter(coreGetter, "manifestUrl", "manifestUrl");
  assert.equal(facebookPlayerPayload(coreGetter, { pageUrl }), null);

  const idGetter = { coreVideoPlayerMetaData: {} , manifest };
  withGetter(idGetter.coreVideoPlayerMetaData, "videoFBID", "id");
  assert.equal(facebookPlayerPayload(idGetter, { pageUrl }), null);

  const manifestGetter = { coreVideoPlayerMetaData: { videoFBID } };
  withGetter(manifestGetter, "manifest", "manifest");
  manifestGetter.manifestUrl = "https://cdn.example.test/video.mpd";
  const fromUrl = facebookPlayerPayload(manifestGetter, { pageUrl });
  assertIdentity(fromUrl);
  assert.equal(fromUrl.video_dash_manifest_url, manifestGetter.manifestUrl);

  const urlGetter = { coreVideoPlayerMetaData: { videoFBID } };
  withGetter(urlGetter, "manifestUrl", "manifestUrl");
  assert.equal(facebookPlayerPayload(urlGetter, { pageUrl }), null);

  assert.deepEqual(reads, { core: 0, id: 0, manifest: 0, manifestUrl: 0 });
});

test("MPD XML at the 512 KiB limit is accepted", () => {
  const xml = `<MPD>${"x".repeat(512 * 1024 - 11)}</MPD>`;
  assert.equal(xml.length, 512 * 1024);

  const result = facebookPlayerPayload(player({ manifest: xml }), { pageUrl });

  assertIdentity(result);
  assert.equal(result.video_dash_manifest, xml);
});

test("oversized and non-MPD manifest text are rejected without a URL fallback", () => {
  const oversized = `<MPD>${"x".repeat(512 * 1024 - 10)}</MPD>`;
  assert.equal(oversized.length, 512 * 1024 + 1);

  assert.equal(facebookPlayerPayload(player({ manifest: oversized }), { pageUrl }), null);
  assert.equal(facebookPlayerPayload(player({ manifest: "<html>not a manifest</html>" }), { pageUrl }), null);
  assert.equal(facebookPlayerPayload(player({ manifest: "plain text <MPD" }), { pageUrl }), null);
});

test("manifestUrl requires HTTPS, an MPD or M3U8 pathname, and no credentials", () => {
  const invalidUrls = [
    "http://cdn.example.test/video.mpd",
    "https://cdn.example.test/manifests/current",
    "https://cdn.example.test/video.mp d",
    "https://cdn.example.test/video.mpd/child",
    "https://user:password@cdn.example.test/video.mpd",
  ];

  for (const url of invalidUrls) {
    assert.equal(
      facebookPlayerPayload(player({ manifestUrl: url }), { pageUrl }),
      null,
      url,
    );
  }
});

test("a valid ID without a usable source and a source without an ID are rejected", () => {
  assert.equal(facebookPlayerPayload(player(), { pageUrl }), null);
  assert.equal(
    facebookPlayerPayload(
      player({ manifest }, { videoFBID: undefined }),
      { pageUrl },
    ),
    null,
  );
});
