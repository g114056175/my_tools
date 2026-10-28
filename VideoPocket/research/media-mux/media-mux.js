(function (root) {
  'use strict';

  const M = root.VideoPocketMediabunny;
  const inputFormats = [M.MP4, M.WEBM, M.MATROSKA, M.MPEG_TS, M.ADTS, M.OGG, M.MP3];
  const fail = (message, code = 'MERGE_FAILED') => Object.assign(new Error(message), { code });

  function outputFormat(extension) {
    switch (String(extension).toLowerCase()) {
      case 'mp4': case 'm4a': return new M.Mp4OutputFormat({ fastStart: false });
      case 'webm': return new M.WebMOutputFormat();
      case 'mkv': return new M.MkvOutputFormat();
      case 'ts': return new M.MpegTsOutputFormat();
      case 'aac': return new M.AdtsOutputFormat();
      case 'ogg': case 'opus': return new M.OggOutputFormat();
      case 'mp3': return new M.Mp3OutputFormat();
      default: throw fail(`不支援的輸出容器：${extension}`);
    }
  }

  function mapKinds(args) {
    const maps = [];
    for (let i = 0; i < args.length - 1; i++) if (args[i] === '-map') maps.push(String(args[i + 1]));
    return maps;
  }

  function wantsAudio(args) {
    if (args.some(arg => arg === '-an')) return false;
    const maps = mapKinds(args);
    return !maps.length || maps.some(map => /:a(?::|$)/.test(map));
  }

  function audioOptional(args) {
    return mapKinds(args).some(map => /:a(?::|$)/.test(map) && map.endsWith('?'));
  }

  function inputFor(inputs, kind) {
    return inputs.find(({ name }) => String(name).toLowerCase().startsWith(`${kind}.`)) || inputs[0];
  }

  async function readTrack(file, type, optional = false) {
    const input = new M.Input({ source: new M.BlobSource(file), formats: inputFormats });
    const track = type === 'video' ? await input.getPrimaryVideoTrack() : await input.getPrimaryAudioTrack();
    if (!track) { input.dispose(); if (optional) return null; throw fail(`來源沒有可用的${type === 'video' ? '視訊' : '音訊'}軌`); }
    const codec = await track.getCodec();
    const decoderConfig = await track.getDecoderConfig();
    if (!codec || !decoderConfig) { input.dispose(); throw fail(`無法辨識${type === 'video' ? '視訊' : '音訊'} codec`); }
    const primingPacket = !decoderConfig.description ? await new M.EncodedPacketSink(track).getFirstPacket() : null;
    return { input, track, codec, decoderConfig, primingPacket };
  }

  async function pump(trackInfo, source, signal, firstMeta, state) {
    let first = true;
    try {
      for await (const packet of new M.EncodedPacketSink(trackInfo.track).packets()) {
        if (signal?.aborted || state.failed || root.VideoPocketMediaMux?.cancelled) throw state.failed || new DOMException('已取消', 'AbortError');
        await source.add(packet, first ? firstMeta : undefined);
        first = false;
      }
    } finally {
      source.close();
    }
  }

  async function muxPacketCopy({ inputs, output, args, signal, scope, onInit }) {
    if (!Array.isArray(inputs) || !inputs.length) throw fail('沒有合併輸入');
    const extension = String(output).split('.').pop().toLowerCase();
    const wantsVideoTrack = !(args || []).some(arg => arg === '-vn');
    const wantsAudioTrack = wantsAudio(args || []);
    const audioIsOptional = audioOptional(args || []);
    const videoInput = inputFor(inputs, 'video');
    const audioInput = inputFor(inputs, 'audio');
    const started = globalThis.performance?.now?.() || Date.now();
    let videoInfo = null, audioInfo = null, access = null, mux = null, finished = false;
    try {
      videoInfo = wantsVideoTrack ? await readTrack(videoInput.file, 'video') : null;
      audioInfo = wantsAudioTrack ? await readTrack(audioInput.file, 'audio', audioIsOptional) : null;
      if (!videoInfo && !audioInfo) throw fail('來源沒有可用的影音軌');
      const format = outputFormat(extension);
      access = await root.VideoPocketDiskMedia.createSyncMediaFile(scope || 'media-mux', output);
      const writable = new WritableStream({
        write(chunk) {
          if (signal?.aborted || root.VideoPocketMediaMux?.cancelled) throw new DOMException('已取消', 'AbortError');
          const count = access.access.write(chunk.data, { at: chunk.position });
          if (count !== chunk.data.byteLength) throw fail('輸出檔案寫入不完整');
        },
      });
      const target = new M.StreamTarget(writable, { chunked: true, chunkSize: 1024 * 1024 });
      mux = new M.Output({ format, target });
      const videoSource = videoInfo && new M.EncodedVideoPacketSource(videoInfo.codec);
      const audioSource = audioInfo && new M.EncodedAudioPacketSource(audioInfo.codec);
      if (videoInfo) mux.addVideoTrack(videoSource, {
        decoderConfig: videoInfo.decoderConfig,
        ...(videoInfo.primingPacket ? { primingPacket: videoInfo.primingPacket } : {}),
      });
      if (audioInfo) mux.addAudioTrack(audioSource, {
        decoderConfig: audioInfo.decoderConfig,
        ...(audioInfo.primingPacket ? { primingPacket: audioInfo.primingPacket } : {}),
      });
      await mux.start();
      onInit?.({ elapsedMs: (globalThis.performance?.now?.() || Date.now()) - started });
      const state = { failed: null };
      const runPump = (info, source) => pump(info, source, signal, { decoderConfig: info.decoderConfig }, state).catch(error => { state.failed ||= error; throw error; });
      const pumps = [];
      if (videoInfo) pumps.push(runPump(videoInfo, videoSource));
      if (audioInfo) pumps.push(runPump(audioInfo, audioSource));
      const settled = await Promise.allSettled(pumps);
      const failure = settled.find(item => item.status === 'rejected');
      if (failure) throw failure.reason;
      await mux.finalize();
      const result = access.finish();
      finished = true;
      return result;
    } catch (error) {
      await mux?.cancel().catch(() => {});
      throw error;
    } finally {
      if (!finished) access?.abort();
      videoInfo?.input.dispose();
      audioInfo?.input.dispose();
    }
  }

  root.VideoPocketMediaMux = { muxPacketCopy, cancelled: false };
})(self);
