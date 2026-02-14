const fs = require('fs');
const os = require('os');
const path = require('path');
const FormData = require('form-data');
const ConfluenceClient = require('../lib/confluence-client');
const MockAdapter = require('axios-mock-adapter');

const removeDirRecursive = (dir) => {
  if (!dir) return;
  try {
    if (fs.rmSync) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
  } catch (error) {
    void error;
  }

  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir).forEach((entry) => {
    const entryPath = path.join(dir, entry);
    const stats = fs.lstatSync(entryPath);
    if (stats.isDirectory()) {
      removeDirRecursive(entryPath);
    } else {
      try {
        fs.unlinkSync(entryPath);
      } catch (error) {
        void error;
      }
    }
  });

  try {
    fs.rmdirSync(dir);
  } catch (error) {
    void error;
  }
};

describe('ConfluenceClient', () => {
  let client;
  
  beforeEach(() => {
    client = new ConfluenceClient({
      domain: 'test.atlassian.net',
      token: 'test-token'
    });
  });

  describe('api path handling', () => {
    test('defaults to /rest/api when path is not provided', () => {
      const defaultClient = new ConfluenceClient({
        domain: 'example.com',
        token: 'no-path-token'
      });

      expect(defaultClient.baseURL).toBe('https://example.com/rest/api');
    });

    test('normalizes custom api paths', () => {
      const customClient = new ConfluenceClient({
        domain: 'cloud.example',
        token: 'custom-path',
        apiPath: 'wiki/rest/api/'
      });

      expect(customClient.baseURL).toBe('https://cloud.example/wiki/rest/api');
    });
  });

  describe('authentication setup', () => {
    test('uses bearer token headers by default', () => {
      const bearerClient = new ConfluenceClient({
        domain: 'test.atlassian.net',
        token: 'bearer-token'
      });

      expect(bearerClient.client.defaults.headers.Authorization).toBe('Bearer bearer-token');
    });

    test('builds basic auth headers when email is provided', () => {
      const basicClient = new ConfluenceClient({
        domain: 'test.atlassian.net',
        token: 'basic-token',
        authType: 'basic',
        email: 'user@example.com'
      });

      const encoded = Buffer.from('user@example.com:basic-token').toString('base64');
      expect(basicClient.client.defaults.headers.Authorization).toBe(`Basic ${encoded}`);
    });

    test('throws when basic auth is missing an email', () => {
      expect(() => new ConfluenceClient({
        domain: 'test.atlassian.net',
        token: 'missing-email',
        authType: 'basic'
      })).toThrow('Basic authentication requires an email address.');
    });
  });

  describe('extractPageId', () => {
    test('should return numeric page ID as is', async () => {
      expect(await client.extractPageId('123456789')).toBe('123456789');
      expect(await client.extractPageId(123456789)).toBe(123456789);
    });

    test('should extract page ID from URL with pageId parameter', async () => {
      const url = 'https://test.atlassian.net/wiki/spaces/TEST/pages/123456789/Page+Title';
      expect(await client.extractPageId(url + '?pageId=987654321')).toBe('987654321');
    });

    test('should extract page ID from pretty URL path', async () => {
      const url = 'https://test.atlassian.net/wiki/spaces/TEST/pages/123456789/Page+Title';
      expect(await client.extractPageId(url)).toBe('123456789');
    });

    test('should resolve display URLs', async () => {
      // Mock the API response for display URL resolution
      const mock = new MockAdapter(client.client);

      mock.onGet('/content').reply(200, {
        results: [{
          id: '12345',
          title: 'Page Title',
          _links: { webui: '/display/TEST/Page+Title' }
        }]
      });

      const displayUrl = 'https://test.atlassian.net/display/TEST/Page+Title';
      expect(await client.extractPageId(displayUrl)).toBe('12345');

      mock.restore();
    });

    test('should resolve nested display URLs', async () => {
      // Mock the API response for display URL resolution
      const mock = new MockAdapter(client.client);

      mock.onGet('/content').reply(200, {
        results: [{
          id: '67890',
          title: 'Child Page',
          _links: { webui: '/display/TEST/Parent/Child+Page' }
        }]
      });

      const displayUrl = 'https://test.atlassian.net/display/TEST/Parent/Child+Page';
      expect(await client.extractPageId(displayUrl)).toBe('67890');

      mock.restore();
    });

    test('should throw error when display URL cannot be resolved', async () => {
      const mock = new MockAdapter(client.client);

      // Mock empty result
      mock.onGet('/content').reply(200, {
        results: []
      });

      const displayUrl = 'https://test.atlassian.net/display/TEST/NonExistentPage';
      await expect(client.extractPageId(displayUrl)).rejects.toThrow(/Could not resolve page ID/);

      mock.restore();
    });
  });

  describe('markdownToStorage', () => {
    test('should convert basic markdown to native Confluence storage format', () => {
      const markdown = '# Hello World\n\nThis is a **test** page with *italic* text.';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<h1>Hello World</h1>');
      expect(result).toContain('<p>This is a <strong>test</strong> page with <em>italic</em> text.</p>');
      expect(result).not.toContain('<ac:structured-macro ac:name="html">');
    });

    test('should convert code blocks to Confluence code macro', () => {
      const markdown = '```javascript\nconsole.log("Hello World");\n```';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">javascript</ac:parameter>');
      expect(result).toContain('console.log(&quot;Hello World&quot;);');
    });

    test('should convert lists to native Confluence format', () => {
      const markdown = '- Item 1\n- Item 2\n\n1. First\n2. Second';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ul>');
      expect(result).toContain('<li><p>Item 1</p></li>');
      expect(result).toContain('<ol>');
      expect(result).toContain('<li><p>First</p></li>');
    });

    test('should convert Confluence admonitions', () => {
      const markdown = '[!info]\nThis is an info message';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:structured-macro ac:name="info">');
      expect(result).toContain('This is an info message');
    });

    test('should convert tables to native Confluence format', () => {
      const markdown = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<table>');
      expect(result).toContain('<th><p>Header 1</p></th>');
      expect(result).toContain('<td><p>Cell 1</p></td>');
    });

    test('should convert links to Confluence link format', () => {
      const markdown = '[Example Link](https://example.com)';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:link>');
      expect(result).toContain('ri:value="https://example.com"');
      expect(result).toContain('Example Link');
    });
  });

  describe('markdownToNativeStorage', () => {
    test('should act as an alias to htmlToConfluenceStorage via markdown render', () => {
      const markdown = '# Native Storage Test';
      const result = client.markdownToNativeStorage(markdown);

      expect(result).toContain('<h1>Native Storage Test</h1>');
    });

    test('should handle code blocks correctly', () => {
      const markdown = '```javascript\nconst a = 1;\n```';
      const result = client.markdownToNativeStorage(markdown);

      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('const a = 1;');
    });
  });

  describe('storageToMarkdown', () => {
    test('should convert Confluence storage format to markdown', () => {
      const storage = '<h1>Hello World</h1><p>This is a <strong>test</strong> page.</p>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('# Hello World');
      expect(result).toContain('**test**');
    });

    test('should convert Confluence code macro to markdown', () => {
      const storage = '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">javascript</ac:parameter><ac:plain-text-body><![CDATA[console.log("Hello");]]></ac:plain-text-body></ac:structured-macro>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('```javascript');
      expect(result).toContain('console.log("Hello");');
      expect(result).toContain('```');
    });

    test('should convert Confluence macros to admonitions', () => {
      const storage = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>This is info</p></ac:rich-text-body></ac:structured-macro>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('[!info]');
      expect(result).toContain('This is info');
    });

    test('should convert Confluence links to markdown', () => {
      const storage = '<ac:link><ri:url ri:value="https://example.com" /><ac:plain-text-link-body><![CDATA[Example]]></ac:plain-text-link-body></ac:link>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('[Example](https://example.com)');
    });
  });

  describe('htmlToMarkdown', () => {
    test('should convert basic HTML to markdown', () => {
      const html = '<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> text.</p>';
      const result = client.htmlToMarkdown(html);
      
      expect(result).toContain('## Title');
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
    });

    test('should convert HTML lists to markdown', () => {
      const html = '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>';
      const result = client.htmlToMarkdown(html);
      
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
    });

    test('should convert HTML tables to markdown', () => {
      const html = '<table><tr><th><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></table>';
      const result = client.htmlToMarkdown(html);
      
      expect(result).toContain('| Header |');
      expect(result).toContain('| --- |');
      expect(result).toContain('| Cell |');
    });
  });

  describe('page creation and updates', () => {
    test('should have required methods for page management', () => {
      expect(typeof client.createPage).toBe('function');
      expect(typeof client.updatePage).toBe('function');
      expect(typeof client.getPageForEdit).toBe('function');
      expect(typeof client.createChildPage).toBe('function');
      expect(typeof client.findPageByTitle).toBe('function');
      expect(typeof client.deletePage).toBe('function');
    });
  });

  describe('deletePage', () => {
    test('should delete a page by ID', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/123456789').reply(204);

      await expect(client.deletePage('123456789')).resolves.toEqual({ id: '123456789' });

      mock.restore();
    });

    test('should delete a page by URL', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/987654321').reply(204);

      await expect(
        client.deletePage('https://test.atlassian.net/wiki/viewpage.action?pageId=987654321')
      ).resolves.toEqual({ id: '987654321' });

      mock.restore();
    });
  });

  describe('movePage', () => {
    test('should move a page by ID', async () => {
      const mock = new MockAdapter(client.client);

      mock.onGet('/content/123456789').reply(200, {
        id: '123456789',
        title: 'Original Title',
        version: { number: 5 },
        body: { storage: { value: '<p>Original content</p>' } },
        space: { key: 'TEST' }
      });

      mock.onGet('/content/987654321').reply(200, {
        id: '987654321',
        space: { key: 'TEST' }
      });

      mock.onPut('/content/123456789').reply(200, {
        id: '123456789',
        title: 'Original Title',
        version: { number: 6 },
        ancestors: [{ id: '987654321' }]
      });

      const result = await client.movePage('123456789', '987654321');

      expect(result.id).toBe('123456789');
      expect(result.version.number).toBe(6);
      expect(result.ancestors).toEqual([{ id: '987654321' }]);

      mock.restore();
    });

    test('should move a page with new title', async () => {
      const mock = new MockAdapter(client.client);

      mock.onGet('/content/555666777').reply(200, {
        id: '555666777',
        title: 'Old Title',
        version: { number: 2 },
        body: { storage: { value: '<p>Page content</p>' } },
        space: { key: 'DOCS' }
      });

      mock.onGet('/content/888999000').reply(200, {
        id: '888999000',
        space: { key: 'DOCS' }
      });

      mock.onPut('/content/555666777').reply(200, {
        id: '555666777',
        title: 'New Title',
        version: { number: 3 },
        ancestors: [{ id: '888999000' }]
      });

      const result = await client.movePage('555666777', '888999000', 'New Title');

      expect(result.title).toBe('New Title');
      expect(result.version.number).toBe(3);
      expect(result.ancestors).toEqual([{ id: '888999000' }]);

      mock.restore();
    });

    test('should move a page using URL for pageId', async () => {
      const mock = new MockAdapter(client.client);
      const pageUrl = 'https://test.atlassian.net/wiki/viewpage.action?pageId=111222333';

      mock.onGet('/content/111222333').reply(200, {
        id: '111222333',
        title: 'Test Page',
        version: { number: 1 },
        body: { storage: { value: '<p>Content</p>' } },
        space: { key: 'TEST' }
      });

      mock.onGet('/content/444555666').reply(200, {
        id: '444555666',
        space: { key: 'TEST' }
      });

      mock.onPut('/content/111222333').reply(200, {
        id: '111222333',
        title: 'Test Page',
        version: { number: 2 },
        ancestors: [{ id: '444555666' }]
      });

      const result = await client.movePage(pageUrl, '444555666');

      expect(result.id).toBe('111222333');
      expect(result.version.number).toBe(2);

      mock.restore();
    });

    test('should move a page using URLs for both parameters', async () => {
      const mock = new MockAdapter(client.client);
      const pageUrl = 'https://test.atlassian.net/wiki/viewpage.action?pageId=777888999';
      const parentUrl = 'https://test.atlassian.net/wiki/viewpage.action?pageId=111000111';

      mock.onGet('/content/777888999').reply(200, {
        id: '777888999',
        title: 'Source Page',
        version: { number: 3 },
        body: { storage: { value: '<p>Page content</p>' } },
        space: { key: 'DOCS' }
      });

      mock.onGet('/content/111000111').reply(200, {
        id: '111000111',
        space: { key: 'DOCS' }
      });

      mock.onPut('/content/777888999').reply(200, {
        id: '777888999',
        title: 'Source Page',
        version: { number: 4 },
        ancestors: [{ id: '111000111' }]
      });

      const result = await client.movePage(pageUrl, parentUrl);

      expect(result.id).toBe('777888999');
      expect(result.version.number).toBe(4);

      mock.restore();
    });

    test('should throw error when moving page across spaces', async () => {
      const mock = new MockAdapter(client.client);

      mock.onGet('/content/123456789').reply(200, {
        id: '123456789',
        title: 'Page in Space A',
        version: { number: 1 },
        body: { storage: { value: '<p>Content</p>' } },
        space: { key: 'SPACEA' }
      });

      mock.onGet('/content/987654321').reply(200, {
        id: '987654321',
        space: { key: 'SPACEB' }
      });

      await expect(
        client.movePage('123456789', '987654321')
      ).rejects.toThrow('Cannot move page across spaces');

      mock.restore();
    });
  });

  describe('page tree operations', () => {
    test('should have required methods for tree operations', () => {
      expect(typeof client.getChildPages).toBe('function');
      expect(typeof client.getAllDescendantPages).toBe('function');
      expect(typeof client.copyPageTree).toBe('function');
      expect(typeof client.buildPageTree).toBe('function');
      expect(typeof client.shouldExcludePage).toBe('function');
    });

    test('should correctly exclude pages based on patterns', () => {
      const patterns = ['temp*', 'test*', '*draft*'];

      expect(client.shouldExcludePage('temporary document', patterns)).toBe(true);
      expect(client.shouldExcludePage('test page', patterns)).toBe(true);
      expect(client.shouldExcludePage('my draft page', patterns)).toBe(true);
      expect(client.shouldExcludePage('normal document', patterns)).toBe(false);
      expect(client.shouldExcludePage('production page', patterns)).toBe(false);
    });

    test('should handle empty exclude patterns', () => {
      expect(client.shouldExcludePage('any page', [])).toBe(false);
      expect(client.shouldExcludePage('any page', null)).toBe(false);
      expect(client.shouldExcludePage('any page', undefined)).toBe(false);
    });

    test('globToRegExp should escape regex metacharacters and match case-insensitively', () => {
      const patterns = [
        'file.name*',   // dot should be literal
        '[draft]?',     // brackets should be literal
        'Plan (Q1)?',   // parentheses literal, ? wildcard
        'DATA*SET',     // case-insensitive
      ];
      const rx = patterns.map(p => client.globToRegExp(p));
      expect('file.name.v1').toMatch(rx[0]);
      expect('filexname').not.toMatch(rx[0]);
      expect('[draft]1').toMatch(rx[1]);
      expect('[draft]AB').not.toMatch(rx[1]);
      expect('Plan (Q1)A').toMatch(rx[2]);
      expect('Plan Q1A').not.toMatch(rx[2]);
      expect('data big set').toMatch(rx[3]);
    });

    test('buildPageTree should link children by parentId and collect orphans at root', () => {
      const rootId = 'root';
      const pages = [
        { id: 'a', title: 'A', parentId: rootId },
        { id: 'b', title: 'B', parentId: 'a' },
        { id: 'c', title: 'C', parentId: 'missing' }, // orphan
      ];
      const tree = client.buildPageTree(pages, rootId);
      // tree should contain A and C at top-level (B is child of A)
      const topTitles = tree.map(n => n.title).sort();
      expect(topTitles).toEqual(['A', 'C']);
      const a = tree.find(n => n.title === 'A');
      expect(a.children.map(n => n.title)).toEqual(['B']);
    });

    test('exclude parser should tolerate spaces and empty items', () => {
      const raw = ' temp* , , *draft* ,,test? ';
      const patterns = raw.split(',').map(p => p.trim()).filter(Boolean);
      expect(patterns).toEqual(['temp*', '*draft*', 'test?']);
      expect(client.shouldExcludePage('temp file', patterns)).toBe(true);
      expect(client.shouldExcludePage('my draft page', patterns)).toBe(true);
      expect(client.shouldExcludePage('test1', patterns)).toBe(true);
      expect(client.shouldExcludePage('production', patterns)).toBe(false);
    });
  });

  describe('comments', () => {
    test('should list comments with location filter', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/child/comment').reply(config => {
        expect(config.params.location).toBe('inline');
        expect(config.params.expand).toContain('body.storage');
        expect(config.params.expand).toContain('ancestors');
        return [200, {
          results: [
            {
              id: 'c1',
              status: 'current',
              body: { storage: { value: '<p>Hello</p>' } },
              history: { createdBy: { displayName: 'Ada' }, createdDate: '2025-01-01' },
              version: { number: 1 },
              ancestors: [{ id: 'c0', type: 'comment' }],
              extensions: {
                location: 'inline',
                inlineProperties: { selection: 'Hello', originalSelection: 'Hello' },
                resolution: { status: 'open' }
              }
            }
          ],
          _links: { next: '/rest/api/content/123/child/comment?start=2' }
        }];
      });

      const page = await client.listComments('123', { location: 'inline' });
      expect(page.results).toHaveLength(1);
      expect(page.results[0].location).toBe('inline');
      expect(page.results[0].resolution).toBe('open');
      expect(page.results[0].parentId).toBe('c0');
      expect(page.nextStart).toBe(2);

      mock.restore();
    });

    test('should create inline comment with inline properties', async () => {
      const mock = new MockAdapter(client.client);
      mock.onPost('/content').reply(config => {
        const payload = JSON.parse(config.data);
        expect(payload.type).toBe('comment');
        expect(payload.container.id).toBe('123');
        expect(payload.body.storage.value).toBe('<p>Hi</p>');
        expect(payload.ancestors[0].id).toBe('c0');
        expect(payload.extensions.location).toBe('inline');
        expect(payload.extensions.inlineProperties.originalSelection).toBe('Hi');
        expect(payload.extensions.inlineProperties.markerRef).toBe('comment-1');
        return [200, { id: 'c1', type: 'comment' }];
      });

      await client.createComment('123', '<p>Hi</p>', 'storage', {
        parentId: 'c0',
        location: 'inline',
        inlineProperties: {
          selection: 'Hi',
          originalSelection: 'Hi',
          markerRef: 'comment-1'
        }
      });

      mock.restore();
    });

    test('should delete a comment by ID', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/456').reply(204);

      await expect(client.deleteComment('456')).resolves.toEqual({ id: '456' });

      mock.restore();
    });
  });

  describe('attachments', () => {
    test('should have required methods for attachment handling', () => {
      expect(typeof client.listAttachments).toBe('function');
      expect(typeof client.getAllAttachments).toBe('function');
      expect(typeof client.downloadAttachment).toBe('function');
      expect(typeof client.uploadAttachment).toBe('function');
      expect(typeof client.deleteAttachment).toBe('function');
    });

    test('matchesPattern should respect glob patterns', () => {
      expect(client.matchesPattern('report.png', '*.png')).toBe(true);
      expect(client.matchesPattern('report.png', '*.jpg')).toBe(false);
      expect(client.matchesPattern('report.png', ['*.jpg', 'report.*'])).toBe(true);
      expect(client.matchesPattern('report.png', null)).toBe(true);
      expect(client.matchesPattern('report.png', [])).toBe(true);
    });

    test('parseNextStart should read start query param when present', () => {
      expect(client.parseNextStart('/rest/api/content/1/child/attachment?start=25')).toBe(25);
      expect(client.parseNextStart('/rest/api/content/1/child/attachment?limit=50')).toBeNull();
      expect(client.parseNextStart(null)).toBeNull();
    });

    test('uploadAttachment should send multipart request with Atlassian token header', async () => {
      const mock = new MockAdapter(client.client);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-cli-'));
      const tempFile = path.join(tempDir, 'upload.txt');
      fs.writeFileSync(tempFile, 'hello');

      try {
        mock.onPost('/content/123/child/attachment').reply((config) => {
          expect(config.headers['X-Atlassian-Token']).toBe('nocheck');
          const contentType = config.headers['content-type'] || config.headers['Content-Type'];
          expect(contentType).toContain('multipart/form-data');
          expect(config.data).toBeInstanceOf(FormData);
          return [200, {
            results: [{
              id: '1',
              title: 'upload.txt',
              version: { number: 2 },
              _links: { download: '/download' }
            }]
          }];
        });

        const response = await client.uploadAttachment('123', tempFile, { comment: 'note', minorEdit: true });
        expect(response.results[0].title).toBe('upload.txt');
      } finally {
        mock.restore();
        removeDirRecursive(tempDir);
      }
    });

    test('uploadAttachment should use PUT when replace is true', async () => {
      const mock = new MockAdapter(client.client);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-cli-'));
      const tempFile = path.join(tempDir, 'replace.txt');
      fs.writeFileSync(tempFile, 'replace');

      try {
        mock.onPut('/content/456/child/attachment').reply(200, {
          results: [{
            id: '2',
            title: 'replace.txt',
            version: { number: 3 },
            _links: { download: '/download' }
          }]
        });

        const response = await client.uploadAttachment('456', tempFile, { replace: true });
        expect(response.results[0].title).toBe('replace.txt');
      } finally {
        mock.restore();
        removeDirRecursive(tempDir);
      }
    });

    test('deleteAttachment should call delete endpoint', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/123/child/attachment/999').reply(204);

      await expect(client.deleteAttachment('123', '999')).resolves.toEqual({ id: '999', pageId: '123' });

      mock.restore();
    });
  });

  describe('content properties', () => {
    test('should have required methods for property handling', () => {
      expect(typeof client.listProperties).toBe('function');
      expect(typeof client.getProperty).toBe('function');
      expect(typeof client.setProperty).toBe('function');
      expect(typeof client.deleteProperty).toBe('function');
    });

    test('listProperties should return results with pagination info', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property').reply(200, {
        results: [
          { key: 'color', value: { hex: '#ff0000' }, version: { number: 1 } },
          { key: 'status', value: 'active', version: { number: 3 } }
        ],
        _links: { next: '/rest/api/content/123/property?start=2&limit=25' }
      });

      const response = await client.listProperties('123');
      expect(response.results).toHaveLength(2);
      expect(response.results[0].key).toBe('color');
      expect(response.results[1].key).toBe('status');
      expect(response.nextStart).toBe(2);

      mock.restore();
    });

    test('listProperties should return empty results when no properties exist', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/456/property').reply(200, { results: [] });

      const response = await client.listProperties('456');
      expect(response.results).toEqual([]);
      expect(response.nextStart).toBeNull();

      mock.restore();
    });

    test('listProperties should resolve page URLs', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/789/property').reply(200, { results: [] });

      const response = await client.listProperties('https://test.atlassian.net/wiki/viewpage.action?pageId=789');
      expect(response.results).toEqual([]);

      mock.restore();
    });

    test('listProperties should pass limit and start as query params', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property').reply((config) => {
        expect(config.params.limit).toBe(5);
        expect(config.params.start).toBe(10);
        return [200, { results: [] }];
      });

      await client.listProperties('123', { limit: 5, start: 10 });

      mock.restore();
    });

    test('getAllProperties should accumulate results across pages', async () => {
      const mock = new MockAdapter(client.client);
      let callCount = 0;
      mock.onGet('/content/123/property').reply((config) => {
        callCount++;
        if (callCount === 1) {
          expect(config.params.start).toBe(0);
          return [200, {
            results: [{ key: 'a', value: 1, version: { number: 1 } }],
            _links: { next: '/rest/api/content/123/property?start=1&limit=1' }
          }];
        }
        expect(config.params.start).toBe(1);
        return [200, {
          results: [{ key: 'b', value: 2, version: { number: 1 } }]
        }];
      });

      const results = await client.getAllProperties('123', { pageSize: 1 });
      expect(results).toHaveLength(2);
      expect(results[0].key).toBe('a');
      expect(results[1].key).toBe('b');

      mock.restore();
    });

    test('getProperty should return property data', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/color').reply(200, {
        key: 'color',
        value: { hex: '#ff0000' },
        version: { number: 2 }
      });

      const result = await client.getProperty('123', 'color');
      expect(result.key).toBe('color');
      expect(result.value.hex).toBe('#ff0000');

      mock.restore();
    });

    test('getProperty should throw on 404', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/missing').reply(404, { message: 'Not found' });

      await expect(client.getProperty('123', 'missing')).rejects.toThrow();

      mock.restore();
    });

    test('setProperty should create new property with version 1', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/newkey').reply(404);
      mock.onPut('/content/123/property/newkey').reply((config) => {
        const body = JSON.parse(config.data);
        expect(body.version.number).toBe(1);
        expect(body.key).toBe('newkey');
        return [200, body];
      });

      const result = await client.setProperty('123', 'newkey', { data: true });
      expect(result.version.number).toBe(1);

      mock.restore();
    });

    test('setProperty should auto-increment version for existing property', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/existing').reply(200, {
        key: 'existing',
        value: 'old',
        version: { number: 5 }
      });
      mock.onPut('/content/123/property/existing').reply((config) => {
        const body = JSON.parse(config.data);
        expect(body.version.number).toBe(6);
        return [200, body];
      });

      const result = await client.setProperty('123', 'existing', 'new');
      expect(result.version.number).toBe(6);

      mock.restore();
    });

    test('setProperty should propagate non-404 errors', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/broken').reply(500);

      await expect(client.setProperty('123', 'broken', 'val')).rejects.toThrow();

      mock.restore();
    });

    test('deleteProperty should call delete endpoint', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/123/property/color').reply(204);

      const result = await client.deleteProperty('123', 'color');
      expect(result).toEqual({ pageId: '123', key: 'color' });

      mock.restore();
    });

    test('getProperty should URL-encode keys with reserved characters', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/my%20prop%2Fkey').reply(200, {
        key: 'my prop/key',
        value: { ok: true },
        version: { number: 1 }
      });

      const result = await client.getProperty('123', 'my prop/key');
      expect(result.key).toBe('my prop/key');
      expect(result.value.ok).toBe(true);

      mock.restore();
    });

    test('setProperty should URL-encode keys with reserved characters', async () => {
      const mock = new MockAdapter(client.client);
      mock.onGet('/content/123/property/my%20prop%2Fkey').reply(404);
      mock.onPut('/content/123/property/my%20prop%2Fkey').reply((config) => {
        const body = JSON.parse(config.data);
        expect(body.key).toBe('my prop/key');
        expect(body.version.number).toBe(1);
        return [200, body];
      });

      const result = await client.setProperty('123', 'my prop/key', { test: true });
      expect(result.key).toBe('my prop/key');

      mock.restore();
    });

    test('deleteProperty should URL-encode keys with reserved characters', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/123/property/my%20prop%2Fkey').reply(204);

      const result = await client.deleteProperty('123', 'my prop/key');
      expect(result).toEqual({ pageId: '123', key: 'my prop/key' });

      mock.restore();
    });

    test('deleteProperty should resolve page URLs', async () => {
      const mock = new MockAdapter(client.client);
      mock.onDelete('/content/789/property/status').reply(204);

      const result = await client.deleteProperty(
        'https://test.atlassian.net/wiki/viewpage.action?pageId=789',
        'status'
      );
      expect(result).toEqual({ pageId: '789', key: 'status' });

      mock.restore();
    });
  });
});
