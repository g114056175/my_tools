/* MP4/M4A range copy, restricted to independently decodable video starts. */
(function (root) {
  'use strict';

  const M = root.VideoPocketMediabunny;
  const disk = root.VideoPocketDiskMedia;
  const active = new Set();
  const unsupported = message => Object.assign(
    new Error(message || 'MP4 無轉碼裁切不適用'),
    { code: 'RANGE_SMART_UNSUPPORTED' },
  );
  const cancelled = () => Object.assign(new Error('已取消'), { code: 'CANCELLED' });
  function check(signal) { if (signal?.aborted) throw cancelled(); }
  function target(access, signal) {
    return new M.StreamTarget(new WritableStream({
      write(chunk) {
        check(signal);
        const data = chunk.data;
        if (access.write(data, { at: chunk.position }) !== data.byteLength) {
          throw unsupported('MP4 輸出寫入不完整');
        }
      },
    }), { chunked: true, chunkSize: 1024 * 1024 });
  }

  // Rewrite only movie presentation metadata. Media sample tables and mdat bytes
  // remain byte-for-byte untouched, so B-frame reference packets are retained.
  const u32 = (a, p) => ((a[p] * 0x1000000) + (a[p + 1] << 16) + (a[p + 2] << 8) + a[p + 3]) >>> 0;
  const put32 = (a, p, v) => { v = Math.max(0, Math.min(0xffffffff, Math.round(v))); a[p] = v >>> 24; a[p + 1] = v >>> 16; a[p + 2] = v >>> 8; a[p + 3] = v; };
  const u64 = (a, p) => u32(a, p) * 0x100000000 + u32(a, p + 4);
  const put64 = (a, p, v) => { if (!Number.isSafeInteger(v) || v < 0 || v > 0xffffffffffffffff) throw unsupported('MP4 duration 超出可表示範圍'); put32(a, p, Math.floor(v / 0x100000000)); put32(a, p + 4, v % 0x100000000); };
  function boxes(bytes, from, to) {
    const out = [];
    for (let p = from; p < to;) {
      if (p + 8 > to) throw unsupported('MP4 box 截斷');
      let size = u32(bytes, p), head = 8;
      if (size === 1) { if (p + 16 > to) throw unsupported('MP4 large box 截斷'); size = u64(bytes, p + 8); head = 16; }
      if (size < head || size > to - p || size > 0xffffffff) throw unsupported('MP4 box size 不規則');
      out.push({ start: p, end: p + size, head, type: String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]) }); p += size;
    }
    return out;
  }
  const box = (type, payload) => { const out = new Uint8Array(8 + payload.length); put32(out, 0, out.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(payload, 8); return out; };
  function capMoov(input, requestedSeconds) {
    const data = new Uint8Array(input);
    const root = boxes(data, 0, data.length);
    if (root.length !== 1 || root[0].type !== 'moov') throw unsupported('MP4 moov box 不規則');
    const movie = root[0], mvhd = boxes(data, movie.start + movie.head, movie.end).find(x => x.type === 'mvhd');
    if (!mvhd) throw unsupported('MP4 缺少 mvhd');
    const mv = data[mvhd.start + mvhd.head];
    if (mv !== 0 && mv !== 1) throw unsupported('MP4 mvhd version 不支援');
    const movieScale = u32(data, mvhd.start + mvhd.head + (mv ? 20 : 12));
    if (!movieScale) throw unsupported('MP4 mvhd timescale 無效');
    const wanted = Math.round(requestedSeconds * movieScale);
    const patchTrack = trak => {
      const children = boxes(data, trak.start + trak.head, trak.end);
      let tkhd = children.find(x => x.type === 'tkhd'), edts = children.find(x => x.type === 'edts');
      if (!tkhd) throw unsupported('MP4 trak 缺少 tkhd');
      const tk = data[tkhd.start + tkhd.head];
      if (tk !== 0 && tk !== 1) throw unsupported('MP4 tkhd version 不支援');
      const tkPos = tkhd.start + tkhd.head + (tk ? 28 : 20);
      const oldTk = tk ? u64(data, tkPos) : u32(data, tkPos);
      const capTk = Math.min(oldTk, wanted);
      const tkBytes = data.slice(tkhd.start, tkhd.end); tk ? put64(tkBytes, tkPos - tkhd.start, capTk) : put32(tkBytes, tkPos - tkhd.start, capTk);
      let edits = edts && boxes(data, edts.start + edts.head, edts.end).find(x => x.type === 'elst');
      let edtsBytes;
      if (edts) {
        if (!edits) throw unsupported('MP4 edts 缺少 elst');
        const el = data[edits.start + edits.head];
        if (el !== 0 && el !== 1) throw unsupported('MP4 elst version 不支援');
        const count = u32(data, edits.start + edits.head + 4), entrySize = el ? 20 : 12;
        if (edits.start + edits.head + 8 + count * entrySize !== edits.end) throw unsupported('MP4 elst 結構不規則');
        const elBytes = data.slice(edits.start, edits.end), base = edits.start + edits.head + 8 - edits.start;
        let remaining = wanted;
        for (let i = 0; i < count; i++) { const pos = base + i * entrySize; const duration = el ? u64(elBytes, pos) : u32(elBytes, pos); const keep = Math.min(duration, remaining); if (el) put64(elBytes, pos, keep); else put32(elBytes, pos, keep); remaining = Math.max(0, remaining - keep); }
        edtsBytes = data.slice(edts.start, edts.end); edtsBytes.set(elBytes, edits.start - edts.start);
      } else {
        const editVersion = Math.min(oldTk, wanted) > 0xffffffff ? 1 : 0;
        const payload = new Uint8Array(editVersion ? 32 : 20); payload[0] = editVersion; put32(payload, 4, 1);
        if (editVersion) { put64(payload, 8, Math.min(oldTk, wanted)); put64(payload, 16, 0); put32(payload, 24, 0x00010000); }
        else { put32(payload, 8, Math.min(oldTk, wanted)); put32(payload, 12, 0); put32(payload, 16, 0x00010000); }
        edtsBytes = box('edts', box('elst', payload));
      }
      const rebuilt = [];
      for (const child of children) { if (child === tkhd) rebuilt.push(tkBytes); else if (child === edts) rebuilt.push(edtsBytes); else rebuilt.push(data.slice(child.start, child.end)); }
      if (!edts) { const index = children.findIndex(x => x.type === 'mdia'); rebuilt.splice(index < 0 ? rebuilt.length : index, 0, edtsBytes); }
      return box('trak', concat(rebuilt));
    };
    const rebuilt = [];
    for (const child of boxes(data, movie.start + movie.head, movie.end)) {
      if (child.type === 'mvhd') { const x = data.slice(child.start, child.end); const off = child.head + (mv ? 24 : 16); const old = mv ? u64(x, off) : u32(x, off); mv ? put64(x, off, Math.min(old, wanted)) : put32(x, off, Math.min(old, wanted)); rebuilt.push(x); }
      else if (child.type === 'trak') rebuilt.push(patchTrack(child)); else rebuilt.push(data.slice(child.start, child.end));
    }
    const oldMovieDuration = mv ? u64(data, mvhd.start + mvhd.head + 24) : u32(data, mvhd.start + mvhd.head + 16);
    return { data: box('moov', concat(rebuilt)), duration: Math.min(wanted, oldMovieDuration) / movieScale };
  }
  function concat(parts) { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
  async function presentationDuration(file) {
    if (!file || typeof file.slice !== 'function' || !Number.isFinite(file.size)) throw unsupported('MP4 檔案無法讀取');
    const size = file.size; let pos = 0, moov = null;
    while (pos + 8 <= size) {
      const header = new Uint8Array(await file.slice(pos, Math.min(size, pos + 16)).arrayBuffer());
      if (header.length < 8) throw unsupported('MP4 top-level box 截斷');
      let boxSize = u32(header, 0), head = 8;
      if (boxSize === 1) { if (header.length < 16) throw unsupported('MP4 large box header 截斷'); boxSize = u64(header, 8); head = 16; }
      if (boxSize < head || boxSize > size - pos) throw unsupported('MP4 top-level box size 不規則');
      const type = String.fromCharCode(header[4], header[5], header[6], header[7]);
      if (type === 'moov') { if (boxSize > 32 * 1024 * 1024) throw unsupported('MP4 moov 過大'); moov = new Uint8Array(await file.slice(pos, pos + boxSize).arrayBuffer()); break; }
      pos += boxSize;
    }
    if (!moov) throw unsupported('MP4 缺少 moov');
    const rootBox = boxes(moov, 0, moov.length)[0], mvhd = boxes(moov, rootBox.head, rootBox.end).find(x => x.type === 'mvhd');
    if (!mvhd) throw unsupported('MP4 缺少 mvhd');
    const version = moov[mvhd.start + mvhd.head];
    if (version !== 0 && version !== 1) throw unsupported('MP4 mvhd version 不支援');
    const scale = u32(moov, mvhd.start + mvhd.head + (version ? 20 : 12));
    if (!scale) throw unsupported('MP4 mvhd timescale 無效');
    const duration = version ? u64(moov, mvhd.start + mvhd.head + 24) : u32(moov, mvhd.start + mvhd.head + 16);
    return duration / scale;
  }

  async function tryCut({ input, start, end, output, scope, kind = 'video', expectedAudio = false,
    signal, onProgress = () => {} }) {
    const ext = String(output || '').split('.').pop().toLowerCase();
    if (!['mp4', 'm4a'].includes(ext) || !['video', 'audio'].includes(kind)) return null;
    if (!input || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
    if (!M || !disk) return null;

    let writer;
    let conversion;
    let finished = false;
    let moovCapture;
    try {
      check(signal);
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      if (kind === 'video' && !video) return null;
      if (kind === 'audio' && !audio) return null;
      if (kind === 'video' && expectedAudio && !audio) return null;
      // Hiding an earlier GOP behind an edit list is not interoperable with all
      // players: some discard its reference frames and show black/frozen video
      // until the next keyframe. Only copy a verified key-aligned video start.
      if (kind === 'video') {
        const sink = new M.EncodedPacketSink(video);
        const key = await sink.getKeyPacket(start, { verifyKeyPackets: true });
        if (!key || Math.abs(key.timestamp - start) > 1e-6) return null;
      }

      writer = await disk.createSyncMediaFile(scope, output);
      const destination = new M.Output({
        format: new M.Mp4OutputFormat({ fastStart: false, onMoov(data, position) { moovCapture = { data: new Uint8Array(data), position }; } }),
        target: target(writer.access, signal),
      });
      const options = {
        input,
        output: destination,
        trim: { start, end: end - 1e-6 },
        copy: { mode: 'forced', shiftTolerance: 0, boundaryPolicy: 'expand', boundaryTolerance: Infinity },
        video: kind === 'video' ? {} : { discard: true },
        audio: audio ? {} : { discard: true },
        showWarnings: false,
      };
      conversion = await M.Conversion.init(options);
      if (!conversion.isValid || conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user')) {
        throw unsupported('MP4 區間無法完整封裝為無轉碼輸出');
      }
      active.add(conversion);
      conversion.onProgress = (progress, timestamp) => { check(signal); onProgress(progress, timestamp); };
      await conversion.execute();
      check(signal);
      if (!moovCapture) throw unsupported('MP4 缺少 moov');
      const capped = capMoov(moovCapture.data, end - start);
      if (writer.access.getSize && moovCapture.position + moovCapture.data.length !== writer.access.getSize()) throw unsupported('MP4 moov 不在檔案尾端');
      if (writer.access.write(capped.data, { at: moovCapture.position }) !== capped.data.length) throw unsupported('MP4 moov 寫入不完整');
      if (writer.access.truncate) writer.access.truncate(moovCapture.position + capped.data.length);
      const result = writer.finish();
      writer = null;
      finished = true;
      onProgress(1, end);
      return {
        result,
        stats: {
          strategy: 'mp4-keyframe-copy',
          copiedSeconds: end - start,
          boundaryPolicy: 'expand',
          boundaryTolerance: Infinity,
          shiftTolerance: 0,
          mode: 'forced',
          expectedAudio: !!expectedAudio,
          presentationDuration: capped.duration,
        },
      };
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error?.code === 'RANGE_SMART_UNSUPPORTED') throw error;
      throw unsupported(error?.message || 'MP4 無轉碼裁切失敗');
    } finally {
      active.delete(conversion);
      if (!finished) {
        await conversion?.cancel().catch(() => {});
        if (writer) {
          await writer.abort();
          await (disk.removeMediaFile ? disk.removeMediaFile(writer.path) : Promise.resolve()).catch(() => {});
        }
      }
    }
  }

  root.VideoPocketRangeMp4 = {
    tryCut,
    presentationDuration,
    inspectPresentation: presentationDuration,
    cancel() { for (const conversion of active) void conversion.cancel().catch(() => {}); },
  };
})(typeof self !== 'undefined' ? self : globalThis);
