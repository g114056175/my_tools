import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function reader() {
  const context = { Uint8Array, ArrayBuffer, Map, Math, Error, Object, Promise, self: {} };
  vm.runInNewContext(await readFile(new URL('../extension/indexed-mp4-download.js', import.meta.url), 'utf8'), context);
  return context.self.VideoPocketIndexedMp4;
}
test('indexed reader uses 256KiB chunks, pending dedupe and bounded LRU', async () => {
  const api = await reader(); let calls = 0;
  class CustomSource { constructor(def) { Object.assign(this, def); } }
  const M = { CustomSource }; const data = new Uint8Array(512 * 1024); data.forEach((_, i) => data[i] = i % 251);
  const r = api.createIndexedMp4Reader({ M, format: { filesize: data.length }, readRange: async (o, n) => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return data.slice(o, o + n); } });
  const [a, b] = await Promise.all([r.source.read(0, 100), r.source.read(0, 100)]);
  assert.deepEqual(a, b); assert.equal(calls, 1); assert.deepEqual(await r.source.read(256 * 1024, 256 * 1024 + 4), data.slice(256 * 1024, 256 * 1024 + 4));
});
test('indexed reader aborts before issuing a request', async () => {
  const api = await reader(), controller = new AbortController(); controller.abort(new Error('cancelled')); let called = false;
  class CustomSource { constructor(def) { Object.assign(this, def); } }
  const r = api.createIndexedMp4Reader({ M: { CustomSource }, format: { filesize: 10 }, signal: controller.signal, readRange: async () => { called = true; return new Uint8Array(10); } });
  await assert.rejects(r.source.read(0, 1)); assert.equal(called, false);
});
test('indexed reader evicts chunks beyond the 4MiB cache bound', async () => {
  const api = await reader(); let calls = 0;
  class CustomSource { constructor(def) { Object.assign(this, def); } }
  const chunks = 18, size = chunks * 256 * 1024;
  const r = api.createIndexedMp4Reader({ M: { CustomSource }, format: { filesize: size }, readRange: async (o, n) => { calls++; return new Uint8Array(n).fill(o / (256 * 1024)); } });
  for (let i = 0; i < chunks; i++) await r.source.read(i * 256 * 1024, (i + 1) * 256 * 1024);
  assert.equal(r.cache.size, 16);
  await r.source.read(0, 1);
  assert.equal(calls, chunks + 1, 'oldest chunk must be fetched after eviction');
});
test('indexed reader clears failed and aborted in-flight requests', async () => {
  const api = await reader(); let rejectRead, calls = 0;
  class CustomSource { constructor(def) { Object.assign(this, def); } }
  const controller = new AbortController();
  const r = api.createIndexedMp4Reader({ M: { CustomSource }, format: { filesize: 10 }, signal: controller.signal, readRange: async () => { calls++; return await new Promise((resolve, reject) => { rejectRead = reject; }); } });
  const pending = r.source.read(0, 1); controller.abort(new Error('cancelled')); rejectRead(new Error('cancelled')); await assert.rejects(pending); assert.equal(r.pending.size, 0);
  await assert.rejects(r.source.read(0, 1)); assert.equal(calls, 1);
});
