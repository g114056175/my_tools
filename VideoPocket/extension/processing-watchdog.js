const DEFAULT_TIMEOUT_MS = 120_000;
const PROCESSING_STAGES = new Set(['initializing', 'normalizing', 'cutting', 'validating']);

/**
 * Detects a stalled range-processing stage without imposing a total-duration cap.
 * Activity only renews the timer when the stage changes or its progress advances.
 */
export function createProcessingWatchdog({
  onTimeout = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const delay = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const lastProgress = new Map();
  let currentStage = null;
  let timer = null;
  let generation = 0;
  let stopped = false;

  const arm = () => {
    if (timer !== null) clearTimer(timer);
    const scheduledGeneration = ++generation;
    timer = setTimer(() => {
      if (stopped || scheduledGeneration !== generation) return;
      timer = null;
      stopped = true;
      generation++;
      const error = Object.assign(new Error('影音處理逾時'), {
        code: 'RANGE_PROCESSING_TIMEOUT',
        processingStage: currentStage || 'initializing',
      });
      onTimeout(error);
    }, delay);
  };

  arm();

  return Object.freeze({
    activity(stage, progress) {
      if (stopped || !PROCESSING_STAGES.has(stage)) return false;

      let meaningful = false;
      if (stage !== currentStage) {
        currentStage = stage;
        meaningful = true;
      }

      if (Number.isFinite(progress)) {
        const previous = lastProgress.get(stage);
        if (previous === undefined || progress > previous) {
          lastProgress.set(stage, progress);
          meaningful = true;
        }
      }

      if (meaningful) arm();
      return meaningful;
    },
    stop() {
      if (stopped) return false;
      stopped = true;
      generation++;
      if (timer !== null) clearTimer(timer);
      timer = null;
      return true;
    },
  });
}
