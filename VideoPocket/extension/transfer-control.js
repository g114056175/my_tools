import {classifyFailure} from './diagnostics.js';
import {sharedHttpRequestPolicy} from './http-resilience.js';

const retryable = error => ['NETWORK_FAILURE', 'NETWORK_TIMEOUT', 'HTTP_RATE_LIMIT', 'HTTP_SERVER', 'INCOMPLETE_MEDIA'].includes(classifyFailure(error).code);
const retryError = error => error?.errors?.at?.(-1) || error;

function cancellableDelay(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, {once: true});
  });
}

// Only in-memory control: no download checkpoints survive a browser session.
export class TransferControl {
  constructor(signal, onState = () => {}, options = {}) {
    this.signal = signal;
    this.onState = onState;
    this.paused = false;
    this.waiters = new Set();
    this.interrupt = options.interrupt !== false;
    this.requestController = new AbortController();
    this.delay = options.delay ?? 500;
    this.attempts = options.attempts ?? 3;
    this.requestPolicy = options.requestPolicy || sharedHttpRequestPolicy;
    signal.addEventListener('abort', () => this.wake(), {once: true});
  }

  wake() {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  pause(state = 'paused') {
    if (this.signal.aborted) return;
    this.paused = true;
    if (this.interrupt) this.requestController.abort(Object.assign(new Error('下載已暫停'), {code: 'PAUSED'}));
    this.onState(state);
  }

  resume() {
    this.requestController = new AbortController();
    this.paused = false;
    this.wake();
    this.onState('running');
  }

  async wait() {
    while (this.paused && !this.signal.aborted) await new Promise(resolve => this.waiters.add(resolve));
    if (this.signal.aborted) throw this.signal.reason || new DOMException('已取消', 'AbortError');
  }

  async run(operation) {
    let attempt = 0;
    for (;;) {
      await this.wait();
      const signal = this.interrupt ? AbortSignal.any([this.signal, this.requestController.signal]) : this.signal;
      try {
        return await operation(signal);
      } catch (error) {
        if (this.signal.aborted) throw this.signal.reason || error;
        if (this.paused || signal.reason?.code === 'PAUSED') {
          await this.wait();
          attempt = 0;
          continue;
        }
        if (!retryable(error)) throw error;
        const rateLimit = this.requestPolicy.observe(retryError(error));
        if (attempt++ >= this.attempts) {
          this.pause('interrupted');
          await this.wait();
          await this.requestPolicy.waitForOrigin(rateLimit.origin, this.signal, {admission:false});
          attempt = 0;
          continue;
        }
        this.onState('retrying');
        await cancellableDelay(Math.min(5000, this.delay * 2 ** (attempt - 1)), this.signal);
        await this.requestPolicy.waitForOrigin(rateLimit.origin, this.signal, {admission:false});
        await this.wait();
        this.onState('running');
      }
    }
  }
}
