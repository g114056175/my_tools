# Bundled dependencies

All executable browser assets are local. No runtime npm install, CDN fetch, native executable, remote script evaluation or download backend is required.

| Component | Version | License | Source |
|---|---|---|---|
| @ffmpeg/core (single-thread UMD JS + WASM, unmodified npm distribution) | 0.12.10 | GPL-2.0-or-later, plus underlying FFmpeg/external-library terms | https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core |
| m3u8-parser | 7.2.0 | Apache-2.0 | https://github.com/videojs/m3u8-parser |
| mpd-parser | 1.4.0 | Apache-2.0 | https://github.com/videojs/mpd-parser |
| @videojs/vhs-utils | 4.1.2 | MIT | https://github.com/videojs/vhs-utils |
| @babel/runtime | 7.29.10 | MIT | https://github.com/babel/babel |
| @xmldom/xmldom | 0.8.15 | MIT | https://github.com/xmldom/xmldom |
| global | 4.4.0 | MIT | https://github.com/Raynos/global |
| googlevideo (SABR downloader and protobuf messages) | main commit 01d5b091a6ce88ebf6d25a7b1b88914d9e16c294; unreleased changes after npm 4.1.1 | MIT | https://github.com/LuanRT/googlevideo/tree/01d5b091a6ce88ebf6d25a7b1b88914d9e16c294 |
| @bufbuild/protobuf | 2.6.2 | Apache-2.0 AND BSD-3-Clause | https://github.com/bufbuild/protobuf-es/tree/v2.6.2 |

Notices and license texts are in `licenses/`. `parsers.js` bundles the two manifest parsers and their listed dependencies. `sabr.js` bundles SabrStream and VideoPlaybackAbrRequest with their UMP/protobuf helpers. Application modules are provided as readable JavaScript. No dynamic attestation interpreter or remote download service is included.

FFmpeg WebAssembly is a compiled browser library, not an installed FFmpeg program. The upstream core's license is distinct from the MIT JavaScript wrapper (the latter is not used here). Upstream explains this in https://ffmpegwasm.netlify.app/docs/faq/ . Core build sources, Dockerfiles, build scripts and pinned third-party source locations are at https://github.com/ffmpegwasm/ffmpeg.wasm ; original FFmpeg source and licenses are at https://ffmpeg.org/download.html and https://ffmpeg.org/legal.html . The distributed core files have not been modified.

For development, bundle `Parser` from m3u8-parser and `parse` from mpd-parser with esbuild for an ESM browser target. Build the pinned googlevideo commit's protobuf/ESM sources and bundle SabrStream plus VideoPlaybackAbrRequest. Copy the two UMD core assets from @ffmpeg/core/dist/umd. These are build steps; extension users do not execute them.

## Corresponding build sources

The unchanged UMD core matches the official npm package `@ffmpeg/core@0.12.10` byte-for-byte:

- `ffmpeg-core.js` SHA-256: `B266AB5B952555881DD6310663986994A182ACB2B7FF25CF10A25F7A37AC2B21`
- `ffmpeg-core.wasm` SHA-256: `9F57947A5BD530D8F00C5B3F2CB2A3492FAA7E5D823315342D6A8656D0A6B7B7`

Upstream build sources: [ffmpeg.wasm commit 71aa99d37c02a7b4c435275ca9ef50e612f6efa1](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1), FFmpeg `n5.1.4`, Emscripten `3.1.40`, and the external libraries listed by its Dockerfile. A separate [source attachment](https://github.com/g114056175/my_tools/releases/download/video-pocket-v1.0.0/videoPocket-third-party-sources-v1.0.0.zip) accompanies the runtime ZIP on the same release. It includes those library source archives with their license files, upstream build scripts, fixed source revisions and SHA-256 manifest. It is not needed to install or use the extension.

The Dockerfile's LAME and x264 branch inputs are pinned in that attachment to the same commits found in upstream history before the npm release and at packaging time. The build environment has not been reproduced, so this is not a bit-for-bit rebuild claim. Other bundled components retain their source links and license notices above and in `licenses/`.
