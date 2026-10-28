import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = name => readFile(new URL(`../extension/${name}`, import.meta.url), 'utf8');
const rotated = [0, -1, 0, 1, 0, 0, 0, 0, 1];
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test('range normalization keeps full affine transforms and rejects matrices Matroska would approximate', async () => {
  const context = { VideoPocketMediabunny: {}, VideoPocketDiskMedia: {} }; context.self = context;
  vm.runInNewContext(await read('range-cut.js'), context);
  const api = context.VideoPocketRangeCut;
  assert.deepEqual(Array.from(api.outputTransform({ matrix: rotated }).transformationMatrix), rotated);
  assert.equal(api.matroskaTransformRepresentable({ matrix: rotated }), true);
  assert.equal(api.matroskaTransformRepresentable({ matrix: identity }), true);
  assert.equal(api.matroskaTransformRepresentable({ matrix: [1, 0.2, 0, 0, 1, 0, 0, 0, 1] }), false, 'shear cannot pass through Matroska');
  assert.equal(api.matroskaTransformRepresentable({ matrix: [2, 0, 0, 0, 1, 0, 0, 0, 1] }), false, 'non-unit scale cannot pass through Matroska');
  const readTransform = await api.videoTransform({ getTransformationMatrix: async () => rotated, getRotation: async () => 270, getFlip: async () => false });
  assert.equal(readTransform.rotation, 270); assert.equal(readTransform.flip, false);
  assert.equal(api.sameDisplayTransform({ matrix: rotated }, { matrix: [0, -1, 0, 1, 0, 0, 0, 720, 1] }), true, 'center translation can be canonicalized by Matroska');
  assert.equal(api.sameDisplayTransform({ matrix: rotated }, { matrix: [0, -1, 0, 1, 0, 0, 0, 720, 1] }, true), false, 'direct transforms must retain the full matrix');
  assert.equal(api.sameDisplayTransform({ matrix: rotated }, { matrix: [0, 1, 0, -1, 0, 0, 0, 0, 1] }), false, 'rotation changes must be detected');
});

test('VP9 hybrid rejects transformed input before mixing encoded and re-encoded orientations', async () => {
  const config = { codec: 'vp09.00.50.08', codedWidth: 1280, codedHeight: 720 };
  const rt = { VideoPocketMediabunny: { EncodedPacketSink: class { async getKeyPacket(time) { return { timestamp: time < 2 ? 1 : 3.5 }; } async getNextKeyPacket() { return { timestamp: 2 }; } } }, VideoPocketDiskMedia: {} };
  rt.self = rt; vm.runInNewContext(await read('range-smart.js'), rt);
  const api = rt.VideoPocketRangeSmart;
  const track = matrix => ({ getCodec: async () => 'vp9', getDecoderConfig: async () => config, getSquarePixelWidth: async () => 1280, getSquarePixelHeight: async () => 720, getTransformationMatrix: async () => matrix });
  assert.equal(await api.identityTransformMetadata(track(identity)) !== null, true);
  assert.ok(await api.plan(track(identity), 1.2, 4), 'untransformed video remains eligible for the VP9 hybrid');
  assert.equal(await api.plan(track(rotated), 1.2, 4), null, 'a rotated track falls through before the splice');
  assert.equal(await api.identityTransformMetadata(track(rotated)), null);
  assert.equal(await api.identityTransformMetadata(track([1, 0.1, 0, 0, 1, 0, 0, 0, 1])), null);
});

test('H.264 smart and indexed MP4 expose the full source transform as muxer metadata', async () => {
  const h264 = { VideoPocketMediabunny: {}, VideoPocketDiskMedia: {}, VideoPocketRangeMp4: {} }; h264.self = h264;
  vm.runInNewContext(await read('range-h264-smart.js'), h264);
  assert.deepEqual(Array.from((await h264.VideoPocketRangeH264.transformationMetadata({ getTransformationMatrix: async () => rotated })).transformationMatrix), rotated);
  await assert.rejects(h264.VideoPocketRangeH264.transformationMetadata({ getTransformationMatrix: async () => [1, 2] }), /格式無效/);

  const indexed = { Uint8Array, ArrayBuffer, Map, Math, Error, Object, Promise, self: {} };
  vm.runInNewContext(await read('indexed-mp4-download.js'), indexed);
  assert.deepEqual(Array.from((await indexed.self.VideoPocketIndexedMp4.videoTransformMetadata({ getTransformationMatrix: async () => rotated })).transformationMatrix), rotated);
  await assert.rejects(indexed.self.VideoPocketIndexedMp4.videoTransformMetadata({ getTransformationMatrix: async () => [1] }), /格式無效/);
});

test('a non-Matroska affine transform bypasses normalization and uses precise MP4 conversion on the original input', async () => {
  const shear = [1, 0.2, 0, 0, 1, 0, 0, 0, 1];
  const calls = { conversion: null, writes: 0, removals: [] };
  const sourceTrack = {
    getCodec: async () => 'avc', getDecoderConfig: async () => ({ codec: 'avc1.64001f', description: Uint8Array.of(1), codedWidth: 1280, codedHeight: 720 }),
    getTransformationMatrix: async () => shear, getRotation: async () => { throw new Error('non-cardinal transform'); }, getFlip: async () => { throw new Error('non-cardinal transform'); },
    getFirstTimestamp: async () => 0, getSquarePixelWidth: async () => 1280, getSquarePixelHeight: async () => 720,
  };
  const outputTrack = { ...sourceTrack, getFirstTimestamp: async () => 0, computeDuration: async () => 0.5 };
  class Input { constructor({ source }) { this.file = source.file; } async getPrimaryVideoTrack() { return this.file.video; } async getPrimaryAudioTrack() { return this.file.audio || null; } dispose() {} }
  class EncodedPacketSink {
    async getFirstPacket() { return { timestamp: 0, duration: 0.1 }; }
    async getFirstKeyPacket() { return { timestamp: 0, duration: 0.1 }; }
    async getKeyPacket() { return { timestamp: 0, duration: 0.1 }; }
    async getNextKeyPacket() { return { timestamp: 1, duration: 0.1 }; }
  }
  class VideoSampleSink {
    async *samples(from, to) { for (let time = from; time < to; time += 0.04) yield { timestamp: time, duration: Math.min(0.04, to - time), close() {} }; }
    async getSample() { return { timestamp: 0, duration: 0.04, close() {} }; }
  }
  class Mp4OutputFormat { getSupportedVideoCodecs() { return ['avc']; } }
  const M = {
    MP4: {}, WEBM: {}, MATROSKA: {}, MPEG_TS: {}, ADTS: {}, OGG: {}, MP3: {},
    BlobSource: class { constructor(file) { this.file = file; } }, Input, EncodedPacketSink, VideoSampleSink,
    Quality: class { constructor(options) { Object.assign(this, options); } }, canEncodeVideo: async () => true,
    Mp4OutputFormat, StreamTarget: class {}, Output: class { constructor({ format }) { this.format = format; } },
    Conversion: { async init(options) { calls.conversion = options; return { isValid: true, discardedTracks: [], async execute() {}, async cancel() {} }; } },
  };
  const outputFile = { duration: 0.5, video: outputTrack };
  const disk = {
    async createSyncMediaFile() { calls.writes++; return { path: 'result.mp4', access: { write(data) { return data.length; } }, finish() { return { path: 'result.mp4', size: 12 }; }, async abort() {} }; },
    async readMediaFile() { return outputFile; }, async removeMediaFile(path) { calls.removals.push(path); },
  };
  const context = { VideoPocketMediabunny: M, VideoPocketDiskMedia: disk, VideoPocketRangeMp4: { presentationDuration: async file => file.duration }, WritableStream };
  context.self = context;
  vm.runInNewContext(await read('range-cut.js'), context);
  const file = { video: sourceTrack };
  const result = await context.VideoPocketRangeCut.cutRange({ inputs: [{ name: 'video.mov', file, timelineStart: 0 }], range: { start: 0.3, end: 0.8 }, kind: 'video', expectedAudio: false, output: 'clip.mp4', scope: 'transform-test', signal: { aborted: false } });
  assert.equal(calls.writes, 1, 'one final output is written, with no Matroska normalization stage');
  assert.equal(calls.conversion.input.file, file, 'the original affine matrix reaches Mediabunny Conversion');
  assert.ok(Math.abs(calls.conversion.trim.start - 0.300001) < 1e-9);
  assert.ok(Math.abs(calls.conversion.trim.end - 0.799999) < 1e-9);
  assert.equal(result.processing.strategy, 'direct-precise-transform');
  assert.deepEqual(Array.from(result.path), Array.from('result.mp4'));
  assert.deepEqual(calls.removals, []);
});
