import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleSegments} from '../extension/ordered-segments.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('consumes out-of-order downloads in source order and bounds retained parts', async () => {
  const output = [], active = {value: 0, max: 0}, disposed = [];
  const stats = await assembleSegments([0, 1, 2, 3, 4, 5], {
    concurrency: 3,
    download: async (job, index) => { active.value++; active.max = Math.max(active.max, active.value); await delay((5 - index) * 3); active.value--; return {job}; },
    consume: async part => { output.push(part.job); },
    dispose: async (part, index) => disposed.push([part.job, index]),
  });
  assert.deepEqual(output, [0, 1, 2, 3, 4, 5]);
  assert.equal(stats.maxPending, 3);
  assert.equal(active.max, 3);
  assert.deepEqual(disposed.map(([job]) => job), [0, 1, 2, 3, 4, 5]);
});

test('a download failure aborts pending work and disposes completed parts', async () => {
  const disposed = [], aborted = [];
  await assert.rejects(assembleSegments([0, 1, 2, 3], {
    concurrency: 3,
    download: async (job, index, signal) => {
      signal.addEventListener('abort', () => aborted.push(index), {once: true});
      if (job === 1) { await delay(2); throw new Error('download failed'); }
      await delay(20); return {job};
    },
    consume: async () => {},
    dispose: async part => disposed.push(part.job),
  }), /download failed/);
  assert.ok(aborted.length >= 1);
  assert.deepEqual(disposed.sort(), [0, 2]);
});

test('consume failure cleans the current and ahead-of-order parts', async () => {
  const disposed = [];
  await assert.rejects(assembleSegments([0, 1, 2], {
    concurrency: 3,
    download: async job => ({job}),
    consume: async (_, index) => { if (index === 0) throw new Error('consume failed'); },
    dispose: async part => disposed.push(part.job),
  }), /consume failed/);
  assert.deepEqual(disposed.sort(), [0, 1, 2]);
});

test('outer abort wakes a paused wait and disposes settled parts', async () => {
  const controller = new AbortController(), disposed = [];
  const promise = assembleSegments([0, 1], {
    signal: controller.signal,
    wait: signal => new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), {once: true});
    }),
    download: async job => ({job}),
    consume: async () => {},
    dispose: async part => disposed.push(part.job),
  });
  await delay(5);
  controller.abort(new Error('stopped'));
  await assert.rejects(promise, /stopped/);
  assert.deepEqual(disposed, []);
});
