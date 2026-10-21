/* The single policy used by inspection and range execution. */

export const RANGE_INDEX_MAX_BYTES = 131072;

const finitePositive = value => Number.isFinite(Number(value)) && Number(value) > 0;

/** Parse a DASH SegmentBase indexRange (inclusive byte offsets). */
export function parseByteRange(value) {
  if (value && Number.isSafeInteger(value.offset) && Number.isSafeInteger(value.length) &&
      value.offset >= 0 && value.length > 0 && value.offset <= Number.MAX_SAFE_INTEGER - (value.length - 1)) {
    return { offset: value.offset, length: value.length };
  }
  const match = String(value ?? '').match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (!match) return null;
  const offset = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || end < offset || !Number.isSafeInteger(end - offset + 1)) return null;
  return { offset, length: end - offset + 1 };
}

function reasonResult(supported, reason, kind = null) {
  return { supported, reason: supported ? null : reason, kind };
}

/** Decide whether one format can provide a precise range plan. */
export function formatRangeCapability(format, { maxIndexBytes = RANGE_INDEX_MAX_BYTES } = {}) {
  if (!format || typeof format !== 'object') return reasonResult(false, '缺少影音軌');
  if (Array.isArray(format.segments) && format.segments.length > 0) {
    if (!format.segments.every(segment => finitePositive(segment?.duration))) {
      return reasonResult(false, '影音片段缺少有效 duration', 'segments');
    }
    return reasonResult(true, null, 'segments');
  }
  const index = parseByteRange(format.indexRange);
  if (!index) return reasonResult(false, '影音軌缺少可用區間索引', 'sidx');
  if (!Number.isSafeInteger(maxIndexBytes) || maxIndexBytes <= 0 || index.length > maxIndexBytes) {
    return reasonResult(false, 'SIDX 索引超過探測上限', 'sidx');
  }
  return reasonResult(true, null, 'sidx');
}

/** Decide whether a selected video/audio plan is range-capable. */
export function planRangeCapability(plan, { duration, sabr = false, maxIndexBytes = RANGE_INDEX_MAX_BYTES } = {}) {
  if (!finitePositive(duration)) return reasonResult(false, '尚未取得完整影片長度');
  const formats = [plan?.video, plan?.audio].filter(Boolean);
  // Array.prototype.every([]) is true; an empty plan must not advertise support.
  if (!formats.length) return reasonResult(false, '計畫沒有可用影音軌');
  if (sabr) return reasonResult(true, null, 'sabr');
  for (const format of formats) {
    const result = formatRangeCapability(format, { maxIndexBytes });
    if (!result.supported) return result;
  }
  return reasonResult(true, null, 'plan');
}

/** Build the UI-facing capability maps for a resolved source. */
export function rangeCapability(source, capability, { maxIndexBytes = RANGE_INDEX_MAX_BYTES } = {}) {
  const duration = Number(source?.duration);
  const sabr = !!source?.sabr;
  const videoPlans = capability?.plans?.video?.auto || {};
  const audioPlans = capability?.plans?.audio?.original || {};
  const inspect = plan => planRangeCapability(plan, { duration, sabr, maxIndexBytes });
  const video = Object.fromEntries(Object.entries(videoPlans).map(([key, plan]) => [key, inspect(plan)]));
  const audio = Object.fromEntries(Object.entries(audioPlans).map(([key, plan]) => [key, inspect(plan)]));
  const all = [...Object.values(video), ...Object.values(audio)];
  const supported = all.some(value => value.supported);
  const failure = all.find(value => !value.supported);
  return {
    supported,
    duration: finitePositive(duration) ? duration : 0,
    precision: 'keyframe',
    plans: {
      video: Object.fromEntries(Object.entries(video).map(([key, value]) => [key, value.supported])),
      audio: Object.fromEntries(Object.entries(audio).map(([key, value]) => [key, value.supported]))
    },
    reason: supported ? null : (failure?.reason || '沒有可用的影音區間計畫')
  };
}
