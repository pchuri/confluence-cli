const {
  RequestGate,
  INITIAL_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  RECOVERY_SUCCESSES
} = require('../lib/request-gate');

// A gate on a virtual clock: `sleep` advances time instead of waiting.
const makeGate = () => {
  const clock = { now: 0, sleeps: [] };
  const gate = new RequestGate({
    now: () => clock.now,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.now += ms;
    }
  });
  return { gate, clock };
};

const start = async (gate) => {
  const config = {};
  await gate.acquire(config);
  return config;
};

describe('RequestGate (#261)', () => {
  describe('without throttling', () => {
    test('starts are released back to back with no wait', async () => {
      const { gate, clock } = makeGate();
      const configs = await Promise.all(Array.from({ length: 50 }, () => start(gate)));

      expect(clock.sleeps).toEqual([]);
      expect(clock.now).toBe(0);
      expect(configs.every((config) => config.__gateEpoch === 0)).toBe(true);
    });

    test('successes change nothing', () => {
      const { gate } = makeGate();
      for (let i = 0; i < 100; i++) gate.reportSuccess();
      expect(gate.intervalMs).toBe(0);
      expect(gate.level).toBe(0);
    });
  });

  describe('a throttled response', () => {
    test('pauses every later start, not only the retrying request', async () => {
      const { gate, clock } = makeGate();
      const failed = await start(gate);
      gate.reportThrottle(failed, 2000);

      const others = await Promise.all([start(gate), start(gate), start(gate)]);

      expect(clock.now).toBeGreaterThanOrEqual(2000);
      expect(others).toHaveLength(3);
    });

    test('the first new throttle spaces starts and counts against the request', async () => {
      const { gate } = makeGate();
      const config = await start(gate);

      const result = gate.reportThrottle(config, 1000);

      expect(result.fresh).toBe(true);
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);
      expect(gate.level).toBe(1);
      expect(gate.epoch).toBe(1);
    });

    test('rejections from the same burst are stale: they neither widen the spacing nor count', async () => {
      const { gate } = makeGate();
      const burst = await Promise.all(Array.from({ length: 5 }, () => start(gate)));

      const results = burst.map((config) => gate.reportThrottle(config, 1000));

      expect(results.map((r) => r.fresh)).toEqual([true, false, false, false, false]);
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);
      expect(gate.level).toBe(1);
    });

    test('a rejection after the spacing changed is new again and doubles it', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate), 1000);
      gate.reportThrottle(await start(gate), 1000);
      gate.reportThrottle(await start(gate), 1000);

      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS * 4);
      expect(gate.level).toBe(3);
    });

    test('the spacing is capped', async () => {
      const { gate } = makeGate();
      for (let i = 0; i < 20; i++) gate.reportThrottle(await start(gate), 1);
      expect(gate.intervalMs).toBe(MAX_INTERVAL_MS);
    });

    test('starts are spaced by the interval', async () => {
      const { gate, clock } = makeGate();
      gate.reportThrottle(await start(gate), 0);
      gate.expire(gate.pauseUntil);
      const times = [];
      for (let i = 0; i < 4; i++) {
        await start(gate);
        times.push(clock.now);
      }

      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(INITIAL_INTERVAL_MS);
      }
    });

    test('expire clears the pause the caller set, but not one that was extended', async () => {
      const { gate } = makeGate();
      const config = await start(gate);
      const { until } = gate.reportThrottle(config, 1000);
      gate.expire(until);
      expect(gate.pauseUntil).toBe(0);

      const { until: first } = gate.reportThrottle(config, 1000);
      gate.reportThrottle(config, 5000);
      gate.expire(first);
      expect(gate.pauseUntil).toBeGreaterThan(first);
    });

    test('a sleep that returns early cannot trap acquire in a loop', async () => {
      const calls = [];
      const gate = new RequestGate({ now: () => 0, sleep: async (ms) => { calls.push(ms); } });
      gate.reportThrottle(await start(gate), 1000);

      await start(gate);

      expect(calls.length).toBeLessThan(5);
    });
  });

  describe('recovery', () => {
    test('a success resets the backoff level', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate), 1000);
      gate.reportSuccess();
      expect(gate.level).toBe(0);
    });

    test('the spacing is halved after enough successes in a row, then dropped', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate), 0);
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);

      for (let i = 0; i < RECOVERY_SUCCESSES - 1; i++) gate.reportSuccess();
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);
      gate.reportSuccess();
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS / 2);

      let guard = 0;
      while (gate.intervalMs !== 0 && guard++ < 1000) gate.reportSuccess();
      expect(gate.intervalMs).toBe(0);
      expect(INITIAL_INTERVAL_MS / 2 ** 3).toBeLessThan(MIN_INTERVAL_MS);
    });

    test('a throttle restarts the success count', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate), 0);
      for (let i = 0; i < RECOVERY_SUCCESSES - 1; i++) gate.reportSuccess();
      gate.reportThrottle(await start(gate), 0);
      gate.reportSuccess();
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS * 2);
    });
  });
});
