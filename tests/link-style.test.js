const { VALID_LINK_STYLES, resolveLinkStyle, createInternalLinkMatcher } = require('../lib/link-style');

describe('link-style', () => {
  test('"auto" is a valid linkStyle and is returned as-is', () => {
    expect(VALID_LINK_STYLES).toContain('auto');
    expect(resolveLinkStyle({ isCloud: true, linkStyle: 'auto' })).toBe('auto');
    expect(resolveLinkStyle({ isCloud: false, linkStyle: 'auto' })).toBe('auto');
  });

  describe('createInternalLinkMatcher', () => {
    const buildUrl = (p) => `https://example.atlassian.net${p.startsWith('/') ? p : `/${p}`}`;

    describe('Cloud site with a /wiki context path', () => {
      const isInternal = createInternalLinkMatcher({ webUrlPrefix: '/wiki', buildUrl });

      test.each([
        'https://example.atlassian.net/wiki/spaces/DEVOPS/pages/1346144034/acme',
        'https://example.atlassian.net/wiki',
        'https://example.atlassian.net/wiki/',
        'https://EXAMPLE.atlassian.net/wiki/spaces/A/overview',
        'https://example.atlassian.net:443/wiki/spaces/A/overview',
        'https://example.atlassian.net/wiki/spaces/A/pages/1?focusedCommentId=2#c',
      ])('treats %s as internal', (href) => {
        expect(isInternal(href)).toBe(true);
      });

      test.each([
        'https://letsencrypt.org/docs/faq/',
        'https://example.atlassian.net.evil.test/wiki/spaces/A/overview',
        'https://example.atlassian.net@evil.test/wiki/spaces/A/overview',
        'https://example.atlassian.net/wikiother/page',
        'https://example.atlassian.net/jira/browse/ABC-1',
        'https://example.atlassian.net/',
        'https://example.atlassian.net/wiki/../jira/browse/ABC-1',
        'http://example.atlassian.net/wiki/spaces/A/overview',
        'https://other.atlassian.net/wiki/spaces/A/overview',
        '/wiki/spaces/A/overview',
        'spaces/A/overview',
        'mailto:someone@example.atlassian.net',
        '',
      ])('treats %p as external', (href) => {
        expect(isInternal(href)).toBe(false);
      });
    });

    describe('site without a context path (Server/Data Center)', () => {
      const isInternal = createInternalLinkMatcher({
        webUrlPrefix: '',
        buildUrl: (p) => `https://wiki.example.org${p.startsWith('/') ? p : `/${p}`}`,
      });

      test('matches any path on the configured host only', () => {
        expect(isInternal('https://wiki.example.org/display/DOC/Home')).toBe(true);
        expect(isInternal('https://wiki.example.org/')).toBe(true);
        expect(isInternal('https://wiki.example.org.evil.test/display/DOC/Home')).toBe(false);
        expect(isInternal('https://github.com/pchuri/confluence-cli')).toBe(false);
      });
    });

    describe('no resolvable site (offline conversion)', () => {
      test('returns false when no buildUrl is provided', () => {
        const isInternal = createInternalLinkMatcher({ webUrlPrefix: '/wiki' });
        expect(isInternal('https://example.atlassian.net/wiki/spaces/A/overview')).toBe(false);
      });

      test('returns false when buildUrl only yields a relative path', () => {
        const isInternal = createInternalLinkMatcher({ webUrlPrefix: '/wiki', buildUrl: (p) => p });
        expect(isInternal('https://example.atlassian.net/wiki/spaces/A/overview')).toBe(false);
      });
    });
  });
});
