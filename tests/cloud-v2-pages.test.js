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

    test('a 403 on /pages without any other match is reported as the auth error, not a 404', async () => {
      mock.onGet(`${V2}/pages/77`).reply(403);
      await expect(client.readPage('77', 'storage')).rejects.toMatchObject({ response: { status: 403 } });
    });

    test('5xx and network failures stop the search at once', async () => {
      mock.onGet(`${V2}/pages/77`).reply(404);
      mock.onGet(`${V2}/blogposts/77`).reply(500);
      await expect(client.readPage('77', 'storage')).rejects.toMatchObject({ response: { status: 500 } });
      expect(mock.history.get.filter(r => r.url.includes('/folders/'))).toHaveLength(0);
    });

    test('a folder is still found when the token lacks the blog post scope', async () => {
      mock.onGet(`${V2}/pages/55`).reply(404);
      mock.onGet(`${V2}/blogposts/55`).reply(401);
      mock.onGet(`${V2}/folders/55`).reply(200, { id: '55', title: 'Dir', spaceId: SPACE.id, parentId: '1' });
      mock.onGet(`${V2}/folders/55/ancestors`).reply(200, { results: [{ id: '1', type: 'page' }] });
      await expect(client.getPageInfo('55')).resolves.toMatchObject({ id: '55', type: 'folder', parentId: '1' });
    });

    test('a blog post is read with only the blog post scope (/pages answers 401)', async () => {
      mock.onGet(`${V2}/pages/88`).reply(401);
      mock.onGet(`${V2}/blogposts/88`).reply(200, v2Page({ id: '88', body: { storage: { value: '<p>blog</p>' } } }));
      await expect(client.readPage('88', 'storage')).resolves.toBe('<p>blog</p>');
    });

    test('when every collection is denied the auth error wins over a 404', async () => {
      mock.onGet(`${V2}/pages/55`).reply(404);
      mock.onGet(`${V2}/blogposts/55`).reply(401);
      mock.onGet(`${V2}/folders/55`).reply(404);
      await expect(client.readPage('55', 'storage')).rejects.toMatchObject({ response: { status: 401 } });
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

  describe('review follow-ups', () => {
    test('pagination follows a Link rel="next" header when the body has no next link', async () => {
      const seen = [];
      mock.onGet(`${V2}/spaces`).reply(config => {
        seen.push(config.params);
        if (!config.params.cursor) {
          return [200, { results: [{ id: '1', key: 'A', name: 'A', type: 'global' }] },
            { Link: '<https://evil.example/wiki/api/v2/spaces?cursor=c2&limit=1>; rel="next"' }];
        }
        return [200, { results: [{ id: '2', key: 'B', name: 'B', type: 'global' }] }];
      });
      const spaces = await client.getSpaces(null, { pageSize: 1 });
      expect(spaces.map(s => s.key)).toEqual(['A', 'B']);
      // only the cursor is taken from the header; the URL itself is never followed
      expect(seen).toEqual([{ limit: 1 }, { limit: 1, cursor: 'c2' }]);
      expect(mock.history.get.every(r => !r.url.includes('evil.example'))).toBe(true);
    });

    test('children pagination also reads the Link header', async () => {
      mock.onGet(`${V2}/pages/10/children`).reply(config => (config.params.cursor
        ? [200, { results: [{ id: '12', title: 'Two', spaceId: SPACE.id }] }]
        : [200, { results: [{ id: '11', title: 'One', spaceId: SPACE.id }] },
          { link: '</wiki/api/v2/pages/10/children?cursor=c2>; rel="next", </x>; rel="prev"' }]));
      const kids = await client.getChildPages(10, 1);
      expect(kids.map(k => k.id)).toEqual(['11', '12']);
    });

    test('child links use the listing _links.base through the OAuth gateway', async () => {
      const gateway = new ConfluenceClient({
        domain: 'api.atlassian.com',
        token: 't',
        apiPath: '/ex/confluence/cloud-id/wiki/rest/api',
        siteUrl: 'https://example.atlassian.net'
      });
      const gwMock = new MockAdapter(gateway.client);
      const gv2 = 'https://api.atlassian.com/ex/confluence/cloud-id/wiki/api/v2';
      gwMock.onGet(`${gv2}/spaces/${SPACE.id}`).reply(200, { ...SPACE, key: '~abc' });
      gwMock.onGet(`${gv2}/pages/1/children`).reply(200, {
        results: [{ id: '2', title: 'Kid', spaceId: SPACE.id }],
        _links: { base: 'https://tenant.atlassian.net/wiki' }
      });
      const [kid] = await gateway.getChildPages(1);
      expect(kid.url).toBe('https://tenant.atlassian.net/wiki/spaces/~abc/pages/2');
      gwMock.restore();
    });

    test('without a response base, child links use the configured siteUrl (never the gateway)', async () => {
      const gateway = new ConfluenceClient({
        domain: 'api.atlassian.com',
        token: 't',
        apiPath: '/ex/confluence/cloud-id/wiki/rest/api',
        siteUrl: 'https://example.atlassian.net'
      });
      const gwMock = new MockAdapter(gateway.client);
      const gv2 = 'https://api.atlassian.com/ex/confluence/cloud-id/wiki/api/v2';
      gwMock.onGet(`${gv2}/spaces/${SPACE.id}`).reply(200, SPACE);
      gwMock.onGet(`${gv2}/pages/1/children`).reply(200, { results: [{ id: '2', title: 'Kid', spaceId: SPACE.id }] });
      const [kid] = await gateway.getChildPages(1);
      expect(kid.url).toBe('https://example.atlassian.net/wiki/spaces/ENG/pages/2');
      gwMock.restore();
    });

    test('folder info reports its parent and ancestors from /folders/{id}/ancestors', async () => {
      mock.onGet(`${V2}/pages/55`).reply(404);
      mock.onGet(`${V2}/blogposts/55`).reply(404);
      mock.onGet(`${V2}/folders/55`).reply(200, {
        id: '55', title: 'Dir', spaceId: SPACE.id, parentId: '100', authorId: 'a', createdAt: '2026-01-01T00:00:00Z'
      });
      mock.onGet(`${V2}/folders/55/ancestors`).reply(200, { results: [{ id: '1', type: 'folder' }, { id: '100', type: 'page' }] });
      const info = await client.getPageInfo('55');
      expect(info).toMatchObject({ type: 'folder', parentId: '100', spaceKey: 'ENG' });
      expect(info.ancestors.map(a => a.id)).toEqual(['1', '100']);
    });

    test('folder info falls back to the record parentId when no ancestors are returned', async () => {
      mock.onGet(`${V2}/pages/55`).reply(404);
      mock.onGet(`${V2}/blogposts/55`).reply(404);
      mock.onGet(`${V2}/folders/55`).reply(200, { id: '55', title: 'Dir', spaceId: SPACE.id, parentId: '100' });
      mock.onGet(`${V2}/folders/55/ancestors`).reply(200, { results: [] });
      await expect(client.getPageInfo('55')).resolves.toMatchObject({ parentId: '100' });
    });

    test('ancestor chains longer than 250 continue from the highest ancestor, preserving order', async () => {
      const ids = n => Array.from({ length: n }, (_, i) => ({ id: String(1000 + i), type: i === 0 ? 'folder' : 'page' }));
      const upper = ids(250); // 1000..1249, first is a folder
      const lower = Array.from({ length: 250 }, (_, i) => ({ id: String(2000 + i), type: 'page' }));
      mock.onGet(`${V2}/pages/123`).reply(200, v2Page());
      mock.onGet(`${V2}/pages/123/ancestors`).reply(200, { results: lower });
      mock.onGet(`${V2}/pages/2000/ancestors`).reply(200, { results: upper });
      mock.onGet(`${V2}/folders/1000/ancestors`).reply(200, { results: [{ id: '1', type: 'page' }] });
      const info = await client.getPageInfo('123');
      expect(info.ancestors).toHaveLength(501);
      expect(info.ancestors[0].id).toBe('1');
      expect(info.ancestors[1].id).toBe('1000');
      expect(info.ancestors[500].id).toBe('2249');
    });

    test('read and info resolve blog post ids via /blogposts/{id}', async () => {
      mock.onGet(`${V2}/pages/88`).reply(404);
      mock.onGet(`${V2}/blogposts/88`).reply(() => {
        return [200, v2Page({ id: '88', title: 'Post', body: { storage: { value: '<p>blog</p>' } },
          _links: { webui: '/spaces/ENG/blog/2026/01/01/88/Post', base: 'https://test.atlassian.net/wiki' } })];
      });
      await expect(client.readPage('88', 'storage')).resolves.toBe('<p>blog</p>');
      const blogRead = mock.history.get.find(r => r.url.endsWith('/blogposts/88'));
      expect(blogRead.params).toEqual({ 'body-format': 'storage' });
      const info = await client.getPageInfo('88');
      expect(info).toMatchObject({ id: '88', type: 'blogpost', title: 'Post', spaceKey: 'ENG' });
      expect(info.url).toBe('https://test.atlassian.net/wiki/spaces/ENG/blog/2026/01/01/88/Post');
    });

    test('a custom domain with forceCloud routes to v2', async () => {
      const custom = new ConfluenceClient({
        domain: 'wiki.example.org', token: 't', apiPath: '/wiki/rest/api', forceCloud: true
      });
      const customMock = new MockAdapter(custom.client);
      customMock.onGet('https://wiki.example.org/wiki/api/v2/pages/1').reply(200, v2Page({ id: '1' }));
      await expect(custom.readPage('1', 'storage')).resolves.toBe('<p>Body</p>');
      customMock.restore();
    });

    test('deletePage reaches a folder even without delete:page or delete:blogpost', async () => {
      mock.onDelete(`${V2}/pages/55`).reply(403);
      mock.onDelete(`${V2}/blogposts/55`).reply(403);
      mock.onDelete(`${V2}/folders/55`).reply(204);
      await expect(client.deletePage('55')).resolves.toEqual({ id: '55' });

      mock.onDelete(`${V2}/pages/56`).reply(403);
      mock.onDelete(`${V2}/blogposts/56`).reply(404);
      mock.onDelete(`${V2}/folders/56`).reply(404);
      await expect(client.deletePage('56')).rejects.toMatchObject({ response: { status: 403 } });
    });

    test('title search links use the response _links.base through the gateway', async () => {
      const gateway = new ConfluenceClient({
        domain: 'api.atlassian.com',
        token: 't',
        apiPath: '/ex/confluence/cloud-id/wiki/rest/api'
      });
      const gwMock = new MockAdapter(gateway.client);
      const gv2 = 'https://api.atlassian.com/ex/confluence/cloud-id/wiki/api/v2';
      gwMock.onGet(`${gv2}/spaces`).reply(200, { results: [SPACE] });
      gwMock.onGet(`${gv2}/pages`).reply(200, {
        results: [{ id: '2', title: 'Other', spaceId: SPACE.id, _links: { webui: '/spaces/ENG/pages/2' } }],
        _links: { base: 'https://tenant.atlassian.net/wiki' }
      });
      await expect(gateway.findPageByTitleAndSpace('ENG', 'Other')).resolves.toEqual({
        title: 'Other',
        url: 'https://tenant.atlassian.net/wiki/spaces/ENG/pages/2'
      });
      gwMock.restore();
    });

    test('deletePage also falls back to blog posts', async () => {
      mock.onDelete(`${V2}/pages/88`).reply(404);
      mock.onDelete(`${V2}/blogposts/88`).reply(204);
      await expect(client.deletePage('88')).resolves.toEqual({ id: '88' });
    });

    test('storage written for entity-bearing markdown keeps the characters intact', async () => {
      mock.onPost(`${V2}/pages`).reply(200, v2Page({ id: '800' }));
      await client.createPage('E', 'ENG', 'AT&T <b> 「日本語」 & 😀', 'markdown');
      const value = JSON.parse(mock.history.post[0].data).body.value;
      expect(value).toContain('AT&amp;T');
      expect(value).toContain('「日本語」');
      expect(value).toContain('😀');
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
