const CHUNK = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_BOXES = 20000;
const MAX_STSD = 4 * 1024 * 1024;
const VIDEO = new Map([['avc1', 'h264'], ['avc3', 'h264'], ['hvc1', 'hevc'], ['hev1', 'hevc'], ['av01', 'av1'], ['vp09', 'vp9']]);
const AUDIO = new Map([['mp4a', 'aac'], ['Opus', 'opus'], ['enca', 'aac']]);
const text = bytes => String.fromCharCode(...bytes);
const u32 = bytes => (((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]);
const u64 = bytes => {
  const value = Number((BigInt(u32(bytes.subarray(0, 4))) << 32n) | BigInt(u32(bytes.subarray(4, 8))));
  return Number.isSafeInteger(value) ? value : null;
};

export async function readMp4Metadata(readRange, initial = new Uint8Array(), totalSize = initial.byteLength) {
  if (typeof readRange !== 'function' || !Number.isSafeInteger(totalSize) || totalSize < 8) return { videoCodec: '', audioCodec: '', drm: false };
  const seed = initial instanceof Uint8Array ? initial : new Uint8Array(initial);
  const cache = new Map();
  for(let at=0;at<Math.min(seed.byteLength,CHUNK*2);at+=CHUNK)cache.set(at,seed.subarray(at,Math.min(seed.byteLength,at+CHUNK)));
  const read = async (offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > totalSize || length > totalSize - offset) throw new Error('invalid MP4 range');
    if (!length) return new Uint8Array();
    const out = new Uint8Array(length);
    let copied = 0;
    while (copied < length) {
      const at = offset + copied;
      const base = Math.floor(at / CHUNK) * CHUNK;
      let chunk = cache.get(base);
      if (!chunk) {
        const got = await readRange(base, Math.min(CHUNK, totalSize - base));
        chunk = got instanceof Uint8Array ? got : new Uint8Array(got);
        if (chunk.byteLength > CHUNK || chunk.byteLength === 0) throw new Error('invalid MP4 range result');
        cache.set(base, chunk);
        while (cache.size > 2) cache.delete(cache.keys().next().value);
      }
      const from = at - base;
      const count = Math.min(chunk.byteLength - from, length - copied);
      if (count <= 0) throw new Error('short MP4 range');
      out.set(chunk.subarray(from, from + count), copied);
      copied += count;
    }
    return out;
  };
  const box = async offset => {
    const head = await read(offset, Math.min(16, totalSize - offset));
    if (head.byteLength < 8) return null;
    let size = u32(head.subarray(0, 4));
    const type = text(head.subarray(4, 8));
    let header = 8;
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = u64(head.subarray(8, 16));
      header = 16;
    } else if (size === 0) size = totalSize - offset;
    if (!size || size < header || size > totalSize - offset) return null;
    return { offset, size, header, type, end: offset + size, payload: offset + header };
  };
  const result = { videoCodec: '', audioCodec: '', drm: false };
  let boxCount = 0;
  let moovComplete = false;
  let hasVideoTrack = false;
  let hasAudioTrack = false;
  let completeTracks = true;
  const indexedTracks=[];
  let fragmented=false;
  const walk = async (start, end, depth, path = [], track = null) => {
    if (depth > MAX_DEPTH) return false;
    let offset = start;
    while (offset < end) {
      if (offset + 8 > end || boxCount++ >= MAX_BOXES) return false;
      const current = await box(offset);
      if (!current || current.end > end) return false;
      const nextPath = [...path, current.type];
      if(current.type==='mvex')fragmented=true;
      if(track&&path.at(-1)==='stbl'&&['stts','stsc','stco','co64','stsz'].includes(current.type)){
        // Inspect table headers only. Actual sample planning belongs to the
        // downloader's demuxer; never expand millions of samples during discovery.
        const bytes=await read(current.payload,Math.min(12,current.size-current.header));
        if(bytes.length>=8&&bytes[0]===0){
          const type=current.type,constant=type==='stsz'&&bytes.length>=12?u32(bytes.subarray(4,8)):0;
          const count=type==='stsz'&&bytes.length>=12?u32(bytes.subarray(8,12)):u32(bytes.subarray(4,8));
          const stride=type==='stts'||type==='co64'?8:type==='stsc'?12:4;
          const expected=(type==='stsz'?12:8)+(constant?0:count*stride);
          if(count>0&&expected===current.size-current.header)track.tables.add(type);
        }
      }
      if (current.type === 'stsd' && nextPath.includes('stbl')) {
        if (!(await sampleEntries(current))) return false;
        if (track) track.hasSampleEntries = true;
      }
      if (current.type === 'mvhd' && nextPath.length === 2) await movieHeader(current);
      if (current.type === 'hdlr' && track) {
        const bytes = await read(current.payload, Math.min(current.size - current.header, 12));
        if (bytes.byteLength < 12) return false;
        track.handler = text(bytes.subarray(8, 12));
        track.hasHandler = true;
      }
      if (current.type === 'trak') {
        const child = { handler: '', hasHandler: false, hasSampleEntries: false, tables:new Set() };
        if (!(await walk(current.payload, current.end, depth + 1, nextPath, child))) return false;
        if (!child.hasHandler || !child.hasSampleEntries) completeTracks = false;
        if (child.handler === 'vide') hasVideoTrack = true;
        if (child.handler === 'soun') hasAudioTrack = true;
        if(['vide','soun'].includes(child.handler))indexedTracks.push(child);
      } else if (['moov', 'mdia', 'minf', 'stbl'].includes(current.type)) {
        if (!(await walk(current.payload, current.end, depth + 1, nextPath, track))) return false;
      }
      offset = current.end;
    }
    return offset === end;
  };
  const sampleEntries = async current => {
    const payloadSize = current.size - current.header;
    if (payloadSize < 8 || payloadSize > MAX_STSD) return false;
    const bytes = await read(current.payload, payloadSize);
    if (bytes.byteLength < payloadSize || bytes.byteLength < 8) return false;
    const count = u32(bytes.subarray(4, 8));
    let at = 8, entries = 0;
    for (; entries < count && at + 8 <= bytes.byteLength; entries++) {
      const size = u32(bytes.subarray(at, at + 4));
      const kind = text(bytes.subarray(at + 4, at + 8));
      if (size < 8 || at + size > payloadSize) return false;
      const video = VIDEO.get(kind);
      const audio = AUDIO.get(kind);
      if (video) {
        result.videoCodec ||= video;
        if (at + 36 <= bytes.byteLength) result.videoHeight ||= (bytes[at + 34] << 8) | bytes[at + 35];
      }
      if (audio) result.audioCodec ||= audio;
      if (kind === 'encv' || kind === 'enca') result.drm = true;
      at += size;
    }
    return at === payloadSize && entries === count;
  };
  const movieHeader = async current => {
    const bytes = await read(current.payload, Math.min(current.size - current.header, 32));
    if (bytes.byteLength < 20) return;
    const version = bytes[0];
    const timescaleAt = version === 1 ? 20 : 12;
    const durationAt = version === 1 ? 24 : 16;
    if (bytes.byteLength >= durationAt + 8) {
      const timescale = u32(bytes.subarray(timescaleAt, timescaleAt + 4));
      const duration = version === 1 ? u64(bytes.subarray(durationAt, durationAt + 8)) : u32(bytes.subarray(durationAt, durationAt + 4));
      if (timescale && duration !== null) result.duration = duration / timescale;
    }
  };
  let offset = 0;
  while (offset + 8 <= totalSize && boxCount++ < MAX_BOXES) {
    const current = await box(offset);
    if (!current) break;
    if (current.type === 'moov') {
      moovComplete = await walk(current.payload, current.end, 1, ['moov']);
      if (moovComplete && completeTracks && hasVideoTrack && !hasAudioTrack) result.audioAbsent = true;
      if(moovComplete&&completeTracks&&!fragmented&&!result.drm&&indexedTracks.length&&indexedTracks.every(t=>
        ['stts','stsc','stsz'].every(k=>t.tables.has(k))&&(t.tables.has('stco')||t.tables.has('co64')))){
        result.mp4Index={video:hasVideoTrack?{duration:result.duration||0}:null,audio:hasAudioTrack?{duration:result.duration||0}:null};
      }
      return result;
    }
    offset = current.end;
  }
  return result;
}
