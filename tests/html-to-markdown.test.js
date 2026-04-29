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

  describe('anchor links', () => {
    test('converts plain <a href> to markdown link', () => {
      expect(htmlToMarkdown('<p><a href="https://example.com">Example</a></p>'))
        .toBe('[Example](https://example.com)');
    });

    test('preserves URL on smart-link / inline-card anchors (data-card-appearance)', () => {
      const html = '<p><a href="https://example.atlassian.net/wiki/spaces/X/pages/123" data-card-appearance="inline">Linked Page</a></p>';
      expect(htmlToMarkdown(html))
        .toBe('[Linked Page](https://example.atlassian.net/wiki/spaces/X/pages/123)');
    });

    test('preserves URL on anchors carrying smart-link metadata attributes', () => {
      const html = '<p><a data-linked-resource-id="123" href="https://example.com/page" data-linked-resource-type="page">Title</a></p>';
      expect(htmlToMarkdown(html))
        .toBe('[Title](https://example.com/page)');
    });

    test('preserves anchor links inside table cells', () => {
      const html = '<table><tr><th>Doc</th></tr><tr><td><a href="https://example.com/a" data-card-appearance="inline">A</a></td></tr></table>';
      expect(htmlToMarkdown(html))
        .toContain('[A](https://example.com/a)');
    });

    test('preserves anchor links inside list items', () => {
      const html = '<ul><li><a href="https://example.com/x" data-card-appearance="inline">X</a></li></ul>';
      expect(htmlToMarkdown(html))
        .toBe('- [X](https://example.com/x)');
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

  describe('fenced code from <pre><code> preserves indentation', () => {
    const preCode = (lang, body) =>
      `<pre><code class="language-${lang}">${body}</code></pre>`;

    test('leading 4-space indent in fenced code is preserved', () => {
      const html = preCode('python', 'def foo():\n    return 1');
      expect(htmlToMarkdown(html)).toBe('```python\ndef foo():\n    return 1\n```');
    });

    test('nested 8-space indent in fenced code is preserved', () => {
      const html = preCode('python', 'def foo():\n    if x:\n        return 1');
      expect(htmlToMarkdown(html)).toBe('```python\ndef foo():\n    if x:\n        return 1\n```');
    });

    test('tab indent in fenced code is preserved', () => {
      const html = preCode('go', 'func f() {\n\treturn 1\n}');
      expect(htmlToMarkdown(html)).toBe('```go\nfunc f() {\n\treturn 1\n}\n```');
    });

    test('inline multi-space inside fenced code is preserved', () => {
      const html = preCode('text', 'a    b    c');
      expect(htmlToMarkdown(html)).toBe('```text\na    b    c\n```');
    });

    test('<pre><code> without language class emits a bare fence', () => {
      const html = '<pre><code>raw line\n    indented</code></pre>';
      expect(htmlToMarkdown(html)).toBe('```\nraw line\n    indented\n```');
    });

    test('non-fence content still has leading whitespace stripped', () => {
      expect(htmlToMarkdown('<p>    hello world</p>')).toBe('hello world');
    });

    test('cleanup still applies between fenced blocks', () => {
      const html = `<p>    para</p>${preCode('py', 'x = 1')}<p>    para2</p>`;
      expect(htmlToMarkdown(html)).toBe('para\n\n```py\nx = 1\n```\n\npara2');
    });

    test('# comment lines inside fenced code do not trigger header blank-line rule', () => {
      const html = preCode('python', '# comment\nx = 1');
      expect(htmlToMarkdown(html)).toBe('```python\n# comment\nx = 1\n```');
    });

    test('trailing whitespace inside fenced code is preserved', () => {
      const html = preCode('py', 'x = 1   \ny = 2   ');
      expect(htmlToMarkdown(html)).toBe('```py\nx = 1   \ny = 2   \n```');
    });

    test('consecutive blank lines inside fenced code are preserved (no 3+ collapse)', () => {
      const html = preCode('text', 'a\n\n\n\nb');
      expect(htmlToMarkdown(html)).toBe('```text\na\n\n\n\nb\n```');
    });

    test('HTML entities inside fenced code are decoded', () => {
      const html = preCode('go', 'if x &lt; 10 &amp;&amp; y &gt; 0 {}');
      expect(htmlToMarkdown(html)).toBe('```go\nif x < 10 && y > 0 {}\n```');
    });

    test('inline <code> still becomes single backticks (no regression)', () => {
      expect(htmlToMarkdown('<p>use <code>npm install</code> first</p>'))
        .toBe('use `npm install` first');
    });

    test('empty <pre><code> body produces an empty fenced block', () => {
      expect(htmlToMarkdown('<pre><code class="language-py"></code></pre>'))
        .toBe('```py\n\n```');
    });

    test('two adjacent <pre><code> blocks each emit their own fence', () => {
      const html = '<pre><code class="language-js">a</code></pre><pre><code class="language-py">b</code></pre>';
      expect(htmlToMarkdown(html)).toBe('```js\na\n```\n\n```py\nb\n```');
    });

    test('payload containing ``` uses a 4-backtick fence (CommonMark-safe)', () => {
      const html = '<pre><code class="language-md">before\n```\nafter</code></pre>';
      expect(htmlToMarkdown(html)).toBe('````md\nbefore\n```\nafter\n````');
    });

    test('payload containing a 4-backtick run uses a 5-backtick fence', () => {
      const html = '<pre><code class="language-md">x ```` y</code></pre>';
      expect(htmlToMarkdown(html)).toBe('`````md\nx ```` y\n`````');
    });

    test('payload with &#96; decimal entities for backticks sizes fence after decode', () => {
      const html = '<pre><code class="language-md">before\n&#96;&#96;&#96;\nafter</code></pre>';
      expect(htmlToMarkdown(html)).toBe('````md\nbefore\n```\nafter\n````');
    });

    test('payload with &#x60; hex entities for backticks sizes fence after decode', () => {
      const html = '<pre><code class="language-md">before\n&#x60;&#x60;&#x60;\nafter</code></pre>';
      expect(htmlToMarkdown(html)).toBe('````md\nbefore\n```\nafter\n````');
    });

    test('payload mixing literal backtick and &#96; entity totals correctly for fence sizing', () => {
      const html = '<pre><code class="language-md">a`&#96;&#96;b</code></pre>';
      expect(htmlToMarkdown(html)).toBe('````md\na```b\n````');
    });

    test('prose with mid-line ``` before a code block does not steal fence boundary', () => {
      const html = '<p>literal ``` marker</p><pre><code class="language-js">const x = 1;</code></pre><p>tail</p>';
      expect(htmlToMarkdown(html)).toBe('literal ``` marker\n\n```js\nconst x = 1;\n```\n\ntail');
    });

    test('prose with mid-line ``` before a code block preserves the code body indent', () => {
      const html = '<p>before ``` after</p><pre><code class="language-py">def foo():\n    return 1</code></pre>';
      expect(htmlToMarkdown(html)).toBe('before ``` after\n\n```py\ndef foo():\n    return 1\n```');
    });

    test('multi-class language attribute (Prism / highlight.js) extracts only the language token', () => {
      const html = '<pre><code class="language-js hljs">x = 1</code></pre>';
      expect(htmlToMarkdown(html)).toBe('```js\nx = 1\n```');
    });

    test('multi-class with sibling class after language- emits a clean info string', () => {
      const html = '<pre><code class="language-python prism">x = 1</code></pre>';
      expect(htmlToMarkdown(html)).toBe('```python\nx = 1\n```');
    });

    test('hyphenated language identifier (e.g. objective-c) is preserved verbatim', () => {
      const html = '<pre><code class="language-objective-c">int x;</code></pre>';
      expect(htmlToMarkdown(html)).toBe('```objective-c\nint x;\n```');
    });
  });
});
