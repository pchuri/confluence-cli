const {
  RequestGate,
  INITIAL_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  SUCCESS_DECAY
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
      expect(gate.open).toBe(false);
    });
  });

  describe('a 429', () => {
    test('without a Retry-After spaces later starts but does not pause them', async () => {
      const { gate, clock } = makeGate();
      gate.reportThrottle(await start(gate), { pauseMs: 0 });

      await start(gate);

      // Only the spacing since the previous start, nowhere near a pause.
      expect(clock.now).toBeLessThanOrEqual(INITIAL_INTERVAL_MS);
    });

    test('with a Retry-After pauses every later start, not only the retrying request', async () => {
      const { gate, clock } = makeGate();
      gate.reportThrottle(await start(gate), { pauseMs: 2000 });

      const others = await Promise.all([start(gate), start(gate), start(gate)]);

      expect(clock.now).toBeGreaterThanOrEqual(2000);
      expect(others).toHaveLength(3);
    });

    test('the first new throttle spaces starts and counts against the request', async () => {
      const { gate } = makeGate();
      const result = gate.reportThrottle(await start(gate));

      expect(result).toMatchObject({ retry: true, fresh: true });
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);
      expect(gate.level).toBe(1);
      expect(gate.epoch).toBe(1);
    });

    test('rejections from the same burst are stale: they neither widen the spacing nor count', async () => {
      const { gate } = makeGate();
      const burst = await Promise.all(Array.from({ length: 5 }, () => start(gate)));

      const results = burst.map((config) => gate.reportThrottle(config));

      expect(results.map((r) => r.fresh)).toEqual([true, false, false, false, false]);
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);
      expect(gate.level).toBe(1);
    });

    test('a rejection after the spacing changed is new again and doubles it', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate));
      gate.reportThrottle(await start(gate));
      gate.reportThrottle(await start(gate));

      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS * 4);
      expect(gate.level).toBe(3);
    });

    test('the spacing is capped', async () => {
      const { gate } = makeGate();
      for (let i = 0; i < 20; i++) gate.reportThrottle(await start(gate));
      expect(gate.intervalMs).toBe(MAX_INTERVAL_MS);
    });

    test('starts are spaced by the interval', async () => {
      const { gate, clock } = makeGate();
      gate.reportThrottle(await start(gate));
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
      const { until } = gate.reportThrottle(config, { pauseMs: 1000 });
      gate.expire(until);
      expect(gate.pauseUntil).toBe(0);

      const { until: first } = gate.reportThrottle(config, { pauseMs: 1000 });
      gate.reportThrottle(config, { pauseMs: 5000 });
      gate.expire(first);
      expect(gate.pauseUntil).toBeGreaterThan(first);
      expect(gate.expire(0)).toBeUndefined();
    });

    test('a sleep that returns early cannot trap acquire in a loop', async () => {
      const calls = [];
      const gate = new RequestGate({ now: () => 0, sleep: async (ms) => { calls.push(ms); } });
      gate.reportThrottle(await start(gate), { pauseMs: 1000 });

      await start(gate);

      expect(calls.length).toBeLessThan(5);
    });
  });

  describe('recovery', () => {
    test('a success resets the backoff level', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate));
      gate.reportSuccess();
      expect(gate.level).toBe(0);
    });

    test('each success shrinks the spacing until it is dropped', async () => {
      const { gate } = makeGate();
      gate.reportThrottle(await start(gate));
      expect(gate.intervalMs).toBe(INITIAL_INTERVAL_MS);

      gate.reportSuccess();
      expect(gate.intervalMs).toBeCloseTo(INITIAL_INTERVAL_MS * SUCCESS_DECAY);

      let successes = 1;
      while (gate.intervalMs !== 0 && successes < 1000) {
        gate.reportSuccess();
        successes++;
      }
      expect(gate.intervalMs).toBe(0);
      // About a dozen successes bring the first throttle's spacing back to nothing.
      expect(successes).toBeLessThan(20);
      expect(INITIAL_INTERVAL_MS * SUCCESS_DECAY ** successes).toBeLessThan(MIN_INTERVAL_MS);
    });

    test('a throttle with a Retry-After pauses and also reports progress only when others succeeded', async () => {
      const { gate } = makeGate();
      const config = await start(gate);
      expect(gate.reportThrottle(config).progressed).toBe(false);

      gate.reportSuccess();

      expect(gate.reportThrottle(config).progressed).toBe(true);
    });

    test('isolated throttles do not ratchet the spacing up', async () => {
      const { gate } = makeGate();
      // A throttle every 20 requests, as a flaky proxy might produce.
      for (let round = 0; round < 50; round++) {
        gate.reportThrottle(await start(gate));
        for (let i = 0; i < 20; i++) gate.reportSuccess();
      }
      expect(gate.intervalMs).toBe(0);
    });
  });

  describe('the circuit', () => {
    test('opens after maxFresh new throttles with no success in between', async () => {
      const { gate } = makeGate();
      const results = [];
      for (let i = 0; i < 4; i++) {
        results.push(gate.reportThrottle(await start(gate), { maxFresh: 4 }));
      }

      expect(results.map((r) => r.retry)).toEqual([true, true, true, false]);
      expect(gate.open).toBe(true);
    });

    test('stale rejections do not count towards it', async () => {
      const { gate } = makeGate();
      const burst = await Promise.all(Array.from({ length: 10 }, () => start(gate)));

      burst.forEach((config) => gate.reportThrottle(config, { maxFresh: 3 }));

      expect(gate.open).toBe(false);
      expect(gate.level).toBe(1);
    });

    test('a success in between keeps it closed', async () => {
      const { gate } = makeGate();
      for (let i = 0; i < 20; i++) {
        gate.reportThrottle(await start(gate), { maxFresh: 3 });
        gate.reportThrottle(await start(gate), { maxFresh: 3 });
        gate.reportSuccess();
      }
      expect(gate.open).toBe(false);
    });

    test('while open nothing is paced or paused, and a success closes it', async () => {
      const { gate, clock } = makeGate();
      for (let i = 0; i < 3; i++) gate.reportThrottle(await start(gate), { pauseMs: 5000, maxFresh: 3 });
      expect(gate.open).toBe(true);
      const before = clock.now;

      await Promise.all([start(gate), start(gate), start(gate)]);
      expect(clock.now).toBe(before);

      gate.reportSuccess();
      expect(gate.open).toBe(false);
    });
  });
});
