import test from "node:test";
import assert from "node:assert/strict";
import {
  createMediaModelStore,
  extractMediaModels,
} from "../extension/media-models.js";

test("Facebook delivery legacy fields produce compact ID-bound descriptor", () => {
  const [model] = extractMediaModels(
    {
      __typename: "Video",
      id: "1659919149203096",
      videoDeliveryLegacyFields: {
        id: "1659919149203096",
        dash_manifest_xml_string: "<MPD/>",
        dash_manifest_url: "/master",
        browser_native_hd_url: "/hd.mp4",
        playable_duration_in_ms: 12000,
      },
      title: "Public clip",
    },
    { baseUrl: "https://www.facebook.com/reel/1659919149203096" },
  );
  assert.deepEqual(model.aliases, ["1659919149203096"]);
  assert.equal(model.manifestUrl, "https://www.facebook.com/master");
  assert.equal(model.versions[0].url, "https://www.facebook.com/hd.mp4");
  assert.equal(model.duration, 12);
  assert.equal(model.title, "Public clip");
});

test("deep FB Relay require and bbox nesting finds the owned attachment video", () => {
  const media = {
    __typename: "Video",
    videoId: "1659919149203096",
    videoDeliveryLegacyFields: {
      id: "1659919149203096",
      browser_native_hd_url: "https://cdn.example/fb.mp4",
    },
  };
  const payload = { require: [] };
  payload.require[0] = { 0: { 3: { 0: { __bbox: { require: [] } } } } };
  payload.require[0][0][3][0].__bbox.require[7] = {
    3: {
      1: {
        __bbox: {
          result: { data: { video: { story: { attachments: [{ media }] } } } },
        },
      },
    },
  };
  const models = extractMediaModels(payload);
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "1659919149203096");
  assert.equal(models[0].versions[0].url, "https://cdn.example/fb.mp4");
});

test("ID-only Video markers are rejected and cannot overwrite complete aliases", () => {
  assert.equal(extractMediaModels({__typename:'Video',id:'same'}).length,0);
  const store = createMediaModelStore();
  store.merge(
    extractMediaModels({
      __typename: "Video",
      id: "same",
      video_url: "https://cdn.example/complete.mp4",
    }),
  );
  store.merge(extractMediaModels({ __typename: "Video", id: "same" }));
  assert.equal(
    store.models()[0].versions[0].url,
    "https://cdn.example/complete.mp4",
  );
});

test("Instagram versions and DASH fields are extracted without platform branching", () => {
  const [model] = extractMediaModels({
    __typename: "GraphVideo",
    code: "ABC",
    video_versions: [
      { id: 1, url: "https://cdn/low.mp4", width: 320, height: 568 },
    ],
    video_dash_manifest: "<MPD/>",
    video_duration: 4.5,
  });
  assert.equal(model.id, "ABC");
  assert.equal(model.versions[0].height, 568);
  assert.equal(model.manifestXml, "<MPD/>");
});

test("nested user IDs and unrelated recommendation videos cannot borrow parent identity", () => {
  const models = extractMediaModels({
    id: "user-1",
    user: { id: "user-1" },
    recommended: {
      __typename: "Video",
      id: "other",
      video_url: "https://cdn/other.mp4",
    },
  });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "other");
  const direct = extractMediaModels({
    __typename: "Video",
    id: "video-1",
    user: { id: "user-1" },
    video_url: "https://cdn/one.mp4",
  });
  assert.deepEqual(direct[0].aliases, ["video-1"]);
  const contradictory = extractMediaModels({
    __typename: "Video",
    id: "video-1",
    videoDeliveryLegacyFields: {
      id: "different",
      browser_native_hd_url: "https://cdn/wrong.mp4",
    },
    video_url: "https://cdn/right.mp4",
  });
  assert.equal(
    contradictory[0].versions.some((version) =>
      version.url.endsWith("wrong.mp4"),
    ),
    false,
  );
});

test("store associates one model with one video and never merges conflicting IDs", () => {
  const store = createMediaModelStore();
  const one = {
    __typename: "Video",
    id: "one",
    video_url: "https://cdn/one.mp4",
  };
  const two = {
    __typename: "Video",
    id: "two",
    video_url: "https://cdn/two.mp4",
  };
  store.merge(extractMediaModels(one));
  store.merge(extractMediaModels(two));
  assert.equal(store.models().length, 2);
  const video = { closest: () => null };
  store.merge(
    extractMediaModels({
      __typename: "Video",
      id: "one",
      video_url: "https://cdn/one-new.mp4",
    }),
  );
  assert.equal(
    store.models().find((model) => model.id === "one").versions[0].url,
    "https://cdn/one-new.mp4",
  );
  assert.equal(store.modelFor(video, "https://example/reel/two").id, "two");
});

test('an unchanged live document repopulates model data after its bounded cache expires',()=>{
 const before=Date.now;let time=100;Date.now=()=>time;
 try{
  const store=createMediaModelStore({ttl:5});
  const script={textContent:JSON.stringify({__typename:'Video',id:'post',video_url:'https://cdn/one.mp4'}),closest:()=>null};
  const video={closest:()=>null};const doc={querySelectorAll:selector=>selector==='video'?[video]:[script]};video.ownerDocument=doc;
  store.scanDocument(doc,'https://example/reel/post');assert.equal(store.modelFor(video,'https://example/reel/post').id,'post');
  time=106;assert.equal(store.modelFor(video,'https://example/reel/post'),null);
  store.scanDocument(doc,'https://example/reel/post');assert.equal(store.modelFor(video,'https://example/reel/post').id,'post');
 }finally{Date.now=before;}
});
