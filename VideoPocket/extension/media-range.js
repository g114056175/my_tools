/* Range planning is deliberately independent of the network and ffmpeg. */

function invalid(message) {
  const error = new Error(message);
  error.code = 'RANGE_INVALID';
  return error;
}

export function normalizeRange(range, duration) {
  if (range == null) return null;
  if (!range || !Number.isFinite(duration) || duration < 0 ||
      !Number.isFinite(range.start) || !Number.isFinite(range.end) ||
      range.start < 0 || range.end <= range.start || range.end > duration) {
    throw invalid('區間必須是 0 <= start < end <= duration 的有限秒數');
  }
  return { start: range.start, end: range.end, duration };
}

function segmentWindow(segment, index, segments, prefix) {
  const duration = Number(segment.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  let start = Number.isFinite(Number(segment.start)) ? Number(segment.start) :
    Number.isFinite(Number(segment.presentationTime)) ? Number(segment.presentationTime) : NaN;
  if (!Number.isFinite(start)) {
    start = prefix[index];
  }
  return { start, end: start + duration };
}

function copySegment(segment, sourceIndex, start) {
  // A shallow copy keeps URI, key (including explicit IV), and map identity.
  return { ...segment, sourceIndex, start, selectedStart: start };
}

function byteWindow(segment) {
  const range = segment?.byterange;
  const offset = Number.isSafeInteger(range?.offset) ? range.offset : segment?.offset;
  const length = Number.isSafeInteger(range?.length) ? range.length : segment?.length;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0) return null;
  return { offset, length };
}

function mediaUri(segment) {
  return segment?.resolvedUri || segment?.uri || null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function mapIdentity(map) {
  return map == null ? null : JSON.stringify(stableValue(map));
}

function sourceIndices(segment) {
  if (Array.isArray(segment?.indices)) return segment.indices.slice();
  return segment?.sourceIndex == null ? [] : [segment.sourceIndex];
}

function canCoalesce(previous, next, maxBytes, maxDuration) {
  if (previous?.key != null || next?.key != null || mediaUri(previous) !== mediaUri(next)) return false;
  const a = byteWindow(previous), b = byteWindow(next);
  if (!a || !b || a.offset + a.length !== b.offset) return false;
  // A missing map means the segment inherits the preceding initialization map.
  // A newly introduced map must match the map already carried by the group.
  if (next.map != null && (previous.map == null || mapIdentity(previous.map) !== mapIdentity(next.map))) return false;
  const duration = Number(previous.duration) + Number(next.duration);
  const previousStart = Number(previous.start), nextStart = Number(next.start);
  if (Number.isFinite(nextStart) && (!Number.isFinite(previousStart) ||
      Math.abs(nextStart - (previousStart + Number(previous.duration))) > 1e-6)) return false;
  return a.length + b.length <= maxBytes && Number.isFinite(duration) && duration <= maxDuration;
}

/**
 * Coalesce adjacent selected SIDX media ranges without broadening the plan.
 * This is intentionally a pure planner operation; callers still own fetching.
 */
export function coalesceIndexedSegments(format, { maxBytes = 2 * 1024 * 1024, maxDuration = 30 } = {}) {
  if (!format || typeof format !== 'object') throw invalid('缺少 range format');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(maxDuration) || maxDuration <= 0) {
    throw invalid('coalesce 上限必須是正的有限數字');
  }
  const segments = Array.isArray(format.segments) ? format.segments : [];
  const result = { ...format, segments: segments.slice() };
  if (!format.rangeLimited || !format.index || segments.length < 2) return result;

  const coalesced = [];
  for (const segment of segments) {
    const previous = coalesced[coalesced.length - 1];
    if (!previous || !canCoalesce(previous, segment, maxBytes, maxDuration)) {
      coalesced.push(segment);
      continue;
    }
    const a = byteWindow(previous), b = byteWindow(segment);
    const merged = { ...previous, offset: a.offset, length: a.length + b.length,
      byterange: { offset: a.offset, length: a.length + b.length },
      duration: Number(previous.duration) + Number(segment.duration) };
    const indices = [...sourceIndices(previous), ...sourceIndices(segment)];
    if (indices.length) merged.indices = indices;
    if (Number.isFinite(previous.durationTicks) && Number.isFinite(segment.durationTicks)) {
      merged.durationTicks = previous.durationTicks + segment.durationTicks;
    }
    coalesced[coalesced.length - 1] = merged;
  }
  result.segments = coalesced;
  return result;
}

export function planSegmentRange(format, range) {
  if (!format || !Array.isArray(format.segments)) throw invalid('缺少可切片的 segments');
  const segments = format.segments;
  const duration = Number.isFinite(Number(format.duration)) ? Number(format.duration) :
    segments.reduce((n, s) => n + (Number(s.duration) || 0), 0);
  const normalized = normalizeRange(range, duration);
  if (!normalized) return null;
  const prefix = [0];
  for (const segment of segments) prefix.push(prefix[prefix.length - 1] + (Number(segment.duration) || 0));
  const windows = segments.map((s, i) => segmentWindow(s, i, segments, prefix));
  let first = windows.findIndex(w => w && w.end > normalized.start && w.start < normalized.end);
  if (first < 0) throw invalid('區間沒有可用片段');
  let last = -1;
  for (let i = first; i < windows.length; i++) if (windows[i] && windows[i].start < normalized.end) last = i;
  // A segment explicitly marked non-independent/non-SAP needs decode preroll.
  // Walk back across an explicitly unsafe run until its known independent/SAP
  // entry point. Unknown metadata keeps the ordinary segment-boundary behavior.
  const needsPreroll = segment => segment?.independent === false || segment?.startsWithSAP === false;
  if (needsPreroll(segments[first])) {
    let candidate = first - 1;
    const isSafeEntry = segment => segment?.independent === true || segment?.startsWithSAP === true;
    while (candidate >= 0 && !isSafeEntry(segments[candidate]) && needsPreroll(segments[candidate])) candidate--;
    if (candidate >= 0 && isSafeEntry(segments[candidate])) {
      first = candidate;
    }
  }
  const selected = segments.slice(first, last + 1).map((s, n) => copySegment(s, first + n, windows[first + n].start));
  // If the selected window starts after an init/map-bearing segment, carry that
  // map onto the first selected segment so downloadTrack still emits init data.
  if (!selected[0].map) {
    for (let i = first - 1; i >= 0; i--) if (segments[i].map) { selected[0].map = segments[i].map; break; }
  }
  const selectedStart = windows[first].start;
  const selectedEnd = windows[last].end;
  return {
    ...format,
    segments: selected,
    mediaSequence: (Number(format.mediaSequence) || 0) + first,
    duration: selectedEnd - selectedStart,
    selectedStart,
    selectedEnd,
    seekTimestamp: normalized.start - selectedStart,
    requestedRange: normalized,
    segmentOffset: first,
    rangeLimited: true
  };
}

function u64(view, offset) {
  const value = (BigInt(view.getUint32(offset)) << 32n) | BigInt(view.getUint32(offset + 4));
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}
function add(a, b) { return typeof a === 'bigint' || typeof b === 'bigint' ? BigInt(a) + BigInt(b) : a + b; }
function asNumber(value, name) {
  if ((typeof value === 'bigint' && value > BigInt(Number.MAX_SAFE_INTEGER)) || !Number.isSafeInteger(Number(value)) || Number(value)<0) throw new Error(`SIDX ${name} 超出安全整數範圍`);
  return Number(value);
}

export function parseSidx(input, absoluteOffset = 0) {
  if (!Number.isSafeInteger(absoluteOffset) || absoluteOffset < 0) throw new Error('SIDX absoluteOffset 必須是非負安全整數');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 32) throw new Error('SIDX 資料過短');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(0), type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
  if (type !== 'sidx') throw new Error('不是 SIDX box');
  let boxSize = size32, header = 8;
  if (size32 === 1) { if (bytes.byteLength < 16) throw new Error('SIDX extended size 遺失'); boxSize = asNumber(u64(view, 8), 'size'); header = 16; }
  if (boxSize === 0 || boxSize > bytes.byteLength || boxSize < header + 24) throw new Error('SIDX box 長度錯誤');
  const version = view.getUint8(header);
  if (version !== 0 && version !== 1) throw new Error('不支援的 SIDX version');
  if(boxSize<header+(version===1?32:24))throw new Error('SIDX header 長度錯誤');
  let p = header + 4;
  const referenceId = view.getUint32(p); p += 4;
  const timescale = view.getUint32(p); p += 4;
  if (!timescale) throw new Error('SIDX timescale 錯誤');
  const earliest = version === 0 ? view.getUint32(p) : u64(view, p); p += version === 0 ? 4 : 8;
  const firstOffset = version === 0 ? view.getUint32(p) : u64(view, p); p += version === 0 ? 4 : 8;
  p += 2;
  const count = view.getUint16(p); p += 2;
  if (p + count * 12 > boxSize) throw new Error('SIDX references 超出 box');
  const sidxOffset = absoluteOffset;
  const mediaStart = asNumber(add(add(sidxOffset, boxSize), firstOffset),'media offset');
  const segments = [];
  let offset = mediaStart, time = earliest;
  for (let i = 0; i < count; i++) {
    const word = view.getUint32(p); p += 4;
    const referenceType = word >>> 31, length = word & 0x7fffffff;
    if (referenceType !== 0) throw new Error('不支援 hierarchical SIDX');
    const durationTicks = view.getUint32(p); p += 4;
    if (length <= 0 || durationTicks <= 0) throw new Error('SIDX reference 長度或時間錯誤');
    const sap = view.getUint32(p); p += 4;
    const startsWithSAP = (sap >>> 31) === 1;
    const segment = { offset, length, byterange: { offset, length }, duration: durationTicks / timescale,
      durationTicks, start: asNumber(time, 'presentation time') / timescale,
      presentationTime: asNumber(time, 'presentation time') / timescale,
      startsWithSAP, sapType: (sap >>> 28) & 7, sapDeltaTime: sap & 0x0fffffff, referenceType };
    segments.push(segment);
    offset = asNumber(add(offset, length),'offset'); time = add(time, durationTicks);
  }
  return { version, referenceId, timescale, earliestPresentationTime: earliest, firstOffset,
    sidxOffset, sidxLength: boxSize, segments, duration: segments.reduce((n, s) => n + s.duration, 0) };
}

export function planIndexedRange(format, index, range) {
  if (!index || !Array.isArray(index.segments)) throw invalid('缺少 SIDX index');
  const duration = Number.isFinite(Number(format?.duration)) ? Number(format.duration) : index.duration;
  const normalized = normalizeRange(range, duration);
  if (!normalized) return null;
  const pseudo = { ...format, duration, segments: index.segments };
  const plan = planSegmentRange(pseudo, normalized);
  // SIDX SAP flags identify safe decode entry points. If the requested first
  // subsegment is not one, use the nearest preceding SAP and never fall back
  // to the beginning of a long presentation.
  const first = plan.segmentOffset;
  if (index.segments[first]?.startsWithSAP === false) {
    let safe = first - 1;
    while (safe >= 0 && index.segments[safe].startsWithSAP !== true) safe--;
    if (safe < 0) throw new Error('SIDX 區間沒有可用的 SAP 起點');
    const selected = index.segments.slice(safe, first).concat(plan.segments);
    plan.segments = selected;
    plan.segmentOffset = safe;
    plan.mediaSequence = (Number(format.mediaSequence) || 0) + safe;
    plan.selectedStart = Number(index.segments[safe].start);
    plan.duration = plan.selectedEnd - plan.selectedStart;
    plan.seekTimestamp = normalized.start - plan.selectedStart;
  }
  const init = format?.initRange || (Number.isFinite(index.sidxOffset) ? { offset: 0, length: index.sidxOffset } : null);
  if (!init || !Number.isSafeInteger(init.offset) || !Number.isSafeInteger(init.length) || init.offset < 0 || init.length <= 0) {
    throw new Error('SIDX 缺少初始化範圍，拒絕退回整檔下載');
  }
  const mediaUrl = format?.url || format?.resolvedUri;
  plan.segments = plan.segments.map((s, i) => {
    const segment = { ...s };
    if (mediaUrl) { segment.uri ||= mediaUrl; segment.resolvedUri ||= mediaUrl; }
    if (i === 0) {
      const map = format?.map ? { ...format.map } : { byterange: { ...init }, offset: init.offset, length: init.length };
      if (mediaUrl) { map.uri ||= mediaUrl; map.resolvedUri ||= mediaUrl; }
      segment.map = map;
    }
    return segment;
  });
  plan.initRange = { ...init };
  plan.index = index;
  return plan;
}
