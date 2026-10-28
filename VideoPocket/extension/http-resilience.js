const MAX_TIMER_DELAY_MS = 60_000;
const DEFAULT_MAX_ORIGINS = 128;
const DEFAULT_RELEASE_WINDOW_MS = 2_000;
const DEFAULT_RELEASE_INTERVAL_MS = 100;
const DEFAULT_MAX_PENDING_PER_ORIGIN = 128;

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.origin === 'null' ? null : url.origin;
  } catch {
    return null;
  }
}

function abortReason(signal) {
  return signal?.reason || new DOMException('已取消', 'AbortError');
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, Math.min(ms, MAX_TIMER_DELAY_MS)));
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/** Parse an HTTP Retry-After value into milliseconds; invalid values return null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  const httpDate = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/;
  if (!httpDate.test(text)) return null;
  const date = Date.parse(text);
  if (!Number.isFinite(date)) return null;
  const milliseconds = Math.max(0, date - now);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function retryAfterFromError(error, now) {
  if (error?.retryAfterMs !== undefined && error?.retryAfterMs !== null) {
    const milliseconds = Number(error.retryAfterMs);
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 0) return milliseconds;
  }
  const header = error?.retryAfter ?? error?.retryAfterHeader ?? error?.headers?.get?.('Retry-After');
  return parseRetryAfter(header, now);
}

/**
 * In-memory per-origin cooldown gate. Timers use bounded slices but always
 * wait through the full server deadline and can be aborted promptly.
 */
export function createHttpRequestPolicy({
  now = () => Date.now(),
  maxOrigins = DEFAULT_MAX_ORIGINS,
  releaseWindowMs = DEFAULT_RELEASE_WINDOW_MS,
  releaseIntervalMs = DEFAULT_RELEASE_INTERVAL_MS,
  maxPendingPerOrigin = DEFAULT_MAX_PENDING_PER_ORIGIN
} = {}) {
  const cooldowns = new Map();
  const capacity = Number.isSafeInteger(maxOrigins) && maxOrigins > 0 ? maxOrigins : DEFAULT_MAX_ORIGINS;
  const releaseWindow = Number.isSafeInteger(releaseWindowMs) && releaseWindowMs >= 0 ? releaseWindowMs : DEFAULT_RELEASE_WINDOW_MS;
  const releaseInterval = Number.isSafeInteger(releaseIntervalMs) && releaseIntervalMs > 0 ? releaseIntervalMs : DEFAULT_RELEASE_INTERVAL_MS;
  const pendingLimit = Number.isSafeInteger(maxPendingPerOrigin) && maxPendingPerOrigin > 0 ? maxPendingPerOrigin : DEFAULT_MAX_PENDING_PER_ORIGIN;
  const admissions = new Map();
  const unsupportedOrigins = new Map();
  const admittedSignals = new WeakMap();
  const admissionBusyError = Object.assign(new Error('來源等待請求過多，請稍後重試'), {code: 'HTTP_RETRY_ADMISSION_BUSY'});
  let overflowUntil = 0;
  let overflowAdmission = null;
  let unsupportedOverflowError = null;
  let generation = 0;

  function newAdmission(deadline) {
    return {deadline, releaseUntil: deadline + releaseWindow, nextAt: deadline, pending: 0, generation: ++generation};
  }

  function resetAdmission(state, deadline) {
    state.deadline = deadline;
    state.releaseUntil = deadline + releaseWindow;
    state.nextAt = deadline;
    state.generation = ++generation;
  }

  function safeUnsupportedError() {
    return Object.assign(new Error('無法安全處理伺服器要求的等待時間，已停止自動重試'), {code: 'HTTP_RETRY_AFTER_UNSUPPORTED'});
  }

  function markUnsupported(origin) {
    if (origin && unsupportedOrigins.has(origin)) return unsupportedOrigins.get(origin);
    if (origin && unsupportedOrigins.size < capacity) {
      const error = safeUnsupportedError();
      unsupportedOrigins.set(origin, error);
      return error;
    }
    unsupportedOverflowError ||= safeUnsupportedError();
    return unsupportedOverflowError;
  }

  function admissionFor(origin, deadline) {
    let state = admissions.get(origin);
    if (!state && admissions.size < capacity) {
      state = newAdmission(deadline);
      admissions.set(origin, state);
    } else if (!state) {
      if (!overflowAdmission) overflowAdmission = newAdmission(Math.max(deadline, overflowUntil));
      else if (deadline > overflowAdmission.deadline) resetAdmission(overflowAdmission, deadline);
      state = overflowAdmission;
    } else if (deadline > state.deadline) {
      resetAdmission(state, deadline);
    }
    return state;
  }

  function pruneExpired(at = now()) {
    for (const [origin, deadline] of cooldowns) if (deadline <= at) cooldowns.delete(origin);
    if (overflowUntil <= at) overflowUntil = 0;
    for (const [origin, state] of admissions) {
      if (state.releaseUntil <= at && state.pending === 0) admissions.delete(origin);
    }
    if (overflowAdmission?.releaseUntil <= at && overflowAdmission.pending === 0) overflowAdmission = null;
  }

  function wasAdmitted(signal, origin, state) {
    if (!signal) return false;
    const byOrigin = admittedSignals.get(signal);
    const previous = byOrigin?.get(origin);
    if (!previous) return false;
    if (previous.expiresAt <= now() || previous.state !== state || previous.generation !== state.generation) {
      byOrigin.delete(origin);
      return false;
    }
    byOrigin.delete(origin);
    byOrigin.set(origin, previous);
    return true;
  }

  function rememberAdmission(signal, origin, state) {
    if (!signal) return;
    let byOrigin = admittedSignals.get(signal);
    if (!byOrigin) admittedSignals.set(signal, byOrigin = new Map());
    byOrigin.delete(origin);
    byOrigin.set(origin, {state, generation: state.generation, expiresAt: state.releaseUntil});
    while (byOrigin.size > capacity) byOrigin.delete(byOrigin.keys().next().value);
  }

  function observe(error) {
    const raw = error?.errors?.at?.(-1) || error;
    const status = Number(raw?.httpStatus ?? raw?.status);
    const rateLimited = status === 429 || status === 503 || raw?.code === 'HTTP_RATE_LIMIT' || raw?.code === 'HTTP_SERVER';
    const origin = normalizeOrigin(raw?.requestOrigin);
    if (raw?.retryAfterUnsupported === true) {
      const failure = markUnsupported(origin);
      return {origin, retryAfterUnsupported: true, error: failure, retryAt: null};
    }
    const at = now();
    pruneExpired(at);
    const retryAfterMs = rateLimited ? retryAfterFromError(raw, at) : null;
    if (!origin || retryAfterMs === null) return {origin, retryAfterMs, retryAt: null};

    const retryAt = at + retryAfterMs;
    if (!Number.isSafeInteger(retryAt)) return {origin, retryAfterMs: null, retryAt: null};
    const currentDeadline = Math.max(cooldowns.get(origin) || 0, overflowUntil);
    const deadline = Math.max(currentDeadline, retryAt);
    if (!cooldowns.has(origin) && cooldowns.size >= capacity) {
      overflowUntil = Math.max(deadline, ...cooldowns.values());
      cooldowns.clear();
      admissions.clear();
      overflowAdmission = newAdmission(overflowUntil);
      return {origin, retryAfterMs, retryAt: overflowUntil};
    }
    if (retryAt > currentDeadline || !admissions.has(origin)) {
      cooldowns.set(origin, deadline);
      admissionFor(origin, deadline);
    }
    return {origin, retryAfterMs, retryAt: deadline};
  }

  async function waitForCooldown(origin, signal) {
    for (;;) {
      if (signal?.aborted) throw abortReason(signal);
      const unsupported = unsupportedOrigins.get(origin) || unsupportedOverflowError;
      if (unsupported) throw unsupported;
      pruneExpired();
      const deadline = Math.max(cooldowns.get(origin) || 0, overflowUntil);
      const at = now();
      if (deadline <= at) return;
      await sleep(deadline - at, signal);
    }
  }

  async function waitForOrigin(value, signal, {admission = true} = {}) {
    const origin = normalizeOrigin(value);
    if (!origin) return;
    const admittedHere = new Map();
    for (;;) {
      await waitForCooldown(origin, signal);
      if (!admission) return;
      pruneExpired();
      const at = now();
      const states = [admissions.get(origin), overflowAdmission].filter(Boolean);
      let admitted = false;
      for (const state of states) {
        if (admittedHere.get(state) === state.generation) continue;
        if (wasAdmitted(signal, origin, state)) continue;
        if (state.releaseUntil <= at && state.pending === 0) continue;
        if (state.pending >= pendingLimit) throw admissionBusyError;
        const slotAt = Math.max(now(), state.nextAt);
        state.nextAt = slotAt + releaseInterval;
        state.pending++;
        try {
          await sleep(slotAt - now(), signal);
        } finally {
          state.pending--;
          if (!state.pending && signal?.aborted) state.nextAt = Math.min(state.nextAt, now());
          pruneExpired();
        }
        if (signal?.aborted) throw abortReason(signal);
        if (Math.max(cooldowns.get(origin) || 0, overflowUntil) > now()) continue;
        rememberAdmission(signal, origin, state);
        admittedHere.set(state, state.generation);
        admitted = true;
        break;
      }
      if (admitted) continue;
      pruneExpired();
      if (Math.max(cooldowns.get(origin) || 0, overflowUntil) > now()) continue;
      return;
    }
  }

  return Object.freeze({
    observe,
    waitForOrigin,
    waitForCooldown(value, signal) {
      const origin = normalizeOrigin(value);
      return origin ? waitForCooldown(origin, signal) : Promise.resolve();
    },
    cooldownUntil(value) {
      const origin = normalizeOrigin(value);
      pruneExpired();
      return origin ? Math.max(cooldowns.get(origin) || 0, overflowUntil) : 0;
    },
    unsupportedError(value) {
      const origin = normalizeOrigin(value);
      return (origin && unsupportedOrigins.get(origin)) || unsupportedOverflowError || null;
    }
  });
}

// A shared default lets independent TransferControl instances coordinate retries.
export const sharedHttpRequestPolicy = createHttpRequestPolicy();
