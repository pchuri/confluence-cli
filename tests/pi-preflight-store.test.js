const { createPreflightStore } = require('../lib/pi/preflight-store');

test('issues one-use approvals that expire after five minutes', () => {
  let now = 1_000;
  let sequence = 0;
  const store = createPreflightStore({
    now: () => now,
    randomId: () => `approval-${++sequence}`,
    ttlMs: 300_000,
  });

  const id = store.issue({ operation: 'confluence_copy_tree', inputHash: 'a', snapshotHash: 'b' });
  expect(store.consume(id)).toMatchObject({ operation: 'confluence_copy_tree' });
  expect(() => store.consume(id)).toThrow(/unknown|used/i);

  const expired = store.issue({ operation: 'confluence_versions_purge', inputHash: 'c', snapshotHash: 'd' });
  now += 300_001;
  expect(() => store.consume(expired)).toThrow(/expired/i);
});

test('binds each opaque approval id to the issued record', () => {
  let sequence = 0;
  const store = createPreflightStore({
    randomId: () => `approval-${++sequence}`,
    ttlMs: 300_000,
  });

  const copyTreeId = store.issue({ operation: 'confluence_copy_tree', inputHash: 'a', snapshotHash: 'b' });
  const purgeId = store.issue({ operation: 'confluence_versions_purge', inputHash: 'c', snapshotHash: 'd' });

  expect(store.consume(purgeId)).toEqual({ operation: 'confluence_versions_purge', inputHash: 'c', snapshotHash: 'd' });
  expect(store.consume(copyTreeId)).toEqual({ operation: 'confluence_copy_tree', inputHash: 'a', snapshotHash: 'b' });
  expect(() => store.consume(purgeId)).toThrow(/unknown|used/i);
});

test('tracks size, clear(), and reload invalidation', () => {
  let sequence = 0;
  const store = createPreflightStore({
    randomId: () => `approval-${++sequence}`,
    ttlMs: 300_000,
  });

  const first = store.issue({ operation: 'confluence_copy_tree', inputHash: 'a', snapshotHash: 'b' });
  const second = store.issue({ operation: 'confluence_versions_purge', inputHash: 'c', snapshotHash: 'd' });
  expect(store.size()).toBe(2);

  expect(store.consume(first)).toMatchObject({ operation: 'confluence_copy_tree' });
  expect(store.size()).toBe(1);

  store.clear();
  expect(store.size()).toBe(0);
  expect(() => store.consume(second)).toThrow(/unknown|used/i);

  const reloaded = createPreflightStore({
    randomId: () => 'approval-reloaded',
    ttlMs: 300_000,
  });
  expect(() => reloaded.consume(second)).toThrow(/unknown|used/i);
});
