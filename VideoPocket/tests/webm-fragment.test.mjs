import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { prepareWebmFragment } from '../extension/webm-fragment.js';

const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, SEEK_HEAD = 0x114d9b74;
const CUES = 0x1c53bb6b, INFO = 0x1549a966, DURATION = 0x4489;
const CLUSTER = 0x1f43b675, CUE_POINT = 0xbb, CUE_TRACK_POSITIONS = 0xb7;
const CUE_CLUSTER_POSITION = 0xf1;
const fixturePath = new URL('./fixtures/matroska-duration-vp9.webm', import.meta.url);
const vendorPath = new URL('../extension/vendor/mediabunny.js', import.meta.url);

function concat(...parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function idBytes(id) {
  let length = 1;
  while (id >= 2 ** (length * 8)) length++;
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) { bytes[i] = id & 0xff; id = Math.floor(id / 256); }
  return bytes;
}

function encodeSize(size, length) {
  let value = BigInt(size);
  assert.ok(value >= 0n && value < (1n << BigInt(7 * length)) - 1n);
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) { bytes[i] = Number(value & 0xffn); value >>= 8n; }
  bytes[0] |= 1 << (8 - length);
  return bytes;
}

function encodeUnknownSize(length) {
  const bytes = new Uint8Array(length).fill(0xff);
  bytes[0] = (1 << (9 - length)) - 1;
  return bytes;
}

function element(id, payload, sizeLength) {
  return concat(idBytes(id), encodeSize(payload.length, sizeLength ?? sizeWidth(payload.length)), payload);
}

function sizeWidth(size) {
  for (let length = 1; length <= 8; length++) {
    if (BigInt(size) < (1n << BigInt(7 * length)) - 1n) return length;
  }
  throw new Error('synthetic element is too large');
}

function readElement(bytes, offset, limit = bytes.length) {
  assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset < limit);
  const width = (first, max) => {
    for (let length = 1; length <= max; length++) if (first & (1 << (8 - length))) return length;
    throw new Error('invalid EBML VINT');
  };
  const idLength = width(bytes[offset], 4);
  assert.ok(offset + idLength < limit, 'truncated EBML ID or size');
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[offset + i];
  const sizeLength = width(bytes[offset + idLength], 8);
  assert.ok(offset + idLength + sizeLength <= limit, 'truncated EBML size');
  let size = BigInt(bytes[offset + idLength] & ((1 << (8 - sizeLength)) - 1));
  for (let i = 1; i < sizeLength; i++) size = size * 256n + BigInt(bytes[offset + idLength + i]);
  const unknown = size === (1n << BigInt(7 * sizeLength)) - 1n;
  const dataStart = offset + idLength + sizeLength;
  const end = unknown ? null : dataStart + Number(size);
  return { id, offset, idLength, sizeLength, dataStart, end, unknown };
}

function childElements(bytes, start, end) {
  const children = [];
  for (let offset = start; offset < end;) {
    const child = readElement(bytes, offset, end);
    assert.ok(child.end !== null && child.end > offset && child.end <= end, `invalid bounds for EBML element 0x${child.id.toString(16)}`);
    children.push(child);
    offset = child.end;
  }
  return children;
}

function syntheticWebm(segmentMode = 'known') {
  const ebml = element(EBML, element(0x4286, Uint8Array.of(1)));
  const seekHead = element(SEEK_HEAD, Uint8Array.of(0x53, 0xab, 0x84, 0, 0, 0, 0), 2);
  const cuePosition = element(CUE_CLUSTER_POSITION, Uint8Array.of(0, 0, 0x40, 0));
  const cueTrack = element(CUE_TRACK_POSITIONS, concat(element(0xf7, Uint8Array.of(1)), cuePosition));
  const cues = element(CUES, element(CUE_POINT, concat(element(0xb3, Uint8Array.of(0)), cueTrack)));
  const scale = element(0x2ad7b1, Uint8Array.of(0x0f, 0x42, 0x40));
  const durationBytes = new Uint8Array(8);
  new DataView(durationBytes.buffer).setFloat64(0, 213.04, false);
  const duration = element(DURATION, durationBytes);
  const info = element(INFO, concat(scale, duration));
  const cluster = element(CLUSTER, Uint8Array.of(0xe7, 0x81, 0, 0xa3, 0x84, 1, 2, 3, 4));
  const prefix = concat(seekHead, cues, info);
  const segmentPayload = concat(prefix, cluster);
  const segmentId = idBytes(SEGMENT);
  const segmentSize = segmentMode === 'unknown' ? encodeUnknownSize(2) : encodeSize(segmentPayload.length, 2);
  const segmentHeaderLength = segmentId.length + segmentSize.length;
  const bytes = concat(ebml, segmentId, segmentSize, segmentPayload);
  const segmentDataStart = ebml.length + segmentHeaderLength;
  return { bytes, segmentDataStart, clusterOffset: segmentDataStart + prefix.length };
}

function instrumentBlob(blob) {
  const reads = [];
  return {
    file: {
      size: blob.size,
      type: blob.type,
      slice(start, end) {
        const part = blob.slice(start, end);
        const arrayBuffer = part.arrayBuffer.bind(part);
        part.arrayBuffer = async () => {
          reads.push({ start, end, length: part.size });
          return arrayBuffer();
        };
        return part;
      }
    },
    reads
  };
}

test('prepareWebmFragment voids stale indexes and Duration without changing Cluster bytes or file length', async () => {
  for (const segmentMode of ['known', 'unknown']) {
    const source = syntheticWebm(segmentMode);
    const recorder = instrumentBlob(new Blob([source.bytes], { type:'video/webm' }));
    const prepared = await prepareWebmFragment(recorder.file);
    const bytes = new Uint8Array(await prepared.arrayBuffer());
    assert.equal(bytes.length, source.bytes.length);
    assert.deepEqual(bytes.slice(source.clusterOffset), source.bytes.slice(source.clusterOffset));

    const ebml = readElement(bytes, 0);
    const segment = readElement(bytes, ebml.end);
    assert.equal(segment.id, SEGMENT);
    assert.equal(segment.unknown, false, 'the output Segment has a finite local size');
    assert.equal(segment.end, bytes.length);
    const top = childElements(bytes, segment.dataStart, bytes.length);
    assert.deepEqual(top.slice(0, 2).map(child => child.id), [0xec, 0xec], 'SeekHead and Cues are equal-size Void elements');
    const info = top.find(child => child.id === INFO);
    assert.ok(info);
    const infoChildren = childElements(bytes, info.dataStart, info.end);
    assert.deepEqual(infoChildren.map(child => child.id), [0x2ad7b1, 0xec], 'Duration is replaced while other Info metadata remains');
    assert.equal(top.at(-1).id, CLUSTER);

    const again = new Uint8Array(await (await prepareWebmFragment(prepared)).arrayBuffer());
    assert.deepEqual(again, bytes, 'preparing an already-sanitized fragment is idempotent');
    assert.ok(recorder.reads.length > 0);
    assert.ok(recorder.reads.every(read => read.length <= 12 && read.start <= source.clusterOffset), 'header reads through the first Cluster stay bounded to 12 bytes');
  }
});

test('prepareWebmFragment reports malformed and truncated EBML bounds as a range error', async () => {
  const truncatedEbml = new Blob([Uint8Array.of(0x1a, 0x45, 0xdf)]);
  await assert.rejects(prepareWebmFragment(truncatedEbml), error => error.code === 'YOUTUBE_RANGE_INCOMPLETE');

  const source = syntheticWebm();
  const malformed = source.bytes.slice();
  const ebml = readElement(malformed, 0), segment = readElement(malformed, ebml.end);
  const seek = readElement(malformed, segment.dataStart);
  malformed.set(encodeSize(1000, seek.sizeLength), seek.offset + seek.idLength);
  await assert.rejects(prepareWebmFragment(new Blob([malformed])), error => error.code === 'YOUTUBE_RANGE_INCOMPLETE');

  const noCluster = concat(source.bytes.slice(0, source.clusterOffset), element(0xec, Uint8Array.of(0)));
  await assert.rejects(prepareWebmFragment(new Blob([noCluster])), error => error.code === 'YOUTUBE_RANGE_INCOMPLETE');
});

function staleIndexBlock() {
  const seekPosition = element(0x53ab, Uint8Array.of(0x7f, 0xff, 0xff, 0xff));
  const seekHead = element(SEEK_HEAD, seekPosition);
  const cuePosition = element(CUE_CLUSTER_POSITION, Uint8Array.of(0x7f, 0xff, 0xff, 0xff));
  const cueTrack = element(CUE_TRACK_POSITIONS, concat(element(0xf7, Uint8Array.of(1)), cuePosition));
  const cues = element(CUES, element(CUE_POINT, concat(element(0xb3, Uint8Array.of(1)), cueTrack)));
  return concat(seekHead, cues);
}

async function readPacketsInWorker(vendorCode, bytes) {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const vm = require('node:vm');
    const { File } = require('node:buffer');
    const { webcrypto } = require('node:crypto');
    const { performance } = require('node:perf_hooks');
    const context = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
      Float32Array, Float64Array, DataView, ArrayBuffer, console, TextEncoder, TextDecoder,
      Blob, File, ReadableStream, WritableStream, TransformStream, DOMException, performance,
      crypto:webcrypto, structuredClone, setTimeout, clearTimeout, queueMicrotask };
    context.globalThis = context; context.self = context;
    vm.runInNewContext(workerData.vendorCode, context, { filename:'mediabunny.js' });
    (async () => {
      let input;
      try {
        const M = context.VideoPocketMediabunny;
        input = new M.Input({ source:new M.BlobSource(new Blob([workerData.bytes])), formats:[M.WEBM] });
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('fixture has no video track');
        const sink = new M.EncodedPacketSink(track);
        const first = await sink.getFirstPacket();
        if (!first) throw new Error('fixture has no first video packet');
        const target = first.timestamp + 0.2;
        const key = await sink.getKeyPacket(target, { verifyKeyPackets:true });
        if (!key) throw new Error('no key packet found at or before seek target');
        const nextKey = await sink.getNextKeyPacket(first, { verifyKeyPackets:true });
        if (!nextKey) throw new Error('no next key packet found');
        const seek = { firstTimestamp:first.timestamp, target, keyTimestamp:key.timestamp,
          keyType:key.type, nextTimestamp:nextKey.timestamp, nextType:nextKey.type };
        first.close?.(); key.close?.(); nextKey.close?.();
        let count = 0, firstTimestamp;
        for await (const packet of sink.packets()) {
          if (firstTimestamp === undefined) firstTimestamp = packet.timestamp;
          count++;
          packet.close?.();
        }
        if (!count) throw new Error('no video packets found');
        const result = { ...seek, timestamp:firstTimestamp, count };
        parentPort.postMessage({ ok:true, result });
      } catch (error) {
        parentPort.postMessage({ ok:false, error:String(error?.stack || error) });
      } finally { await input?.dispose?.(); }
    })();
  `;
  const worker = new Worker(source, { eval:true, workerData:{ vendorCode, bytes } });
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('Mediabunny packet scan exceeded 5 seconds')), 5000);
    worker.once('message', message => message.ok ? finish(resolve, message.result) : finish(reject, new Error(message.error)));
    worker.once('error', error => finish(reject, error));
    worker.once('exit', code => { if (!settled) finish(reject, new Error(`Mediabunny worker exited before result (${code})`)); });
  });
}

test('sanitized generated VP9 fixture supports keyframe seeks with stale indexes and known or unknown Segment size', async () => {
  const original = new Uint8Array(await fs.readFile(fixturePath));
  const ebml = readElement(original, 0), originalSegment = readElement(original, ebml.end);
  const vendorCode = await fs.readFile(vendorPath, 'utf8');
  for (const segmentMode of ['known', 'unknown']) {
    const source = original.slice();
    const segment = readElement(source, ebml.end);
    const segmentSize = segmentMode === 'unknown'
      ? encodeUnknownSize(segment.sizeLength)
      : encodeSize(source.length - segment.dataStart, segment.sizeLength);
    source.set(segmentSize, segment.offset + segment.idLength);
    const top = childElements(source, originalSegment.dataStart, source.length);
    const firstCluster = top.find(child => child.id === CLUSTER);
    assert.ok(firstCluster, 'generated fixture contains a video Cluster');
    const indexes = staleIndexBlock();
    const stale = concat(source.slice(0, firstCluster.offset), indexes, source.slice(firstCluster.offset));

    const prepared = await prepareWebmFragment(new Blob([stale], { type:'video/webm' }));
    const preparedBytes = new Uint8Array(await prepared.arrayBuffer());
    const insertedAt = firstCluster.offset;
    const sanitizedSeek = readElement(preparedBytes, insertedAt);
    const sanitizedCues = readElement(preparedBytes, sanitizedSeek.end);
    const preservedCluster = readElement(preparedBytes, sanitizedCues.end);
    assert.equal(sanitizedSeek.id, 0xec);
    assert.equal(sanitizedCues.id, 0xec);
    assert.equal(preservedCluster.id, CLUSTER);
    const packets = await readPacketsInWorker(vendorCode, preparedBytes);
    assert.equal(packets.keyType, 'key');
    assert.ok(packets.keyTimestamp <= packets.target);
    assert.equal(packets.nextType, 'key');
    assert.ok(packets.nextTimestamp > packets.firstTimestamp);
    assert.ok(packets.count > 1);
    assert.ok(Number.isFinite(packets.timestamp));
  }
});
