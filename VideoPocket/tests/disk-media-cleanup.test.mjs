import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const code = await fs.readFile(new URL('../extension/disk-media.js', import.meta.url), 'utf8');
function runtime() {
  const files = new Map();
  const dir = { async getDirectoryHandle() { return dir; }, async getFileHandle(name) {
    let data = files.get(name) || new Uint8Array();
    return { async createWritable() { let pos = 0; return { async seek(n) { pos = n; }, async write(bytes) { const b = new Uint8Array(bytes), out = new Uint8Array(Math.max(data.length, pos + b.length)); out.set(data); out.set(b, pos); data = out; pos += b.length; files.set(name, data); }, async close() {}, async abort() {} }; }, async getFile() { return new Blob([data]); }, async createSyncAccessHandle() { return { write(bytes, options = {}) { const b = new Uint8Array(bytes), at = Number(options.at) || 0, out = new Uint8Array(Math.max(data.length, at + b.length)); out.set(data); out.set(b, at); data = out; files.set(name, data); return b.length; }, truncate(length) { data = data.slice(0, length); files.set(name, data); }, getSize() { return data.length; }, flush() {}, close() {} }; } };
  }, async removeEntry(name) { files.delete(name); } };
  const context = { navigator: { storage: { getDirectory: async () => dir } }, crypto: { randomUUID: () => 'fixed-id' }, Uint8Array, ArrayBuffer, Blob, Promise, Error, Number, String, Math, Set, Map };
  context.globalThis = context; vm.runInNewContext(code, context, { filename: 'disk-media.js' });
  return { disk: context.VideoPocketDiskMedia, files };
}

test('async OPFS sink removes its partial file on abort', async () => {
  const { disk, files } = runtime();
  const sink = await disk.createMediaFile('job', 'input');
  await sink.append(new Uint8Array([1, 2]));
  await sink.abort();
  assert.equal(files.size, 0);
});

test('ordinary writes and positioned writes preserve their bytes without an application size gate', async () => {
  const { disk } = runtime();
  const sink = await disk.createMediaFile('job', 'input');
  await sink.append(new Uint8Array([1, 2, 3]));
  await sink.writeAt(new Uint8Array([4]), 1);
  const result=await sink.finish();
  assert.equal(result.size, 3);
  assert.deepEqual(new Uint8Array(await result.file.arrayBuffer()),new Uint8Array([1,4,3]));
});

test('sync sink abort is awaitable and removes its own partial file', async () => {
  const { disk, files } = runtime();
  const sink = await disk.createSyncMediaFile('job', 'sync');
  sink.access.write(new Uint8Array([1, 2, 3, 4]), { at: 0 });
  await sink.abort();
  assert.equal(files.size,0);
});
