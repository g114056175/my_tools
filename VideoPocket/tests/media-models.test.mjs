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

test("Facebook video delivery response fragment stays bound to its parent Video", () => {
  const [model] = extractMediaModels({
    __typename: "Video",
    id: "fb-response-1",
    videoDeliveryResponseFragment: {
      videoDeliveryResponseResult: {
        progressive_urls: [
          { progressive_url: "https://cdn.example/fb-response.mp4" },
        ],
        dash_manifest_urls: [
          { manifest_url: "https://cdn.example/fb-response.mpd" },
        ],
        dash_manifests: [{ manifest_xml: "<MPD/>" }],
        hls_playlist_urls: [
          { hls_playlist_url: "https://cdn.example/fb-response.m3u8" },
        ],
      },
    },
  });
  assert.equal(model.id, "fb-response-1");
  assert.equal(model.versions.length, 1);
  assert.equal(model.versions[0].url, "https://cdn.example/fb-response.mp4");
  assert.equal(model.manifestUrl, "https://cdn.example/fb-response.mpd");
  assert.equal(model.manifestType, "dash");
  assert.equal(model.manifestXml, "<MPD/>");
  assert.equal(extractMediaModels({
    __typename: "Video",
    id: "fb-response-1",
    videoDeliveryResponseFragment: {
      videoDeliveryResponseResult: {
        progressive_urls: [{ progressive_url: "https://cdn.example/dup.mp4" }],
      },
    },
  }).length, 1);
});

test("Facebook response fragment with a conflicting ID contributes no child sources", () => {
  const [model] = extractMediaModels({
    __typename: "Video",
    id: "fb-parent",
    video_url: "https://cdn.example/parent.mp4",
    videoDeliveryResponseFragment: {
      videoDeliveryResponseResult: {
        video_id: "fb-other",
        progressive_urls: [{ progressive_url: "https://cdn.example/other.mp4" }],
        dash_manifest_urls: [{ manifest_url: "https://cdn.example/other.mpd" }],
      },
    },
  });
  assert.equal(model.id, "fb-parent");
  assert.deepEqual(model.versions.map((item) => item.url), [
    "https://cdn.example/parent.mp4",
  ]);
  assert.equal(model.manifestUrl, undefined);
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

test('Vimeo API play response retains route identity and prefers HLS over JSON DASH',()=>{
 const [model]=extractMediaModels({uri:'/videos/1084537',name:'Big Buck Bunny',duration:597,play:{hls:{link:'https://cdn.example/master.m3u8'},dash:{link:'https://cdn.example/master.json'},progressive:[{link:'https://cdn.example/720.mp4',height:720}]} });
 assert.equal(model.id,'1084537');assert.equal(model.manifestUrl,'https://cdn.example/master.m3u8');assert.equal(model.versions[0].height,720);
 const store=createMediaModelStore();store.merge([model]);const video={closest:()=>null};assert.equal(store.modelFor(video,'https://vimeo.com/1084537').id,'1084537');
});
test('player config files preserve their own video ID and CDN choice',()=>{
 const [model]=extractMediaModels({video:{id:1084537,title:'Big Buck Bunny'},request:{files:{hls:{default_cdn:'ak',cdns:{ak:{url:'https://cdn.example/master.m3u8'}}},progressive:[{url:'https://cdn.example/high.mp4',height:1080}]}}});
 assert.equal(model.id,'1084537');assert.equal(model.title,'Big Buck Bunny');assert.equal(model.manifestUrl,'https://cdn.example/master.m3u8');
});

test('TikTok style playback URLs bind to the owning aweme ID without borrowing sibling media',()=>{
 const fixture={aweme_detail:{aweme_id:'7420000000000000001',desc:'Sample clip',video:{duration:12500,bitrateInfo:[{PlayAddr:{UrlList:['https://v16.tiktokcdn.example/video/tos/sample.mp4'],DataSize:1200}}]}}};
 const [model]=extractMediaModels(fixture,{baseUrl:'https://www.tiktok.com/@creator/video/7420000000000000001'});
 assert.equal(model.id,'7420000000000000001');
 assert.equal(model.title,'Sample clip');
 assert.deepEqual(model.versions.map(item=>item.url),['https://v16.tiktokcdn.example/video/tos/sample.mp4']);
 const store=createMediaModelStore();store.merge([model]);
 assert.equal(store.modelFor({closest:()=>null},'https://www.tiktok.com/@creator/video/7420000000000000001').id,model.id);
 const unrelated=extractMediaModels({aweme_detail:{aweme_id:'parent',video:{bitrateInfo:[{PlayAddr:{UrlList:['https://cdn.example/a.mp4']}}]},recommendations:[{video:{playAddr:'https://cdn.example/b.mp4'}}]}});
 assert.equal(unrelated.length,2);
 assert.deepEqual(unrelated.map(item=>item.id).sort(),['parent',undefined]);
});

test('TikTok downloadAddr is tried before playAddr while preserving the owning aweme identity',()=>{
 const model=extractMediaModels({aweme_id:'tt-1',video:{playAddr:{UrlList:['https://cdn.example/play.mp4']},downloadAddr:{UrlList:['https://cdn.example/download.mp4']}}})[0];
 assert.equal(model.id,'tt-1');
 assert.deepEqual(model.versions.map(item=>item.url),['https://cdn.example/download.mp4','https://cdn.example/play.mp4']);
 const bitrate=extractMediaModels({aweme_id:'tt-2',video:{bitrateInfo:[{downloadAddr:{UrlList:['https://cdn.example/bitrate-download.mp4']},PlayAddr:{UrlList:['https://cdn.example/bitrate-play.mp4']}}]}})[0];
 assert.deepEqual(bitrate.versions.map(item=>item.url),['https://cdn.example/bitrate-download.mp4','https://cdn.example/bitrate-play.mp4']);
});

test('bounded script scan recognizes JSON with TikTok playback field names',()=>{
 const store=createMediaModelStore();
 const script={textContent:JSON.stringify({aweme_detail:{aweme_id:'id-1',video:{playAddr:'https://cdn.example/a.mp4'}}}),closest:()=>null};
 const document={querySelectorAll:selector=>selector.startsWith('script')?[script]:[]};
 assert.equal(store.scanDocument(document,'https://www.tiktok.com/@creator/video/id-1').length,1);
});

test('TikTok ItemStruct keeps the post title, resource aliases and explicit playback structure',()=>{
 const model=extractMediaModels({id:'7690095904514297106',desc:'Post description',author:{id:'author'},video:{id:'7690095904514297106',videoID:'resource',PlayAddrStruct:{UrlList:['https://cdn.example/current.mp4']},playAddr:'https://cdn.example/play.mp4',bitrateInfo:[{GearName:'normal_720_0',PlayAddr:{Width:1280,Height:720,UrlList:['https://cdn.example/720.mp4']}}]}})[0];
 assert.ok(model.aliases.includes('7690095904514297106'));assert.ok(model.aliases.includes('resource'));
 assert.equal(model.title,'Post description');assert.ok(model.versions.some(v=>v.url.endsWith('current.mp4')));
 assert.equal(model.versions.find(v=>v.url.endsWith('720.mp4')).height,720);
});

test('post descriptors and resource-only player descriptors coalesce without merging distinct posts',()=>{
 const store=createMediaModelStore();
 store.merge(extractMediaModels({id:'post',videoID:'resource',playAddr:'https://cdn.example/a.mp4'}));
 store.merge(extractMediaModels({videoID:'resource',playAddr:'https://cdn.example/a.mp4'}));
 assert.equal(store.models().length,1);assert.equal(store.models()[0].id,'post');
 store.merge(extractMediaModels({id:'other-post',videoID:'resource',playAddr:'https://cdn.example/b.mp4'}));
 assert.equal(store.models().length,2);
});

test('new FB delivery must agree independently even when legacy delivery has the correct ID',()=>{
 const [model]=extractMediaModels({__typename:'Video',id:'current',videoDeliveryLegacyFields:{id:'current',browser_native_hd_url:'https://cdn.example/right.mp4'},videoDeliveryResponseFragment:{videoDeliveryResponseResult:{id:'other',progressive_urls:[{progressive_url:'https://cdn.example/wrong.mp4'}]}}});
 assert.deepEqual(model.versions.map(v=>v.url),['https://cdn.example/right.mp4']);
 assert.doesNotThrow(()=>extractMediaModels({__typename:'Video',id:'bad-array',videoDeliveryResponseFragment:{videoDeliveryResponseResult:{dash_manifest_urls:{},hls_playlist_urls:'invalid',dash_manifests:{}}}}));
});
