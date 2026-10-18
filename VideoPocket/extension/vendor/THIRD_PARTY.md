# Bundled dependencies

All executable browser assets are local. No runtime npm install, CDN fetch, native executable, remote script evaluation or download backend is required.

| Component | Version | License | Source |
|---|---|---|---|
| FFmpeg (custom single-thread WebAssembly, native codecs, stream-copy build) | 5.1.4 | LGPL-2.1-or-later; Emscripten runtime MIT | https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.gz |
| m3u8-parser | 7.2.0 | Apache-2.0 | https://github.com/videojs/m3u8-parser |
| mpd-parser | 1.4.0 | Apache-2.0 | https://github.com/videojs/mpd-parser |
| @videojs/vhs-utils | 4.1.2 | MIT | https://github.com/videojs/vhs-utils |
| @babel/runtime | 7.29.10 | MIT | https://github.com/babel/babel |
| @xmldom/xmldom | 0.8.15 | MIT | https://github.com/xmldom/xmldom |
| global | 4.4.0 | MIT | https://github.com/Raynos/global |
| googlevideo (SABR downloader and protobuf messages) | main commit 01d5b091a6ce88ebf6d25a7b1b88914d9e16c294; unreleased changes after npm 4.1.1 | MIT | https://github.com/LuanRT/googlevideo/tree/01d5b091a6ce88ebf6d25a7b1b88914d9e16c294 |
| @bufbuild/protobuf | 2.6.2 | Apache-2.0 AND BSD-3-Clause | https://github.com/bufbuild/protobuf-es/tree/v2.6.2 |

Notices and license texts are in `licenses/`. `parsers.js` bundles the two manifest parsers and their listed dependencies. `sabr.js` bundles SabrStream and VideoPlaybackAbrRequest with their UMP/protobuf helpers. Application modules are provided as readable JavaScript. No dynamic attestation interpreter or remote download service is included.

## FFmpeg WebAssembly build

This local test build replaces @ffmpeg/core 0.12.10 with a custom FFmpeg 5.1.4 single-thread core. It includes WORKERFS input and an application OPFS output filesystem, and is loaded only when remuxing or extracting audio. Application code is MIT; FFmpeg retains LGPL-2.1-or-later. No external codec libraries or encoders are enabled. Emscripten runtime terms are in `licenses/emscripten.txt`, FFmpeg terms in `licenses/LGPL-2.1.txt`.

The separate corresponding-source archive accompanying this local delivery includes clean FFmpeg source, configuration/build scripts, source URLs, licenses and asset SHA-256. It is not required at runtime. The original stable extension retains its previous unchanged core and licensing notices. See the local optimization report for exact resulting binary sizes and hashes.

Build tools: Emscripten 3.1.40 and its wasm-opt, FFmpeg 5.1.4. Native FFmpeg/ffprobe used for QA are not shipped. The JavaScript adapter invokes callMain with `-nostdin -y` and the application's stream-copy arguments; it does not add transcoding.

## Other bundles

`parsers.js` and `sabr.js` retain the source and notices listed above. `media-observer.js` is a local IIFE bundle of this project's media-evidence, media-models and media-observer-source modules. Rebuild with the development-only esbuild script under `build/`; no CDN, downloaded runtime code, Python, native helper or server is used by extension users.
