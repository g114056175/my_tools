/* OPFS backed temporary media files.
 * This file is deliberately dependency free so it can be loaded by the
 * offscreen page or by the FFmpeg worker with importScripts().
 */
(function (root) {
  'use strict';
  const PREFIX = 'video-pocket';
  const MAX_NAME = 180;
  const safe = value => String(value || 'file').replace(/[^\w.()\- \u0080-\uFFFF]/g, '_').slice(0, MAX_NAME) || 'file';
  const pathParts = value => {
    const parts = String(value || '').split('/').filter(Boolean);
    if (!parts.length || parts.some(p => p === '.' || p === '..' || !/^[\w.()\- \u0080-\uFFFF]+$/.test(p))) throw new Error('暫存檔路徑無效');
    return parts;
  };
  let rootPromise;
  const openSinks=new Map();
  async function opfsRoot() {
    if (!navigator.storage?.getDirectory) throw new Error('此瀏覽器不支援本機暫存檔');
    return rootPromise ||= navigator.storage.getDirectory();
  }
  async function directory(scope, create = true) {
    const root = await opfsRoot();
    const top = await root.getDirectoryHandle(PREFIX, { create });
    return top.getDirectoryHandle(safe(scope), { create });
  }
  const bytes = value => value instanceof Uint8Array ? value : ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new Uint8Array(value);

  async function createMediaFile(scope, name, options = {}) {
    const dir = await directory(scope);
    const filename = safe(name) + '-' + crypto.randomUUID().replaceAll('-', '') + '.part';
    const handle = await dir.getFileHandle(filename, { create: true });
    const writer = await handle.createWritable({ keepExistingData: false });
    let size = 0, closed = false, chain = Promise.resolve();
    const scopeKey=safe(scope);if(!openSinks.has(scopeKey))openSinks.set(scopeKey,new Set());
    const enqueue = task => {if(closed)return Promise.reject(new Error('暫存檔已關閉'));chain = chain.then(task); return chain; };
    const sink = {
      get path() { return PREFIX + '/' + safe(scope) + '/' + filename; },
      get size() { return size; },
      append(data) { const b = bytes(data); return enqueue(async () => { await writer.seek(size); await writer.write(b); size += b.byteLength; }); },
      writeAt(data, offset) {
        const b = bytes(data); offset = Math.max(0, Number(offset) || 0);
        return enqueue(async () => { await writer.seek(offset); await writer.write(b); size = Math.max(size, offset + b.byteLength); });
      },
      truncate(length=0){length=Math.max(0,Number(length)||0);return enqueue(async()=>{await writer.truncate(length);size=length;});},
      async finish() {
        await chain; if (closed) return { path: sink.path, size, file: await handle.getFile() };
        await writer.close(); closed = true;openSinks.get(scopeKey)?.delete(sink);
        return { path: sink.path, size, file: await handle.getFile() };
      },
      async abort() {
        if (closed) return;
        closed = true;
        try { await chain; } catch {}
        try { await writer.abort(); } catch {}
        try { await dir.removeEntry(filename); } catch {}
        openSinks.get(scopeKey)?.delete(sink);
      }
    };
    openSinks.get(scopeKey).add(sink);
    if (options.expectedSize != null) {
      const expected = Math.max(0, Number(options.expectedSize) || 0);
      if (expected) await sink.writeAt(new Uint8Array(0), expected);
      size = 0;
    }
    return sink;
  }

  async function createSyncMediaFile(scope,name){
    const dir=await directory(scope),filename=safe(name)+'-'+crypto.randomUUID().replaceAll('-','')+'.part',handle=await dir.getFileHandle(filename,{create:true}),access=await handle.createSyncAccessHandle();
    return {path:PREFIX+'/'+safe(scope)+'/'+filename,access,finish(){access.flush();const size=access.getSize();access.close();return {path:this.path,size};},abort(){try{access.close();}catch{}}};
  }

  async function readMediaFile(path) {
    const parts = pathParts(path);
    if (parts.shift() !== PREFIX || parts.length < 2) throw new Error('暫存檔路徑無效');
    const scope = parts.shift(), dir = await directory(scope, false);
    let current = dir;
    for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part, { create: false });
    return current.getFileHandle(parts.at(-1), { create: false }).then(h => h.getFile());
  }

  async function openSyncMediaFile(path) {
    const parts = pathParts(path);
    if (parts.shift() !== PREFIX || parts.length !== 2) throw new Error('暫存檔路徑無效');
    const dir = await directory(parts[0], false);
    const handle = await dir.getFileHandle(parts[1], { create: false });
    const access = await handle.createSyncAccessHandle();
    return { path, access };
  }

  async function removeMediaFiles(scope) {
    for(const [key,sinks] of openSinks)if(scope==null||key===safe(scope)){await Promise.allSettled([...sinks].map(s=>s.abort()));openSinks.delete(key);}
    const root = await opfsRoot(), top = await root.getDirectoryHandle(PREFIX, { create: false }).catch(() => null);
    if (!top) return;
    if (scope == null) { await root.removeEntry(PREFIX, { recursive: true }); rootPromise = null; return; }
    await top.removeEntry(safe(scope), { recursive: true }).catch(() => {});
  }
  async function removeMediaFile(path){const parts=pathParts(path);if(parts.shift()!==PREFIX||parts.length!==2)throw new Error('暫存檔路徑無效');const dir=await directory(parts[0],false);await dir.removeEntry(parts[1]);}
  async function estimateMediaQuota() { return navigator.storage?.estimate ? navigator.storage.estimate() : { usage: 0, quota: 0 }; }
  root.VideoPocketDiskMedia = { createMediaFile, createSyncMediaFile, readMediaFile, openSyncMediaFile, removeMediaFile, removeMediaFiles, estimateMediaQuota };
})(typeof self !== 'undefined' ? self : globalThis);
