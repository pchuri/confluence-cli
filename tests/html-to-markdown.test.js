const { htmlToMarkdown, NAMED_ENTITIES } = require('../lib/html-to-markdown');

describe('htmlToMarkdown', () => {
  describe('inline formatting', () => {
    test('converts <strong> to **bold**', () => {
      expect(htmlToMarkdown('<p><strong>hello</strong></p>')).toBe('**hello**');
    });

    test('converts <em> to *italic*', () => {
      expect(htmlToMarkdown('<p><em>hi</em></p>')).toBe('*hi*');
    });

    test('converts <code> to backticks', () => {
      expect(htmlToMarkdown('<p>use <code>npm install</code> first</p>'))
        .toBe('use `npm install` first');
    });

    test('preserves attributes-laden tags via stripped wrappers', () => {
      expect(htmlToMarkdown('<p><strong class="x">bold</strong></p>'))
        .toBe('**bold**');
    });
  });

  describe('headings', () => {
    test.each([1, 2, 3, 4, 5, 6])('converts <h%i> to # heading', (level) => {
      const html = `<h${level}>Title</h${level}>`;
      expect(htmlToMarkdown(html)).toBe(`${'#'.repeat(level)} Title`);
    });

    test('ensures a blank line follows headings', () => {
      const result = htmlToMarkdown('<h2>Heading</h2><p>body</p>');
      expect(result).toBe('## Heading\n\nbody');
    });
  });

  describe('lists', () => {
    test('converts <ul> to a bullet list', () => {
      const html = '<ul><li>one</li><li>two</li><li>three</li></ul>';
      expect(htmlToMarkdown(html)).toBe('- one\n- two\n- three');
    });

    test('converts <ol> to a numbered list', () => {
      const html = '<ol><li>first</li><li>second</li></ol>';
      expect(htmlToMarkdown(html)).toBe('1. first\n2. second');
    });

    test('skips empty <li> entries', () => {
      const html = '<ul><li>kept</li><li>   </li><li>also kept</li></ul>';
      expect(htmlToMarkdown(html)).toBe('- kept\n- also kept');
    });
  });

  describe('tables', () => {
    test('converts a simple table to GFM markdown with header separator', () => {
      const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
      const result = htmlToMarkdown(html);
      expect(result).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    });

    test('replaces empty cells with a placeholder so the row stays well-formed', () => {
      const html = '<table><tr><td>x</td><td></td></tr></table>';
      const result = htmlToMarkdown(html);
      // Empty cells collapse to a single space, so the joined row becomes "| x | |"
      expect(result).toContain('| x | |');
    });
  });

  describe('block elements', () => {
    test('converts <br> to a newline', () => {
      expect(htmlToMarkdown('line1<br>line2')).toBe('line1\nline2');
      expect(htmlToMarkdown('line1<br/>line2')).toBe('line1\nline2');
      expect(htmlToMarkdown('line1<br />line2')).toBe('line1\nline2');
    });

    test('converts <hr> to a markdown rule', () => {
      expect(htmlToMarkdown('above<hr>below')).toBe('above\n---\nbelow');
    });

    test('keeps <details>/<summary> tags', () => {
      const html = '<details><summary>Click</summary><p>hidden</p></details>';
      const result = htmlToMarkdown(html);
      expect(result).toContain('<details>');
      expect(result).toContain('<summary>');
      expect(result).toContain('Click');
      expect(result).toContain('hidden');
    });

    test('extracts datetime from <time> elements', () => {
      expect(htmlToMarkdown('<p>at <time datetime="2024-05-01T12:00:00Z"></time> sharp</p>'))
        .toBe('at 2024-05-01T12:00:00Z sharp');
    });
  });

  describe('numeric and named HTML entities', () => {
    test('decodes decimal entities like &#65;', () => {
      expect(htmlToMarkdown('<p>&#65;&#66;&#67;</p>')).toBe('ABC');
    });

    test('decodes hexadecimal entities like &#x41;', () => {
      expect(htmlToMarkdown('<p>&#x41;&#x42;</p>')).toBe('AB');
    });

    test('decodes the basic XML entities', () => {
      expect(htmlToMarkdown('<p>&lt;tag&gt; &amp; &quot;q&quot; &apos;a&apos;</p>'))
        .toBe('<tag> & "q" \'a\'');
    });

    test('decodes typographic punctuation entities', () => {
      const html = '<p>&ldquo;hi&rdquo; &lsquo;a&rsquo; &mdash; &ndash; &hellip;</p>';
      expect(htmlToMarkdown(html)).toBe('"hi" \'a\' — – ...');
    });

    test('decodes non-breaking space and bullet entities', () => {
      expect(htmlToMarkdown('<p>a&nbsp;b &bull; c</p>')).toBe('a b • c');
    });

    test('decodes accented Latin named entities from the table', () => {
      expect(htmlToMarkdown('<p>caf&eacute; na&iuml;ve &ntilde;</p>'))
        .toBe('café naïve ñ');
    });

    test('preserves unknown named entities verbatim', () => {
      expect(htmlToMarkdown('<p>&unknownentity;</p>')).toBe('&unknownentity;');
    });

    test('NAMED_ENTITIES exports a non-empty mapping for all uppercase variants', () => {
      expect(typeof NAMED_ENTITIES).toBe('object');
      expect(NAMED_ENTITIES.eacute).toBe('é');
      expect(NAMED_ENTITIES.Eacute).toBe('É');
    });
  });

  describe('whitespace cleanup', () => {
    test('collapses three or more consecutive newlines to a blank line', () => {
      expect(htmlToMarkdown('<p>a</p>\n\n\n\n<p>b</p>')).toBe('a\n\nb');
    });

    test('strips trailing whitespace on each line', () => {
      expect(htmlToMarkdown('<p>hello   </p>')).toBe('hello');
    });

    test('collapses runs of spaces to a single space', () => {
      expect(htmlToMarkdown('<p>a    b</p>')).toBe('a b');
    });
  });

  describe('regression: unknown tags are dropped', () => {
    test('removes generic unknown elements but keeps text content', () => {
      expect(htmlToMarkdown('<p><span class="x">visible</span></p>')).toBe('visible');
    });
  });
});
