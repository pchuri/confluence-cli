const { htmlToStorage, HtmlDepthExceededError } = require('../lib/html-to-storage');

describe('htmlToStorage', () => {
  describe('text node entities', () => {
    test('plain text passes through', () => {
      expect(htmlToStorage('<p>hello</p>')).toBe('<p>hello</p>');
    });

    test('ampersand entity is preserved verbatim (parser keeps entities raw)', () => {
      expect(htmlToStorage('<p>a &amp; b</p>')).toBe('<p>a &amp; b</p>');
    });

    test('angle bracket entities are preserved verbatim', () => {
      expect(htmlToStorage('<p>1 &lt; 2 &gt; 0</p>')).toBe('<p>1 &lt; 2 &gt; 0</p>');
    });

    test('literal `"` in text is left literal (matches V1 markdown-it output)', () => {
      expect(htmlToStorage('<p>he said "hi"</p>')).toBe('<p>he said "hi"</p>');
    });
  });

  describe('handled element types', () => {
    test('headings h1-h6 round-trip', () => {
      for (let i = 1; i <= 6; i++) {
        expect(htmlToStorage(`<h${i}>title</h${i}>`)).toBe(`<h${i}>title</h${i}>`);
      }
    });

    test('strong / em nest correctly', () => {
      expect(htmlToStorage('<p>plain <strong>bold <em>inner</em></strong> end</p>'))
        .toBe('<p>plain <strong>bold <em>inner</em></strong> end</p>');
    });

    test('hr is normalized to self-closing form (matches V1\'s explicit normalize)', () => {
      expect(htmlToStorage('<hr>')).toBe('<hr />');
    });

    test('br stays in markdown-it form `<br>` (V1 does not transform it)', () => {
      expect(htmlToStorage('<br>')).toBe('<br>');
    });

    test('img stays in markdown-it form `<img …>` with attributes preserved', () => {
      expect(htmlToStorage('<img src="x" alt="y">')).toBe('<img src="x" alt="y">');
    });

    test('attributes on h1-h6 / p / strong / em / inline code are preserved (raw HTML input)', () => {
      // markdown-it never emits these with attributes, but raw HTML input
      // through `htmlToConfluenceStorage` does. Walker must preserve them.
      expect(htmlToStorage('<h1 id="top">Title</h1>'))
        .toBe('<h1 id="top">Title</h1>');
      expect(htmlToStorage('<p class="lead">intro</p>'))
        .toBe('<p class="lead">intro</p>');
      expect(htmlToStorage('<p>see <strong class="hl">bold</strong> word</p>'))
        .toBe('<p>see <strong class="hl">bold</strong> word</p>');
      expect(htmlToStorage('<p>use <code data-x="y">npm</code></p>'))
        .toBe('<p>use <code data-x="y">npm</code></p>');
    });
  });

  describe('list elements', () => {
    test('tight `<li>` content is wrapped in `<p>` to match V1 regex', () => {
      expect(htmlToStorage('<ul><li>one</li><li>two</li></ul>'))
        .toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
    });

    test('inline children do not prevent the `<p>` wrap', () => {
      expect(htmlToStorage('<ul><li>text <strong>bold</strong> end</li></ul>'))
        .toBe('<ul><li><p>text <strong>bold</strong> end</p></li></ul>');
    });

    test('phrasing-content children (kbd, abbr, etc.) do not prevent the `<p>` wrap', () => {
      // Raw-HTML input case: V1's single-line regex would wrap any inline
      // content. The walker treats common phrasing-content elements the
      // same way for byte parity with V1 on `--input-format html`.
      expect(htmlToStorage('<ul><li>press <kbd>Ctrl</kbd> to copy</li></ul>'))
        .toBe('<ul><li><p>press <kbd>Ctrl</kbd> to copy</p></li></ul>');
    });

    test('block-level child (nested list) suppresses the wrap', () => {
      const html = '<ul><li>outer<ul><li>inner</li></ul></li></ul>';
      expect(htmlToStorage(html))
        .toBe('<ul><li>outer<ul><li><p>inner</p></li></ul></li></ul>');
    });

    test('newline in a text-node child suppresses the wrap', () => {
      const html = '<ul>\n<li>line one\nline two</li>\n</ul>';
      expect(htmlToStorage(html))
        .toBe('<ul>\n<li>line one\nline two</li>\n</ul>');
    });

    test('ordered list behaves the same as unordered', () => {
      expect(htmlToStorage('<ol><li>one</li></ol>'))
        .toBe('<ol><li><p>one</p></li></ol>');
    });
  });

  describe('code blocks', () => {
    test('fenced code with language → ac:structured-macro with CDATA', () => {
      const html = '<pre><code class="language-javascript">function() { return 1; }\n</code></pre>';
      expect(htmlToStorage(html)).toBe(
        '<ac:structured-macro ac:name="code">' +
        '<ac:parameter ac:name="language">javascript</ac:parameter>' +
        '<ac:plain-text-body><![CDATA[function() { return 1; }]]></ac:plain-text-body>' +
        '</ac:structured-macro>'
      );
    });

    test('fenced code without a language defaults to text', () => {
      const html = '<pre><code>plain code</code></pre>';
      expect(htmlToStorage(html)).toContain('<ac:parameter ac:name="language">text</ac:parameter>');
    });

    test('html entities in code body are emitted decoded inside CDATA', () => {
      const html = '<pre><code class="language-html">&lt;blockquote&gt;</code></pre>';
      expect(htmlToStorage(html)).toContain('<![CDATA[<blockquote>]]>');
    });

    test(']]> in code body is escaped via CDATA section split', () => {
      const html = '<pre><code>foo]]&gt;bar</code></pre>';
      expect(htmlToStorage(html)).toContain('foo]]]]><![CDATA[>bar');
    });

    test('code body preserves double-encoding (`&amp;lt;` round-trips as `&lt;`)', () => {
      // preserveDouble:true ordering: amp runs last, so the literal entity
      // payload survives. Without it, the body would over-decode to `<`.
      const html = '<pre><code>&amp;lt;tag&amp;gt;</code></pre>';
      expect(htmlToStorage(html)).toContain('<![CDATA[&lt;tag&gt;]]>');
    });

    test('code body decodes single-encoded entities normally', () => {
      // Verifies preserveDouble:true still decodes single-encoded entities
      // (the four it knows about). `&quot;` → `"`, `&amp;` → `&`.
      const html = '<pre><code>a &amp; b &quot;c&quot;</code></pre>';
      expect(htmlToStorage(html)).toContain('<![CDATA[a & b "c"]]>');
    });

    test('inline `<code>` is identity (not transformed to a macro)', () => {
      expect(htmlToStorage('<p>see <code>x &lt; y</code></p>'))
        .toBe('<p>see <code>x &lt; y</code></p>');
    });

    test('`<pre>` without a single `<code>` child is left as plain pre', () => {
      expect(htmlToStorage('<pre>raw block</pre>')).toBe('<pre>raw block</pre>');
    });

    test('`<pre>` with whitespace siblings around `<code>` is not transformed', () => {
      // V1's regex requires `<pre><code...>` adjacency; whitespace defeats it.
      const html = '<pre>\n<code>hi</code>\n</pre>';
      expect(htmlToStorage(html)).toBe('<pre>\n<code>hi</code>\n</pre>');
    });
  });

  describe('passthrough fallback for unhandled tags', () => {
    test('attributes on unhandled tags are preserved', () => {
      const out = htmlToStorage('<aside data-x="y"><span>note</span></aside>');
      expect(out).toBe('<aside data-x="y"><span>note</span></aside>');
    });

    test('attribute values with `&quot;` entities are preserved verbatim', () => {
      const out = htmlToStorage('<details title="he said &quot;hi&quot;">x</details>');
      expect(out).toBe('<details title="he said &quot;hi&quot;">x</details>');
    });
  });

  describe('blockquote and callout markers', () => {
    test('plain blockquote stays a blockquote', () => {
      expect(htmlToStorage('<blockquote><p>quote</p></blockquote>'))
        .toBe('<blockquote><p>quote</p></blockquote>');
    });

    test('INFO marker (paragraph-separated form) becomes info macro', () => {
      const html = '<blockquote>\n<p><strong>INFO</strong></p>\n<p>body</p>\n</blockquote>';
      const out = htmlToStorage(html);
      expect(out).toContain('<ac:structured-macro ac:name="info">');
      expect(out).toContain('<p>body</p>');
      expect(out).not.toContain('<strong>INFO</strong>');
    });

    test('INFO marker (same-line form) becomes info macro and strips marker text', () => {
      const html = '<blockquote>\n<p><strong>INFO</strong>\nbody</p>\n</blockquote>';
      const out = htmlToStorage(html);
      expect(out).toContain('<ac:structured-macro ac:name="info">');
      expect(out).toContain('<p>body</p>');
      expect(out).not.toContain('<strong>INFO</strong>');
    });

    test('WARNING and NOTE markers map to their respective macros', () => {
      expect(htmlToStorage('<blockquote><p><strong>WARNING</strong>\nx</p></blockquote>'))
        .toContain('<ac:structured-macro ac:name="warning">');
      expect(htmlToStorage('<blockquote><p><strong>NOTE</strong>\nx</p></blockquote>'))
        .toContain('<ac:structured-macro ac:name="note">');
    });

    test('mid-paragraph **INFO** does NOT trigger marker conversion (false-positive guard)', () => {
      const html = '<blockquote><p>see <strong>INFO</strong> at the start.</p></blockquote>';
      const out = htmlToStorage(html);
      expect(out).not.toContain('ac:structured-macro');
      expect(out).toContain('<blockquote>');
    });

    test('nested INFO inside outer blockquote keeps outer balanced', () => {
      const html = '<blockquote>\n<blockquote>\n<p><strong>INFO</strong>\ninner</p>\n</blockquote>\n</blockquote>';
      const out = htmlToStorage(html);
      expect(out).toMatch(/<blockquote>[\s\S]*<ac:structured-macro ac:name="info">[\s\S]*<\/ac:structured-macro>[\s\S]*<\/blockquote>/);
      expect(out).not.toMatch(/<\/ac:structured-macro>\s*<\/blockquote>\s*<\/blockquote>/);
    });
  });

  describe('paragraph marker patterns', () => {
    test('`<p><strong>TOC</strong></p>` becomes the toc macro', () => {
      expect(htmlToStorage('<p><strong>TOC</strong></p>'))
        .toBe('<ac:structured-macro ac:name="toc" />');
    });

    test('`<p><strong>ANCHOR: id</strong></p>` becomes the anchor macro', () => {
      expect(htmlToStorage('<p><strong>ANCHOR: my-section</strong></p>'))
        .toBe('<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">my-section</ac:parameter></ac:structured-macro>');
    });

    test('paragraph marker detection requires the strict shape (extra text falls through)', () => {
      // Embellished — extra text outside the strong → plain paragraph
      expect(htmlToStorage('<p>see <strong>TOC</strong></p>'))
        .toBe('<p>see <strong>TOC</strong></p>');
    });

    test('EXPAND open + close paragraphs collapse into the expand macro', () => {
      const html = '<p><strong>EXPAND: Show</strong></p>\n<p>body</p>\n<p><strong>EXPAND_END</strong></p>';
      const out = htmlToStorage(html);
      expect(out).toContain('<ac:structured-macro ac:name="expand">');
      expect(out).toContain('<ac:parameter ac:name="title">Show</ac:parameter>');
      expect(out).toContain('<p>body</p>');
      expect(out).not.toContain('<strong>EXPAND');
    });

    test('EXPAND title with inline HTML is stripped (matches V1 cleanTitle rule)', () => {
      const html = '<p><strong>EXPAND: a <em>b</em> c</strong></p>\n<p>body</p>\n<p><strong>EXPAND_END</strong></p>';
      const out = htmlToStorage(html);
      expect(out).toContain('<ac:parameter ac:name="title">a b c</ac:parameter>');
      expect(out).not.toContain('<em>');
    });

    test('EXPAND without a matching close is left as plain paragraphs', () => {
      const html = '<p><strong>EXPAND: orphan</strong></p>\n<p>body</p>';
      const out = htmlToStorage(html);
      expect(out).not.toContain('ac:structured-macro');
      expect(out).toContain('<p><strong>EXPAND: orphan</strong></p>');
    });

    test('EXPAND_END detection tolerates trailing whitespace text nodes inside <p>', () => {
      // Defensive: if a parser variation emits `<p><strong>EXPAND_END</strong>\n</p>`
      // (with a trailing whitespace text node inside the paragraph), the close
      // is still detected and the macro still collapses.
      const html = '<p><strong>EXPAND: t</strong>\n</p>\n<p>body</p>\n<p><strong>EXPAND_END</strong>\n</p>';
      const out = htmlToStorage(html);
      expect(out).toContain('<ac:structured-macro ac:name="expand">');
      expect(out).toContain('<ac:parameter ac:name="title">t</ac:parameter>');
    });

    test('TOC marker detection tolerates trailing whitespace text nodes', () => {
      const html = '<p><strong>TOC</strong>\n</p>';
      expect(htmlToStorage(html)).toBe('<ac:structured-macro ac:name="toc" />');
    });
  });

  describe('tables', () => {
    test('table / thead / tbody / tr emit verbatim with children walked', () => {
      const html = '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>';
      // th and td additionally wrap their inline content in <p> per V1 quirk
      expect(htmlToStorage(html)).toBe(
        '<table><thead><tr><th><p>h</p></th></tr></thead><tbody><tr><td><p>c</p></td></tr></tbody></table>'
      );
    });

    test('th / td with inline children get the `<p>` wrap', () => {
      const html = '<table><tbody><tr><td>plain <strong>bold</strong></td></tr></tbody></table>';
      expect(htmlToStorage(html)).toBe(
        '<table><tbody><tr><td><p>plain <strong>bold</strong></p></td></tr></tbody></table>'
      );
    });

    test('th / td whose content spans multiple lines do NOT get the wrap', () => {
      const html = '<table><tbody><tr><td>line one\nline two</td></tr></tbody></table>';
      expect(htmlToStorage(html)).toBe(
        '<table><tbody><tr><td>line one\nline two</td></tr></tbody></table>'
      );
    });
  });

  describe('links', () => {
    test('plain mode is identity (preserves all attributes)', () => {
      const html = '<a href="https://example.com" title="t">link</a>';
      expect(htmlToStorage(html, { linkStyle: 'plain' })).toBe(html);
    });

    test('smart mode adds data-card-appearance and keeps other attributes', () => {
      const html = '<a href="https://example.com" title="tooltip">link</a>';
      expect(htmlToStorage(html, { linkStyle: 'smart' })).toBe(
        '<a href="https://example.com" title="tooltip" data-card-appearance="inline">link</a>'
      );
    });

    test('wiki mode rewrites to ac:link + ri:url with CDATA body', () => {
      expect(htmlToStorage('<a href="https://example.com">link</a>', { linkStyle: 'wiki' }))
        .toBe('<ac:link><ri:url ri:value="https://example.com" /><ac:plain-text-link-body><![CDATA[link]]></ac:plain-text-link-body></ac:link>');
    });

    test('default linkStyle is `wiki` for server (isCloud:false) and `smart` for cloud', () => {
      const a = '<a href="x">y</a>';
      expect(htmlToStorage(a, { isCloud: false })).toContain('<ac:link>');
      expect(htmlToStorage(a, { isCloud: true })).toContain('data-card-appearance="inline"');
    });

    test('anchor link (`#id`) becomes ac:link with ac:anchor regardless of linkStyle', () => {
      const html = '<a href="#section">jump</a>';
      const expected = '<ac:link ac:anchor="section"><ac:plain-text-link-body><![CDATA[jump]]></ac:plain-text-link-body></ac:link>';
      expect(htmlToStorage(html, { linkStyle: 'smart' })).toBe(expected);
      expect(htmlToStorage(html, { linkStyle: 'wiki' })).toBe(expected);
      expect(htmlToStorage(html, { linkStyle: 'plain' })).toBe(expected);
    });

    test('anchor link body decodes the entity set V1 decodes', () => {
      const html = '<a href="#x">a &amp; b &lt;c&gt;</a>';
      expect(htmlToStorage(html, { linkStyle: 'wiki' }))
        .toContain('<![CDATA[a & b <c>]]>');
    });
  });

  describe('whitespace and structure', () => {
    test('newlines between elements are preserved', () => {
      const html = '<h1>A</h1>\n<h2>B</h2>\n';
      expect(htmlToStorage(html)).toBe(html);
    });

    test('multiple top-level paragraphs are walked in order', () => {
      const html = '<p>one</p>\n<p>two</p>\n<p>three</p>\n';
      expect(htmlToStorage(html)).toBe(html);
    });
  });

  describe('attribute value escaping', () => {
    test('literal `"` from a single-quoted source attribute is escaped to &quot;', () => {
      // htmlparser2 accepts single-quoted attribute values containing literal
      // double quotes. Without escape on emit, the resulting double-quoted
      // attribute slot would be closed mid-value and corrupt the XML.
      const out = htmlToStorage('<details title=\'he said "hi"\'>x</details>');
      expect(out).toBe('<details title="he said &quot;hi&quot;">x</details>');
    });

    test('literal `"` in a smart-link href is escaped on emit', () => {
      // The smart-link branch spreads attribs into a new object; the same
      // escape must apply there. Single-quoted href is the realistic vector
      // (ampersand-rich URLs in single-quoted attributes).
      const html = '<a href=\'q?a="b"\'>l</a>';
      expect(htmlToStorage(html, { linkStyle: 'smart' }))
        .toBe('<a href="q?a=&quot;b&quot;" data-card-appearance="inline">l</a>');
    });
  });

  describe('max-depth guard', () => {
    test('throws HtmlDepthExceededError on pathologically deep nesting rather than crashing the process', () => {
      // Build a 1000-deep chain of <div> wrappers — well past the default cap
      // of 256. A native stack overflow would abort any caller mid-convert; a
      // typed error lets the caller skip the input and continue. Mirrors the
      // storage-walker test in tests/macro-converter.test.js.
      const html = '<div>'.repeat(1000) + 'x' + '</div>'.repeat(1000);
      expect(() => htmlToStorage(html)).toThrow(HtmlDepthExceededError);
    });

    test('within-limit nesting (50 levels) walks without error', () => {
      // 50 levels comfortably exceeds realistic markdown-it output depth but
      // stays well under the 256 cap, so it must succeed.
      const html = '<div>'.repeat(50) + 'x' + '</div>'.repeat(50);
      expect(() => htmlToStorage(html)).not.toThrow();
    });
  });
});
