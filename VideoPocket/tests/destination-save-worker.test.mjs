import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const destinationSource = readFileSync(new URL('../extension/destinations.js', import.meta.url), 'utf8');
const diskSource = readFileSync(new URL('../extension/disk-media.js', import.meta.url), 'utf8');
const saveSource = readFileSync(new URL('../extension/save-worker.js', import.meta.url), 'utf8');

function loadDestinations({ failures = 0, syncFailures = 0 } = {}) {
  let opens = 0;
  const db = {
    createObjectStore() {},
    transaction() {
      const store = { put: value => ({ result: value }), get: () => ({ result: undefined }), delete: () => ({ result: undefined }), clear: () => ({ result: undefined }) };
      return { objectStore: () => store, oncomplete: null, onerror: null, onabort: null };
    },
    close() { this.onclose?.(); },
    onclose: null,
    onversionchange: null,
  };
  const indexedDB = { open() {
    opens++;
    if (opens <= syncFailures) throw new Error('sync open failed');
    const request = { result: db, error: new Error('open failed'), onupgradeneeded: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (opens <= failures) request.onerror?.({ target: { error: new Error('open failed') } });
      else { request.onupgradeneeded?.(); request.onsuccess?.(); }
    });
    return request;
  } };
  const context = { indexedDB, crypto: { randomUUID: () => 'id' }, console };
  vm.runInNewContext(destinationSource, context, { filename: 'destinations.js' });
  return { context, get opens() { return opens; }, db };
}

test('production destinations module retries after an IndexedDB open failure', async () => {
  const loaded = loadDestinations({ failures: 1 });
  const first = loaded.context.VideoPocketDestinations.ready();
  await assert.rejects(first, /open failed/);
  await loaded.context.VideoPocketDestinations.ready();
  assert.equal(loaded.opens, 2);
  loaded.db.onversionchange?.();
  await loaded.context.VideoPocketDestinations.ready();
  assert.equal(loaded.opens, 3);
});

test('production destinations module retries after a synchronous IndexedDB open throw', async () => {
  const loaded = loadDestinations({ syncFailures: 1 });
  await assert.rejects(loaded.context.VideoPocketDestinations.ready(), /sync open failed/);
  await loaded.context.VideoPocketDestinations.ready();
  assert.equal(loaded.opens, 2);
});

function loadSaveWorker({ content = Uint8Array.from([1, 2, 3]), delayedWrite = false } = {}) {
  let resolveWrite;
  const messages = [];
  let closed = false;
  const access = { getSize: () => content.length, read(target, { at }) { const value = content.subarray(at, at + target.length); target.set(value); return value.length; }, close: () => { closed = true; } };
  const file = { createSyncAccessHandle: async () => access };
  const directories = new Map([['video-pocket', new Map([['scope', new Map([['input.part', file]])]])]]);
  const root = { async getDirectoryHandle(name) { const value = directories.get(name); if (!value) throw new Error('missing directory'); return { async getDirectoryHandle(child) { const files = value.get(child); if (!files) throw new Error('missing scope'); return { async getFileHandle(name) { const handle = files.get(name); if (!handle) throw new Error('missing file'); return handle; } }; } }; } };
  const writes = [];
  const writer = { async write(value) { writes.push(new Uint8Array(value)); if (delayedWrite) await new Promise(resolve => { resolveWrite = resolve; }); }, async close() { closed = true; }, async abort() { closed = true; } };
  const context = {
    navigator: { storage: { getDirectory: async () => root } },
    VideoPocketDestinations: { get: async () => ({ createWritable: async () => writer }) },
    postMessage: message => messages.push(message),
    DOMException,
    importScripts(...names) { for (const name of names) if (name === 'disk-media.js') vm.runInNewContext(diskSource, context, { filename: name }); },
  };
  vm.runInNewContext(saveSource, context, { filename: 'save-worker.js' });
  return { context, messages, writes, access, get closed() { return closed; }, releaseWrite: () => resolveWrite?.() };
}

test('production save worker rejects an untrusted OPFS path and cleans a normal save', async () => {
  const loaded = loadSaveWorker();
  await loaded.context.onmessage({ data: { path: 'other/scope/input.part', destinationId: 'dest' } });
  assert.equal(loaded.messages.at(-1).code, 'SAVE_FAILED');
  await loaded.context.onmessage({ data: { path: 'video-pocket/scope/input.part', destinationId: 'dest' } });
  assert.equal(loaded.messages.at(-1).type, 'done');
  assert.equal(loaded.writes.length, 1);
  assert.equal(loaded.closed, true);
});

test('production save worker cancellation aborts the writer and closes the OPFS access handle', async () => {
  const loaded = loadSaveWorker({ delayedWrite: true });
  const pending = loaded.context.onmessage({ data: { path: 'video-pocket/scope/input.part', destinationId: 'dest' } });
  while (!loaded.writes.length) await new Promise(resolve => setTimeout(resolve, 0));
  await loaded.context.onmessage({ data: { action: 'cancel' } });
  loaded.releaseWrite();
  await pending;
  assert.equal(loaded.messages.at(-1).code, 'CANCELLED');
  assert.equal(loaded.closed, true);
});
