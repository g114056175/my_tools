// Direct file transfer with verified HTTP ranges. No page or player controls.
export const MAX_TRANSFER_BYTES = Infinity;

function rangeInfo(response) {
  const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
  return match ? {start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3])} : null;
}

function strongETag(value) {
  const tag = typeof value === 'string' ? value.trim() : '';
  return tag.length <= 4096 && /^"[\x21\x23-\x7E\x80-\xFF]*"$/.test(tag) ? tag : null;
}

function versionError(code, message) {
  return Object.assign(new Error(message), {code});
}

/**
 * Binds a set of byte ranges to the selected source version. Weak or absent
 * ETags leave the selected URL usable, but never authorize cross-URL mixing.
 */
export function createRangeVersionGuard({sourceUrl, url = sourceUrl, total, etag} = {}) {
  const pinnedUrl = sourceUrl ?? url;
  const pinnedSize = Number.isFinite(total) ? total : undefined;
  const validator = strongETag(etag);

  return Object.freeze({
    validator,
    headers() {
      return validator ? {'If-Range': validator} : {};
    },
    verify(requestUrl, response, expected = {}) {
      const sameSource = requestUrl === pinnedUrl;
      const mismatch = message => versionError(
        sameSource ? 'SOURCE_VERSION_CHANGED' : 'SOURCE_CANDIDATE_MISMATCH',
        message,
      );

      if (response.status >= 400) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (response.status !== 206) {
        throw mismatch('Range 來源版本已變更');
      }
      if (!validator && !sameSource) {
        throw mismatch('備援來源沒有可比對的檔案版本');
      }
      if (validator && strongETag(response.headers.get('etag')) !== validator) {
        throw mismatch('Range 來源版本已變更');
      }

      const range = rangeInfo(response);
      const expectedTotal = expected.total ?? pinnedSize;
      if (!range || (expectedTotal !== undefined && range.total !== expectedTotal)) {
        throw mismatch('Range 來源檔案大小已變更');
      }
      if ((expected.start !== undefined && range.start !== expected.start) ||
          (expected.end !== undefined && range.end !== expected.end)) {
        throw new Error('來源未提供正確的檔案範圍');
      }
      return range;
    },
  });
}

async function withReadDeadline(signal, timeoutMs, operation) {
  const stalled = new AbortController();
  const readSignal = AbortSignal.any([signal, stalled.signal]);
  const timed = async task => {
    readSignal.throwIfAborted();
    const timer = setTimeout(() => stalled.abort(new DOMException('來源持續沒有回傳資料', 'TimeoutError')), timeoutMs);
    try {
      return await task();
    } catch (error) {
      throw readSignal.aborted ? readSignal.reason : error;
    } finally {
      clearTimeout(timer);
    }
  };
  return operation(readSignal, timed);
}

async function read(response, signal, limit, onBytes = () => {}, timed = task => task()) {
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason || new Error('已取消');
      const {value, done} = await timed(() => reader.read());
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('來源檔案超過可處理的大小');
      parts.push(value);
      onBytes(value.length);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

async function streamToFile(response, signal, sink, onBytes, timed) {
  const reader = response.body.getReader();
  let size = 0;
  await sink.truncate(0);
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const {value, done} = await timed(() => reader.read());
      if (done) break;
      size += value.length;
      await sink.append(value);
      onBytes(value.length);
    }
    const expected = Number(response.headers.get('content-length'));
    if (expected > 0 && !response.headers.get('content-encoding') && size !== expected) {
      throw new Error('來源檔案長度不完整');
    }
    return await sink.finish();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

function errorHasStatus(error, statuses) {
  if (!error) return false;
  if ((error.code === 'HTTP_AUTH' && statuses.some(status => status === 401 || status === 403)) ||
      (error.code === 'HTTP_RATE_LIMIT' && statuses.includes(429))) return true;
  if (statuses.includes(Number(error.status ?? error.httpStatus))) return true;
  return Array.isArray(error.errors) && error.errors.some(item => errorHasStatus(item, statuses));
}

function hasCode(error, code) {
  if (!error) return false;
  if (error.code === code) return true;
  return Array.isArray(error.errors) && error.errors.some(item => hasCode(item, code));
}

export async function directTransfer(format, request, signal, onBytes = () => {}, sink, control, {readTimeoutMs = 20000} = {}) {
  const urls = [...new Set([format.url, ...(format.backupUrls || [])])].filter(Boolean);
  if (!urls.length) throw new Error('來源網址已失效');

  const transferController = new AbortController();
  const transferSignal = AbortSignal.any([signal, transferController.signal]);
  let fatalError;
  let progressBytes = 0;
  const reportBytes = delta => {
    progressBytes += delta;
    onBytes(delta);
  };
  const rollbackProgress = () => {
    if (!progressBytes) return;
    const rollback = progressBytes;
    progressBytes = 0;
    onBytes(-rollback);
  };
  const stopForVersionChange = error => {
    if (!fatalError) {
      fatalError = error?.code === 'SOURCE_VERSION_CHANGED'
        ? error
        : versionError('SOURCE_VERSION_CHANGED', '來源檔案版本已變更');
      transferController.abort(fatalError);
    }
    return fatalError;
  };
  const ensureActive = () => {
    if (fatalError) throw fatalError;
    if (signal.aborted) throw signal.reason || new Error('已取消');
    if (transferController.signal.aborted) throw transferController.signal.reason;
  };
  const run = (operation, extraSignal) => {
    ensureActive();
    const operationSignal = extraSignal ? AbortSignal.any([transferSignal, extraSignal]) : transferSignal;
    if (!control) {
      operationSignal.throwIfAborted();
      return operation(operationSignal);
    }

    const task = control.run(async attemptSignal => {
      ensureActive();
      return operation(AbortSignal.any([attemptSignal, transferController.signal, ...(extraSignal ? [extraSignal] : [])]));
    });
    let abort;
    const stopped = new Promise((_, reject) => {
      abort = () => reject(operationSignal.reason || new Error('已取消'));
      if (operationSignal.aborted) abort();
      else operationSignal.addEventListener('abort', abort, {once: true});
    });
    return Promise.race([task, stopped]).finally(() => operationSignal.removeEventListener('abort', abort));
  };

  // A small, bounded probe measures available routes and supplies exact length.
  // The first fully verified prefix wins and is reused for the transfer.
  const probeControllers = [];
  const ready = [];
  const probes = urls.slice(0, 3).map(async url => {
    const controller = new AbortController();
    probeControllers.push(controller);
    await request.waitForOrigin?.(url,AbortSignal.any([transferSignal,controller.signal]));
    const started = performance.now();
    const probeSignal = AbortSignal.any([transferSignal, controller.signal, AbortSignal.timeout(5000)]);
    const response = await request(url, {signal: probeSignal, headers: {Range: 'bytes=0-65535'}});
    const range = rangeInfo(response);
    if (response.status !== 206 || !range || range.total === null || range.start !== 0 || range.end >= range.total) {
      await response.body?.cancel();
      ready.push({url, ranged: false});
      throw new Error('來源未支援檔案範圍');
    }
    const prefix = await read(response, probeSignal, 65536);
    if (prefix.length !== range.end + 1) throw new Error('來源片段長度不完整');
    const result = {
      url,
      ranged: true,
      range,
      prefix,
      etag: strongETag(response.headers.get('etag')),
      elapsed: performance.now() - started,
    };
    ready.push(result);
    return result;
  });

  let selected;
  try {
    selected = await Promise.any(probes);
  } catch {}

  if (selected) for (const controller of probeControllers) controller.abort();
  ensureActive();

  if (!selected) {
    let firstError;
    const attemptUrls = [...ready.map(item => item.url), ...urls.filter(url => !ready.some(item => item.url === url))];
    for (const url of attemptUrls) {
      try {
        return await run(attemptSignal => withReadDeadline(attemptSignal, readTimeoutMs, async (readSignal, timed) => {
          await request.waitForOrigin?.(url,readSignal);
          const response = await timed(() => request(url, {signal: readSignal}));
          if (response.status >= 400) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          if (response.status === 206) throw new Error('來源未提供完整檔案');
          return sink
            ? await streamToFile(response, readSignal, sink, reportBytes, timed)
            : await read(response, readSignal, MAX_TRANSFER_BYTES, reportBytes, timed);
        }));
      } catch (error) {
        firstError ||= error;
        if (signal.aborted) throw error;
        rollbackProgress();
        if (errorHasStatus(error, [401, 403, 429])) throw error;
      }
    }
    throw firstError || new Error('來源下載失敗');
  }

  const total = selected.range.total;
  const output = sink ? null : new Uint8Array(total);
  const guard = createRangeVersionGuard({sourceUrl: selected.url, total, etag: selected.etag});
  if (sink) await sink.writeAt(selected.prefix, 0);
  else output.set(selected.prefix);
  ensureActive();
  reportBytes(selected.prefix.length);

  const chunkSize = 2 * 1024 * 1024;
  const parts = [];
  for (let start = selected.prefix.length; start < total; start += chunkSize) {
    parts.push({start, end: Math.min(total - 1, start + chunkSize - 1)});
  }

  // Only a strong, matching ETag makes another URL eligible for a byte range.
  const candidates = selected.etag
    ? [selected.url, ...urls.filter(url => url !== selected.url)]
    : [selected.url];
  let cursor = 0;
  let hedges = 0;
  const rangeBatchController = new AbortController();
  const rangeBatchAbort = Object.assign(new Error('同批範圍已停止'), {code: 'RANGE_BATCH_ABORTED'});
  let rangeFailure;
  const ensureRangeActive = () => {
    ensureActive();
    if (rangeFailure) throw rangeFailure;
    rangeBatchController.signal.throwIfAborted();
  };

  const partBytes = async (part, url, controller, attemptSignal = transferSignal, onRead = () => {}) => {
    return withReadDeadline(AbortSignal.any([attemptSignal, controller.signal]), readTimeoutMs, async (partSignal, timed) => {
      await request.waitForOrigin?.(url,partSignal);
      const headers = {Range: `bytes=${part.start}-${part.end}`, ...guard.headers(url)};
      const response = await timed(() => request(url, {signal: partSignal, headers}));
      try {
        const range = guard.verify(url, response, {start: part.start, end: part.end, total});
        const expectedSize = part.end - part.start + 1;
        const data = await read(response, partSignal, expectedSize, onRead, timed);
        if (data.length !== expectedSize) throw new Error('來源片段長度不完整');
        if (range.end - range.start + 1 !== expectedSize) throw new Error('來源未提供正確的檔案範圍');
        return data;
      } catch (error) {
        if (error?.code === 'SOURCE_VERSION_CHANGED') {
          const fatal = stopForVersionChange(error);
          await response.body?.cancel().catch(() => {});
          throw fatal;
        }
        await response.body?.cancel().catch(() => {});
        throw error;
      }
    });
  };

  const workers = Array.from({length: Math.min(4, parts.length)}, async () => {
    try {
      while (cursor < parts.length) {
        ensureRangeActive();
        const part = parts[cursor++];
        const controllers = [];
        const attemptProgress = new Map();
        let visibleBytes = 0;
        let attemptId = 0;
        const reportAttempt = (id, delta) => {
          if (fatalError) return;
          const previous = attemptProgress.get(id) || 0;
          const next = Math.max(0, previous + delta);
          attemptProgress.set(id, next);
          const aggregate = Math.max(0, ...attemptProgress.values());
          const visibleDelta = aggregate - visibleBytes;
          if (visibleDelta) {
            visibleBytes = aggregate;
            reportBytes(visibleDelta);
          }
        };
        const readAttempt = (url, controller, attemptSignal) => {
          const id = ++attemptId;
          const rangeSignal = AbortSignal.any([attemptSignal, rangeBatchController.signal]);
          return partBytes(part, url, controller, rangeSignal, bytes => reportAttempt(id, bytes)).catch(error => {
            const previous = attemptProgress.get(id) || 0;
            attemptProgress.delete(id);
            if (previous) reportAttempt(id, -previous);
            throw error;
          });
        };

        let data;
        let failure;
        await run(async attemptSignal => {
          const controller = new AbortController();
          controllers.push(controller);
          let timer;
          let startBackup;
          try {
            const primary = readAttempt(candidates[0], controller, attemptSignal);
            const noBackupForHttpFailure = error => errorHasStatus(error, [401, 403, 429]);
            if (candidates.length > 1) {
              let rejectBackup;
              const backup = new Promise((resolve, reject) => {
                rejectBackup = reject;
                startBackup = () => {
                  if (!startBackup) return;
                  if (transferSignal.aborted) {
                    startBackup = null;
                    reject(transferSignal.reason);
                    return;
                  }
                  if (hedges >= 2) {
                    timer = setTimeout(() => startBackup?.(), 200);
                    return;
                  }
                  startBackup = null;
                  clearTimeout(timer);
                  hedges++;
                  const backupController = new AbortController();
                  controllers.push(backupController);
                  readAttempt(candidates[1], backupController, attemptSignal)
                    .then(resolve, reject)
                    .finally(() => hedges--);
                };
                timer = setTimeout(() => startBackup?.(), 1200);
              });
              primary.catch(error => {
                if (noBackupForHttpFailure(error)) {
                  clearTimeout(timer);
                  startBackup = null;
                  rejectBackup(error);
                } else {
                  startBackup?.();
                }
              });
              data = await Promise.any([primary, backup]);
            } else {
              data = await primary;
            }
          } finally {
            clearTimeout(timer);
            startBackup = null;
            for (const activeController of controllers) activeController.abort();
          }
          ensureActive();
          return data;
        }, rangeBatchController.signal).catch(error => {
          failure = error;
        });

        ensureRangeActive();
        if (!data && !errorHasStatus(failure, [401, 403, 429])) {
          for (const url of candidates.slice(1)) {
            ensureRangeActive();
            try {
              data = await readAttempt(url, new AbortController(), transferSignal);
              break;
            } catch (error) {
              failure = error;
              if (signal.aborted || fatalError || rangeBatchController.signal.aborted) throw error;
              if (errorHasStatus(error, [401, 403, 429])) break;
            }
          }
        }
        if (!data) {
          if (hasCode(failure, 'SOURCE_CANDIDATE_MISMATCH')) {
            throw versionError('SOURCE_CANDIDATE_MISMATCH', '備援來源檔案版本不一致');
          }
          throw failure || new Error('來源片段下載失敗');
        }

        ensureRangeActive();
        if (sink) await sink.writeAt(data, part.start);
        else output.set(data, part.start);
        for (const activeController of controllers) activeController.abort();
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason || error;
      if (fatalError) throw fatalError;
      if (rangeFailure) throw rangeFailure;
      rangeFailure = error;
      rangeBatchController.abort(rangeBatchAbort);
      throw error;
    }
  });

  const results = await Promise.allSettled(workers);
  if (fatalError) {
    rollbackProgress();
    throw fatalError;
  }
  if (signal.aborted) {
    rollbackProgress();
    throw signal.reason || new Error('已取消');
  }
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) {
    const canRestartWholeFile = urls.length > 1 &&
      !errorHasStatus(rejected.reason, [401, 403, 429]) &&
      (!sink || (typeof sink.truncate === 'function' && typeof sink.append === 'function'));
    if (!canRestartWholeFile) {
      if (hasCode(rejected.reason, 'SOURCE_CANDIDATE_MISMATCH')) {
        throw versionError('SOURCE_VERSION_CHANGED', '備援來源檔案版本不一致');
      }
      throw rejected.reason;
    }

    // Every range worker has settled. Clear all partial bytes before a backup
    // is downloaded as one complete response, so unknown validators are safe.
    rollbackProgress();
    if (sink) await sink.truncate(0);
    else output.fill(0);
    const fallbackUrls = [...urls.filter(url => url !== selected.url), selected.url];
    let fallbackError;
    for (const url of fallbackUrls) {
      try {
        return await run(attemptSignal => withReadDeadline(attemptSignal, readTimeoutMs, async (readSignal, timed) => {
          await request.waitForOrigin?.(url,readSignal);
          const response = await timed(() => request(url, {signal: readSignal}));
          if (response.status >= 400) {
            const error = new Error(`HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          if (response.status === 206) throw new Error('來源未提供完整檔案');
          return sink
            ? await streamToFile(response, readSignal, sink, reportBytes, timed)
            : await read(response, readSignal, MAX_TRANSFER_BYTES, reportBytes, timed);
        }));
      } catch (error) {
        fallbackError ||= error;
        rollbackProgress();
        if (sink) await sink.truncate(0);
        if (signal.aborted) throw error;
        if (errorHasStatus(error, [401, 403, 429])) throw error;
      }
    }
    if (hasCode(rejected.reason, 'SOURCE_CANDIDATE_MISMATCH')) {
      throw versionError('SOURCE_VERSION_CHANGED', '備援來源檔案版本不一致');
    }
    throw fallbackError || rejected.reason;
  }
  ensureActive();
  return sink ? await sink.finish() : output;
}
