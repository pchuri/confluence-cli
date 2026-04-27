const MacroConverter = require('../lib/macro-converter');

describe('MacroConverter', () => {
  describe('linkStyle defaulting', () => {
    test('defaults to "smart" when isCloud is true and no linkStyle is passed', () => {
      const converter = new MacroConverter({ isCloud: true });
      expect(converter.linkStyle).toBe('smart');
    });

    test('defaults to "wiki" when isCloud is false and no linkStyle is passed', () => {
      const converter = new MacroConverter({ isCloud: false });
      expect(converter.linkStyle).toBe('wiki');
    });

    test('explicit "smart" is used even when isCloud is false', () => {
      const converter = new MacroConverter({ isCloud: false, linkStyle: 'smart' });
      expect(converter.linkStyle).toBe('smart');
    });

    test('explicit "plain" is used regardless of isCloud', () => {
      const cloudConverter = new MacroConverter({ isCloud: true, linkStyle: 'plain' });
      const serverConverter = new MacroConverter({ isCloud: false, linkStyle: 'plain' });
      expect(cloudConverter.linkStyle).toBe('plain');
      expect(serverConverter.linkStyle).toBe('plain');
    });

    test('invalid linkStyle silently falls back to the isCloud-based default', () => {
      // Config-level validation is the user-facing guardrail; the converter is
      // lenient so direct library consumers cannot break the pipeline.
      const converter = new MacroConverter({ isCloud: true, linkStyle: 'garbage' });
      expect(converter.linkStyle).toBe('smart');
    });
  });

  describe('link conversion by linkStyle', () => {
    const markdown = '[Example](https://example.com)';

    test('"smart" emits a smart link with data-card-appearance="inline"', () => {
      const converter = new MacroConverter({ isCloud: true, linkStyle: 'smart' });
      const result = converter.markdownToStorage(markdown);
      expect(result).toContain('<a href="https://example.com" data-card-appearance="inline">Example</a>');
      expect(result).not.toContain('<ac:link>');
    });

    test('"plain" emits an unadorned <a href> tag', () => {
      const converter = new MacroConverter({ isCloud: true, linkStyle: 'plain' });
      const result = converter.markdownToStorage(markdown);
      expect(result).toContain('<a href="https://example.com">Example</a>');
      expect(result).not.toContain('data-card-appearance');
      expect(result).not.toContain('<ac:link>');
    });

    test('"wiki" emits the Server/DC ac:link + ri:url storage macro', () => {
      const converter = new MacroConverter({ isCloud: false, linkStyle: 'wiki' });
      const result = converter.markdownToStorage(markdown);
      expect(result).toContain('<ac:link>');
      expect(result).toContain('ri:value="https://example.com"');
      expect(result).toContain('<![CDATA[Example]]>');
      expect(result).not.toContain('data-card-appearance');
    });
  });

  describe('VALID_LINK_STYLES', () => {
    test('is exported alongside the class', () => {
      expect(MacroConverter.VALID_LINK_STYLES).toEqual(['smart', 'plain', 'wiki']);
    });
  });
});

describe('MacroConverter markdownToStorage marker conventions', () => {
  // isCloud: true so link output matches the smart-link branch in mixed tests.
  const converter = new MacroConverter({ isCloud: true });

  describe('TOC', () => {
    test('**TOC** becomes Table of Contents macro', () => {
      const result = converter.markdownToStorage('**TOC**');
      expect(result).toContain('<ac:structured-macro ac:name="toc" />');
      expect(result).not.toContain('**TOC**');
    });
  });

  describe('ANCHOR', () => {
    test('**ANCHOR: id** becomes anchor macro with given id', () => {
      const result = converter.markdownToStorage('**ANCHOR: my-section**');
      expect(result).toContain('<ac:structured-macro ac:name="anchor">');
      expect(result).toContain('<ac:parameter ac:name="">my-section</ac:parameter>');
      expect(result).not.toContain('**ANCHOR');
    });
  });

  describe('same-page anchor links', () => {
    test('[text](#id) becomes ac:link with ac:anchor', () => {
      const result = converter.markdownToStorage('[Jump](#my-section)');
      expect(result).toContain('<ac:link ac:anchor="my-section">');
      expect(result).toContain('<![CDATA[Jump]]>');
    });

    test('anchor-link conversion runs before general link conversion on Cloud', () => {
      const result = converter.markdownToStorage(
        '[Jump](#my-section) and [External](https://example.com)'
      );
      expect(result).toContain('ac:anchor="my-section"');
      expect(result).toContain('data-card-appearance="inline"');
    });

    test('anchor-link conversion runs before general link conversion on Server/DC', () => {
      const serverConverter = new MacroConverter({ isCloud: false });
      const result = serverConverter.markdownToStorage(
        '[Jump](#my-section) and [External](https://example.com)'
      );
      expect(result).toContain('ac:anchor="my-section"');
      // External link should get the ac:link + ri:url storage format, not be
      // double-wrapped by the anchor replacement.
      expect(result).toContain('ri:value="https://example.com"');
      expect(result).not.toContain('ac:anchor="https');
    });
  });

});

describe('MacroConverter storageToMarkdown anchor round-trip', () => {
  const converter = new MacroConverter({ isCloud: true });

  test('anchor macro converts back to **ANCHOR: id** marker', () => {
    const storage = '<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">my-section</ac:parameter></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('**ANCHOR: my-section**');
  });

  test('anchor macro with extra attributes (e.g. ac:macro-id) still converts', () => {
    const storage = '<ac:structured-macro ac:name="anchor" ac:macro-id="abc-123"><ac:parameter ac:name="">section-2</ac:parameter></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('**ANCHOR: section-2**');
  });

  test('ac:link with ac:anchor converts back to [text](#id)', () => {
    const storage = '<ac:link ac:anchor="my-section"><ac:plain-text-link-body><![CDATA[Jump]]></ac:plain-text-link-body></ac:link>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('[Jump](#my-section)');
  });

  test('anchor link is not consumed by the generic <ac:link> catch-all', () => {
    const storage = '<p><ac:link ac:anchor="x"><ac:plain-text-link-body><![CDATA[A]]></ac:plain-text-link-body></ac:link> and <ac:link><ri:url ri:value="https://example.com" /><ac:plain-text-link-body><![CDATA[Ext]]></ac:plain-text-link-body></ac:link></p>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('[A](#x)');
    expect(result).toContain('[Ext](https://example.com)');
  });

  test('full round-trip: markdown → storage → markdown preserves anchor and link', () => {
    const original = '**ANCHOR: section-a**\n\nSee [details](#section-a) below.';
    const storage = converter.markdownToStorage(original);
    const back = converter.storageToMarkdown(storage);
    expect(back).toContain('**ANCHOR: section-a**');
    expect(back).toContain('[details](#section-a)');
  });
});
