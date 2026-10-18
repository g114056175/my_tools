/**
 * Download a bounded number of segments ahead of the consumer while preserving
 * the source order presented to consume().
 */
export async function assembleSegments(jobs, options = {}) {
  const list = Array.from(jobs || []);
  const concurrency = Math.max(1, Math.floor(Number(options.concurrency) || 4));
  if (typeof options.download !== 'function') throw new TypeError('download is required');
  if (typeof options.consume !== 'function') throw new TypeError('consume is required');

  const controller = new AbortController();
  const outer = options.signal;
  let primaryError = null;
  let abortWake;
  const abortPromise = new Promise(resolve => { abortWake = resolve; });
  const reason = () => controller.signal.reason || primaryError || new DOMException('已取消', 'AbortError');
  const abort = error => {
    if (!primaryError) primaryError = error;
    if (!controller.signal.aborted) controller.abort(error);
    abortWake(reason());
  };
  const onAbort = () => abort(outer.reason || new DOMException('已取消', 'AbortError'));
  if (outer?.aborted) onAbort();
  else outer?.addEventListener('abort', onAbort, {once: true});

  const pending = new Map();
  const settled = new Set();
  const completed = new Map();
  const disposed = new Set();
  let nextToSchedule = 0;
  let nextToConsume = 0;
  let maxPending = 0;

  const wait = async () => {
    if (controller.signal.aborted) throw reason();
    if (typeof options.wait !== 'function') return;
    await Promise.race([Promise.resolve().then(() => options.wait(controller.signal)), abortPromise]);
    if (controller.signal.aborted) throw reason();
  };

  const dispose = async (index, part) => {
    if (disposed.has(index)) return;
    disposed.add(index);
    if (typeof options.dispose === 'function') await options.dispose(part, index);
  };

  const launch = index => {
    const task = (async () => {
      await wait();
      const part = await options.download(list[index], index, controller.signal);
      completed.set(index, part);
    })().catch(error => {
      abort(error);
    }).finally(() => settled.add(index));
    pending.set(index, task);
    maxPending = Math.max(maxPending, pending.size);
  };

  try {
    while (nextToSchedule < list.length && pending.size < concurrency && !primaryError) launch(nextToSchedule++);

    while (nextToConsume < list.length && !primaryError) {
      if (!completed.has(nextToConsume)) {
        const active = [...pending.entries()].filter(([index]) => !settled.has(index)).map(([, task]) => task);
        if (!active.length) break;
        try { await Promise.race([...active, abortPromise]); }
        catch (error) { abort(error); break; }
        continue;
      }

      const index = nextToConsume;
      const part = completed.get(index);
      try {
        await wait();
        await options.consume(part, index);
      } catch (error) {
        abort(error);
        break;
      }
      try {
        await dispose(index, part);
      } catch (error) {
        abort(error);
        break;
      }
      completed.delete(index);
      pending.delete(index);
      settled.delete(index);
      nextToConsume++;
      while (nextToSchedule < list.length && pending.size < concurrency && !primaryError) launch(nextToSchedule++);
    }
  } finally {
    if (primaryError) controller.abort(primaryError);
    await Promise.allSettled([...pending.values()]);
    for (const [index, part] of completed) {
      try { await dispose(index, part); }
      catch (error) { if (!primaryError) primaryError = error; }
    }
    outer?.removeEventListener('abort', onAbort);
  }

  if (primaryError) throw primaryError;
  return {count: list.length, maxPending};
}
