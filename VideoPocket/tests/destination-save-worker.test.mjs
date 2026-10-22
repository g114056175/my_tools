import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const destinationSource = readFileSync(new URL('../extension/destinations.js', import.meta.url), 'utf8');
const diskSource = readFileSync(new URL('../extension/disk-media.js', import.meta.url), 'utf8');
const saveSource = readFileSync(new URL('../extension/save-worker.js', import.meta.url), 'utf8');
const fileSaveSource = readFileSync(new URL('../extension/file-save.js', import.meta.url), 'utf8');

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

function loadSaveWorker({ content = Uint8Array.from([1, 2, 3]), delayedWrite = false, failureStage, failureName='NotAllowedError', readFailure=false } = {}) {
  let resolveWrite;
  const messages = [];
  let closed = false;
  const access = { getSize: () => content.length, read(target, { at }) { if(readFailure)return 0;const value = content.subarray(at, at + target.length); target.set(value); return value.length; }, close: () => { closed = true; } };
  const file = { createSyncAccessHandle: async () => access };
  const directories = new Map([['video-pocket', new Map([['scope', new Map([['input.part', file]])]])]]);
  const root = { async getDirectoryHandle(name) { const value = directories.get(name); if (!value) throw new Error('missing directory'); return { async getDirectoryHandle(child) { const files = value.get(child); if (!files) throw new Error('missing scope'); return { async getFileHandle(name) { const handle = files.get(name); if (!handle) throw new Error('missing file'); return handle; } }; } }; } };
  const writes = [];
  const fail=stage=>{if(failureStage===stage)throw new DOMException('/private/path?token=SECRET',failureName);};
  let aborted=false;
  const writer = { async write(value) { fail('write-target');writes.push(new Uint8Array(value)); if (delayedWrite) await new Promise(resolve => { resolveWrite = resolve; }); }, async close() { fail('close-target');closed = true; }, async abort() { aborted=true;closed = true; } };
  const context = {
    navigator: { storage: { getDirectory: async () => root } },
    VideoPocketDestinations: { get: async () => {fail('get-target');return { createWritable: async () => {fail('open-target');return writer;} };} },
    postMessage: message => messages.push(message),
    DOMException,
    importScripts(...names) { for (const name of names) if (name === 'disk-media.js'||name==='file-save.js') vm.runInNewContext(name==='disk-media.js'?diskSource:fileSaveSource, context, { filename: name }); },
  };
  vm.runInNewContext(saveSource, context, { filename: 'save-worker.js' });
  return { context, messages, writes, access, get closed() { return closed; },get aborted(){return aborted;}, releaseWrite: () => resolveWrite?.() };
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

test('target open, write and close failures preserve the completed input for browser saving',async()=>{
 for(const failureStage of ['get-target','open-target','write-target','close-target']){
  const loaded=loadSaveWorker({failureStage});
  await loaded.context.onmessage({data:{path:'video-pocket/scope/input.part',destinationId:'dest'}});
  const result=loaded.messages.at(-1);assert.equal(result.type,'done');assert.equal(result.saved,false);assert.equal(result.saveFailure.code,'SAVE_FAILED');assert.equal(result.saveFailure.saveStage,failureStage);assert.equal(result.saveFailure.saveReason,'permission');assert.ok(loaded.closed);
  assert.equal(loaded.aborted,['write-target','close-target'].includes(failureStage));assert.ok(!JSON.stringify(result).includes('SECRET'));
 }
});

test('a writer AbortError without user cancellation falls back instead of silently cancelling',async()=>{
 const loaded=loadSaveWorker({failureStage:'close-target',failureName:'AbortError'});
 await loaded.context.onmessage({data:{path:'video-pocket/scope/input.part',destinationId:'dest'}});
 const result=loaded.messages.at(-1);assert.equal(result.saved,false);assert.equal(result.saveFailure.saveReason,'aborted');assert.ok(loaded.aborted);
});

test('empty or truncated input never becomes a successful browser fallback',async()=>{
 for(const options of [{content:new Uint8Array()},{readFailure:true}]){
  const loaded=loadSaveWorker(options);await loaded.context.onmessage({data:{path:'video-pocket/scope/input.part',destinationId:'dest'}});
  const result=loaded.messages.at(-1);assert.equal(result.type,'error');assert.equal(result.code,'INCOMPLETE_MEDIA');assert.equal(result.saveStage,'read-temp');
 }
});

test('destination quota failure does not get mislabeled as full temporary storage',async()=>{
 const loaded=loadSaveWorker({failureStage:'write-target',failureName:'QuotaExceededError'});
 await loaded.context.onmessage({data:{path:'video-pocket/scope/input.part',destinationId:'dest'}});
 const result=loaded.messages.at(-1);assert.equal(result.saved,false);assert.equal(result.saveFailure.saveReason,'disk-full');assert.equal(result.saveFailure.code,'SAVE_FAILED');
});
