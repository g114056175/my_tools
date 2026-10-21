import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../extension/range-mp4-copy.js', import.meta.url), 'utf8');
const box = (type, body) => { const out = new Uint8Array(8 + body.length); new DataView(out.buffer).setUint32(0, out.length); out.set([...type].map(c => c.charCodeAt(0)), 4); out.set(body, 8); return out; };
function children(bytes, from = 0, to = bytes.length) { const out = []; for (let p = from; p < to;) { const size = new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0); out.push({ start: p, end: p + size, head: 8, type: String.fromCharCode(...bytes.slice(p + 4, p + 8)) }); p += size; } return out; }
function findBox(bytes, type, from = 0, to = bytes.length) { for (const item of children(bytes, from, to)) { if (item.type === type) return item; if (['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl'].includes(item.type)) { const nested = findBox(bytes, type, item.start + item.head, item.end); if (nested) return nested; } } return null; }
function syntheticMoov(version = 0, duration = 10000, leadingEmpty = 0, withEdit = true) {
  const mvhd = new Uint8Array(version ? 36 : 28); mvhd[0] = version; new DataView(mvhd.buffer).setUint32(version ? 20 : 12, 1000); if (version) new DataView(mvhd.buffer).setBigUint64(24, BigInt(duration)); else new DataView(mvhd.buffer).setUint32(16, duration);
  const tkhd = new Uint8Array( version ? 44 : 32); tkhd[0] = version; if (version) new DataView(tkhd.buffer).setBigUint64(28, BigInt(duration)); else new DataView(tkhd.buffer).setUint32(20, duration);
  const elst = new Uint8Array(8 + (leadingEmpty ? 24 : 12)); const ev = new DataView(elst.buffer); ev.setUint32(4, leadingEmpty ? 2 : 1); if (leadingEmpty) { ev.setUint32(8, leadingEmpty); ev.setInt32(12, -1); ev.setUint32(16, 0x00010000); ev.setUint32(20, duration - leadingEmpty); ev.setInt32(24, 0); ev.setUint32(28, 0x00010000); } else { ev.setUint32(8, duration); ev.setInt32(12, 0); ev.setUint32(16, 0x00010000); }
  const trakChildren = withEdit ? [...box('tkhd', tkhd), ...box('edts', box('elst', elst))] : [...box('tkhd', tkhd), 0, 0, 0, 12, 0x73, 0x74, 0x63, 0x6f, 0xaa, 0xbb, 0xcc, 0xdd];
  return box('moov', new Uint8Array([...box('mvhd', mvhd), ...box('trak', new Uint8Array(trakChildren))]));
}

function runtime({ discardedTracks = [], valid = true, moov = syntheticMoov() } = {}) {
  const calls = [];
  let aborted = 0;
  class Conversion {
    static async init(options) {
      calls.push(options);
      return {
        isValid: valid,
        discardedTracks,
        onProgress: null,
        async execute() { options.output.options.format.options.onMoov(moov, 0); this.onProgress?.(1, options.trim.end); },
        async cancel() { calls.push({ cancel: true }); },
      };
    }
  }
  class Output { constructor(options) { this.options = options; } }
  class Mp4OutputFormat { constructor(options) { this.options = options; } }
  class StreamTarget { constructor(stream, options) { this.stream = stream; this.options = options; } }
  const writes = [];
  const writer = {
    path: 'video-pocket/scope/out.part',
    access: { write(data) { writes.push(new Uint8Array(data)); return data.byteLength; }, getSize() { return moov.length; }, truncate() {} },
    finish() { return { path: this.path, size: 42 }; },
    abort() { aborted++; },
  };
  const removed = [];
  const context = {
    WritableStream,
    VideoPocketMediabunny: { MP4: {}, Conversion, Output, Mp4OutputFormat, StreamTarget, EncodedPacketSink:class{constructor(track){this.track=track;}async getKeyPacket(start,options){calls.push({keyProbe:options});return {timestamp:this.track.keyTimestamp??start};}} },
    VideoPocketDiskMedia: { async createSyncMediaFile() { return writer; }, async removeMediaFile(path) { removed.push(path); } },
  };
  vm.runInNewContext(source, context);
  return { api: context.VideoPocketRangeMp4, calls, get aborted() { return aborted; }, removed, writes };
}

const input = {
  async getFormat() { return { name: 'MP4' }; },
  async getPrimaryVideoTrack() { return {}; },
  async getPrimaryAudioTrack() { return {}; },
};

test('copies an MP4 range with forced edit-list settings', async () => {
  const rt = runtime();
  const progress = [];
  const result = await rt.api.tryCut({ input, start: 2, end: 5, output: 'clip.mp4', scope: 's',
    expectedAudio: true, onProgress: value => progress.push(value) });
  assert.deepEqual(result.result, { path: 'video-pocket/scope/out.part', size: 42 });
  assert.equal(result.stats.strategy, 'mp4-keyframe-copy');
  assert.equal(result.stats.copiedSeconds, 3);
  assert.equal(progress.at(-1), 1);
  const options = rt.calls.find(call=>call.trim);
  assert.equal(options.trim.start, 2);
  assert.equal(options.trim.end, 5 - 1e-6);
  assert.equal(options.copy.mode, 'forced');
  assert.equal(options.copy.shiftTolerance, 0);
  assert.equal(options.copy.boundaryPolicy, 'expand');
  assert.equal(options.copy.boundaryTolerance, Infinity);
  assert.deepEqual(Object.keys(options.video), []);
  assert.deepEqual(Object.keys(options.audio), []);
  assert.equal(rt.aborted, 0);
});

test('returns null for unsupported output extension', async () => {
  const rt = runtime();
  assert.equal(await rt.api.tryCut({ input, start: 0, end: 1, output: 'clip.webm', scope: 's' }), null);
  assert.equal(rt.calls.length, 0);
});

test('allows an already normalized Matroska input to enter forced copy', async () => {
  const rt = runtime();
  const matroskaInput = {
    async getPrimaryVideoTrack() { return {}; },
    async getPrimaryAudioTrack() { return {}; },
  };
  const result = await rt.api.tryCut({ input: matroskaInput, start: 0, end: 1, output: 'clip.mp4', scope: 's' });
  assert.equal(result.stats.strategy, 'mp4-keyframe-copy');
  assert.equal(rt.calls.filter(call=>call.trim).length, 1);
});

test('rejects a forced-copy failure and aborts the writer', async () => {
  const rt = runtime({ discardedTracks: [{ reason: 'cannot_copy' }] });
  await assert.rejects(
    rt.api.tryCut({ input, start: 0, end: 1, output: 'clip.m4a', scope: 's' }),
    error => error.code === 'RANGE_SMART_UNSUPPORTED',
  );
  assert.equal(rt.aborted, 1);
  assert.deepEqual(rt.removed, ['video-pocket/scope/out.part']);
});

test('reads presentation duration from mvhd v0/v1 without decoding media', async () => {
  const rt = runtime();
  const mdat = box('mdat', new Uint8Array([1, 2, 3, 4]));
  assert.equal(await rt.api.presentationDuration(new Blob([mdat, syntheticMoov(0, 10000)])), 10);
  assert.equal(await rt.api.inspectPresentation(new Blob([syntheticMoov(1, 0x100000001)])), 4294967.297);
});

test('adds a zero media-time edit for a v1 track without elst and keeps opaque sample metadata', async () => {
  const original = syntheticMoov(1, 10000, 0, false), rt = runtime({ moov: original });
  await rt.api.tryCut({ input, start: 0, end: 3, output: 'clip.mp4', scope: 's' });
  const capped = rt.writes.at(-1);
  const originalStco = findBox(original, 'stco'), cappedStco = findBox(capped, 'stco');
  assert.deepEqual([...capped.slice(cappedStco.start, cappedStco.end)], [...original.slice(originalStco.start, originalStco.end)]);
  const elst = findBox(capped, 'elst'), ev = new DataView(capped.buffer, capped.byteOffset + elst.start, elst.end - elst.start);
  assert.equal(ev.getUint32(16), 3000); // duration is capped to capTk, never extended
  assert.equal(ev.getInt32(20), 0); // media_time=0 for the synthesized edit
  assert.equal(ev.getUint32(24), 0x00010000); // rate=1.0
  const tkhd = findBox(capped, 'tkhd');
  assert.equal(new DataView(capped.buffer, capped.byteOffset + tkhd.start, tkhd.end - tkhd.start).getBigUint64(36), 3000n); // v1 offset
});

test('preserves v1 duration carry across the low 32-bit word', async () => {
  const duration = 0x100000001, original = syntheticMoov(1, duration, 0, false), rt = runtime({ moov: original });
  await rt.api.tryCut({ input, start: 0, end: duration / 1000, output: 'clip.mp4', scope: 's' });
  const tkhd = findBox(rt.writes.at(-1), 'tkhd');
  assert.equal(new DataView(rt.writes.at(-1).buffer, rt.writes.at(-1).byteOffset + tkhd.start, tkhd.end - tkhd.start).getBigUint64(36), BigInt(duration));
});

test('caps display duration while preserving leading empty edit and payload bytes', async () => {
  const rt = runtime({ moov: syntheticMoov(0, 10000, 2000) });
  await rt.api.tryCut({ input, start: 0, end: 3, output: 'clip.mp4', scope: 's' });
  const capped = rt.writes.at(-1), view = new DataView(capped.buffer, capped.byteOffset, capped.byteLength);
  assert.equal(view.getUint32(32), 3000); // mvhd duration
  assert.equal(view.getUint32(116), 2000); // leading empty edit retained
  assert.equal(view.getUint32(128), 1000); // media edit capped after the empty edit
});

test('non-key MP4 start cannot hide a multi-second GOP behind an edit list',async()=>{
 const rt=runtime(),input={async getPrimaryVideoTrack(){return {keyTimestamp:0};},async getPrimaryAudioTrack(){return {};}};
 const result=await rt.api.tryCut({input,start:5.3,end:12.8,output:'clip.mp4',scope:'s',expectedAudio:true});
 assert.equal(result,null);assert.equal(rt.calls.filter(c=>c.trim).length,0);assert.equal(rt.writes.length,0);
 assert.equal(rt.calls[0].keyProbe.verifyKeyPackets,true);
});
