import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadMux({ shortWrite = false, failAudio = false } = {}) {
  const writes = [], files = new Map(), disposed = [];
  const track = (file, type) => ({
    type,
    file,
    packets: type === 'audio' && failAudio ? [{ data: new Uint8Array([2]), timestamp: 0, duration: 1, type: 'key' }] : [{ data: new Uint8Array([1]), timestamp: 0, duration: 1, type: 'key' }],
    async getCodec() { return type === 'video' ? 'avc' : 'aac'; },
    async getDecoderConfig() { return type === 'video' ? { codec: 'avc1.42e01e', codedWidth: 1, codedHeight: 1 } : { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 48000, description: new Uint8Array([17, 144]) }; },
  });
  class BlobSource { constructor(file) { this.file = file; } }
  class Input {
    constructor({ source }) { this.file = source.file; }
    getPrimaryVideoTrack() { return Promise.resolve(this.file.name.startsWith('audio.') ? null : track(this.file, 'video')); }
    getPrimaryAudioTrack() { return Promise.resolve(this.file.name.startsWith('video-only.') ? null : track(this.file, 'audio')); }
    dispose() { disposed.push(this.file.name); }
  }
  class EncodedPacketSink { constructor(inputTrack) { this.inputTrack = inputTrack; } packets() { return this.inputTrack.packets; } getFirstPacket() { return Promise.resolve(this.inputTrack.packets[0] || null); } }
  class PacketSource {
    constructor(codec) { this.codec = codec; this.target = null; }
    async add(packet) { if (failAudio && this.codec === 'aac') throw new Error('audio packet failed'); await this.target.write(packet.data); }
    close() {}
  }
  class StreamTarget {
    constructor(writable) { this.writable = writable; this.writer = writable.getWriter(); }
    async write(data) { await this.writer.write({ data, position: writes.reduce((n, x) => n + x.length, 0) }); }
    async close() { await this.writer.close(); }
  }
  class Output {
    constructor({ target }) { this.target = target; this.finalized = false; }
    addVideoTrack(source) { source.target = this.target; }
    addAudioTrack(source) { source.target = this.target; }
    async start() {}
    async finalize() { this.finalized = true; await this.target.close(); }
    async cancel() { await this.target.writer.abort(); }
  }
  const access = {
    write(data, { at }) { writes.push(data); files.set(at, data); return shortWrite ? Math.max(0, data.byteLength - 1) : data.byteLength; },
    getSize() { return writes.reduce((n, x) => n + x.length, 0); },
  };
  const self = {
    VideoPocketMediabunny: {
      MP4: {}, WEBM: {}, MATROSKA: {}, MPEG_TS: {}, ADTS: {}, OGG: {}, MP3: {},
      BlobSource, Input, EncodedPacketSink, EncodedVideoPacketSource: PacketSource,
      EncodedAudioPacketSource: PacketSource, StreamTarget, Output,
      Mp4OutputFormat: class {}, WebMOutputFormat: class {}, MkvOutputFormat: class {},
      MpegTsOutputFormat: class {}, AdtsOutputFormat: class {}, OggOutputFormat: class {}, Mp3OutputFormat: class {},
    },
    VideoPocketDiskMedia: { async createSyncMediaFile() { return { access, finish() { return { path: 'scope/output.mp4', size: access.getSize() }; }, abort() { self.aborted = true; } }; } },
    performance: { now: () => 0 },
    WritableStream,
    DOMException,
    Error,
  };
  self.self = self;
  vm.runInNewContext(readFileSync(new URL('../research/media-mux/media-mux.js', import.meta.url), 'utf8'), self);
  return { self, files, writes, disposed };
}

test('video-only map does not require an audio track', async () => {
  const { self, writes } = loadMux();
  const result = await self.VideoPocketMediaMux.muxPacketCopy({
    inputs: [{ name: 'video-only.mp4', file: { name: 'video-only.mp4' } }],
    output: 'output.mp4', args: ['-map', '0:v:0'], scope: 'scope', signal: { aborted: false },
  });
  assert.equal(result.size, 1);
  assert.equal(writes.length, 1);
});

test('a pump failure settles both pumps and aborts the output', async () => {
  const { self, disposed } = loadMux({ failAudio: true });
  await assert.rejects(() => self.VideoPocketMediaMux.muxPacketCopy({
    inputs: [{ name: 'video.mp4', file: { name: 'video.mp4' } }, { name: 'audio.mp4', file: { name: 'audio.mp4' } }],
    output: 'output.mp4', args: ['-map', '0:v:0', '-map', '1:a:0'], scope: 'scope', signal: { aborted: false },
  }), /audio packet failed/);
  assert.equal(self.aborted, true);
  assert.deepEqual(disposed.sort(), ['audio.mp4', 'video.mp4']);
});

test('short OPFS writes fail and abort the output', async () => {
  const { self } = loadMux({ shortWrite: true });
  await assert.rejects(() => self.VideoPocketMediaMux.muxPacketCopy({
    inputs: [{ name: 'video-only.mp4', file: { name: 'video-only.mp4' } }],
    output: 'output.mp4', args: ['-map', '0:v:0'], scope: 'scope', signal: { aborted: false },
  }), /輸出檔案寫入不完整/);
  assert.equal(self.aborted, true);
});
