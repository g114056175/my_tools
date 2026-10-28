importScripts('disk-media.js', 'vendor/mediabunny.js', 'indexed-mp4-download.js');
let cancelled = false, activeController, pendingReads = new Map(), sequence = 0;
onmessage = async ({ data }) => {
  if (data.action === 'readResult') { const p = pendingReads.get(data.requestId); if (p) { pendingReads.delete(data.requestId); data.error ? p.reject(Object.assign(new Error(data.error), { code: data.errorCode, httpStatus: data.httpStatus })) : p.resolve(new Uint8Array(data.bytes)); } return; }
  if (data.action === 'cancel') { cancelled = true; activeController?.abort(Object.assign(new Error('已取消'), { code: 'CANCELLED' })); for (const p of pendingReads.values()) p.reject(Object.assign(new Error('已取消'), { code: 'CANCELLED' })); pendingReads.clear(); return; }
  cancelled = false;
  activeController = new AbortController();
  const signal = activeController.signal;
  try {
    const result = await VideoPocketIndexedMp4.downloadIndexedMp4({
      ...data, signal,
      readRange: (offset, length) => new Promise((resolve, reject) => { const requestId = ++sequence; pendingReads.set(requestId, { resolve, reject }); postMessage({ type: 'readRange', requestId, offset, length }); }),
      onBytes: bytes => postMessage({ type: 'bytes', bytes }),
      onProgress: progress => postMessage({ type: 'progress', progress })
    });
    postMessage({ type: 'done', ...result });
  } catch (error) { postMessage({ type: 'error', error: error.message || String(error), errorCode: cancelled ? 'CANCELLED' : error.code || 'RANGE_PROCESSING_FAILED', httpStatus: error.httpStatus || error.status }); }
  finally { activeController = null; }
};
