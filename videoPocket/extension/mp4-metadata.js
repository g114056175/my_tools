const CHUNK = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_BOXES = 20000;
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
  const walk = async (start, end, depth, path = []) => {
    if (depth > MAX_DEPTH) return;
    let offset = start;
    while (offset + 8 <= end && boxCount++ < MAX_BOXES) {
      const current = await box(offset);
      if (!current || current.end > end) return;
      const nextPath = [...path, current.type];
      if (current.type === 'stsd' && nextPath.includes('stbl')) await sampleEntries(current, nextPath);
      if (current.type === 'mvhd' && nextPath.length === 2) await movieHeader(current);
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(current.type)) await walk(current.payload, current.end, depth + 1, nextPath);
      offset = current.end;
    }
  };
  const sampleEntries = async current => {
    if (current.size < current.header + 8) return;
    const bytes = await read(current.payload, Math.min(current.size - current.header, CHUNK));
    if (bytes.byteLength < 8) return;
    const count = u32(bytes.subarray(4, 8));
    let at = 8;
    for (let index = 0; index < count && at + 8 <= bytes.byteLength; index++) {
      const size = u32(bytes.subarray(at, at + 4));
      const kind = text(bytes.subarray(at + 4, at + 8));
      if (size < 8 || at + size > current.size - current.header) return;
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
    if (current.type === 'moov') {await walk(current.payload, current.end, 1, ['moov']);return result;}
    offset = current.end;
  }
  return result;
}
