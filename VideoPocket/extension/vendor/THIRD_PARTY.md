# Bundled dependencies

All executable browser assets are local. No runtime npm install, CDN fetch, native executable, remote script evaluation or download backend is required.

| Component | Version | License | Source |
|---|---|---|---|
| FFmpeg (custom single-thread WebAssembly, native codecs, stream-copy build) | 5.1.4 | LGPL-2.1-or-later; Emscripten runtime MIT | https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.gz |
| Mediabunny (local remux and precise-cut bundle) | 1.61.6 | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
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

This production build replaces @ffmpeg/core 0.12.10 with a custom FFmpeg 5.1.4 single-thread core. It includes WORKERFS input and an application OPFS output filesystem, and is loaded only when remuxing or extracting audio. Application code is MIT; FFmpeg retains LGPL-2.1-or-later. No external codec libraries or encoders are enabled. Emscripten runtime terms are in `licenses/emscripten.txt`, FFmpeg terms in `licenses/LGPL-2.1.txt`.

The Emscripten-only patch in `fftools/ffmpeg.c` disables process resource-usage benchmark queries (`getrusage` and `ru_maxrss`) that this browser runtime cannot meaningfully implement. It does not filter console errors or change media processing; the matching source archive includes this patch.

The corresponding source is published in `third-party/ffmpeg/ffmpeg-5.1.4-videopocket-source.zip`, with archive size and SHA-256 in `third-party/ffmpeg/README.md`. It contains the patched FFmpeg source, build scripts, licenses and bundle hashes; it is developer material and is not required at runtime or included in the extension installation package. The GitHub project target is https://github.com/g114056175/my_tools/tree/main/VideoPocket/third-party/ffmpeg.

Build tools: Emscripten 3.1.40 and its wasm-opt, FFmpeg 5.1.4. Native FFmpeg/ffprobe used for QA are not shipped. The JavaScript adapter invokes callMain with `-nostdin -y` and the application's stream-copy arguments; it does not add transcoding.

## Other bundles

`mediabunny.js` uses the same pinned 1.61.6 dependency; its license is in `licenses/mediabunny.txt`. The local bundle exports Conversion, Quality, canEncodeVideo, VideoSampleSink and AudioSampleSink for precise cuts, matching hardware capability probes and presentation validation. Reproduce the modified source build with `build/patch-mediabunny-duration.mjs`, `evaluation/build.mjs`, `evaluation/entry.js` and `evaluation/package-lock.json`; `work/release-polish/mediabunny-build.json` records the matching formal and rebuilt bundle SHA-256. No dependency version was changed.

Selected fragments are aligned on a shared timeline in OPFS. Compatible MP4 video cuts copy packets only when the requested start exactly matches a verified key packet; other starts use precise conversion rather than hiding a multi-second video pre-roll behind edit lists. Audio-only M4A may still use edit lists. The local MP4 helper caps movie, track and edit-list presentation durations without changing media sample tables or payloads. VP9 Profile 0, 8-bit WebM/Matroska cuts may encode only the start-to-next-keyframe boundary, then copy intact original packets, including superframes. Configuration mismatches or failed timing checks fall back to the existing precise conversion path. Other unsupported smart-cut combinations use that ordinary browser WebCodecs path, which may re-encode the selected interval. Unsupported browser codecs fail explicitly instead of saving a known inaccurate cut.

The bundle also exports CustomSource and video sample-source interfaces for indexed MP4 reads and H.264 boundary encoding. Compatible H.264 cuts can encode boundary GOPs and copy the verified middle packets; long GOPs, incompatible configurations or failed timing checks use precise conversion of the selected interval. These application helpers do not change the pinned upstream codec package or add a runtime dependency.

Safe copy boundaries leave quality/bitrate unset. Necessary encodes probe high bitrate-based quality with prefer-hardware; hardware use is a hint, not guaranteed. Normalization retains the required GOP window and audio preroll. Outputs are checked for expected tracks, start, duration and synchronization; MP4 additionally checks the actual sample presented at zero and its movie presentation duration. Full downloads retain the existing stream-copy path. This adds no package or remote runtime dependency; boundary encoding can use CPU and change compression quality in that boundary.

`parsers.js` and `sabr.js` retain the source and notices listed above. `media-observer.js` is a local IIFE bundle of this project's media-evidence, media-models and media-observer-source modules. Rebuild with the development-only esbuild script under `build/`; no CDN, downloaded runtime code, Python, native helper or server is used by extension users.

Local Matroska duration fix (1.61.6): video packets with a positive duration use BlockGroup + BlockDuration, preserving explicit VFR timing at cluster boundaries. Without this, the last frame of a cluster could demux with zero duration and be dropped during conversion. Reproduce with `build/patch-mediabunny-duration.mjs` before `evaluation/build.mjs`; the pinned package is specified by `evaluation/package-lock.json`, and the modified muxer is applied to both source and dist files before bundling. MPL-2.0 terms remain unchanged.
