const { StorageWalker } = require('../lib/storage-walker');
const MacroConverter = require('../lib/macro-converter');

describe('StorageWalker parser warnings', () => {
  test('well-formed input produces no warnings', () => {
    const walker = new StorageWalker();
    walker.walk('<p>hello <strong>world</strong></p>');
    expect(walker.warnings).toEqual([]);
  });

  test('self-closing XML tags are not flagged', () => {
    const walker = new StorageWalker();
    walker.walk('<p>before<br/>after</p><hr/>');
    expect(walker.warnings).toEqual([]);
  });

  test('Confluence storage with self-closing ac/ri tags is clean', () => {
    const walker = new StorageWalker();
    walker.walk(
      '<ac:image><ri:attachment ri:filename="x.png"/></ac:image>',
    );
    expect(walker.warnings).toEqual([]);
  });

  test('unclosed inline tag is captured', () => {
    const walker = new StorageWalker();
    walker.walk('<p>not closed <strong>bold');
    const tags = walker.warnings.map((w) => w.tag);
    expect(tags).toEqual(expect.arrayContaining(['strong', 'p']));
    expect(walker.warnings.every((w) => w.type === 'implicit-close')).toBe(true);
  });

  test('crossed nesting captures the inner tag that gets auto-closed', () => {
    const walker = new StorageWalker();
    walker.walk('<p>nested <em>partial</p>');
    const tags = walker.warnings.map((w) => w.tag);
    expect(tags).toContain('em');
  });

  test('unbalanced macro body is captured', () => {
    const walker = new StorageWalker();
    walker.walk('<ac:rich-text-body><p>x</ac:rich-text-body>');
    const tags = walker.warnings.map((w) => w.tag);
    expect(tags).toContain('p');
  });

  test('warnings reset between walk() calls', () => {
    const walker = new StorageWalker();
    walker.walk('<p>broken <strong>x');
    expect(walker.warnings.length).toBeGreaterThan(0);
    walker.walk('<p>good</p>');
    expect(walker.warnings).toEqual([]);
  });

  test('CONFLUENCE_CLI_VERBOSE writes warnings to stderr', () => {
    const original = process.env.CONFLUENCE_CLI_VERBOSE;
    process.env.CONFLUENCE_CLI_VERBOSE = '1';
    const writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const walker = new StorageWalker();
      walker.walk('<p>broken <strong>x');
      const messages = writeSpy.mock.calls.map((c) => c[0]).join('');
      expect(messages).toMatch(/auto-closed <strong>/);
      expect(messages).toMatch(/auto-closed <p>/);
    } finally {
      writeSpy.mockRestore();
      if (original === undefined) delete process.env.CONFLUENCE_CLI_VERBOSE;
      else process.env.CONFLUENCE_CLI_VERBOSE = original;
    }
  });
});

describe('MacroConverter onWarnings option', () => {
  test('callback fires with warnings array on malformed input', () => {
    const converter = new MacroConverter({ isCloud: true });
    const captured = [];
    converter.storageToMarkdown('<p>broken <strong>x', {
      onWarnings: (w) => captured.push(...w),
    });
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toMatchObject({ type: 'implicit-close' });
  });

  test('callback is not invoked on well-formed input', () => {
    const converter = new MacroConverter({ isCloud: true });
    const cb = jest.fn();
    converter.storageToMarkdown('<p>hello <strong>world</strong></p>', {
      onWarnings: cb,
    });
    expect(cb).not.toHaveBeenCalled();
  });

  test('storageToMarkdown still returns the markdown string when no callback supplied', () => {
    const converter = new MacroConverter({ isCloud: true });
    const md = converter.storageToMarkdown('<p>broken <strong>x');
    expect(typeof md).toBe('string');
    expect(md).toContain('broken');
  });
});
