// Coordinates requests that share one rate-limited server.
//
// Each request used to back off on its own, so a burst of N concurrent
// requests that hit a low shared limit (Confluence Data Center can allow as
// little as 3 requests per second) was rejected N times over, retried in
// lockstep, rejected again, and ran out of retries even though a patient
// client would have finished. Capping concurrency does not fix that: a fast
// server answers at once, so even one request at a time arrives faster than
// the limit. The gate paces request *starts* instead, and shares what it
// learns across every request the client makes:
//
//  - A throttled response pauses every request, not just the one that saw it.
//  - A new throttle doubles the minimum spacing between request starts, and
//    successes win the spacing back by halving it. A rejection from a burst
//    that was already in flight when the spacing last changed is stale: it
//    waits like the others but neither widens the spacing again nor uses up
//    its own retries.
//  - Without throttling there is no pause and no spacing: starts are released
//    back to back, so concurrency and throughput are untouched and the gate
//    only adds a microtask to each request.
//
// Waiting stays bounded: the spacing is capped, a request's own retries are
// capped by the caller, and so are the stale rejections it rides out.

// Spacing applied after the first throttle, and its ceiling.
const INITIAL_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 10000;
// Below this the spacing is dropped altogether.
const MIN_INTERVAL_MS = 50;
// Successes in a row (since the last throttle) before the spacing is halved.
const RECOVERY_SUCCESSES = 10;

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
    // Consecutive throttles without a success; scales the shared backoff.
    this.level = 0;
    // Bumped whenever the spacing widens. A request stamped with an older
    // epoch was sent before the change that its rejection would cause.
    this.epoch = 0;
    this.successes = 0;
  }

  // Wait for this request's turn to start, then for the shared pause and the
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
      for (;;) {
        const target = Math.max(this.pauseUntil, this.lastStart + this.intervalMs);
        if (target <= startAt) break;
        await this.sleep(target - startAt);
        startAt = target;
      }
      this.lastStart = Math.max(startAt, this.now());
      config.__gateEpoch = this.epoch;
    } finally {
      done();
    }
  }

  // Record a throttled response that will be retried after `delayMs`. Returns
  // `fresh` (whether it counts against the request's own retries) and `until`
  // (the pause it set, for `expire`).
  reportThrottle(config, delayMs) {
    const fresh = config.__gateEpoch === this.epoch;
    const until = Math.max(this.pauseUntil, this.now() + delayMs);
    this.pauseUntil = until;
    this.successes = 0;
    if (fresh) {
      this.epoch++;
      this.level++;
      this.intervalMs = this.intervalMs === 0
        ? INITIAL_INTERVAL_MS
        : Math.min(this.intervalMs * 2, MAX_INTERVAL_MS);
    }
    return { fresh, until };
  }

  // The caller that set the pause has waited it out itself; clear it unless
  // someone has extended it since.
  expire(until) {
    if (this.pauseUntil === until) this.pauseUntil = 0;
  }

  reportSuccess() {
    this.level = 0;
    if (this.intervalMs === 0) return;
    this.successes++;
    if (this.successes < RECOVERY_SUCCESSES) return;
    this.successes = 0;
    const next = this.intervalMs / 2;
    this.intervalMs = next < MIN_INTERVAL_MS ? 0 : next;
  }
}

module.exports = {
  RequestGate,
  INITIAL_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  RECOVERY_SUCCESSES
};
