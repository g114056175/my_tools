import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndexedRoutes } from '../extension/indexed-routes.js';

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
