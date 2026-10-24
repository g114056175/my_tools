import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {createMediaTransfer} from '../extension/media-transfer.js';
import {assembleSegments} from '../extension/ordered-segments.js';
import {TransferControl} from '../extension/transfer-control.js';

const bytes = value => new Uint8Array(value);
function response(data, range, status = 206) {
  const body = bytes(data); let used = false;
  return {status, headers: {get: name => name.toLowerCase() === 'content-range' && range ? `bytes ${range.offset}-${range.offset + range.length - 1}/${range.total || range.offset + range.length}` : null}, body: {getReader: () => ({read: async () => used ? {done: true} : (used = true, {done: false, value: body}), cancel: async () => {}})}};
}
function diskMock() {
  const files = new Map(), writes = [], removed = [];
  return {files, writes, removed,
    async createMediaFile(scope, name) { const path = `${scope}/${name}/${files.size}`; const sink = {path, data: new Uint8Array(), append: async value => { const b = bytes(value), next = new Uint8Array(sink.data.length + b.length); next.set(sink.data); next.set(b, sink.data.length); sink.data = next; }, writeAt: async (value, offset) => { const b = bytes(value), next = new Uint8Array(Math.max(sink.data.length, offset + b.length)); next.set(sink.data); next.set(b, offset); sink.data = next; writes.push({offset, size: b.length}); }, finish: async () => { files.set(path, sink.data); return {path, size: sink.data.length}; }, abort: async () => { removed.push(path); }}; return sink; },
    async readMediaFile(path) { const data = files.get(path); return {stream: () => new ReadableStream({start(c) {c.enqueue(data); c.close();}})}; },
    async removeMediaFile(path) { files.delete(path); removed.push(path); }
  };
}
async function serialAssembler(jobs, options) {
  const parts = new Map();
  // Complete in reverse order to exercise ordered consumption.
  for (let i = jobs.length - 1; i >= 0; i--) parts.set(i, await options.download(jobs[i], i, options.signal || new AbortController().signal));
  for (let i = 0; i < jobs.length; i++) { await options.consume(parts.get(i), i); await options.dispose(parts.get(i), i); }
}

test('progressive body requests use media streaming deadlines rather than metadata deadlines',async()=>{
 const stages=[],disk=diskMock(),service=createMediaTransfer({disk,assembleSegments,request:async(url,referer,options)=>{stages.push(options.sourceStage);assert.equal(options.pageContext.tabId,7);return new Response(new Uint8Array([1,2,3]));},directTransfer:async(format,request,signal,onBytes,sink)=>{const response=await request(format.url,{signal});await sink.append(new Uint8Array(await response.arrayBuffer()));return sink.finish();}});
 const result=await service.downloadTrack({url:'https://cdn.test/file.mp4',pageContext:{tabId:7}},'https://page.test/',new AbortController().signal,()=>{},'job');
 assert.deepEqual(stages,['stream-segment']);assert.equal(result.size,3);
});

test('known unencrypted ranges write directly at concatenated offsets and preserve order', async () => {
  const disk = diskMock(), source = [bytes([1, 2]), bytes([3, 4]), bytes([5, 6])];
  const request = async (url, _referer, {headers}) => { const i = Number(url.slice(1)); const range = {offset: i * 2, length: 2, total: 6}; return response(source[i], range); };
  const service = createMediaTransfer({request, disk, directTransfer: async () => {throw Error('unexpected');}, assembleSegments});
  const result = await service.downloadTrack({url: 'https://x', segments: [0, 1, 2].map((_, i) => ({resolvedUri: `s${i}`, byterange: {offset: i * 2, length: 2}}))}, '', new AbortController().signal, () => {}, 'job', {wait: async () => {}, run: operation => operation(new AbortController().signal)});
  assert.deepEqual([...disk.files.get(result.path)], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(disk.writes.map(w => w.offset).sort((a, b) => a - b), [0, 2, 4]);
  assert.equal(disk.removed.length, 0);
});

test('invalid range rejects and cleans the output', async () => {
  const disk = diskMock(), request = async () => response(bytes([1]), {offset: 2, length: 2, total: 4});
  const service = createMediaTransfer({request, disk, directTransfer: async () => {}, assembleSegments: serialAssembler});
  await assert.rejects(service.downloadTrack({url: 'x', segments: [{resolvedUri: 's', byterange: {offset: 0, length: 2}}]}, '', new AbortController().signal, () => {}, 'job', {wait: async () => {}, run: operation => operation(new AbortController().signal)}), /範圍/);
  assert.ok(disk.removed.length > 0);
});

test('map bytes receive their own concatenated offset before media segments', async () => {
  const disk = diskMock(), parts = {map: bytes([9, 9]), s0: bytes([1, 2]), s1: bytes([3, 4])};
  const ranges = {map: {offset: 0, length: 2, total: 2}, s0: {offset: 2, length: 2, total: 4}, s1: {offset: 4, length: 2, total: 6}};
  const request = async url => response(parts[url], ranges[url]);
  const service = createMediaTransfer({request, disk, directTransfer: async () => {}, assembleSegments});
  const control = {wait: async () => {}, run: op => op(new AbortController().signal)};
  const result = await service.downloadTrack({url: 'https://x', segments: [{map: {resolvedUri: 'map', byterange: ranges.map}, resolvedUri: 's0', byterange: ranges.s0}, {map: {resolvedUri: 'map', byterange: ranges.map}, resolvedUri: 's1', byterange: ranges.s1}]}, '', new AbortController().signal, () => {}, 'job', control);
  assert.deepEqual([...disk.files.get(result.path)], [9, 9, 1, 2, 3, 4]);
  assert.deepEqual(disk.writes.map(w => w.offset).sort((a, b) => a - b), [0, 2, 4]);
});

test('abort removes a partially downloaded output', async () => {
  const disk = diskMock(), abort = new AbortController();
  const request = async () => ({status: 206, headers: {get: () => 'bytes 0-1/2'}, body: {getReader: () => ({
    read: async () => { await new Promise(resolve => setTimeout(resolve, 20)); return {done: false, value: bytes([1])}; },
    cancel: async () => {}
  })}});
  const service = createMediaTransfer({request, disk, directTransfer: async () => {}, assembleSegments});
  const control = {wait: async () => {}, run: op => op(abort.signal)};
  const pending = service.downloadTrack({url: 'x', segments: [{resolvedUri: 's', byterange: {offset: 0, length: 2}}]}, '', abort.signal, () => {}, 'job', control);
  setTimeout(() => abort.abort(new Error('cancelled')), 2);
  await assert.rejects(pending);
  assert.ok(disk.removed.length > 0);
});

test('continuous slow HLS segment data can exceed the no-progress window', async () => {
  const originalTimeout = AbortSignal.timeout;
  const timeoutMock = mock.method(AbortSignal, 'timeout', function (ms) { return originalTimeout.call(this, ms === 20000 ? 10 : ms); });
  const disk = diskMock(), chunks = [bytes([1]), bytes([2]), bytes([3])];
  const request = async () => ({status: 200, headers: {get: () => null}, body: new ReadableStream({start(controller) {
    chunks.forEach((chunk, index) => setTimeout(() => controller.enqueue(chunk), index * 8));
    setTimeout(() => controller.close(), 25);
  }})});
  const service = createMediaTransfer({request, disk, directTransfer: async () => {}, assembleSegments, progressTimeoutMs: 10});
  try {
    const result = await service.downloadTrack({url: 'https://x', segments: [{resolvedUri: 's'}]}, '', new AbortController().signal, () => {}, 'job', {wait: async () => {}, run: operation => operation(new AbortController().signal)});
    assert.deepEqual([...disk.files.get(result.path)], [1, 2, 3]);
  } finally { timeoutMock.mock.restore(); }
});

test('a stalled HLS segment times out and retries while user cancellation stays explicit', async () => {
  const disk = diskMock(), abort = new AbortController(); let calls = 0;
  const request = async () => ({status: 200, headers: {get: () => null}, body: new ReadableStream({start(controller) {
    calls++;
    if (calls === 1) return;
    controller.enqueue(bytes([7])); controller.close();
  }})});
  const control = new TransferControl(abort.signal, () => {}, {delay: 1, attempts: 1});
  const service = createMediaTransfer({request, disk, directTransfer: async () => {}, assembleSegments, progressTimeoutMs: 8});
  const result = await service.downloadTrack({url: 'https://x', segments: [{resolvedUri: 's'}]}, '', abort.signal, () => {}, 'job', control);
  assert.deepEqual([...disk.files.get(result.path)], [7]); assert.equal(calls, 2);

  const cancel = new AbortController();
  const cancelService = createMediaTransfer({request: async () => ({status: 200, headers: {get: () => null}, body: new ReadableStream({start() {}})}), disk, directTransfer: async () => {}, assembleSegments, progressTimeoutMs: 50});
  const pending = cancelService.downloadTrack({url: 'https://x', segments: [{resolvedUri: 's'}]}, '', cancel.signal, () => {}, 'cancel', {wait: async () => {}, run: operation => operation(cancel.signal)});
  setTimeout(() => cancel.abort(Object.assign(new Error('已取消'), {code: 'CANCELLED'})), 2);
  await assert.rejects(pending, error => error.code === 'CANCELLED');
});

test('indexed route aggregate keeps the first underlying failure', async () => {
  const disk = diskMock(), errors = [new Error('primary failed'), new Error('backup failed')], aggregate = new AggregateError(errors);
  const service = createMediaTransfer({request: async () => { throw errors[0]; }, disk, directTransfer: async () => {}, assembleSegments: async (jobs, options) => options.download(jobs[0], 0, options.signal)});
  const format = {url: 'https://x', rangeRoutes: {run: async () => { throw aggregate; }}, segments: [{resolvedUri: 's', byterange: {offset: 0, length: 1}}]};
  await assert.rejects(service.downloadTrack(format, '', new AbortController().signal, () => {}, 'job', {wait: async () => {}, run: operation => operation(new AbortController().signal)}), error => error === errors[0]);
});

test('AES segments use the safe lower concurrency while retaining decrypt path', async () => {
  const disk = diskMock(), calls = [];
  const rawKey = new Uint8Array(16).fill(7), iv = new Uint8Array(16).fill(3), plain = new TextEncoder().encode('0123456789abcdef');
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, {name: 'AES-CBC'}, false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv}, cryptoKey, plain));
  const request = async (url, _referer, {headers}) => { calls.push(url); if (url.endsWith('/key') || url === 'key') return response(rawKey, null, 200); return response(encrypted, {offset: 0, length: encrypted.length, total: encrypted.length}); };
  const service = createMediaTransfer({request, disk, directTransfer: async () => {}, assembleSegments: async (jobs, options) => { assert.equal(options.concurrency, 2); for (const [i, job] of jobs.entries()) { const part = await options.download(job, i, options.signal); await options.consume(part, i); await options.dispose(part, i); } }});
  const result = await service.downloadTrack({url: 'https://x', segments: [{resolvedUri: 'seg', byterange: {offset: 0, length: encrypted.length}, key: {method: 'AES-128', uri: 'key', iv: new Uint32Array([0x03030303, 0x03030303, 0x03030303, 0x03030303])}}]}, '', new AbortController().signal, () => {}, 'job', {wait: async () => {}, run: operation => operation(new AbortController().signal)});
  assert.deepEqual([...disk.files.get(result.path)], [...plain]);
  assert.ok(calls.some(url => url.endsWith('/key') || url === 'key'));
});
