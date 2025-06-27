const ConfluenceClient = require('../lib/confluence-client');

describe('ConfluenceClient', () => {
  let client;
  
  beforeEach(() => {
    client = new ConfluenceClient({
      domain: 'test.atlassian.net',
      token: 'test-token'
    });
  });

  describe('extractPageId', () => {
    test('should return numeric page ID as is', () => {
      expect(client.extractPageId('123456789')).toBe('123456789');
      expect(client.extractPageId(123456789)).toBe(123456789);
    });

    test('should extract page ID from URL with pageId parameter', () => {
      const url = 'https://test.atlassian.net/wiki/spaces/TEST/pages/123456789/Page+Title';
      expect(client.extractPageId(url + '?pageId=987654321')).toBe('987654321');
    });

    test('should throw error for display URLs', () => {
      const displayUrl = 'https://test.atlassian.net/display/TEST/Page+Title';
      expect(() => client.extractPageId(displayUrl)).toThrow('Display URLs not yet supported');
    });
  });

  describe('markdownToStorage', () => {
    test('should convert markdown to Confluence storage format', () => {
      const markdown = '# Hello World\n\nThis is a **test** page.';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:structured-macro ac:name="html">');
      expect(result).toContain('<h1>Hello World</h1>');
      expect(result).toContain('<strong>test</strong>');
    });
  });

  describe('page creation and updates', () => {
    test('should have required methods for page management', () => {
      expect(typeof client.createPage).toBe('function');
      expect(typeof client.updatePage).toBe('function');
      expect(typeof client.getPageForEdit).toBe('function');
      expect(typeof client.createChildPage).toBe('function');
      expect(typeof client.findPageByTitle).toBe('function');
    });
  });
});
