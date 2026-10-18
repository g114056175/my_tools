# Mediabunny evaluation (not part of the delivered extension)

Pinned prototype: Mediabunny 1.61.6 (MPL-2.0), bundled by esbuild 0.28.2. Run `npm install` then `npm run build` here to rebuild the classic worker library. The bundle intentionally assigns `globalThis.VideoPocketMediabunny` itself; do not add an esbuild globalName that would overwrite that assignment.

`extension/media-mux.js`, `media-mux-worker.js`, `vendor/mediabunny.js` and its license are research assets. Production `offscreen.js` continues to call `ffmpeg-worker.js`. The optimized runtime package excludes all four research assets and the standalone instagram/twitch test adapters (the actual injected pageSnapshot must contain self-contained equivalents).

Packet-copy passed MP4/WebM/TS/fMP4/AV1/HEVC cases. FLV failed and the two-hour synthetic sample was slower than FFmpeg; the prototype does not implement the same MP4 faststart setting. Therefore it is not the default muxer. Source: https://github.com/Vanilagy/mediabunny/tree/v1.61.6 ; official package: https://www.npmjs.com/package/mediabunny/v/1.61.6 . License: ../extension/vendor/licenses/mediabunny.txt .

Benchmarks and real network samples were run separately under the task's scratch work directory; signed URLs, tokens, media payloads and local validation server are not distribution assets. See the user-facing OPTIMIZATION.md report for scope and limitations.
