const MockAdapter = require('axios-mock-adapter');
const ConfluenceClient = require('../lib/confluence-client');

const V2 = 'https://test.atlassian.net/wiki/api/v2';
const SPACE = { id: '9001', key: 'ENG', name: 'Engineering', type: 'global' };

function cloudClient(extra = {}) {
  return new ConfluenceClient({ domain: 'test.atlassian.net', token: 'test-token', apiPath: '/wiki/rest/api', ...extra });
}

function mockSpaces(mock) {
  mock.onGet(`${V2}/spaces`).reply(config => {
    const { keys } = config.params || {};
    return [200, { results: keys === SPACE.key ? [SPACE] : [] }];
  });
  mock.onGet(`${V2}/spaces/${SPACE.id}`).reply(200, SPACE);
}

function v2Page(overrides = {}) {
  return {
    id: '123',
    status: 'current',
    title: 'Page',
    spaceId: SPACE.id,
    parentId: '100',
    authorId: 'acct-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    version: { number: 3, createdAt: '2026-02-01T00:00:00.000Z', authorId: 'acct-2' },
    body: { storage: { representation: 'storage', value: '<p>Body</p>' } },
    _links: { webui: '/spaces/ENG/pages/123/Page', base: 'https://test.atlassian.net/wiki' },
    ...overrides
  };
}

describe('Confluence Cloud v2 page API', () => {
  let client;
  let mock;

  beforeEach(() => {
    client = cloudClient();
    mock = new MockAdapter(client.client);
    mockSpaces(mock);
  });

  afterEach(() => mock.restore());

  describe('API selection', () => {
    test('Cloud uses v2, Server/Data Center keeps v1', () => {
      expect(client.usesV2PageApi()).toBe(true);
      expect(new ConfluenceClient({ domain: 'wiki.example.com', token: 't' }).usesV2PageApi()).toBe(false);
    });

    test('OAuth gateway (api.atlassian.com) builds v2 URLs under /ex/confluence', () => {
      const scoped = new ConfluenceClient({
        domain: 'api.atlassian.com',
        token: 't',
        apiPath: '/ex/confluence/cloud-id/wiki/rest/api'
      });
      expect(scoped.usesV2PageApi()).toBe(true);
      expect(scoped.v2BaseUrl()).toBe('https://api.atlassian.com/ex/confluence/cloud-id/wiki/api/v2');
    });

    test('pageApi option and CONFLUENCE_PAGE_API override auto detection', () => {
      expect(cloudClient({ pageApi: 'v1' }).usesV2PageApi()).toBe(false);
      expect(new ConfluenceClient({ domain: 'wiki.example.com', token: 't', pageApi: 'v2' }).usesV2PageApi()).toBe(true);
      process.env.CONFLUENCE_PAGE_API = 'v1';
      try {
        expect(cloudClient().usesV2PageApi()).toBe(false);
      } finally {
        delete process.env.CONFLUENCE_PAGE_API;
      }
    });

    test('Server/Data Center still calls the v1 /content endpoint', async () => {
      const dc = new ConfluenceClient({ domain: 'wiki.example.com', token: 't' });
      const dcMock = new MockAdapter(dc.client);
      dcMock.onGet('/content/123').reply(200, { body: { storage: { value: '<p>v1</p>' } } });
      await expect(dc.readPage('123', 'storage')).resolves.toBe('<p>v1</p>');
      expect(dcMock.history.get).toHaveLength(1);
      dcMock.restore();
    });
  });

  describe('reading', () => {
    test('readPage requests the storage body from /pages/{id}', async () => {
      mock.onGet(`${V2}/pages/123`).reply(config => {
        expect(config.params).toEqual({ 'body-format': 'storage' });
        return [200, v2Page()];
      });
      await expect(client.readPage('123', 'storage')).resolves.toBe('<p>Body</p>');
    });

    test('readPage markdown resolves page links through the v2 title search', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page({
        body: { storage: { value: '<p>See <ac:link><ri:page ri:content-title="Other" /></ac:link></p>' } }
      }));
      mock.onGet(`${V2}/pages`).reply(config => {
        expect(config.params).toMatchObject({ 'space-id': SPACE.id, title: 'Other' });
        return [200, { results: [v2Page({ id: '456', title: 'Other', _links: { webui: '/spaces/ENG/pages/456/Other' } })] }];
      });
      await expect(client.readPage('123', 'markdown')).resolves.toBe(
        'See [Other](https://test.atlassian.net/wiki/spaces/ENG/pages/456/Other)'
      );
    });

    test('readPage markdown expands the children macro from /pages/{id}/children', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page({
        body: { storage: { value: '<ac:structured-macro ac:name="children" />' } }
      }));
      mock.onGet(`${V2}/pages/123/children`).reply(200, {
        results: [{ id: '7', title: 'Kid', spaceId: SPACE.id }]
      });
      const out = await client.readPage('123', 'markdown', { resolvePageLinks: false });
      expect(out).toBe('- [Kid](https://test.atlassian.net/wiki/spaces/ENG/pages/7)');
    });

    test('reading a folder id reports a clear no-body error', async () => {
      mock.onGet(`${V2}/pages/55`).reply(404);
      mock.onGet(`${V2}/folders/55`).reply(200, { id: '55', title: 'Dir', spaceId: SPACE.id, type: 'folder' });
      await expect(client.readPage('55', 'storage')).rejects.toThrow(/no readable body/);
    });

    test('a 404 that is neither page nor folder surfaces the original error', async () => {
      mock.onGet(`${V2}/pages/77`).reply(404, { message: 'gone' });
      mock.onGet(`${V2}/folders/77`).reply(404);
      await expect(client.readPage('77', 'storage')).rejects.toMatchObject({
        response: { status: 404, data: { message: 'gone' } }
      });
    });

    test('non-404 failures are not retried as folders', async () => {
      mock.onGet(`${V2}/pages/77`).reply(403);
      await expect(client.readPage('77', 'storage')).rejects.toMatchObject({ response: { status: 403 } });
      expect(mock.history.get.filter(r => r.url.includes('/folders/'))).toHaveLength(0);
    });

    test('getPageInfo normalizes space, version, author, parent and ancestors', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      mock.onGet(`${V2}/pages/123/ancestors`).reply(200, {
        results: [{ id: '1', type: 'page' }, { id: '100', type: 'page' }]
      });
      const info = await client.getPageInfo('123');
      expect(info).toMatchObject({
        id: '123',
        title: 'Page',
        spaceKey: 'ENG',
        space: { key: 'ENG', name: 'Engineering' },
        parentId: '100',
        version: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/123/Page'
      });
      expect(info.ancestors.map(a => a.id)).toEqual(['1', '100']);
      expect(info.author.accountId).toBe('acct-1');
    });

    test('getPageForEdit returns body, version and space', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      await expect(client.getPageForEdit('123')).resolves.toMatchObject({
        id: '123', title: 'Page', content: '<p>Body</p>', version: 3, space: { key: 'ENG' }
      });
    });

    test('display URLs resolve via space key and title', async () => {
      mock.onGet(`${V2}/pages`).reply(config => {
        expect(config.params).toMatchObject({ 'space-id': SPACE.id, title: 'My Page' });
        return [200, { results: [v2Page({ id: '999' })] }];
      });
      await expect(client.extractPageId('https://test.atlassian.net/wiki/display/ENG/My+Page')).resolves.toBe('999');
    });
  });

  describe('writing', () => {
    test('createPage resolves the space id and posts a v2 page', async () => {
      mock.onPost(`${V2}/pages`).reply(config => {
        expect(JSON.parse(config.data)).toEqual({
          spaceId: SPACE.id,
          title: 'New',
          status: 'current',
          body: { representation: 'storage', value: '<p>hi</p>' }
        });
        return [200, v2Page({ id: '500', title: 'New' })];
      });
      const result = await client.createPage('New', 'ENG', '<p>hi</p>', 'storage');
      expect(result).toMatchObject({
        id: '500',
        space: { key: 'ENG', name: 'Engineering' },
        version: { number: 3 },
        _links: { webui: '/spaces/ENG/pages/123/Page' }
      });
    });

    test('createChildPage sends parentId', async () => {
      mock.onPost(`${V2}/pages`).reply(config => {
        expect(JSON.parse(config.data)).toMatchObject({ spaceId: SPACE.id, parentId: '42', title: 'Kid' });
        return [200, v2Page({ id: '501', title: 'Kid', parentId: '42' })];
      });
      const result = await client.createChildPage('Kid', 'ENG', 42, '# Hello', 'markdown');
      expect(result.id).toBe('501');
      expect(JSON.parse(mock.history.post[0].data).body.value).toContain('<h1>Hello</h1>');
    });

    test('folders are created through /folders without a body', async () => {
      mock.onPost(`${V2}/folders`).reply(config => {
        expect(JSON.parse(config.data)).toEqual({ spaceId: SPACE.id, title: 'Dir', parentId: '42' });
        return [200, { id: '600', type: 'folder', title: 'Dir', spaceId: SPACE.id }];
      });
      const result = await client.createChildPage('Dir', 'ENG', '42', undefined, 'storage', 'folder');
      expect(result).toMatchObject({ id: '600', type: 'folder', space: { key: 'ENG' } });
      expect(result._links.webui).toBe('/spaces/ENG/folder/600');
    });

    test('creating in an unknown space fails before any write', async () => {
      await expect(client.createPage('T', 'NOPE', '<p>x</p>')).rejects.toThrow('Space not found: NOPE');
      expect(mock.history.post).toHaveLength(0);
    });

    test('updatePage bumps the version and keeps the title when omitted', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      mock.onPut(`${V2}/pages/123`).reply(config => {
        expect(JSON.parse(config.data)).toEqual({
          id: '123',
          status: 'current',
          title: 'Page',
          body: { representation: 'storage', value: '<p>new</p>' },
          version: { number: 4 }
        });
        return [200, v2Page({ version: { number: 4 } })];
      });
      const result = await client.updatePage('123', null, '<p>new</p>', 'storage');
      expect(result.version.number).toBe(4);
      expect(result._links.webui).toBe('/spaces/ENG/pages/123/Page');
    });

    test('updatePage without content re-sends the existing body', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      mock.onPut(`${V2}/pages/123`).reply(config => {
        expect(JSON.parse(config.data)).toMatchObject({ title: 'Renamed', body: { value: '<p>Body</p>' } });
        return [200, v2Page({ title: 'Renamed', version: { number: 4 } })];
      });
      await client.updatePage('123', 'Renamed', undefined);
      expect(mock.history.put).toHaveLength(1);
    });

    test('movePage sets parentId within the same space', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      mock.onGet(`${V2}/pages/200`).reply(200, v2Page({ id: '200' }));
      mock.onPut(`${V2}/pages/123`).reply(config => {
        expect(JSON.parse(config.data)).toMatchObject({ parentId: '200', title: 'Page', version: { number: 4 } });
        return [200, v2Page({ parentId: '200', version: { number: 4 } })];
      });
      await expect(client.movePage('123', '200')).resolves.toMatchObject({ version: { number: 4 } });
    });

    test('movePage refuses to cross spaces', async () => {
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      mock.onGet(`${V2}/pages/200`).reply(200, v2Page({ id: '200', spaceId: '9002' }));
      mock.onGet(`${V2}/spaces/9002`).reply(200, { id: '9002', key: 'OPS', name: 'Ops' });
      await expect(client.movePage('123', '200')).rejects.toThrow(/across spaces/);
      expect(mock.history.put).toHaveLength(0);
    });

    test('deletePage uses /pages and falls back to /folders on 404', async () => {
      mock.onDelete(`${V2}/pages/123`).reply(204);
      await expect(client.deletePage('123')).resolves.toEqual({ id: '123' });

      mock.onDelete(`${V2}/pages/55`).reply(404);
      mock.onDelete(`${V2}/folders/55`).reply(204);
      await expect(client.deletePage('55')).resolves.toEqual({ id: '55' });

      mock.onDelete(`${V2}/pages/66`).reply(404);
      mock.onDelete(`${V2}/folders/66`).reply(404);
      await expect(client.deletePage('66')).rejects.toMatchObject({ response: { status: 404 } });
    });
  });

  describe('spaces and children', () => {
    test('getSpaceMetadata looks the key up with /spaces?keys=', async () => {
      await expect(client.getSpaceMetadata('ENG')).resolves.toEqual({ key: 'ENG', name: 'Engineering', type: 'global' });
      await expect(client.getSpaceMetadata('NOPE')).resolves.toBeNull();
    });

    test('getSpaces follows cursors and honours the cap', async () => {
      const calls = [];
      mock.onGet(`${V2}/spaces`).reply(config => {
        calls.push(config.params);
        if (!config.params.cursor) {
          return [200, {
            results: [{ id: '1', key: 'A', name: 'A', type: 'global' }, { id: '2', key: 'B', name: 'B', type: 'global' }],
            _links: { next: '/wiki/api/v2/spaces?cursor=abc&limit=2' }
          }];
        }
        return [200, { results: [{ id: '3', key: 'C', name: 'C', type: 'personal' }] }];
      });
      const all = await client.getSpaces(null, { pageSize: 2 });
      expect(all.map(s => s.key)).toEqual(['A', 'B', 'C']);
      expect(calls).toEqual([{ limit: 2 }, { limit: 2, cursor: 'abc' }]);

      calls.length = 0;
      const capped = await client.getSpaces(1, { pageSize: 2 });
      expect(capped.map(s => s.key)).toEqual(['A']);
      expect(calls).toHaveLength(1);
    });

    test('getChildPages paginates by cursor and sets parent, space key and ancestors', async () => {
      mock.onGet(`${V2}/pages/10/ancestors`).reply(200, { results: [{ id: '1', type: 'page' }] });
      mock.onGet(`${V2}/pages/10/children`).reply(config => {
        if (!config.params.cursor) {
          return [200, {
            results: [{ id: '11', title: 'One', spaceId: SPACE.id }],
            _links: { next: '/wiki/api/v2/pages/10/children?cursor=c2' }
          }];
        }
        return [200, { results: [{ id: '12', title: 'Two', spaceId: SPACE.id }] }];
      });
      const children = await client.getChildPages(10, 1, { includeAncestors: true });
      expect(children.map(c => c.id)).toEqual(['11', '12']);
      expect(children[0]).toMatchObject({
        parentId: '10',
        spaceKey: 'ENG',
        url: 'https://test.atlassian.net/wiki/spaces/ENG/pages/11'
      });
      expect(children[1].ancestors.map(a => a.id)).toEqual(['1', '10']);
    });
  });

  describe('text encoding through markdown -> storage -> markdown', () => {
    const samples = {
      japanese: '日本語のテキストです。\n\nこれは二つ目の段落です。',
      fullWidthPunctuation: '「こんにちは」、世界！（テスト）：ＡＢＣ１２３～',
      emoji: 'Launch 🚀 with 👨‍👩‍👧‍👦 and 🏳️‍🌈 and 😀',
      boldAndCodeNextToCjk: '日本語**太字**です。`code`の直後や日本語`コード`日本語も。',
      lists: '- りんご\n- みかん 🍊\n  - 子要素\n\n1. 最初\n2. 次',
      table: '| 名前 | 説明 |\n| --- | --- |\n| 項目 | **強調**と`コード` |\n| 絵文字 | 😀🚀 |'
    };

    async function roundTrip(markdown) {
      const store = {};
      mock.onPost(`${V2}/pages`).reply(config => {
        store.body = JSON.parse(config.data).body.value;
        return [200, v2Page({ id: '700' })];
      });
      mock.onPut(`${V2}/pages/700`).reply(config => {
        store.body = JSON.parse(config.data).body.value;
        return [200, v2Page({ id: '700' })];
      });
      mock.onGet(`${V2}/pages/700`).reply(() => [200, v2Page({
        id: '700',
        body: { storage: { value: store.body } }
      })]);
      await client.createPage('Enc', 'ENG', markdown, 'markdown');
      const created = store.body;
      const read = await client.readPage('700', 'markdown', { resolveUsers: false, resolvePageLinks: false });
      // Writing the markdown we read back must be stable.
      await client.updatePage('700', null, read, 'markdown');
      return { storage: created, markdown: read, storageAgain: store.body };
    }

    test.each(Object.entries(samples))('%s survives the v2 round trip unchanged', async (_name, markdown) => {
      const { storage, markdown: read, storageAgain } = await roundTrip(markdown);
      expect(read.trim()).toBe(markdown);
      expect(storageAgain).toBe(storage);
      // The JSON request body must carry the characters, not escapes or replacement characters.
      expect(storage).not.toContain('�');
    });

    test('request bodies keep surrogate pairs and ZWJ sequences intact', async () => {
      const family = '👨‍👩‍👧‍👦';
      await roundTrip(`家族 ${family} です`).then(({ storage }) => {
        expect(storage).toContain(family);
        expect(Array.from(family)).toHaveLength(7);
      });
      const sent = mock.history.post[0].data;
      expect(JSON.parse(sent).body.value).toContain(family);
    });
  });
});
