// Synthetic compatibility fixtures. No credentials or real media URLs.
export const mediaSchemaFixtures = [
  {
    name: "Facebook legacy delivery",
    value: {
      __typename: "Video", id: "fb-legacy-1", title: "FB legacy title",
      videoDeliveryLegacyFields: {
        id: "fb-legacy-1", browser_native_hd_url: "https://cdn.example.test/fb-legacy.mp4",
        playable_duration_in_ms: 12500, height: 720,
      },
    },
  },
  {
    name: "Facebook response delivery",
    value: {
      __typename: "Video", id: "fb-response-1", title: "FB response title",
      videoDeliveryResponseFragment: { videoDeliveryResponseResult: {
        progressive_urls: [{ progressive_url: "https://cdn.example.test/fb-response.mp4" }],
        dash_manifest_urls: [{ manifest_url: "https://cdn.example.test/fb-response.mpd" }],
      } },
    },
  },
  {
    name: "TikTok PlayAddrStruct and bitrateInfo",
    value: {
      id: "tt-post-1", desc: "TikTok title", video: {
        id: "tt-post-1", videoID: "tt-resource-1",
        PlayAddrStruct: { UrlList: ["https://cdn.example.test/tt-current.mp4"] },
        duration: 18, bitrateInfo: [{ PlayAddr: {
          Width: 1280, Height: 720, UrlList: ["https://cdn.example.test/tt-720.mp4"],
        } }],
      },
    },
  },
  {
    name: "Instagram video_versions",
    value: {
      __typename: "GraphVideo", code: "ig-contract-1", title: "Instagram title",
      video_duration: 7.5, original_height: 1080,
      video_versions: [{ url: "https://cdn.example.test/ig.mp4", width: 608, height: 1080 }],
    },
  },
  {
    name: "Threads video_versions",
    value: {
      media_id: "threads-contract-1", title: "Threads title", duration: 9,
      height: 720, video_versions: [{ url: "https://cdn.example.test/threads.mp4", height: 720 }],
    },
  },
  {
    name: "Instagram Polaris numeric player identity",
    playerId: "3971730051816042598",
    value: {
      id: "POLARIS_3971730051816042598", code: "Dcea3BiPTBm",
      video_duration: 41.166122, original_width: 720, original_height: 1280,
      video_versions: [{url:"https://cdn.example.test/polaris-video.mp4",width:720,height:1280}],
    },
  },
  {
    name: "X ordinary video_info",
    value: {
      rest_id: "x-post-1", legacy: { full_text: "X ordinary title", extended_entities: { media: [{
        id_str: "x-media-1", type: "video", video_info: {
          duration_millis: 21000, variants: [{ content_type: "video/mp4", url: "https://cdn.example.test/x.mp4" }],
          original_info: { height: 900 },
        },
      }] } },
    },
  },
  {
    name: "X quoted video_info",
    // Full quoted-tweet envelopes exceed the production Worker depth limit;
    // JSON/Response paths cover the envelope, Worker covers direct X media.
    worker: false,
    value: {
      rest_id: "x-outer-1", legacy: { extended_entities: { media: [{ id_str: "x-outer-media", video_info: {
        variants: [{ content_type: "video/mp4", url: "https://cdn.example.test/x-outer.mp4" }],
      } }] } },
      quoted_status_result: { result: { rest_id: "x-quoted-1", legacy: {
        full_text: "X quoted title", extended_entities: { media: [{ id_str: "x-quoted-media", video_info: {
          duration_millis: 33000, variants: [{ content_type: "video/mp4", url: "https://cdn.example.test/x-quoted.mp4" }],
          original_info: { height: 1080 },
        } }] },
      } } },
    },
  },
  {
    name: "X broadcast metadata and playback",
    parts: [
      { value: { broadcasts: { "broadcast-contract": { id: "broadcast-contract", media_key: "28_contract" } } }, baseUrl: "https://x.com/i/api/1.1/broadcasts/show.json?ids=broadcast-contract" },
      { value: { source: { noRedirectPlaybackUrl: "https://cdn.example.test/broadcast-contract.m3u8" } }, baseUrl: "https://x.com/i/api/1.1/live_video_stream/status/28_contract" },
    ],
  },
  {
    name: "generic source schema",
    value: { id: "generic-source-1", title: "Generic source title", duration: 12, height: 540,
      sources: [{ type: "video/mp4", src: "https://cdn.example.test/generic.mp4" }] },
  },
  {
    name: "generic player configuration",
    value: { video: { id: 1001, title: "Player config title" }, request: {
      files: { progressive: [{ url: "https://cdn.example.test/player.mp4", height: 720 }] },
    } },
  },
  {
    name: "Facebook HLS-only response",
    value: {id: "fb-hls", videoDeliveryResponseFragment: {videoDeliveryResponseResult: {
      hls_playlist_urls: [{hls_playlist_url: "https://cdn.example.test/fb-hls.m3u8"}],
    }}},
  },
  {
    name: "generic MIME-only HLS",
    value: {id: "mime-hls", sources: [{url: "https://cdn.example.test/manifest", contentType: "application/vnd.apple.mpegurl"}]},
  },
  {
    name: "direct HLS declaration",
    value: {id: "direct-hls", hls: "https://cdn.example.test/direct.m3u8"},
  },
  {
    name: "Dailymotion qualities",
    value: {id: "dm-1", duration: 15, title: "Dailymotion title", qualities: {
      auto: [{type: "application/x-mpegURL", url: "https://cdn.example.test/dm.m3u8"}],
      720: [{type: "video/mp4", url: "https://cdn.example.test/dm.mp4", width_px: 1280, height_px: 720}],
    }},
  },
  {
    name: "player mediaDefinitions and remote exclusion",
    value: {video_id: "definitions-1", video_title: "Player definitions", video_duration: 18, mediaDefinitions: [
      {format: "hls", videoUrl: "https://cdn.example.test/definitions.m3u8", adaptive: true},
      {format: "mp4", videoUrl: "https://cdn.example.test/definitions.mp4", quality: 720},
      {format: "mp4", videoUrl: "https://cdn.example.test/remote.mp4", remote: true},
    ]},
  },
  {
    name: "Vimeo preferred CDN",
    value: {data: {result: {video: {id: "vimeo-1", title: "CDN choice"}, request: {files: {hls: {
      default_cdn: "preferred", cdns: {first: {url: "https://cdn.example.test/other.m3u8"}, preferred: {url: "https://cdn.example.test/preferred.m3u8"}},
    }}}}}},
    worker: false, // The outer API wrappers put URL scalars beyond depth 8.
  },
];
