import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANGE_INDEX_MAX_BYTES, parseByteRange, formatRangeCapability,
  planRangeCapability, rangeCapability
} from '../extension/range-capability.js';

test('parses inclusive byte ranges and rejects malformed values', () => {
  assert.deepEqual(parseByteRange('10-77'), { offset: 10, length: 68 });
  assert.deepEqual(parseByteRange({ offset: 3, length: 4 }), { offset: 3, length: 4 });
  assert.equal(parseByteRange('77-10'), null);
  assert.equal(parseByteRange('x-y'), null);
  assert.equal(parseByteRange('0-9007199254740991'), null);
  assert.equal(parseByteRange({ offset: Number.MAX_SAFE_INTEGER, length: 2 }), null);
});

test('applies the index probe limit consistently', () => {
  assert.equal(formatRangeCapability({ indexRange: `0-${RANGE_INDEX_MAX_BYTES - 1}` }).supported, true);
  const oversized = formatRangeCapability({ indexRange: `0-${RANGE_INDEX_MAX_BYTES}` });
  assert.equal(oversized.supported, false);
  assert.match(oversized.reason, /探測上限/);
});

test('requires finite duration, valid segment durations, and a non-empty plan', () => {
  assert.equal(planRangeCapability({}, { duration: Infinity }).supported, false);
  assert.equal(planRangeCapability({}, { duration: 30 }).supported, false);
  assert.equal(planRangeCapability({}, { duration: 30, sabr: true }).supported, false);
  assert.equal(planRangeCapability({ video: { segments: [{ duration: 2 }] } }, { duration: 30 }).supported, true);
  assert.equal(planRangeCapability({ video: { segments: [{ duration: 0 }] } }, { duration: 30 }).supported, false);
  assert.equal(planRangeCapability({ video: { indexRange: '0-10' } }, { duration: 30, sabr: true }).supported, true);
});

test('returns UI plan booleans and a concise failure reason', () => {
  const result = rangeCapability({ duration: 60 }, {
    plans: { video: { auto: { good: { video: { segments: [{ duration: 1 }] } }, bad: {} } }, audio: { original: {} } }
  });
  assert.deepEqual(result.plans.video, { good: true, bad: false });
  assert.equal(result.supported, true);
});
