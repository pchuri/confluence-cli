const ConfluenceClient = require('../lib/confluence-client');

function scopedClient(siteUrl) {
  return new ConfluenceClient({
    domain: 'api.atlassian.com',
    apiPath: '/ex/confluence/cloud-id/wiki/rest/api',
    authType: 'basic',
    email: 'user@example.com',
    token: 'test-token',
    siteUrl,
    linkStyle: 'auto',
  });
}

const pageUrl = 'https://example.atlassian.net/wiki/spaces/A/pages/1';

test.each([
  'https://example.atlassian.net',
  'https://example.atlassian.net/',
  'https://example.atlassian.net/wiki',
  'https://example.atlassian.net/wiki/',
])('siteUrl %s detects site links and preserves API/auth origin', (siteUrl) => {
  const client = scopedClient(siteUrl);
  expect(client.buildWebUrl('/wiki/spaces/A/pages/1')).toBe(pageUrl);
  expect(client.markdownToStorage(`[Page](${pageUrl})`)).toContain('data-card-appearance="inline"');
  expect(client.baseURL).toBe('https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api');
  expect(client.buildUrl('/wiki')).toBe('https://api.atlassian.com/wiki');
  expect(client.configuredOrigin()).toBe('https://api.atlassian.com');
  expect(() => client.assertSameOrigin(pageUrl)).toThrow(/does not match/);
});

test.each([
  'https://example.atlassian.net.evil.test/wiki/spaces/A/pages/1',
  'https://example.atlassian.net@evil.test/wiki/spaces/A/pages/1',
  'https://other.atlassian.net/wiki/spaces/A/pages/1',
  'http://example.atlassian.net/wiki/spaces/A/pages/1',
  'https://example.atlassian.net:8443/wiki/spaces/A/pages/1',
  'https://example.atlassian.net/wikiother/page',
  'https://example.atlassian.net/jira/browse/A-1',
  'https://example.atlassian.net/wiki/../jira/browse/A-1',
  '/wiki/spaces/A/pages/1',
])('siteUrl keeps external boundary %s plain', (href) => {
  const client = scopedClient('https://example.atlassian.net/wiki/');
  expect(client.markdownToStorage(`[Page](${href})`)).not.toContain('data-card-appearance');
});

test('unset siteUrl retains gateway fallback and ordinary site detection', () => {
  const client = scopedClient(undefined);
  expect(client.buildWebUrl('/wiki')).toBe(client.buildUrl('/wiki'));
  expect(client.markdownToStorage(`[Page](${pageUrl})`)).not.toContain('data-card-appearance');
  const ordinary = new ConfluenceClient({ domain: 'example.atlassian.net', token: 'token', linkStyle: 'auto' });
  expect(ordinary.markdownToStorage(`[Page](${pageUrl})`)).toContain('data-card-appearance="inline"');
});

test('local conversion accepts siteUrl while an explicit buildUrl takes precedence', () => {
  const local = ConfluenceClient.createLocalConverter({ siteUrl: 'https://example.atlassian.net/wiki/', webUrlPrefix: '/wiki', linkStyle: 'auto' });
  expect(local.markdownToStorage(`[Page](${pageUrl})`)).toContain('data-card-appearance="inline"');
  const explicit = ConfluenceClient.createLocalConverter({ siteUrl: 'https://example.atlassian.net/wiki/', buildUrl: (path) => `https://other.atlassian.net${path}`, webUrlPrefix: '/wiki', linkStyle: 'auto' });
  expect(explicit.markdownToStorage(`[Page](${pageUrl})`)).not.toContain('data-card-appearance');
});
