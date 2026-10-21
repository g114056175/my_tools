import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRange, planSegmentRange, parseSidx, planIndexedRange, coalesceIndexedSegments } from '../extension/media-range.js';

test('normalizes absent and rejects invalid ranges with stable code', () => {
  assert.equal(normalizeRange(null, 10), null);
  for (const range of [{ start: -1, end: 2 }, { start: 2, end: 2 }, { start: 2, end: 11 }, { start: NaN, end: 3 }]) {
    assert.throws(() => normalizeRange(range, 10), e => e.code === 'RANGE_INVALID');
  }
});

test('segment plan excludes unselected ranges, offsets sequence, and preserves AES IV/map', () => {
  const key = { method: 'AES-128', uri: 'k', iv: new Uint32Array([1, 2, 3, 4]) };
  const format = { mediaSequence: 40, duration: 12, segments: [0, 1, 2, 3].map(i => ({ uri: `s${i}`, duration: 3, key: i === 2 ? key : undefined, map: i === 0 ? { uri: 'init' } : undefined })) };
  const plan = planSegmentRange(format, { start: 4, end: 7 });
  assert.deepEqual(plan.segments.map(s => s.uri), ['s1', 's2']);
  assert.equal(plan.mediaSequence, 41);
  assert.equal(plan.segments[1].key, key);
  assert.equal(plan.segments[0].map.uri, 'init');
  assert.equal(plan.seekTimestamp, 1);
});

test('tracks different per-track segment boundaries through presentation times', () => {
  const video = planSegmentRange({ duration: 10, segments: [{ duration: 4, presentationTime: 0 }, { duration: 3, presentationTime: 4 }, { duration: 3, presentationTime: 7 }] }, { start: 4.5, end: 6 });
  const audio = planSegmentRange({ duration: 10, segments: [{ duration: 2.5, presentationTime: 0 }, { duration: 2.5, presentationTime: 2.5 }, { duration: 2.5, presentationTime: 5 }, { duration: 2.5, presentationTime: 7.5 }] }, { start: 4.5, end: 6 });
  assert.equal(video.selectedStart, 4); assert.equal(audio.selectedStart, 2.5);
  assert.equal(video.seekTimestamp, .5); assert.equal(audio.seekTimestamp, 2);
});

function sidxBox(version, refs, firstOffset = 0) {
  const size = (version ? 40 : 32) + refs.length * 12, b = new Uint8Array(size), v = new DataView(b.buffer);
  v.setUint32(0, size); b.set([115, 105, 100, 120], 4); b[8] = version; v.setUint32(12, 1); v.setUint32(16, 1000);
  if (!version) { v.setUint32(20, 0); v.setUint32(24, firstOffset); v.setUint16(30, refs.length); }
  else { v.setUint32(20, 0); v.setUint32(24, 0); v.setUint32(28, firstOffset); v.setUint16(38, refs.length); }
  let p = version ? 40 : 32; for (const r of refs) { v.setUint32(p, (r.type ? 0x80000000 : 0) | r.length); v.setUint32(p + 4, r.duration); v.setUint32(p + 8, 0x90000000); p += 12; }
  return b;
}

test('parses SIDX offsets, durations, SAP and rejects hierarchy', () => {
  const index = parseSidx(sidxBox(0, [{ length: 100, duration: 2000 }, { length: 50, duration: 1000 }]), 1000);
  assert.deepEqual(index.segments.map(s => [s.offset, s.length, s.duration]), [[1056, 100, 2], [1156, 50, 1]]);
  assert.equal(index.segments[0].startsWithSAP, true);
  assert.throws(() => parseSidx(sidxBox(0, [{ length: 1, duration: 1, type: 1 }])), /hierarchical/);
  const v1 = parseSidx(sidxBox(1, [{ length: 3, duration: 10 }]), 7); assert.equal(v1.segments[0].offset, 59);
});

test('indexed plan requests only selected ranges and keeps initialization map', () => {
  const index = parseSidx(sidxBox(0, [{ length: 10, duration: 2000 }, { length: 20, duration: 2000 }, { length: 30, duration: 2000 }]), 100);
  const plan = planIndexedRange({ url: 'x', duration: 6 }, index, { start: 2.1, end: 3.9 });
  assert.deepEqual(plan.segments.map(s => [s.offset, s.length]), [[178, 20]]);
  assert.deepEqual(plan.initRange, { offset: 0, length: 100 });
  assert.equal(plan.segments[0].uri, 'x');
  assert.equal(plan.segments[0].map.resolvedUri, 'x');
  assert.throws(() => planIndexedRange({}, { ...index, sidxOffset: undefined }, { start: 0, end: 1 }), /初始化範圍/);
});

test('builds large segment windows linearly', () => {
  const segments = Array.from({ length: 20000 }, () => ({ duration: 1 }));
  const plan = planSegmentRange({ duration: 20000, segments }, { start: 19998.2, end: 19999.2 });
  assert.equal(plan.segments.length, 2);
  assert.equal(plan.selectedStart, 19998);
});

test('rejects unsafe SIDX offsets and invalid references', () => {
  assert.throws(() => parseSidx(new Uint8Array(40), -1), /absoluteOffset/);
  assert.throws(() => parseSidx(new Uint8Array(40), Number.MAX_SAFE_INTEGER + 1), /absoluteOffset/);
  const bad = new Uint8Array(44); const v = new DataView(bad.buffer);
  v.setUint32(0, 44); bad.set([115, 105, 100, 120], 4); v.setUint32(12, 1); v.setUint32(16, 1000); v.setUint16(30, 1);
  assert.throws(() => parseSidx(bad), /reference|過短|錯誤/);
});

test('uses preceding SAP without rewinding to presentation start', () => {
  const index = parseSidx(sidxBox(0, [
    { length: 10, duration: 2000 }, { length: 10, duration: 2000 }, { length: 10, duration: 2000 }
  ]), 100);
  index.segments[0].startsWithSAP = true;
  index.segments[1].startsWithSAP = false;
  index.segments[2].startsWithSAP = false;
  const plan = planIndexedRange({ url: 'x', duration: 6 }, index, { start: 4.1, end: 5 });
  assert.equal(plan.segmentOffset, 0);
  assert.equal(plan.segments.length, 3);
  index.segments[0].startsWithSAP = false;
  assert.throws(() => planIndexedRange({ url: 'x', duration: 6 }, index, { start: 4.1, end: 5 }), /SAP/);
});

test('includes one known independent preroll segment for an explicitly unsafe HLS boundary', () => {
  const format = { segments: [
    { duration: 1, independent: true },
    { duration: 1, independent: false },
  ]};
  const plan = planSegmentRange(format, { start: 1.1, end: 1.5 });
  assert.equal(plan.segmentOffset, 0);
  assert.deepEqual(plan.segments.map(segment => segment.sourceIndex), [0, 1]);
  assert.equal(plan.selectedStart, 0);
  assert.equal(plan.seekTimestamp, 1.1);
});

test('walks across consecutive explicitly unsafe segments to the known SAP entry', () => {
  const format = { segments: [
    { duration: 1, startsWithSAP: true },
    { duration: 1, startsWithSAP: false },
    { duration: 1, independent: false },
    { duration: 1, independent: false },
  ]};
  const plan = planSegmentRange(format, { start: 3.1, end: 3.5 });
  assert.equal(plan.segmentOffset, 0);
  assert.deepEqual(plan.segments.map(segment => segment.sourceIndex), [0, 1, 2, 3]);
  assert.equal(plan.selectedStart, 0);
  assert.equal(plan.seekTimestamp, 3.1);
});

test('coalesces adjacent selected SIDX ranges and preserves timing/map metadata', () => {
  const format = {
    rangeLimited: true, index: { type: 'sidx' }, selectedStart: 10, selectedEnd: 13,
    requestedRange: { start: 10.2, end: 12.8 }, seekTimestamp: .2,
    segments: [0, 1, 2].map((i) => ({
      sourceIndex: i, uri: 'video.webm', resolvedUri: 'video.webm', offset: 100 + i * 10,
      length: 10, byterange: { offset: 100 + i * 10, length: 10 }, duration: 1,
      ...(i === 0 ? { map: { uri: 'video.webm', byterange: { offset: 0, length: 100 } } } : {})
    }))
  };
  const result = coalesceIndexedSegments(format);
  assert.notEqual(result, format);
  assert.equal(result.segments.length, 1);
  assert.deepEqual(result.segments[0].byterange, { offset: 100, length: 30 });
  assert.equal(result.segments[0].duration, 3);
  assert.deepEqual(result.segments[0].indices, [0, 1, 2]);
  assert.deepEqual(result.segments[0].map, format.segments[0].map);
  assert.equal(result.selectedStart, 10);
  assert.equal(result.selectedEnd, 13);
  assert.deepEqual(result.requestedRange, format.requestedRange);
  assert.equal(result.seekTimestamp, .2);
  assert.equal(format.segments.length, 3);
});

test('coalescing never crosses gaps, overlaps, keys, URLs, maps, or limits', () => {
  const make = (offset, extra = {}) => ({ uri: 'x', offset, length: 10, byterange: { offset, length: 10 }, duration: 1, ...extra });
  const segments = [
    make(0), make(10), make(25), make(35, { key: { uri: 'k' } }), make(45),
    make(55, { uri: 'y' }), make(65), make(75, { map: { uri: 'different' } }), make(85, { map: { uri: 'another' } })
  ];
  const format = { rangeLimited: true, index: {}, segments };
  const result = coalesceIndexedSegments(format, { maxBytes: 25, maxDuration: 2 });
  assert.deepEqual(result.segments.map(s => [s.offset, s.length]), [[0, 20], [25, 10], [35, 10], [45, 10], [55, 10], [65, 10], [75, 10], [85, 10]]);

  const outOfScope = { rangeLimited: false, index: {}, segments: [make(0), make(10)] };
  assert.equal(coalesceIndexedSegments(outOfScope).segments.length, 2);
  const nonIndex = { rangeLimited: true, segments: [make(0), make(10)] };
  assert.equal(coalesceIndexedSegments(nonIndex).segments.length, 2);
});

test('keeps an individual segment even when it exceeds coalescing limits', () => {
  const format = { rangeLimited: true, index: {}, segments: [
    { uri: 'x', offset: 0, length: 100, byterange: { offset: 0, length: 100 }, duration: 40 },
    { uri: 'x', offset: 100, length: 1, byterange: { offset: 100, length: 1 }, duration: 1 }
  ] };
  const result = coalesceIndexedSegments(format, { maxBytes: 2, maxDuration: 2 });
  assert.deepEqual(result.segments.map(s => s.length), [100, 1]);
});

test('does not merge byte-adjacent segments with a presentation-time gap', () => {
  const segment = (offset, start) => ({ uri: 'x', offset, length: 10,
    byterange: { offset, length: 10 }, start, duration: 1 });
  const format = { rangeLimited: true, index: {}, segments: [segment(0, 0), segment(10, 2)] };
  assert.equal(coalesceIndexedSegments(format).segments.length, 2);
});
