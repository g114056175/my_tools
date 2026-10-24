import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const vendorPath = new URL('../extension/vendor/mediabunny.js', import.meta.url);
const initPath = new URL('./fixtures/fb-init-only-895.mp4', import.meta.url);
// Generated 1-second, 16x16 black H.264 sample; no third-party footage.
const normalPath = new URL('./fixtures/fb-normal-sample.mp4', import.meta.url);
const reportPath = new URL('../work/fb-regression-20/mediabunny-init-packet.json', import.meta.url);

function loadMediabunny(code) {
  const context = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
    Float32Array, Float64Array, DataView, ArrayBuffer, console, TextEncoder, TextDecoder,
    Blob, File, ReadableStream, WritableStream, TransformStream, DOMException, performance,
    crypto, structuredClone, setTimeout, clearTimeout, queueMicrotask };
  context.globalThis = context; context.self = context;
  vm.runInNewContext(code, context, { filename: 'mediabunny.js' });
  return context.VideoPocketMediabunny;
}

async function firstPacket(M, bytes) {
  const input = new M.Input({ source: new M.BlobSource(new Blob([bytes])), formats: [M.MP4] });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return false;
    const packet = await new M.EncodedPacketSink(track).getFirstPacket();
    try { return !!packet; } finally { packet?.close?.(); }
  } finally { await input.dispose(); }
}

test('Mediabunny rejects the saved 895-byte init-only MP4 and accepts a normal MP4 packet', async () => {
  const M = loadMediabunny(await fs.readFile(vendorPath, 'utf8'));
  const init = new Uint8Array(await fs.readFile(initPath));
  const normal = new Uint8Array(await fs.readFile(normalPath));
  assert.equal(init.byteLength, 895);
  const initPacket = await firstPacket(M, init);
  const normalPacket = await firstPacket(M, normal);
  const report = { initBytes: init.byteLength, initFirstVideoPacket: initPacket,
    normalBytes: normal.byteLength, normalFirstVideoPacket: normalPacket };
  await fs.mkdir(new URL('../work/fb-regression-20/', import.meta.url), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  assert.equal(initPacket, false);
  assert.equal(normalPacket, true);
});
