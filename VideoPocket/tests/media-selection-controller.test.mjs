import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaSelectionController, selectedMediaIndex} from '../extension/media-selection-controller.js';
import {stableHash} from '../extension/download-identity.js';

const frames = [{frameId: 0, documentId: 'top-doc', result: {url: 'https://example.test/feed'}}, {frameId: 2, documentId: 'child-doc', result: {url: 'https://example.test/frame'}}];

function apiMock() {
  const calls = []; const badges = []; const writes = []; let writeResolve;
  const api = {
    calls, badges, writes,
    action: {setBadgeText: async value => { badges.push(value); }},
    storage: {session: {set: async value => { writes.push(value); if (!writeResolve) await new Promise(resolve => { writeResolve = resolve; }); else await writeResolve; }}},
    scripting: {executeScript: async request => {
      calls.push(request);
      if (request.func.toString().includes('location.href')) return frames;
      return new Promise(resolve => { request.resolve = resolve; });
    }},
    releaseStorage() { writeResolve?.(); },
  };
  return api;
}

test('selectedMediaIndex requires page, frame, document, media identity and source token', () => {
  const url = 'https://example.test/feed';
  const selection = {pageToken: stableHash(url), frameId: 2, documentId: 'child-doc', mediaKey: 8, sourceToken: stableHash('https://cdn/video.mp4')};
  const videos = [{frameId: 2, documentId: 'child-doc', mediaKey: 8, url: 'https://cdn/video.mp4'}];
  assert.equal(selectedMediaIndex(videos, selection, url), 0);
  assert.equal(selectedMediaIndex([{...videos[0], documentId: 'other'}], selection, url), -1);
  assert.equal(selectedMediaIndex([{...videos[0], url: 'https://cdn/new-post.mp4'}], selection, url), -1);
});

test('begin claims tab before frame discovery and a later begin owns the tab', async () => {
  const api = apiMock(); const controller = createMediaSelectionController(api);
  let firstDiscoveryResolve; let discoveryCount = 0; api.scripting.executeScript = async request => {
    api.calls.push(request);
    if (!request.args) { discoveryCount++; if (discoveryCount === 1) return new Promise(resolve => { firstDiscoveryResolve = resolve; }); return frames; }
    return [];
  };
  const first = controller.begin(11); const second = controller.begin(11);
  firstDiscoveryResolve(frames);
  assert.deepEqual(await first, {started: false});
  assert.equal((await second).started, true);
});

test('late storage completion from an old selection cannot clear a newer request', async () => {
  const api = apiMock(); const controller = createMediaSelectionController(api);
  let pickerResolve; let discoveryCount = 0;
  api.scripting.executeScript = async request => {
    api.calls.push(request);
    if (!request.args) { discoveryCount++; return frames; }
    if (discoveryCount === 1) return new Promise(resolve => { pickerResolve = resolve; });
    return new Promise(() => {});
  };
  const first = await controller.begin(12); assert.equal(first.started, true);
  const firstStart = api.calls.find(call => call.args?.[0]?.requestId);
  const requestId = firstStart.args[0].requestId;
  pickerResolve([{result: {ok: true, requestId, frameId: 2, documentId: 'child-doc', mediaKey: 9, url: 'https://cdn/one'}}]);
  await new Promise(resolve => setImmediate(resolve));
  const second = await controller.begin(12); assert.equal(second.started, true);
  api.releaseStorage();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.badges.some(value => value.text === ''), false, 'old completion must not clear the new picker badge');
  const cancelCall = api.calls.find(call => call.args?.[0]?.requestId === requestId && call.target?.allFrames);
  assert.ok(cancelCall, 'replacing a request cancels every frame with the old requestId');
});

function pickerApi({storageSet, frameResult = () => null} = {}) {
  const calls = []; const badges = [];
  return {
    calls, badges,
    action: {setBadgeText: async value => badges.push(value)},
    storage: {session: {set: storageSet || (async () => {})}},
    scripting: {executeScript: async request => {
      calls.push(request);
      if (!request.args) return frames;
      if (request.target?.allFrames) return [];
      const options = request.args[0]; const result = frameResult(options);
      return result ? [{result: {...result, requestId: options.requestId, frameId: options.frameId, documentId: options.documentId}}] : new Promise(() => {});
    }},
  };
}

test('successful selection cancels every other frame with the same requestId', async () => {
  const api = pickerApi({frameResult: options => options.frameId === 2 ? {ok: true, mediaKey: 7, url: 'https://cdn/selected'} : null});
  const controller = createMediaSelectionController(api); await controller.begin(20);
  await new Promise(resolve => setImmediate(resolve));
  const picker = api.calls.find(call => call.args?.[0]?.frameId === 2); const requestId = picker.args[0].requestId;
  const cancel = api.calls.find(call => call.target?.allFrames && call.args?.[0]?.requestId === requestId);
  assert.ok(cancel, 'selection completion broadcasts cancellation to all frames');
});

test('Escape cancellation broadcasts to every frame', async () => {
  const api = pickerApi({frameResult: options => options.frameId === 0 ? {ok: false, reason: 'cancelled'} : null});
  const controller = createMediaSelectionController(api); await controller.begin(21);
  await new Promise(resolve => setImmediate(resolve));
  const picker = api.calls.find(call => call.args?.[0]?.frameId === 0); const requestId = picker.args[0].requestId;
  assert.ok(api.calls.some(call => call.target?.allFrames && call.args?.[0]?.requestId === requestId));
});

test('storage failure releases active request so a later selection can start', async () => {
  let attempts = 0;
  const api = pickerApi({storageSet: async () => { attempts++; throw new Error('session unavailable'); }, frameResult: options => options.frameId === 2 ? {ok: true, mediaKey: attempts + 1, url: `https://cdn/${attempts}`} : null});
  const controller = createMediaSelectionController(api);
  assert.equal((await controller.begin(22)).started, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.equal((await controller.begin(22)).started, true, 'retry is accepted after the failed write');
});

test('delayed storage writes stay ordered across two selections', async () => {
  const writes = []; const resolvers = [];
  const api = pickerApi({storageSet: async value => { writes.push(value); await new Promise(resolve => resolvers.push(resolve)); }, frameResult: options => options.frameId === 2 ? {ok: true, mediaKey: options.requestId.endsWith('a') ? 1 : 2, url: `https://cdn/${options.requestId}`} : null});
  const controller = createMediaSelectionController(api);
  // Make request IDs deterministic for this ordering assertion.
  const originalRandomUUID = crypto.randomUUID; let serial = 0; crypto.randomUUID = () => `${++serial}a`;
  try {
    await controller.begin(23); await new Promise(resolve => setImmediate(resolve));
    const first = api.calls.find(call => call.args?.[0]?.frameId === 2); const firstId = first.args[0].requestId;
    assert.equal(writes.length, 1);
    crypto.randomUUID = () => '2b';
    await controller.begin(23); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.length, 1, 'second write waits for first');
    resolvers.shift()(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.length, 2); assert.equal(Object.values(writes[0])[0].mediaKey, 1); assert.equal(Object.values(writes[1])[0].mediaKey, 2);
    resolvers.shift()();
  } finally { crypto.randomUUID = originalRandomUUID; }
});
