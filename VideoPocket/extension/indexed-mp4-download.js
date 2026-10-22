/* Indexed MP4 range downloader.  This file is intentionally usable from a
 * dedicated worker and from the QA harness; it contains no extension UI code. */
(function (root) {
  'use strict';
  const CHUNK = 256 * 1024;
  const MAX_CHUNKS = 16; // 4 MiB bounded LRU
  const check = signal => { if (signal?.aborted) throw signal.reason || Object.assign(new Error('已取消'), { code: 'CANCELLED' }); };

  function createIndexedMp4Reader({ M, format, readRange, signal, onBytes = () => {}, onRequest = () => {} }) {
    if (!M?.CustomSource || !Number.isSafeInteger(format?.filesize)||format.filesize<=0) throw Object.assign(new Error('普通 MP4 range source unavailable'), { code: 'RANGE_UNSUPPORTED' });
    const cache = new Map(), pending = new Map();
    const chunk = async index => {
      check(signal);
      if (cache.has(index)) { const value = cache.get(index); cache.delete(index); cache.set(index, value); return value; }
      if (pending.has(index)) return pending.get(index);
      const task = (async () => {
        const offset = index * CHUNK, length = Math.min(CHUNK, format.filesize - offset);
        onRequest({ index, offset, length });
        const value = await readRange(offset, length, signal);
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (bytes.byteLength !== length) throw new Error('MP4 range response length mismatch');
        onBytes(bytes.byteLength);
        cache.set(index, bytes);
        while (cache.size > MAX_CHUNKS) cache.delete(cache.keys().next().value);
        return bytes;
      })();
      pending.set(index, task);
      try { return await task; } finally { pending.delete(index); }
    };
    const source = new M.CustomSource({
      getSize: () => format.filesize,
      read: async (start, end) => {
        check(signal); start = Number(start); end = Number(end);
        if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||start<0||end>format.filesize)throw new Error('MP4 read range invalid');
        if(end-start>16*1024*1024)throw Object.assign(new Error('MP4 索引或封包超過單次讀取上限'),{code:'RANGE_UNSUPPORTED'});
        const first = Math.floor(start / CHUNK), last = Math.ceil(end / CHUNK), parts = [];
        for (let i = first; i < last; i++) parts.push(await chunk(i));
        const out = new Uint8Array(end - start); let at = 0;
        for (let i = first; i < last; i++) {
          const bytes = parts[i - first], from = i === first ? start - i * CHUNK : 0;
          const to = i === last - 1 ? end - i * CHUNK : bytes.length;
          out.set(bytes.subarray(from, to), at); at += to - from;
        }
        return out;
      }, maxCacheSize: CHUNK * MAX_CHUNKS, prefetchProfile: 'none'
    });
    return { source, cache, pending };
  }

  async function trackWindow(track, kind, range, signal) {
    const sink = new root.VideoPocketMediabunny.EncodedPacketSink(track);
    let first, last;
    if (kind === 'video') {
      first = await sink.getKeyPacket(range.start, { verifyKeyPackets: true }) || await sink.getFirstKeyPacket({ verifyKeyPackets: true });
      const endPacket = await sink.getPacket(range.end);
      // Keep the next keyframe: B-frame decode dependencies can straddle the UI end.
      last = endPacket && await sink.getNextKeyPacket(endPacket, { verifyKeyPackets: true });
    } else {
      first = await sink.getPacket(Math.max(0, range.start - .12)) || await sink.getFirstPacket();
      const endPacket = await sink.getPacket(range.end + .12);
      last = endPacket && await sink.getNextPacket(endPacket);
    }
    if (!first) throw new Error('來源片段缺少可解碼的起始封包');
    return { sink, first, last: last || undefined, base: first.timestamp };
  }

  async function downloadIndexedMp4({ format, range, signal, scope, kind = 'video', expectedAudio = true, readRange, onBytes, onRequest, onProgress=()=>{} }) {
    const M = root.VideoPocketMediabunny, disk = root.VideoPocketDiskMedia;
    if (!M || !disk) throw new Error('Mediabunny/OPFS runtime unavailable');
    const reader = createIndexedMp4Reader({ M, format, readRange, signal, onBytes, onRequest });
    const input = new M.Input({ source: reader.source, formats: [M.MP4] });
    let out, mux;
    try {
      const videoTrack = kind === 'audio' ? null : await input.getPrimaryVideoTrack();
      const audioTrack = expectedAudio || kind === 'audio' ? await input.getPrimaryAudioTrack() : null;
      if (kind === 'video' && !videoTrack) throw new Error('MP4 缺少影片軌');
      if (kind === 'video' && expectedAudio && !audioTrack) throw new Error('MP4 缺少音訊軌');
      if (kind === 'audio' && !audioTrack) throw new Error('MP4 缺少音訊軌');
      const video = videoTrack && { track: videoTrack, ...(await trackWindow(videoTrack, 'video', range, signal)), codec: await videoTrack.getCodec(), config: await videoTrack.getDecoderConfig() };
      const audio = audioTrack && { track: audioTrack, ...(await trackWindow(audioTrack, 'audio', range, signal)), codec: await audioTrack.getCodec(), config: await audioTrack.getDecoderConfig() };
      const tracks = [video, audio].filter(Boolean), base = Math.min(...tracks.map(t => t.base));
      out = await disk.createSyncMediaFile(scope, 'indexed.mp4');
      const target = new M.StreamTarget(new WritableStream({ write(chunk) { check(signal); if (out.access.write(chunk.data, { at: chunk.position }) !== chunk.data.byteLength) throw new Error('MP4 range output write incomplete'); } }), { chunked: true, chunkSize: 1024 * 1024 });
      mux = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: false }), target });
      const sources = tracks.map(t => {
        const source = t === video ? new M.EncodedVideoPacketSource(t.codec) : new M.EncodedAudioPacketSource(t.codec);
        mux[t === video ? 'addVideoTrack' : 'addAudioTrack'](source, { decoderConfig: t.config }); return source;
      });
      await mux.start();
      // Each track streams directly to the muxer. No packet array is retained.
      let pumpFailure;
      const pumps = tracks.map(async (t, i) => {
        try { for await (const packet of t.sink.packets(t.first, t.last)) { check(signal);if(pumpFailure)throw pumpFailure; await sources[i].add(packet.clone({ timestamp: packet.timestamp - base }), { decoderConfig: t.config });if(i===0)onProgress(Math.max(0,Math.min(.99,(packet.timestamp-base)/(range.end-base)))); } }
        catch (error) { pumpFailure ||= error; throw error; }
        finally { sources[i].close(); }
      });
      await Promise.allSettled(pumps);
      if (pumpFailure) throw pumpFailure;
      await mux.finalize(); const result = out.finish(); out = null;
      return { ...result, timelineStart: base, bytes: result.size };
    } catch (error) {
      await mux?.cancel?.().catch(() => {}); await out?.abort?.(); throw error;
    } finally { await input.dispose?.(); }
  }
  root.VideoPocketIndexedMp4 = { CHUNK_SIZE: CHUNK, MAX_CACHE_CHUNKS: MAX_CHUNKS, createIndexedMp4Reader, downloadIndexedMp4 };
})(typeof self !== 'undefined' ? self : globalThis);
