/* Small, stateful URL hedging helper for range/index requests. */

function abortReason(signal) {
  return signal?.reason || new DOMException('The operation was aborted', 'AbortError');
}

export function createIndexedRoutes(urls, { hedgeDelayMs = 1200, maxHedges = 2, dispose, retryOrigin, waitForRetryOrigin } = {}) {
  const candidates = [...new Set((Array.isArray(urls) ? urls : []).filter(url => typeof url === 'string' && url))];
  if (!Number.isFinite(hedgeDelayMs) || hedgeDelayMs < 0 || !Number.isInteger(maxHedges) || maxHedges < 0) {
    throw new TypeError('hedgeDelayMs/maxHedges 必須是有效的非負數');
  }
  let preferred = candidates[0];
  let activeHedges = 0;
  const hedgeWaiters = new Set();
  const retryOrigins = new Map();
  let retryEpoch = 0;

  function noteRetry(error) {
    if (typeof retryOrigin !== 'function' || typeof waitForRetryOrigin !== 'function') return false;
    let origin;
    try { origin = retryOrigin(error); } catch { return false; }
    if (typeof origin !== 'string' || !origin) return false;
    retryOrigins.set(origin, ++retryEpoch);
    return true;
  }

  async function waitForRetries(signal) {
    while (retryOrigins.size) {
      if (signal?.aborted) throw abortReason(signal);
      const epoch = retryEpoch;
      const origins = [...retryOrigins.keys()];
      const waiter = new AbortController();
      const waitSignal = signal ? AbortSignal.any([signal, waiter.signal]) : waiter.signal;
      try { await Promise.all(origins.map(origin => waitForRetryOrigin(origin, waitSignal))); }
      catch (error) { waiter.abort(error); throw error; }
      if (epoch !== retryEpoch) continue;
      for (const [origin, observedAt] of retryOrigins) if (observedAt <= epoch) retryOrigins.delete(origin);
    }
  }

  function discard(value) {
    if (typeof dispose !== 'function') return;
    try { Promise.resolve(dispose(value)).catch(() => {}); } catch { /* cleanup must not change the settled result */ }
  }

  const releaseHedge = () => {
    if (activeHedges >= maxHedges) return;
    const next = hedgeWaiters.values().next().value;
    if (!next) return;
    hedgeWaiters.delete(next);
    activeHedges++;
    queueMicrotask(next);
  };

  async function run(operation, signal) {
    if (typeof operation !== 'function') throw new TypeError('operation 必須是函式');
    if (!candidates.length) throw new Error('沒有可用的 indexed route');
    if (signal?.aborted) throw abortReason(signal);

    const ordered = preferred ? [preferred, ...candidates.filter(url => url !== preferred)] : candidates.slice();
    const controllers = new Map();
    const listeners = new Map();
    const errors = [];
    let started = 0, completed = 0, pending = 0, settled = false, timer, queuedWaiter;
    let resolveRun, rejectRun;
    const result = new Promise((resolve, reject) => { resolveRun = resolve; rejectRun = reject; });

    const clearTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    const cleanup = () => {
      clearTimer();
      if (signal && parentAbort) signal.removeEventListener('abort', parentAbort);
      for (const listener of listeners.values()) signal?.removeEventListener('abort', listener);
      listeners.clear();
      if (queuedWaiter) { hedgeWaiters.delete(queuedWaiter); queuedWaiter = undefined; }
    };
    const abortLosers = (winnerUrl) => {
      for (const [url, controller] of controllers) if (url !== winnerUrl) controller.abort();
    };
    const failIfDone = () => {
      if (settled || pending || started < ordered.length && started === 0) return;
      settled = true;
      cleanup();
      if (errors.length === 1) rejectRun(errors[0]);
      else {
        const aggregate = new AggregateError(errors, '所有 indexed routes 都失敗');
        aggregate.attempts = errors.slice();
        rejectRun(aggregate);
      }
    };
    const requestHedge = callback => {
      const waiter = () => { if (queuedWaiter === waiter) queuedWaiter = undefined; callback(); };
      if (activeHedges < maxHedges) { activeHedges++; waiter(); }
      else { queuedWaiter = waiter; hedgeWaiters.add(waiter); }
    };
    const schedule = () => {
      clearTimer();
      if (!settled && maxHedges > 0 && started < ordered.length && pending) timer = setTimeout(() => {
        timer = undefined;
        requestHedge(() => launch(true));
      }, hedgeDelayMs);
    };
    const launch = (isHedge = false) => {
      if (settled || signal?.aborted || started >= ordered.length) {
        if (isHedge) { activeHedges--; releaseHedge(); }
        return;
      }
      const url = ordered[started++]; pending++;
      const controller = new AbortController();
      controllers.set(url, controller);
      const parentAbort = () => controller.abort(signal.reason);
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', parentAbort, { once: true });
        listeners.set(controller.signal, parentAbort);
      }
      Promise.resolve().then(async () => {
        await waitForRetries(controller.signal);
        return operation(url, controller.signal);
      }).then(value => {
        completed++; pending--;
        if (isHedge) { activeHedges--; releaseHedge(); }
        listeners.delete(controller.signal);
        if (signal) signal.removeEventListener('abort', parentAbort);
        if (settled || signal?.aborted || controller.signal.aborted) { discard(value); return; }
        settled = true;
        cleanup();
        preferred = url;
        abortLosers(url);
        resolveRun({ value, url });
      }, error => {
        completed++; pending--;
        if (isHedge) { activeHedges--; releaseHedge(); }
        listeners.delete(controller.signal);
        if (signal) signal.removeEventListener('abort', parentAbort);
        if (settled) return;
        const retryObserved = noteRetry(error);
        if (retryObserved) clearTimer();
        errors.push(error);
        if (signal?.aborted) {
          settled = true; cleanup();
          rejectRun(abortReason(signal));
          return;
        }
        if (started < ordered.length) {
          if (pending) requestHedge(() => launch(true));
          else launch(false);
        } else failIfDone();
      });
      schedule();
    };
    let parentAbort;
    parentAbort = () => {
      if (settled) return;
      settled = true; cleanup();
      for (const controller of controllers.values()) controller.abort(signal.reason);
      rejectRun(abortReason(signal));
    };
    if (signal) signal.addEventListener('abort', parentAbort, { once: true });
    launch(false);
    return result;
  }

  const routes = { run };
  Object.defineProperty(routes, 'preferredUrl', { enumerable: true, get: () => preferred });
  return routes;
}
