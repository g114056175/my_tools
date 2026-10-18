importScripts('destinations.js', 'disk-media.js', 'vendor/mediabunny.js', 'media-mux.js');

let cancelled = false;

async function save(path, destinationId) {
  const parts = path.split('/');
  let directory = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) {
    if (!part || part === '.' || part === '..') throw new Error('暫存路徑無效');
    directory = await directory.getDirectoryHandle(part);
  }
  const input = await directory.getFileHandle(parts.at(-1));
  const access = await input.createSyncAccessHandle();
  let writer;
  try {
    const destination = await VideoPocketDestinations.get(destinationId);
    if (!destination) throw Object.assign(new Error('儲存位置已失效'), { code: 'SAVE_FAILED' });
    writer = await destination.createWritable();
    const size = access.getSize(), chunk = new Uint8Array(4 * 1024 * 1024);
    postMessage({ type: 'saving' });
    for (let at = 0; at < size;) {
      if (cancelled) throw new DOMException('已取消', 'AbortError');
      const count = access.read(chunk.subarray(0, Math.min(chunk.length, size - at)), { at });
      if (!count) throw Object.assign(new Error('檔案不完整'), { code: 'SAVE_FAILED' });
      await writer.write(chunk.subarray(0, count));
      at += count;
      postMessage({ type: 'saveProgress', progress: size ? at / size * 100 : 100 });
    }
    if (cancelled) throw new DOMException('已取消', 'AbortError');
    await writer.close(); writer = null;
  } catch (error) {
    await writer?.abort().catch(() => {});
    throw Object.assign(error, { code: error.code || (error.name === 'AbortError' ? 'CANCELLED' : error.name === 'QuotaExceededError' ? 'TEMP_STORAGE_FULL' : 'SAVE_FAILED') });
  } finally { access.close(); }
}

onmessage = async ({ data }) => {
  if (data.action === 'cancel') { cancelled = true; VideoPocketMediaMux.cancelled = true; return; }
  cancelled = false; VideoPocketMediaMux.cancelled = false;
  let result;
  try {
    result = await VideoPocketMediaMux.muxPacketCopy({ inputs: data.inputs, output: data.outputPath || data.output, args: data.args || [], scope: data.scope, signal: { get aborted() { return cancelled; } }, onInit: detail => postMessage({ type: 'init', ...detail }) });
    let saved = false;
    if (data.destinationId) { await save(result.path, data.destinationId); saved = true; }
    postMessage({ type: 'done', ...result, saved });
  } catch (error) {
    postMessage({ type: 'error', error: error.message || String(error), errorCode: error.code || (error.name === 'AbortError' ? 'CANCELLED' : 'MERGE_FAILED') });
  }
};
