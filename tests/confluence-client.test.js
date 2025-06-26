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
});
