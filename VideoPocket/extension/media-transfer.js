/* Injectable media transfer service.  It deliberately has no offscreen globals. */
import {parseByteRange} from './range-capability.js';

const FAST_WRITE_MAX_BYTES = 2 * 1024 * 1024;
const readWithProgress = async (reader, signal, timeoutMs) => {
  if (!(timeoutMs > 0)) return reader.read();
  return await new Promise((resolve, reject) => {
    let timer;
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { clear(); reject(signal.reason || new DOMException('已取消', 'AbortError')); };
    const settle = (fn, value) => { clear(); fn(value); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => settle(reject, new DOMException('串流讀取逾時', 'TimeoutError')), timeoutMs);
    Promise.resolve().then(() => reader.read()).then(value => settle(resolve, value), error => {
      // Some streams reject with a generic AbortError while the controlling
      // signal carries the useful TimeoutError or user cancellation reason.
      if (error?.name === 'AbortError' && signal?.aborted && signal.reason) settle(reject, signal.reason);
      else settle(reject, error);
    });
  });
};
const rangeOf = value => {
  return parseByteRange(value);
};

const rangeHeader = range => range ? {Range: `bytes=${range.offset || 0}-${(range.offset || 0) + range.length - 1}`} : {};
const checkRange = (response, range, message = '來源未提供正確的檔案範圍') => {
  if (!range) return;
  const h = response.headers.get('content-range')?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (response.status !== 206 || !h || Number(h[1]) !== range.offset || Number(h[2]) - Number(h[1]) + 1 !== range.length) {
    if (typeof response.body?.cancel === 'function') void response.body.cancel();
    throw Object.assign(new Error(message), {code: 'RANGE_UNSUPPORTED'});
  }
};

export function createMediaTransfer({request, disk, directTransfer, assembleSegments, absolute = (url, base) => new URL(url, base).href, progressTimeoutMs = 20000} = {}) {
  if (typeof request !== 'function' || !disk || typeof assembleSegments !== 'function') throw new TypeError('request, disk and assembleSegments are required');
  if (typeof directTransfer !== 'function') throw new TypeError('directTransfer is required');

  async function transfer(url, referer, signal, range, onBytes = () => {}, pageContext) {
    const response = await request(url, referer, {signal, pageContext, sourceStage: 'stream-segment', headers: rangeHeader(range)});
    checkRange(response, range);
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const {done, value} = await readWithProgress(reader, signal, progressTimeoutMs);
        if (done) break;
        length += value.length;
        if (range && length > range.length) throw new Error('來源片段長度不完整');
        chunks.push(value); onBytes(value.length);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    if (range && length !== range.length) throw new Error('來源片段長度不完整');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  async function downloadTrack(f, referer, signal, onBytes, scope, control, onSegment = () => {}, abortJob = () => {}, onSegmentBytes = () => {}, clearSegmentAttempt = () => {}) {
    const output = await disk.createMediaFile(scope, 'input');
    if (!f.segments?.length) {
      try { return await directTransfer(f, (url, options) => request(url, referer, {...options, sourceStage:'stream-segment', pageContext: f.pageContext}), signal, onBytes, output, control); }
      catch (error) { await output.abort(); throw error; }
    }
    const jobs = [], seenMap = new Set(), keys = new Map();
    for (const [i, segment] of f.segments.entries()) {
      if (segment.map) {
        const key = (segment.map.resolvedUri || segment.map.uri) + '|' + JSON.stringify(segment.map.byterange);
        if (!seenMap.has(key)) { jobs.push({url: segment.map.resolvedUri || segment.map.uri, range: rangeOf(segment.map.byterange)}); seenMap.add(key); }
      }
      jobs.push({url: segment.resolvedUri || absolute(segment.uri, f.url), range: rangeOf(segment.byterange), key: segment.key, sequence: (f.mediaSequence || 0) + i, segmentIndex: i});
    }
    // A range plan is safe for direct writes only when every emitted byte has an
    // exact length and no decryption changes its size. Maps are included in the
    // same concatenated output and receive their own sequential destination.
    const directWrite = typeof output.writeAt === 'function' && !f.rangeRoutes && jobs.every(job => job.range && !job.key && job.range.length <= FAST_WRITE_MAX_BYTES);
    let outputOffset = 0;
    for (const job of jobs) { job.outputOffset = outputOffset; outputOffset += job.range?.length || 0; }
    const hasEncrypted = jobs.some(job => job.key?.method === 'AES-128');
    const concurrency = hasEncrypted ? 2 : 4;
    let observedAssembly;
    try {
      await assembleSegments(jobs, {
        concurrency, signal, wait: () => control.wait(),
        download: async (job, index, assemblySignal) => {
          if (observedAssembly !== assemblySignal) { observedAssembly = assemblySignal; assemblySignal.addEventListener('abort', () => abortJob(assemblySignal.reason), {once: true}); }
          const readPart = async (url, attemptSignal) => {
             const readSignal = AbortSignal.any([attemptSignal, assemblySignal]);
            const attempt = {};
            const report = received => { if (job.segmentIndex !== undefined) onSegmentBytes(job.segmentIndex, received, attempt); };
            let partSink;
            try {
              if (job.key?.method === 'AES-128') {
                let encrypted = 0;
                let bytes = await transfer(url, referer, readSignal, job.range, delta => report(encrypted += delta), f.pageContext);
                const keyUrl = job.key.resolvedUri || absolute(job.key.uri, f.url);
                if (!keys.has(keyUrl)) keys.set(keyUrl, transfer(keyUrl, referer, readSignal, null, () => {}, f.pageContext).then(value => crypto.subtle.importKey('raw', value, {name: 'AES-CBC'}, false, ['decrypt'])).catch(error => { keys.delete(keyUrl); throw error; }));
                const iv = new Uint8Array(16), view = new DataView(iv.buffer);
                if (job.key.iv) for (let i = 0; i < 4; i++) view.setUint32(i * 4, job.key.iv[i]); else view.setUint32(12, job.sequence);
                bytes = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-CBC', iv}, await keys.get(keyUrl), bytes));
                partSink = await disk.createMediaFile(scope, 'segment'); await partSink.append(bytes);
              } else if (directWrite) {
                const response = await request(url, referer, {signal: readSignal, pageContext: f.pageContext, sourceStage: 'stream-segment', headers: rangeHeader(job.range)});
                checkRange(response, job.range, '來源片段範圍不完整');
                const reader = response.body.getReader(); let size = 0;
                try { for (;;) { readSignal.throwIfAborted(); const {done, value} = await readWithProgress(reader, readSignal, progressTimeoutMs); if (done) break; size += value.length; if (size > job.range.length) throw new Error('來源片段長度不完整'); await output.writeAt(value, job.outputOffset + size - value.length); report(size); } }
                catch (error) { await reader.cancel().catch(() => {}); throw error; }
                if (size !== job.range.length) throw new Error('來源片段長度不完整');
                return {path: null, size, direct: true};
              } else {
                partSink = await disk.createMediaFile(scope, 'segment');
                const response = await request(url, referer, {signal: readSignal, pageContext: f.pageContext, sourceStage: 'stream-segment', headers: rangeHeader(job.range)});
                checkRange(response, job.range, '來源片段範圍不完整');
                const reader = response.body.getReader(); let size = 0;
                try { for (;;) { readSignal.throwIfAborted(); const {done, value} = await readWithProgress(reader, readSignal, progressTimeoutMs); if (done) break; size += value.length; if (job.range && size > job.range.length) throw new Error('來源片段長度不完整'); await partSink.append(value); report(size); } }
                catch (error) { await reader.cancel().catch(() => {}); throw error; }
                const expected = job.range?.length || (!response.headers.get('content-encoding') ? Number(response.headers.get('content-length')) : 0);
                if (expected > 0 && size !== expected) throw new Error('來源片段長度不完整');
              }
              readSignal.throwIfAborted(); return await partSink.finish();
            } catch (error) { await partSink?.abort(); throw error; }
            finally { if (job.segmentIndex !== undefined) clearSegmentAttempt(job.segmentIndex, attempt); }
          };
          const result = await control.run(async attemptSignal => {
            if (f.rangeRoutes && job.range && !job.key && job.url === f.url) {
              try { return (await f.rangeRoutes.run((url, routeSignal) => readPart(url, AbortSignal.any([attemptSignal, routeSignal])), attemptSignal)).value; }
              catch (error) { throw error?.errors?.[0] || error; }
            }
            return readPart(job.url, attemptSignal);
          });
          onBytes(result.size); if (job.segmentIndex !== undefined) onSegment(job.segmentIndex); return result;
        },
        consume: async (part) => {
          if (part.direct) return;
          const reader = (await disk.readMediaFile(part.path)).stream().getReader();
          try { for (;;) { await control.wait(); const {done, value} = await readWithProgress(reader, signal, progressTimeoutMs); if (done) break; await output.append(value); } }
          catch (error) { await reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        },
        dispose: part => part.direct ? undefined : disk.removeMediaFile(part.path)
      });
      return await output.finish();
    } catch (error) { await output.abort(); throw error; }
  }
  return {transfer, downloadTrack};
}

export {rangeOf};
