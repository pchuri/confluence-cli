// Coordinates the requests of one client that share a rate-limited server.
//
// Each request used to back off on its own, so a burst of N concurrent
// requests that hit a low shared limit (Confluence Data Center can allow as
// little as 3 requests per second) was rejected N times over, retried in
// lockstep, rejected again, and ran out of retries even though a patient
// client would have finished. Capping concurrency does not fix that: a fast
// server answers at once, so even one request at a time arrives faster than
// the limit. The gate paces request *starts* instead, and shares what it
// learns across every request the client makes. It only ever sees 429
// responses; other retryable statuses keep their independent backoff.
//
//  - A positive Retry-After pauses every request, not just the one that saw
//    it. Without one (Data Center answers 429 with `Retry-After: 0`) there is
//    nothing to wait for, so only the spacing below changes.
//  - A new 429 doubles the minimum spacing between request starts, and each
//    success shrinks it again. A rejection from a burst that was already in
//    flight when the spacing last changed is stale: it neither widens the
//    spacing again nor uses up the request's own retries.
//  - After `maxFresh` new 429s with no success in between, the gate opens a
//    circuit: nothing more is retried or delayed until a request succeeds, so
//    a server that keeps refusing fails as fast as a single request would.
//  - Without throttling there is no pause and no spacing: starts are released
//    back to back, so concurrency and throughput are untouched and the gate
//    only adds a microtask to each request.

// Spacing applied after the first throttle, its ceiling, and the factor each
// success applies to it. Below MIN_INTERVAL_MS the spacing is dropped. The
// decay is deliberately memoryless: a 429 that has nothing to do with the
// request rate (a flaky proxy) is forgotten within a handful of successes
// instead of leaving the client throttled, and against a real limit the
// spacing settles around the server's pace, crossing it now and then.
const INITIAL_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 5000;
const SUCCESS_DECAY = 0.9;
const MIN_INTERVAL_MS = 25;

// The gate waits with its own timer, not ConfluenceClient.sleep, which a
// caller may stub to skip the per-request backoff.
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RequestGate {
  constructor({ now = () => Date.now(), sleep = defaultSleep } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.intervalMs = 0;
    this.lastStart = -Infinity;
    // Requests start one at a time, in arrival order.
    this.tail = Promise.resolve();
    this.pauseUntil = 0;
    // New 429s since the last success; scales a request's own backoff and
    // trips the circuit.
    this.level = 0;
    this.open = false;
    // Bumped whenever the spacing widens. A request stamped with an older
    // epoch was sent before the change that its rejection would cause.
    this.epoch = 0;
    // Successful responses so far; a request that sees this grow while it is
    // throttled knows the server is still making progress for others.
    this.successes = 0;
  }

  // Wait for this request's turn to start, then for any shared pause and the
  // spacing since the previous start. `config` is stamped so a rejection can
  // later be told apart as new or stale.
  async acquire(config) {
    const previous = this.tail;
    let done;
    this.tail = new Promise((resolve) => { done = resolve; });
    try {
      await previous;
      // Track the time waited until rather than re-reading the clock, so the
      // loop ends even if `sleep` returns early; it only repeats when the
      // pause was extended while this request slept.
      let startAt = this.now();
      while (!this.open) {
        const target = Math.max(this.pauseUntil, this.lastStart + this.intervalMs);
        if (target <= startAt) break;
        await this.sleep(target - startAt);
        startAt = target;
      }
      this.lastStart = Math.max(startAt, this.now());
      config.__gateEpoch = this.epoch;
      if (config.__gateSuccesses === undefined) config.__gateSuccesses = this.successes;
    } finally {
      done();
    }
  }

  // Record a 429 that may be retried. `pauseMs` is a positive Retry-After
  // (0 if there was none) and `maxFresh` how many new 429s in a row are
  // allowed before the circuit opens. Returns `retry` (false once the circuit
  // is open), `fresh` (a new 429 rather than one from a burst already in
  // flight), `progressed` (some request has succeeded since this one first
  // started, so the rejection is not evidence against it) and `until` (the
  // shared pause it set, for `expire`). Only a fresh rejection with no
  // progress should count against the request's own retries.
  reportThrottle(config, { pauseMs = 0, maxFresh = Infinity } = {}) {
    const fresh = config.__gateEpoch === this.epoch;
    const progressed = this.successes > (config.__gateSuccesses ?? this.successes);
    let until = 0;
    if (pauseMs > 0) {
      until = Math.max(this.pauseUntil, this.now() + pauseMs);
      this.pauseUntil = until;
    }
    if (fresh) {
      this.epoch++;
      this.level++;
      this.intervalMs = this.intervalMs === 0
        ? INITIAL_INTERVAL_MS
        : Math.min(this.intervalMs * 2, MAX_INTERVAL_MS);
      if (this.level >= maxFresh) {
        this.open = true;
        this.pauseUntil = 0;
      }
    }
    return { retry: !this.open, fresh, progressed, until };
  }

  // The caller that set the pause has waited it out itself; clear it unless
  // someone has extended it since.
  expire(until) {
    if (until && this.pauseUntil === until) this.pauseUntil = 0;
  }

  reportSuccess() {
    this.successes++;
    this.level = 0;
    this.open = false;
    if (this.intervalMs === 0) return;
    const next = this.intervalMs * SUCCESS_DECAY;
    this.intervalMs = next < MIN_INTERVAL_MS ? 0 : next;
  }
}

module.exports = {
  RequestGate,
  INITIAL_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  SUCCESS_DECAY
};
