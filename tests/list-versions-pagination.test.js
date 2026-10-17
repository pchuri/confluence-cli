// listVersions pagination: servers that cap the page size and advertise
// `_links.next`, strict forward-progress validation of that link, and the
// legacy Server/DC offset rule. Synthetic responses only; no live purge/delete.

const ConfluenceClient = require('../lib/confluence-client');

function versions(from, count) {
  return Array.from({ length: count }, (_, i) => ({
    number: from + i,
    when: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    by: { displayName: `User ${from + i}` },
    minorEdit: (from + i) % 2 === 0,
    message: `edit ${from + i}`
  }));
}

function notFound() {
  const err = new Error('Request failed with status code 404');
  err.response = { status: 404, data: {} };
  return err;
}

describe('listVersions pagination', () => {
  let client;

  beforeEach(() => {
    client = new ConfluenceClient({ domain: 'synthetic.example.invalid', token: 'synthetic-token' });
    client.client.delete = jest.fn(() => {
      throw new Error('listVersions must never delete');
    });
  });

  test('follows a capped Cloud page via _links.next start=100, then a final 25 (125 total)', async () => {
    client.client.get = jest.fn(async (url, { params }) => {
      if (params.start === 0) {
        return { data: { results: versions(1, 100), start: 0, limit: 100, size: 100,
          _links: { next: '/rest/api/content/123/version?limit=100&start=100' } } };
      }
      if (params.start === 100) {
        return { data: { results: versions(101, 25), start: 100, limit: 100, size: 25, _links: {} } };
      }
      throw new Error(`unexpected start ${params.start}`);
    });

    const list = await client.listVersions('123');

    expect(list).toHaveLength(125);
    expect(list[0].number).toBe(1);
    expect(list[124].number).toBe(125);
    expect(client.client.get.mock.calls.map(c => [c[0], c[1].params])).toEqual([
      ['/content/123/version', { start: 0, limit: 200 }],
      ['/content/123/version', { start: 100, limit: 200 }]
    ]);
  });

  test('uses only the numeric start of _links.next and never requests its host', async () => {
    client.client.get = jest.fn(async (url, { params }) => (params.start === 0
      ? { data: { results: versions(1, 100), _links: { next: 'https://other-host.example.invalid/rest/api/content/123/version?start=100' } } }
      : { data: { results: versions(101, 3) } }));

    const list = await client.listVersions('123');

    expect(list).toHaveLength(103);
    for (const call of client.client.get.mock.calls) {
      expect(call[0]).toBe('/content/123/version');
    }
  });

  test.each([
    ['without a start parameter', '/rest/api/content/123/version?limit=100'],
    ['with a non-numeric start', '/rest/api/content/123/version?start=abc'],
    ['for another page', '/rest/api/content/999/version?start=100'],
    ['for a different endpoint', '/rest/api/content/123/child/page?start=100'],
    ['that is empty', '']
  ])('rejects an unusable _links.next %s instead of treating history as complete', async (_label, next) => {
    client.client.get = jest.fn(async () => ({ data: { results: versions(1, 100), _links: { next } } }));
    await expect(client.listVersions('123')).rejects.toMatchObject({ code: 'CONFLUENCE_INCOMPLETE_VERSION_HISTORY' });
    expect(client.client.get).toHaveBeenCalledTimes(1);
  });

  test('rejects a backward or non-forward _links.next', async () => {
    client.client.get = jest.fn(async (url, { params }) => (params.start === 0
      ? { data: { results: versions(1, 100), _links: { next: '/rest/api/content/123/version?start=100' } } }
      : { data: { results: versions(101, 100), _links: { next: '/rest/api/content/123/version?start=50' } } }));
    await expect(client.listVersions('123')).rejects.toThrow(/does not move forward/);

    client.client.get = jest.fn(async () => ({
      data: { results: versions(1, 100), _links: { next: '/rest/api/content/123/version?start=0' } }
    }));
    await expect(client.listVersions('123')).rejects.toThrow(/does not move forward/);
  });

  test('rejects a cycle that repeats an earlier page', async () => {
    client.client.get = jest.fn(async (url, { params }) => ({
      data: {
        results: versions(1, 100),
        _links: { next: `/rest/api/content/123/version?start=${params.start + 100}` }
      }
    }));
    await expect(client.listVersions('123')).rejects.toThrow(/version 1 was returned twice/);
    expect(client.client.get).toHaveBeenCalledTimes(2);
  });

  test('rejects a _links.next that would skip versions', async () => {
    client.client.get = jest.fn(async () => ({
      data: { results: versions(1, 100), _links: { next: '/rest/api/content/123/version?start=150' } }
    }));
    await expect(client.listVersions('123')).rejects.toThrow(/would skip versions/);
  });

  test('rejects an empty page that still advertises a next page', async () => {
    client.client.get = jest.fn(async () => ({
      data: { results: [], _links: { next: '/rest/api/content/123/version?start=100' } }
    }));
    await expect(client.listVersions('123')).rejects.toThrow(/empty page/);
  });

  test('legacy Server/DC without _links.next: a full 200 page then 50 uses offset paging', async () => {
    client.client.get = jest.fn(async (url, { params }) => (params.start === 0
      ? { data: { results: versions(1, 200) } }
      : { data: { results: versions(201, 50) } }));

    const list = await client.listVersions('123');

    expect(list).toHaveLength(250);
    expect(client.client.get.mock.calls.map(c => c[1].params.start)).toEqual([0, 200]);
  });

  test('switches to the experimental path on 404 and keeps paging there with _links.next', async () => {
    const experimental = client.experimentalVersionUrl('123');
    client.client.get = jest.fn(async (url, { params }) => {
      if (url === '/content/123/version') throw notFound();
      if (url === experimental && params.start === 0) {
        return { data: { results: versions(1, 100).reverse(), _links: { next: '/rest/experimental/content/123/version?start=100&limit=100' } } };
      }
      if (url === experimental && params.start === 100) {
        return { data: { results: versions(101, 2) } };
      }
      throw new Error(`unexpected ${url} ${params.start}`);
    });

    const list = await client.listVersions('123');

    expect(client.client.get.mock.calls.map(c => [c[0], c[1].params.start])).toEqual([
      ['/content/123/version', 0],
      [experimental, 0],
      [experimental, 100]
    ]);
    expect(list.map(v => v.number)).toEqual(Array.from({ length: 102 }, (_, i) => i + 1));
    expect(list[0]).toEqual({ number: 1, when: expect.any(String), by: 'User 1', minorEdit: false, message: 'edit 1' });
    expect(list[1].minorEdit).toBe(true);
  });
});
