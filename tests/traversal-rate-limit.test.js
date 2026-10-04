const MockAdapter = require('axios-mock-adapter');
const ConfluenceClient = require('../lib/confluence-client');

// A deterministic stand-in for a Data Center instance with a low shared rate
// limit. Time is virtual (jest fake timers), so a token bucket refilling at
// `ratePerSecond` is exact and the whole run takes milliseconds of real time.
describe('page tree traversal under a low shared rate limit (#261)', () => {
  const buildTree = (fanouts) => {
    const children = new Map();
    let nextId = 2;
    const grow = (id, depth) => {
      if (depth >= fanouts.length) return;
      const ids = Array.from({ length: fanouts[depth] }, () => String(nextId++));
      children.set(id, ids);
      ids.forEach((child) => grow(child, depth + 1));
    };
    grow('1', 0);
    return { children, total: nextId - 2 };
  };

  const startServer = (client, tree, { capacity, ratePerSecond, retryAfter = '0' }) => {
    const stats = { ok: 0, rejected: 0, rejectedTimes: [] };
    let tokens = capacity;
    let last = Date.now();
    const mock = new MockAdapter(client.client);
    mock.onGet(/\/content\/\d+\/child\/page$/).reply((config) => {
      const now = Date.now();
      tokens = Math.min(capacity, tokens + ((now - last) / 1000) * ratePerSecond);
      last = now;
      if (tokens < 1) {
        stats.rejected++;
        stats.rejectedTimes.push(now);
        return [429, {}, { 'retry-after': retryAfter }];
      }
      tokens -= 1;
      stats.ok++;
      const id = config.url.match(/content\/(\d+)\/child/)[1];
      const results = (tree.children.get(id) || []).map((childId) => ({
        id: childId,
        title: `Page ${childId}`,
        type: 'page',
        space: { key: 'ENG' },
        version: { number: 1 }
      }));
      return [200, { results }];
    });
    return { stats, mock };
  };

  // Advance virtual time until the promise settles, within a virtual budget.
  const settle = async (promise, budgetMs = 10 * 60 * 1000) => {
    let outcome = null;
    promise.then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
    const start = Date.now();
    while (outcome === null && Date.now() - start < budgetMs) {
      await jest.advanceTimersByTimeAsync(50);
    }
    if (outcome === null) throw new Error(`still running after ${budgetMs} virtual ms`);
    return { ...outcome, elapsedMs: Date.now() - start };
  };

  let client;
  beforeEach(() => {
    jest.useFakeTimers();
    client = new ConfluenceClient({ domain: 'wiki.example.org', token: 'test-token' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a 3 requests/second server does not exhaust retries on a 40-page tree', async () => {
    const tree = buildTree([4, 3, 2]);
    const { stats, mock } = startServer(client, tree, { capacity: 3, ratePerSecond: 3 });

    const result = await settle(client.getAllDescendantPages('1', 10));
    mock.restore();

    expect(result.error).toBeUndefined();
    expect(result.value).toHaveLength(tree.total);
    expect(new Set(result.value.map((page) => page.id)).size).toBe(tree.total);
    // Every page was listed once, and the rejections were a handful, not a storm.
    expect(stats.ok).toBe(tree.total + 1);
    expect(stats.rejected).toBeLessThan(tree.total / 2);
    // Within a small multiple of the time the limit itself requires.
    expect(result.elapsedMs).toBeLessThan((tree.total / 3) * 4 * 1000);
  });

  test.each([
    ['1 request/second with no burst', { capacity: 1, ratePerSecond: 1 }],
    ['2 requests/second', { capacity: 2, ratePerSecond: 2 }],
    ['a large burst but a low steady rate', { capacity: 10, ratePerSecond: 2 }],
    ['a positive Retry-After', { capacity: 3, ratePerSecond: 3, retryAfter: '1' }],
    ['no Retry-After header', { capacity: 3, ratePerSecond: 3, retryAfter: undefined }]
  ])('completes a wide and deep tree under %s', async (_label, limits) => {
    const tree = buildTree([6, 4, 3]);
    const { stats, mock } = startServer(client, tree, limits);

    const result = await settle(client.getAllDescendantPages('1', 10));
    mock.restore();

    expect(result.error).toBeUndefined();
    expect(result.value).toHaveLength(tree.total);
    expect(stats.ok).toBe(tree.total + 1);
    // No retry storm: far fewer rejected requests than pages.
    expect(stats.rejected).toBeLessThan(tree.total);
  });

  test('without a limit nothing is paced or delayed', async () => {
    const tree = buildTree([4, 3, 2]);
    const { stats, mock } = startServer(client, tree, { capacity: 1000, ratePerSecond: 1000 });

    const result = await settle(client.getAllDescendantPages('1', 10));
    mock.restore();

    expect(result.value).toHaveLength(tree.total);
    expect(stats.rejected).toBe(0);
    // Done within the first 50 ms step of virtual time: no pause, no spacing.
    expect(result.elapsedMs).toBeLessThanOrEqual(50);
  });

  test('a server that never lets a request through fails after bounded waiting', async () => {
    const tree = buildTree([4, 3, 2]);
    const { stats, mock } = startServer(client, tree, { capacity: 0, ratePerSecond: 0 });

    const result = await settle(client.getAllDescendantPages('1', 10));
    mock.restore();

    expect(result.error).toBeDefined();
    expect(result.error.response.status).toBe(429);
    // The error surfaces as before, after a bounded number of requests and time.
    expect(stats.ok).toBe(0);
    expect(stats.rejected).toBeLessThan(100);
    expect(result.elapsedMs).toBeLessThan(5 * 60 * 1000);
  });

  test('a throttled request makes concurrent requests wait for the same pause', async () => {
    const { stats, mock } = startServer(client, buildTree([]), { capacity: 1, ratePerSecond: 1, retryAfter: '3' });

    const results = await settle(Promise.all(Array.from({ length: 5 }, () => client.getChildPages('1'))));
    mock.restore();

    expect(results.error).toBeUndefined();
    // Nobody retried inside the 3 second window the server asked for.
    expect(stats.rejectedTimes.length).toBeGreaterThan(0);
    const first = stats.rejectedTimes[0];
    expect(stats.rejectedTimes.filter((time) => time > first && time < first + 3000)).toEqual([]);
  });
});
