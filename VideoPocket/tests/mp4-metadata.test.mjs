import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readMp4Metadata } from '../extension/mp4-metadata.js';

const ascii = value => Uint8Array.from([...value].map(char => char.charCodeAt(0)));
const u32 = value => Uint8Array.from([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const box = (type, payload = new Uint8Array()) => {
  const out = new Uint8Array(8 + payload.length);
  out.set(u32(out.length), 0); out.set(ascii(type), 4); out.set(payload, 8); return out;
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
const sample = (type, size = 86) => { const out = new Uint8Array(size); out.set(u32(size), 0); out.set(ascii(type), 4); if (type === 'avc1') { out[34] = 2; out[35] = 208; } return out; };
const stsd = (...entries) => box('stsd', concat(new Uint8Array(4), u32(entries.length), ...entries));
const track = entry => box('trak', box('mdia', box('minf', box('stbl', stsd(entry)))));
const hdlr = kind => box('hdlr', concat(new Uint8Array(8), ascii(kind), new Uint8Array(12)));
const typedTrack = (kind, entry) => box('trak', box('mdia', concat(hdlr(kind), box('minf', box('stbl', stsd(entry))))));
const fixture = (...entries) => concat(box('ftyp', ascii('isom')), box('moov', concat(...entries.map(track))));
const reader = bytes => async (offset, length) => bytes.slice(offset, offset + length);

test('reads video and audio sample entries through moov/trak/mdia/minf/stbl/stsd', async () => {
  const result = await readMp4Metadata(reader(fixture(sample('avc1'), sample('mp4a'))), new Uint8Array(), fixture(sample('avc1'), sample('mp4a')).length);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.audioCodec, 'aac');
  assert.equal(result.videoHeight, 720);
  assert.equal(result.drm, false);
});

test('seeks past an initial 128 KiB and handles a large moov before audio stsd', async () => {
  const bytes = concat(box('ftyp', ascii('isom')), box('moov', concat(box('free', new Uint8Array(140 * 1024)), track(sample('avc1')), track(sample('mp4a')))));
  let max = 0;
  const readRange = async (offset, length) => { max = Math.max(max, length); return bytes.slice(offset, offset + length); };
  const result = await readMp4Metadata(readRange, bytes.slice(0, 128 * 1024), bytes.length);
  assert.equal(result.audioCodec, 'aac');
  assert.ok(max <= 64 * 1024);
});

test('finds moov after a large mdat by skipping the atom payload', async () => {
  const tail = box('moov', track(sample('mp4a')));
  const bytes = concat(box('ftyp', ascii('isom')), box('mdat', new Uint8Array(2 * 1024 * 1024)), tail);
  const result = await readMp4Metadata(reader(bytes), bytes.slice(0, 128 * 1024), bytes.length);
  assert.equal(result.audioCodec, 'aac');
});

test('marks encrypted sample entries and rejects malformed extended sizes safely', async () => {
  const drm = fixture(sample('encv'), sample('enca'));
  const result = await readMp4Metadata(reader(drm), drm, drm.length);
  assert.equal(result.drm, true);
  const malformed = concat(Uint8Array.from([0, 0, 0, 1]), ascii('moov'), new Uint8Array(8).fill(255));
  assert.deepEqual(await readMp4Metadata(reader(malformed), malformed, malformed.length), { videoCodec: '', audioCodec: '', drm: false });
});

test('marks a complete video-only MP4 as audioAbsent', async () => {
  const bytes = concat(box('ftyp', ascii('isom')), box('moov', typedTrack('vide', sample('avc1'))));
  const result = await readMp4Metadata(reader(bytes), bytes, bytes.length);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.audioCodec, '');
  assert.equal(result.audioAbsent, true);
});

test('does not mark an audio track absent when its sample entry is unknown', async () => {
  const bytes = concat(box('ftyp', ascii('isom')), box('moov', concat(typedTrack('vide', sample('avc1')), typedTrack('soun', sample('zzzz')))));
  const result = await readMp4Metadata(reader(bytes), bytes, bytes.length);
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.audioCodec, '');
  assert.equal(result.audioAbsent, undefined);
});

test('does not mark a truncated moov as audioAbsent', async () => {
  const complete = concat(box('ftyp', ascii('isom')), box('moov', typedTrack('vide', sample('avc1'))));
  const truncated = complete.slice(0, complete.length - 3);
  const result = await readMp4Metadata(reader(truncated), truncated, truncated.length);
  assert.equal(result.audioAbsent, undefined);
});

test('does not certify silent video from an incomplete declared sample-entry count',async()=>{
 const bytes=concat(box('ftyp',ascii('isom')),box('moov',typedTrack('vide',sample('avc1'))));
 const at=Buffer.from(bytes).indexOf(Buffer.from('stsd'));bytes.set([0,0,0,2],at+8);
 const result=await readMp4Metadata(reader(bytes),bytes,bytes.length);assert.equal(result.audioAbsent,undefined);
});

const indexedTrack=(kind='vide',malformed=false)=>box('trak',box('mdia',concat(hdlr(kind),box('minf',box('stbl',concat(
 stsd(sample(kind==='vide'?'avc1':'mp4a')),
 box('stts',concat(u32(0),u32(1),u32(10000000),u32(1))),
 box('stsc',concat(u32(0),u32(1),u32(1),u32(10000000),u32(1))),
 box('stco',concat(u32(0),u32(1),u32(100))),
 box('stsz',concat(u32(0),u32(1),u32(malformed?0:10000000)))
))))));

test('sample-index capability reads compact headers without expanding millions of samples',async()=>{
 const bytes=concat(box('ftyp',ascii('isom')),box('mdat',new Uint8Array(400000)),box('moov',concat(indexedTrack(),indexedTrack('soun'))));
 let fetched=0;const result=await readMp4Metadata(async(o,n)=>{fetched+=n;return bytes.slice(o,o+n);},bytes.slice(0,131072),bytes.length);
 assert.ok(result.mp4Index?.video);assert.ok(result.mp4Index?.audio);assert.ok(fetched<65537);
 assert.equal(result.mp4Index.video.samples,undefined);
});

test('fragmented and empty/malformed sample tables do not advertise ordinary MP4 indexing',async()=>{
 for(const content of [concat(indexedTrack(),box('mvex')),indexedTrack('vide',true)]){
  const bytes=box('moov',content),result=await readMp4Metadata(reader(bytes),bytes,bytes.length);
  assert.equal(result.mp4Index,undefined);
 }
});

test('reads AAC from the complete Anime1 MP4 with bounded range reads', { skip: !process.env.MEDIA_LIVE_FILES }, async () => {
  const path = resolve('..', '..', 'work', 'anime1-01112-test.mp4');
  const file = await open(path);
  const stat = await file.stat();
  let max = 0;
  const result = await readMp4Metadata(async (offset, length) => { max = Math.max(max, length); const buffer = Buffer.alloc(length); const { bytesRead } = await file.read(buffer, 0, length, offset); return buffer.subarray(0, bytesRead); }, new Uint8Array(), stat.size);
  await file.close();
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.audioCodec, 'aac');
  assert.equal(result.videoHeight, 720);
  assert.ok(max <= 64 * 1024);
});
