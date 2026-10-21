# VideoPocket FFmpeg corresponding source

`ffmpeg-5.1.4-videopocket-source.zip` is the corresponding-source archive for the custom single-thread FFmpeg WebAssembly files in `extension/vendor/`.

| archive | bytes | SHA-256 |
|---|---:|---|
| `ffmpeg-5.1.4-videopocket-source.zip` | 18,996,609 | `F438A9D28E2EA55CF84AD66E0C15737F1F98D0755DA160F8A41E08E1DC9C2639` |

The archive contains the complete FFmpeg `n5.1.4` source tree, VideoPocket build scripts, and FFmpeg/Emscripten license texts, including upstream test fixtures. Its `fftools/ffmpeg.c` includes the local `__EMSCRIPTEN__` patch that disables only optional `getrusage` and `ru_maxrss` benchmark fields. It intentionally excludes the Emscripten SDK, compiler binaries, `wasm-opt`, generated objects, build cache, personal test media, credentials, and other personal validation data.

The source package records the official FFmpeg source archive SHA-256 as `6ED8BA17D513955CD9A03D0D87195B8EAC3D148DCB61EF30EBDDF1A3CD718DE8`. Rebuild with Emscripten `3.1.40` and `wasm-opt` using the included `build-single.sh`; the script uses the single-thread configuration and postprocesses with `wasm-opt -Oz --strip-debug --strip-producers`. Host toolchain differences may prevent bit-for-bit reproduction.

The current production bundle correspondence is:

| file | bytes | SHA-256 |
|---|---:|---|
| `extension/vendor/ffmpeg-core.js` | 207,964 | `AE48201D0456EB136F050869798A2C448FD91F422019E2F05365BEE1A1724AAD` |
| `extension/vendor/ffmpeg-core.wasm` | 4,664,753 | `3A9EAFAFDC05535CF5FD651182C8B421077D159DA43120DAD5F814CD882C72B1` |

This is developer corresponding-source material only; it is not loaded by or included in the extension installation package.
