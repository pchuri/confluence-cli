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

  describe('EXPAND', () => {
    test('**EXPAND: title** / **EXPAND_END** wraps content in an expand macro', () => {
      const markdown = '**EXPAND: Show details**\n\nHidden content here.\n\n**EXPAND_END**';
      const result = converter.markdownToStorage(markdown);
      expect(result).toContain('<ac:structured-macro ac:name="expand">');
      expect(result).toContain('<ac:parameter ac:name="title">Show details</ac:parameter>');
      expect(result).toContain('<ac:rich-text-body>');
      expect(result).toContain('Hidden content here.');
      expect(result).not.toContain('**EXPAND');
    });

    test('inline italic in title is stripped (would otherwise be silently truncated by Confluence)', () => {
      const result = converter.markdownToStorage('**EXPAND: foo *bar* baz**\n\nbody\n\n**EXPAND_END**');
      expect(result).toContain('<ac:parameter ac:name="title">foo bar baz</ac:parameter>');
      expect(result).not.toContain('<em>');
    });

    test('inline code span in title is stripped', () => {
      const result = converter.markdownToStorage('**EXPAND: use `getUser()` here**\n\nbody\n\n**EXPAND_END**');
      expect(result).toContain('<ac:parameter ac:name="title">use getUser() here</ac:parameter>');
      expect(result).not.toContain('<code>');
    });

    test('inline link in title is stripped (URL is dropped — macro titles cannot hold links)', () => {
      const result = converter.markdownToStorage('**EXPAND: see [docs](https://example.com)**\n\nbody\n\n**EXPAND_END**');
      expect(result).toContain('<ac:parameter ac:name="title">see docs</ac:parameter>');
      expect(result).not.toContain('<a ');
      expect(result).not.toContain('data-card-appearance');
    });

    test('inline strikethrough in title is stripped (would otherwise cause Confluence to reject the page with HTTP 500)', () => {
      const result = converter.markdownToStorage('**EXPAND: ~~old~~ new**\n\nbody\n\n**EXPAND_END**');
      expect(result).toContain('<ac:parameter ac:name="title">old new</ac:parameter>');
      expect(result).not.toContain('<s>');
    });

    test('XML entities in title are preserved (the fix only strips literal tags)', () => {
      const result = converter.markdownToStorage('**EXPAND: A & B**\n\nbody\n\n**EXPAND_END**');
      expect(result).toContain('<ac:parameter ac:name="title">A &amp; B</ac:parameter>');
    });

    test('multiple EXPAND blocks in one document each get their own macro', () => {
      const markdown = [
        '**EXPAND: First**',
        '',
        'one',
        '',
        '**EXPAND_END**',
        '',
        '**EXPAND: Second**',
        '',
        'two',
        '',
        '**EXPAND_END**'
      ].join('\n');
      const result = converter.markdownToStorage(markdown);
      const matches = result.match(/<ac:structured-macro ac:name="expand">/g) || [];
      expect(matches).toHaveLength(2);
      expect(result).toContain('<ac:parameter ac:name="title">First</ac:parameter>');
      expect(result).toContain('<ac:parameter ac:name="title">Second</ac:parameter>');
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

  describe('blockquote default', () => {
    test('unmarked blockquote becomes a plain <blockquote> (not an info macro)', () => {
      const result = converter.markdownToStorage('> Just a quote');
      expect(result).toContain('<blockquote>');
      expect(result).toContain('Just a quote');
      expect(result).not.toContain('ac:name="info"');
    });

    test('multi-line unmarked blockquote stays plain', () => {
      const result = converter.markdownToStorage('> first line\n> second line');
      expect(result).toContain('<blockquote>');
      expect(result).toContain('first line');
      expect(result).toContain('second line');
      expect(result).not.toContain('ac:structured-macro');
    });

    test('> **INFO** marker still produces an info macro', () => {
      const result = converter.markdownToStorage('> **INFO**\n> Heads up.');
      expect(result).toContain('<ac:structured-macro ac:name="info">');
      expect(result).toContain('Heads up.');
    });

    test('> **WARNING** marker still produces a warning macro', () => {
      const result = converter.markdownToStorage('> **WARNING**\n> Be careful.');
      expect(result).toContain('<ac:structured-macro ac:name="warning">');
      expect(result).toContain('Be careful.');
    });

    test('> **NOTE** marker still produces a note macro', () => {
      const result = converter.markdownToStorage('> **NOTE**\n> Side note.');
      expect(result).toContain('<ac:structured-macro ac:name="note">');
      expect(result).toContain('Side note.');
    });
  });

  describe('admonition preprocessor respects markdown context', () => {
    // The previous raw-text preprocessor would transform any `[!info]`
    // anywhere in the source — including inside fenced code blocks, inline
    // code, and heading text — and break the surrounding markdown. Inline
    // code and fenced code are now stashed before rewriting, and the
    // admonition pattern is anchored to a line start so it cannot match
    // mid-paragraph or after a `>` blockquote prefix.
    test('[!info] inside inline code is left intact', () => {
      const result = converter.markdownToStorage('use the `[!info]` marker for callouts');
      expect(result).toContain('<code>[!info]</code>');
      expect(result).not.toContain('ac:name="info"');
    });

    test('[!info] inside a heading\'s inline code is left intact', () => {
      const result = converter.markdownToStorage('## 5. `[!info]` round-trip marker');
      expect(result).toContain('<h2>');
      expect(result).toContain('<code>[!info]</code>');
      expect(result).not.toContain('ac:name="info"');
    });

    test('[!info] inside a fenced code block is left intact', () => {
      const result = converter.markdownToStorage('```\n[!info]\nbody\n```');
      expect(result).toContain('ac:name="code"');
      expect(result).toContain('[!info]');
      expect(result).not.toContain('ac:name="info"');
    });

    test('[!info] mentioned in heading text stays a heading', () => {
      const result = converter.markdownToStorage('## [!info] is a section title');
      expect(result).toContain('<h2>');
      expect(result).toContain('[!info]');
      expect(result).not.toContain('ac:name="info"');
    });

    test('[!info] mid-paragraph stays inline text', () => {
      const result = converter.markdownToStorage('This text mentions [!info] in passing.');
      expect(result).toContain('<p>');
      expect(result).toContain('[!info]');
      expect(result).not.toContain('ac:name="info"');
    });

    test('GitHub-style `> [!info]` defers to plain blockquote', () => {
      // Recognizing `> [!info]` here would emit nested blockquote tokens
      // that the storage handler's lazy regex can't balance — producing
      // malformed XML that Confluence rejects with 400. Until the storage
      // handler supports balanced blockquote parsing, this form must fall
      // through to a plain `<blockquote>` containing literal `[!info]`.
      const result = converter.markdownToStorage('> [!info]\n> body');
      expect(result).toContain('<blockquote>');
      expect(result).toContain('[!info]');
      expect(result).not.toContain('ac:name="info"');
    });

    // Guard against the placeholder/restore step accidentally swallowing
    // user-authored numbers. The stash uses Unicode private-use delimiters
    // so the restore regex only matches the placeholder shape, never bare
    // digits in prose, headings, or list markers.
    test('plain digits in prose are preserved', () => {
      const result = converter.markdownToStorage('Version 5 released. 1.0 milestone in 2026.');
      expect(result).toContain('Version 5 released');
      expect(result).toContain('1.0 milestone');
      expect(result).toContain('2026');
      expect(result).not.toContain('undefined');
    });

    test('digits in a heading next to inline code are preserved', () => {
      const result = converter.markdownToStorage('## 5. `[!info]` round-trip marker');
      expect(result).toContain('<h2>5.');
      expect(result).toContain('<code>[!info]</code>');
      expect(result).not.toContain('undefined');
    });

    test('ordered list markers and inline code coexist', () => {
      const result = converter.markdownToStorage('1. first\n2. `code` item\n3. third');
      expect(result).toContain('<ol>');
      expect(result).toContain('first');
      expect(result).toContain('<code>code</code> item');
      expect(result).toContain('third');
      expect(result).not.toContain('undefined');
    });

    test('[!info] inside a tilde-fenced code block is left intact', () => {
      const result = converter.markdownToStorage('~~~\n[!info]\nbody\n~~~');
      expect(result).toContain('ac:name="code"');
      expect(result).toContain('[!info]');
      expect(result).not.toContain('ac:name="info"');
    });

    test('[!warning] at line start becomes a warning macro', () => {
      const result = converter.markdownToStorage('[!warning]\nheads up');
      expect(result).toContain('ac:name="warning"');
      expect(result).toContain('heads up');
    });

    test('[!note] at line start becomes a note macro', () => {
      const result = converter.markdownToStorage('[!note]\nside note');
      expect(result).toContain('ac:name="note"');
      expect(result).toContain('side note');
    });
  });

  describe('marker text is stripped from macro body', () => {
    // README's recommended form: `> **INFO**\n> body` (no blank `>` line).
    // markdown-it parses this as a single paragraph, which the original
    // cleanup regex did not handle — leaking `<strong>INFO</strong>` into
    // the rendered macro body. These tests guard the README-documented form.
    test('INFO marker is stripped (single-paragraph form)', () => {
      const result = converter.markdownToStorage('> **INFO**\n> body line');
      expect(result).toContain('ac:name="info"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>INFO</strong>');
    });

    test('INFO marker is stripped (paragraph-separated form)', () => {
      const result = converter.markdownToStorage('> **INFO**\n>\n> body line');
      expect(result).toContain('ac:name="info"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>INFO</strong>');
    });

    test('WARNING marker is stripped (single-paragraph form)', () => {
      const result = converter.markdownToStorage('> **WARNING**\n> body line');
      expect(result).toContain('ac:name="warning"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>WARNING</strong>');
    });

    test('WARNING marker is stripped (paragraph-separated form)', () => {
      const result = converter.markdownToStorage('> **WARNING**\n>\n> body line');
      expect(result).toContain('ac:name="warning"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>WARNING</strong>');
    });

    test('NOTE marker is stripped (single-paragraph form)', () => {
      const result = converter.markdownToStorage('> **NOTE**\n> body line');
      expect(result).toContain('ac:name="note"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>NOTE</strong>');
    });

    test('NOTE marker is stripped (paragraph-separated form)', () => {
      const result = converter.markdownToStorage('> **NOTE**\n>\n> body line');
      expect(result).toContain('ac:name="note"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>NOTE</strong>');
    });

    // The pre-processor expands `[!info]\nbody` → `> **INFO**\n> body`
    // (single-paragraph form), so the round-trip path hits the same bug as
    // the README form. Guard that round-trip here.
    test('[!info] round-trip strips the marker', () => {
      const result = converter.markdownToStorage('[!info]\nbody line');
      expect(result).toContain('ac:name="info"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>INFO</strong>');
    });

    test('[!warning] round-trip strips the marker', () => {
      const result = converter.markdownToStorage('[!warning]\nbody line');
      expect(result).toContain('ac:name="warning"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>WARNING</strong>');
    });

    test('[!note] round-trip strips the marker', () => {
      const result = converter.markdownToStorage('[!note]\nbody line');
      expect(result).toContain('ac:name="note"');
      expect(result).toContain('body line');
      expect(result).not.toContain('<strong>NOTE</strong>');
    });

    // Negative cases: a quotation that merely *mentions* `**INFO**` (or any
    // marker keyword) as part of prose must stay a plain blockquote — the
    // marker is only honored when it sits at the very start of the first
    // paragraph, immediately followed by `</p>` or `\n`. Both detection and
    // stripping use this same anchor, so prose `**INFO**` survives untouched.
    test('mid-sentence **INFO** stays a plain blockquote (no false-positive macro)', () => {
      const result = converter.markdownToStorage('> Use **INFO** at the start of a callout.');
      expect(result).toContain('<blockquote>');
      expect(result).not.toContain('ac:name="info"');
      expect(result).toContain('<strong>INFO</strong>');
    });

    test('**INFO** followed by trailing same-line text stays a plain blockquote', () => {
      const result = converter.markdownToStorage('> **INFO** is an acronym\n> for Information.');
      expect(result).toContain('<blockquote>');
      expect(result).not.toContain('ac:name="info"');
      expect(result).toContain('<strong>INFO</strong>');
      expect(result).toContain('is an acronym');
    });

    test('**INFO** as the second word stays a plain blockquote', () => {
      const result = converter.markdownToStorage('> Some **INFO** text here\n> next line.');
      expect(result).toContain('<blockquote>');
      expect(result).not.toContain('ac:name="info"');
      expect(result).toContain('<strong>INFO</strong>');
    });
  });

});

describe('MacroConverter storageToMarkdown EXPAND round-trip', () => {
  const converter = new MacroConverter({ isCloud: true });

  test('titled expand macro converts back to **EXPAND: title** / **EXPAND_END** markers', () => {
    const storage = '<ac:structured-macro ac:name="expand" ac:schema-version="1" ac:macro-id="abc-123"><ac:parameter ac:name="title">My title</ac:parameter><ac:rich-text-body><p>body content</p></ac:rich-text-body></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('**EXPAND: My title**');
    expect(result).toContain('body content');
    expect(result).toContain('**EXPAND_END**');
    expect(result).not.toContain('<details>');
  });

  test('title-less expand macro still falls back to <details>/<summary> (preserves existing UI-created behavior)', () => {
    const storage = '<ac:structured-macro ac:name="expand" ac:schema-version="1"><ac:rich-text-body><p>untitled body</p></ac:rich-text-body></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('<details>');
    expect(result).toContain('<summary>');
    expect(result).toContain('untitled body');
    expect(result).not.toContain('**EXPAND:');
  });

  test('full round-trip: markdown → storage → markdown preserves title and body', () => {
    const original = '**EXPAND: Show details**\n\nHidden content here.\n\n**EXPAND_END**';
    const storage = converter.markdownToStorage(original);
    const back = converter.storageToMarkdown(storage);
    expect(back).toContain('**EXPAND: Show details**');
    expect(back).toContain('Hidden content here.');
    expect(back).toContain('**EXPAND_END**');
  });
});

describe('MacroConverter storageToMarkdown callout round-trip', () => {
  // Storage → markdown emits the `> **MARKER**` blockquote form (matching
  // README) rather than the bare `[!marker]` shorthand, because the bare form
  // has no body terminator — a blank line inside a multi-paragraph body is
  // indistinguishable from the body ending, so re-uploading the bare form
  // silently drops every paragraph after the first. The blockquote form's
  // `>` prefix gives the body an explicit boundary.
  const converter = new MacroConverter({ isCloud: true });

  test('info macro emits the > **INFO** blockquote form', () => {
    const storage = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>heads up</p></ac:rich-text-body></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('> **INFO**');
    expect(result).toContain('> heads up');
    expect(result).not.toMatch(/^\[!info\]/m);
  });

  test('warning macro emits the > **WARNING** blockquote form', () => {
    const storage = '<ac:structured-macro ac:name="warning"><ac:rich-text-body><p>be careful</p></ac:rich-text-body></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('> **WARNING**');
    expect(result).toContain('> be careful');
    expect(result).not.toMatch(/^\[!warning\]/m);
  });

  test('note macro emits the > **NOTE** blockquote form', () => {
    const storage = '<ac:structured-macro ac:name="note"><ac:rich-text-body><p>side note</p></ac:rich-text-body></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('> **NOTE**');
    expect(result).toContain('> side note');
    expect(result).not.toMatch(/^\[!note\]/m);
  });

  test('multi-paragraph body separates paragraphs with `>` (issue #135)', () => {
    // Regression guard for the round-trip body-bounds bug: a blank line
    // between paragraphs must round-trip as a `>` line, not a bare blank
    // line, so re-upload preserves both paragraphs inside the macro.
    const storage = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>foo</p><p>bar</p></ac:rich-text-body></ac:structured-macro>';
    const result = converter.storageToMarkdown(storage);
    expect(result).toContain('> **INFO**\n> foo\n>\n> bar');
  });

  test('full round-trip preserves multi-paragraph body inside the macro (issue #135)', () => {
    const original = '> **INFO**\n> foo\n>\n> bar';
    const storage1 = converter.markdownToStorage(original);
    const downloaded = converter.storageToMarkdown(storage1);
    const storage2 = converter.markdownToStorage(downloaded);
    // Both paragraphs must remain inside the rich-text-body after re-upload.
    // Previously, the second paragraph escaped the macro because the bare
    // `[!info]` output form had ambiguous body bounds.
    expect(storage2).toMatch(/<ac:rich-text-body>[\s\S]*<p>foo<\/p>[\s\S]*<p>bar<\/p>[\s\S]*<\/ac:rich-text-body>/);
    expect(storage2).not.toMatch(/<\/ac:structured-macro>\s*<p>bar<\/p>/);
  });

  test('full round-trip preserves single-paragraph body', () => {
    const original = '> **WARNING**\n> single line body';
    const storage1 = converter.markdownToStorage(original);
    const downloaded = converter.storageToMarkdown(storage1);
    const storage2 = converter.markdownToStorage(downloaded);
    expect(storage2).toContain('<ac:structured-macro ac:name="warning">');
    expect(storage2).toContain('single line body');
    expect(storage2).not.toContain('**WARNING**');
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
