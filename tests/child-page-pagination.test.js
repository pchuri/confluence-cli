const fs = require('fs');
const os = require('os');
const path = require('path');
const MockAdapter = require('axios-mock-adapter');
const ConfluenceClient = require('../lib/confluence-client');
const { exportRecursive } = require('../bin/commands/export');

describe('child page pagination', () => {
  let client;
  let mock;
  let exportDir;

  const page = (id, parentId = '1') => ({
    id,
    title: `Page ${id}`,
    type: 'page',
    space: { key: 'ENG', name: 'Engineering' },
    version: { number: 2 },
    ancestors: [{ id: parentId, type: 'page', title: `Page ${parentId}` }]
  });

  // The server returns fewer children than the requested page size. The child
  // on the second page has its own descendant, which must also be traversed.
  const mockPaginatedTree = () => {
    mock.onGet('/content/1/child/page').reply(config => {
      if (config.params.start === 0) {
        return [200, {
          results: [page('2')],
          _links: { next: '/rest/api/content/1/child/page?start=1&limit=500' }
        }];
      }
      expect(config.params.start).toBe(1);
      return [200, { results: [page('3')], _links: {} }];
    });
    mock.onGet('/content/2/child/page').reply(200, { results: [] });
    mock.onGet('/content/3/child/page').reply(200, { results: [page('4', '3')] });
    mock.onGet('/content/4/child/page').reply(200, { results: [] });
  };

  beforeEach(() => {
    client = new ConfluenceClient({ domain: 'test.atlassian.net', token: 'test-token' });
    mock = new MockAdapter(client.client);
  });

  afterEach(() => {
    mock.restore();
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (exportDir) {
      fs.rmSync(exportDir, { recursive: true, force: true });
      exportDir = undefined;
    }
  });

  test.each([false, true])('follows every next offset and preserves options (includeAncestors=%s)', async includeAncestors => {
    const starts = [0, 7, 11];
    mock.onGet('/content/1/child/page').reply(config => {
      const index = starts.indexOf(config.params.start);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(config.params.limit).toBe(5);
      expect(config.params.expand).toBe(includeAncestors ? 'space,version,ancestors' : 'space,version');
      return [200, {
        results: [page(String(index + 2))],
        _links: index < starts.length - 1
          ? { next: `/rest/api/content/1/child/page?limit=5&start=${starts[index + 1]}` }
          : {}
      }];
    });

    const children = await client.getChildPages('1', 5, { includeAncestors });

    expect(children.map(child => child.id)).toEqual(['2', '3', '4']);
    expect(mock.history.get.map(request => request.params.start)).toEqual(starts);
    for (const child of children) {
      expect(child).toEqual(expect.objectContaining({ parentId: '1', depth: 1, spaceKey: 'ENG', version: 2 }));
      expect(child.ancestors).toEqual([{ id: '1', type: 'page', title: 'Page 1' }]);
    }
  });

  test('returns an empty list without requesting another page', async () => {
    mock.onGet('/content/1/child/page').reply(200, { results: [], _links: {} });

    await expect(client.getChildPages('1')).resolves.toEqual([]);
    expect(mock.history.get).toHaveLength(1);
  });

  test('stops without a next link even when the last page is full', async () => {
    mock.onGet('/content/1/child/page').reply(200, { results: [page('2'), page('3')] });

    const children = await client.getChildPages('1', 2);

    expect(children.map(child => child.id)).toEqual(['2', '3']);
    expect(mock.history.get).toHaveLength(1);
  });

  test('propagates later-page errors rather than returning incomplete children', async () => {
    mock.onGet('/content/1/child/page').reply(config => config.params.start === 0
      ? [200, { results: [page('2')], _links: { next: '?start=1' } }]
      : [403, { message: 'Forbidden' }]);

    await expect(client.getChildPages('1')).rejects.toMatchObject({ response: { status: 403 } });
    expect(mock.history.get).toHaveLength(2);
  });

  test('treats limit as a page size and retries a throttled later page', async () => {
    jest.useFakeTimers();
    let laterPageAttempts = 0;
    mock.onGet('/content/1/child/page').reply(config => {
      expect(config.params.limit).toBe(1);
      if (config.params.start === 0) {
        return [200, { results: [page('2')], _links: { next: '?start=1&limit=1' } }];
      }
      laterPageAttempts += 1;
      return laterPageAttempts === 1
        ? [429, {}, { 'retry-after': '1' }]
        : [200, { results: [page('3')] }];
    });

    const pending = client.getChildPages('1', 1);
    await jest.runAllTimersAsync();
    const children = await pending;

    expect(children.map(child => child.id)).toEqual(['2', '3']);
    expect(mock.history.get.map(request => request.params.start)).toEqual([0, 1, 1]);
  });

  test('recurses into later-page children with the correct parents, depths and options', async () => {
    mockPaginatedTree();

    const descendants = await client.getAllDescendantPages('1', 10, { includeAncestors: true });

    expect(descendants.map(({ id, parentId, depth }) => ({ id, parentId, depth }))).toEqual([
      { id: '2', parentId: '1', depth: 1 },
      { id: '3', parentId: '1', depth: 1 },
      { id: '4', parentId: '3', depth: 2 }
    ]);
    expect(mock.history.get.every(request => request.params.expand === 'space,version,ancestors')).toBe(true);
  });

  test('honors maxDepth after collecting all direct children', async () => {
    mockPaginatedTree();

    const descendants = await client.getAllDescendantPages('1', 1);

    expect(descendants.map(child => child.id)).toEqual(['2', '3']);
    expect(mock.history.get).toHaveLength(2);
    expect(mock.history.get.every(request => request.url === '/content/1/child/page')).toBe(true);
  });

  test('exports a later-page child and its descendants in the correct folders', async () => {
    mockPaginatedTree();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(client, 'getPageInfo').mockResolvedValue(page('1'));
    jest.spyOn(client, 'readPage').mockImplementation(async id => `# Content ${id}`);
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-pagination-'));

    await exportRecursive(client, fs, path, '1', {
      dest: exportDir,
      skipAttachments: true,
      delayMs: 0
    });

    const expectedFiles = [
      ['Page 1', '1'],
      ['Page 1/Page 2', '2'],
      ['Page 1/Page 3', '3'],
      ['Page 1/Page 3/Page 4', '4']
    ];
    for (const [folder, id] of expectedFiles) {
      expect(fs.readFileSync(path.join(exportDir, folder, 'page.md'), 'utf8')).toBe(`# Content ${id}`);
    }
    expect(client.readPage).toHaveBeenCalledTimes(4);
  });

  test('copies a later-page child and its descendants under their copied parents', async () => {
    mockPaginatedTree();
    jest.spyOn(client, 'getPageInfo').mockResolvedValue(page('1'));
    jest.spyOn(client, 'getPageForEdit').mockImplementation(async id => ({
      title: `Page ${id}`,
      content: `<p>Content ${id}</p>`
    }));
    jest.spyOn(client, 'createChildPage').mockImplementation(async title => ({
      id: `copy-${title.match(/\d+/)[0]}`,
      title
    }));

    const result = await client.copyPageTree('1', 'destination', null, { quiet: true, delayMs: 0 });

    expect(result.totalCopied).toBe(4);
    expect(result.failures).toEqual([]);
    expect(result.copiedPages.map(child => child.id)).toEqual(['copy-1', 'copy-2', 'copy-3', 'copy-4']);
    expect(client.createChildPage.mock.calls).toEqual([
      ['Page 1 (Copy)', 'ENG', 'destination', '<p>Content 1</p>', 'storage'],
      ['Page 2', 'ENG', 'copy-1', '<p>Content 2</p>', 'storage'],
      ['Page 3', 'ENG', 'copy-1', '<p>Content 3</p>', 'storage'],
      ['Page 4', 'ENG', 'copy-3', '<p>Content 4</p>', 'storage']
    ]);
  });
});
