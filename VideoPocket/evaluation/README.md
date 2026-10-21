# Mediabunny bundle build and evaluation history

Pinned production dependency: Mediabunny 1.61.6 (MPL-2.0), bundled by esbuild 0.28.2. From the repository root, run `npm ci --prefix evaluation`, then `npm run build:mediabunny`; the build patches the installed 1.61.6 Matroska muxer before bundling. Use `node evaluation/build.mjs --output <temporary-file>` to verify a rebuild without replacing the checked-in extension bundle. The bundle intentionally assigns `globalThis.VideoPocketMediabunny` itself; do not add an esbuild globalName that would overwrite that assignment. This directory is a development tool; only the generated bundle and its license ship in the extension.

`extension/vendor/mediabunny.js` is a production runtime asset used by `range-cut-worker.js` for precise cuts. The older `media-mux.js` and `media-mux-worker.js` prototype remain evaluation history; they are not the build entry. The standalone instagram/twitch adapters remain research assets because the injected page snapshot contains self-contained equivalents.

Packet-copy passed MP4/WebM/TS/fMP4/AV1/HEVC cases. FLV failed and the two-hour synthetic sample was slower than FFmpeg; the prototype does not implement the same MP4 faststart setting. Therefore it is not the default muxer. Source: https://github.com/Vanilagy/mediabunny/tree/v1.61.6 ; official package: https://www.npmjs.com/package/mediabunny/v/1.61.6 . License: ../extension/vendor/licenses/mediabunny.txt .

Benchmarks and real network samples were run separately under the task's scratch work directory; signed URLs, tokens, media payloads and local validation server are not distribution assets. See the user-facing OPTIMIZATION.md report for scope and limitations.
