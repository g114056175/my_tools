import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexedRoutes } from '../extension/indexed-routes.js';
import {createMediaRangeVersions} from '../extension/media-range-versions.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('hedges a slow primary and remembers the successful route', async () => {
  const routes = createIndexedRoutes(['slow', 'fast'], { hedgeDelayMs: 10 });
  const calls = [];
  const result = await routes.run((url, signal) => new Promise((resolve, reject) => {
    calls.push(url);
    if (url === 'fast') return setTimeout(() => resolve('ok'), 1);
    signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
  }));
  assert.deepEqual(result, { value: 'ok', url: 'fast' });
  assert.deepEqual(calls, ['slow', 'fast']);
  assert.equal(routes.preferredUrl, 'fast');
  assert.deepEqual(await routes.run(async url => ({ url })), { value: { url: 'fast' }, url: 'fast' });
});

test('starts backup immediately after primary rejection and preserves all errors', async () => {
  const routes = createIndexedRoutes(['a', 'b', 'c'], { hedgeDelayMs: 100 });
  const e1 = new Error('a'), e2 = new Error('b'), e3 = new Error('c');
  await assert.rejects(routes.run(async url => { throw ({ a: e1, b: e2, c: e3 }[url]); }), error => {
    assert.equal(error.name, 'AggregateError');
    assert.deepEqual(error.errors, [e1, e2, e3]);
    return true;
  });
});

test('with zero hedges, tries every route sequentially after failure', async () => {
  const routes = createIndexedRoutes(['a', 'b', 'c'], { maxHedges: 0 });
  const calls = [];
  const result = await routes.run(async url => { calls.push(url); if (url !== 'c') throw new Error(url); return 'ok'; });
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(result, { value: 'ok', url: 'c' });
});

test('honours cancellation and disposes late loser results', async () => {
  const controller = new AbortController();
  const disposed = [];
  const routes = createIndexedRoutes(['a', 'b'], { hedgeDelayMs: 2, dispose: async value => { disposed.push(value); throw new Error('dispose failed'); } });
  const pending = routes.run((url, signal) => new Promise(resolve => {
    setTimeout(() => resolve(url + '-late'), url === 'a' ? 20 : 30);
    signal.addEventListener('abort', () => {}, { once: true });
  }), controller.signal);
  setTimeout(() => controller.abort(new Error('cancelled')), 5);
  await assert.rejects(pending, /cancelled/);
  await wait(40);
  assert.deepEqual(disposed.sort(), ['a-late', 'b-late']);
});

test('limits concurrent hedges and disposes a late loser after a winner', {timeout:3000}, async () => {
  let active = 0, maxActive = 0;
  const disposed = [],complete=new Map();let thirdStarted;
  const started=new Promise(resolve=>{thirdStarted=resolve;});
  const routes = createIndexedRoutes(['a', 'b', 'c', 'd'], { hedgeDelayMs: 10, maxHedges: 2, dispose: value => disposed.push(value) });
  const pending = routes.run((url, signal) => new Promise(resolve => {
    active++; maxActive = Math.max(maxActive, active);
    let finished=false;const done = () => { if(!finished){finished=true;active--;} };
    signal.addEventListener('abort', done, { once: true });
    complete.set(url,value=>{done();resolve(value);});
    if(url==='c')thirdStarted();
  }));
  // Control completion explicitly: scheduler load must not decide the winner.
  await started;assert.equal(active,3);assert.equal(complete.has('d'),false);
  complete.get('c')('winner');const result=await pending;
  assert.equal(result.url, 'c');
  assert.equal(maxActive, 3);
  complete.get('a')('a');complete.get('b')('b');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(disposed.sort(), ['a', 'b']);
});

test('shares the hedge concurrency limit across runs', async () => {
  const routes = createIndexedRoutes(['a', 'b', 'c', 'd'], { hedgeDelayMs: 5, maxHedges: 1 });
  let hedgeActive = 0, maxHedgeActive = 0;
  const operation = (url, signal) => new Promise(resolve => {
    const isHedge = url === 'b' || url === 'd';
    if (isHedge) { hedgeActive++; maxHedgeActive = Math.max(maxHedgeActive, hedgeActive); }
    setTimeout(() => { if (isHedge) hedgeActive--; resolve(url); }, 25);
    signal.addEventListener('abort', () => {}, { once: true });
  });
  await Promise.all([routes.run(operation), routes.run(operation)]);
  assert.equal(maxHedgeActive, 1);
});

test('waits for an explicit route cooldown across runs and lets cancellation stop a queued route', async () => {
  let releaseCooldown;
  const cooldown = new Promise(resolve => { releaseCooldown = resolve; });
  const controller = new AbortController(), calls = [];
  let waitingResolve;
  const waiting = new Promise(resolve => { waitingResolve = resolve; });
  const routes = createIndexedRoutes(['limited-alias', 'backup-alias'], {
    maxHedges: 0,
    retryOrigin: error => [429, 503].includes(error.httpStatus) && error.retryAfterMs !== undefined ? error.requestOrigin : null,
    waitForRetryOrigin: (origin, signal) => new Promise((resolve, reject) => {
      assert.equal(origin, 'https://limited.test');
      waitingResolve();
      if (signal?.aborted) { reject(signal.reason); return; }
      const onAbort = () => reject(signal.reason);
      signal?.addEventListener('abort', onAbort, {once: true});
      cooldown.then(() => { signal?.removeEventListener('abort', onAbort); resolve(); });
    })
  });
  const pending = routes.run(async url => {
    calls.push(url);
    if (url === 'limited-alias') throw Object.assign(new Error('limited'), {httpStatus: 429, retryAfterMs: 2000, requestOrigin: 'https://limited.test'});
    return 'unexpected';
  }, controller.signal);
  await waiting;
  const reason = new Error('cancelled during cooldown');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.deepEqual(calls, ['limited-alias']);
  releaseCooldown();
});

test('401/403 backup switching remains immediate and keeps the backup byte version pinned', async () => {
  const versions = createMediaRangeVersions(), calls = [], waits = [];
  const routes = createIndexedRoutes(['https://primary.test/file', 'https://backup.test/file'], {
    maxHedges: 0,
    retryOrigin: error => [429, 503].includes(error.httpStatus) && error.retryAfterMs !== undefined ? error.requestOrigin : null,
    waitForRetryOrigin: async origin => { waits.push(origin); }
  });
  const fetchRange = async (url, range, etag = '"v1"') => {
    const headers = versions.headers('indexed-file');
    calls.push({url, headers});
    if (url.includes('primary')) throw Object.assign(new Error('forbidden'), {httpStatus: 403});
    const [start, end] = range;
    const response = new Response(new Uint8Array(end - start + 1), {status: 206, headers: {ETag: etag, 'Content-Range': `bytes ${start}-${end}/100`}});
    versions.verify('indexed-file', url, response);
    return response;
  };
  const first = await routes.run(url => fetchRange(url, [10, 19]));
  assert.equal(first.url, 'https://backup.test/file');
  const second = await routes.run(url => fetchRange(url, [20, 29]));
  assert.equal(second.url, 'https://backup.test/file');
  assert.deepEqual(calls.map(call => call.url), ['https://primary.test/file', 'https://backup.test/file', 'https://backup.test/file']);
  assert.deepEqual(calls[2].headers, {'If-Range': '"v1"'});
  assert.deepEqual(waits, []);
  await assert.rejects(routes.run(url => fetchRange(url, [30, 39], '"v2"')), error => {
    const errors = error.errors || [error];
    assert.ok(errors.some(item => item.code === 'SOURCE_VERSION_CHANGED'));
    return true;
  });
});
