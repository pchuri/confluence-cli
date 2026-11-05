const ConfluenceClient = require('../lib/confluence-client');
const MockAdapter = require('axios-mock-adapter');

// Every request is intercepted, including unexpected ones: these regressions
// must never call a real Confluence instance.
describe('Inline comment selection matches visible storage text', () => {
  let client;
  let mock;

  beforeEach(() => {
    client = new ConfluenceClient({ domain: 'test.atlassian.net', token: 'test-token' });
    mock = new MockAdapter(client.client, { onNoMatch: 'throwException' });
    mock.onPost('https://test.atlassian.net/api/v2/inline-comments')
      .reply(200, { id: '1', pageId: '123' });
  });

  afterEach(() => mock.restore());

  const page = (storage) => mock.onGet('/content/123').reply(200, {
    body: { storage: { value: storage } }
  });

  test.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])('%s preserves selection case', async (tag) => {
    page(`<${tag}>Release notes</${tag}>`);
    await expect(client.createInlineCommentV2('123', '<p>review</p>', {
      textSelection: 'Release notes'
    })).resolves.toHaveProperty('id', '1');
  });

  test.each([
    ['link labels only', '<p><a href="https://example.com/foo">foo</a> foo</p>', 'foo', 2],
    ['phrase spanning a link', '<p>A <a href="https://example.com">link</a> here</p>', 'A link here', 1],
    ['adjacent inline formatting', '<p>pre<strong>fix</strong> &amp; <em>suffix</em></p>', 'prefix & suffix', 1],
    ['collapsed HTML whitespace', '<p>A\n <strong> link </strong> here</p>', 'A link here', 1],
    ['table heading case', '<table><tbody><tr><th>Release notes</th></tr></tbody></table>', 'Release notes', 1],
    ['list text', '<ol><li>Release notes</li><li>Release notes</li></ol>', 'Release notes', 2],
    ['plain link CDATA', '<p>A <ac:link><ri:page ri:content-title="Hidden"/><ac:plain-text-link-body><![CDATA[link]]></ac:plain-text-link-body></ac:link> here</p>', 'A link here', 1],
    ['literal CDATA markup and entities', '<ac:link><ac:plain-text-link-body><![CDATA[<tag> &amp;]]></ac:plain-text-link-body></ac:link>', '<tag> &amp;', 1],
    ['rich link body', '<ac:link><ri:page ri:content-title="foo"/><ac:link-body><strong>foo</strong></ac:link-body></ac:link>', 'foo', 1],
    ['implicit page label', '<ac:link><ri:page ri:content-title="A &amp; B"/></ac:link>', 'A & B', 1],
    ['implicit attachment label', '<ac:link><ri:attachment ri:filename="Report.pdf"/></ac:link>', 'Report.pdf', 1],
    ['code CDATA spacing', '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[foo  <bar>\n  baz &amp;]]></ac:plain-text-body></ac:structured-macro>', 'foo  <bar>\n  baz &amp;', 1],
    ['preformatted HTML', '<pre>foo  &lt;bar&gt;\n  baz</pre>', 'foo  <bar>\n  baz', 1],
    ['HTML entities and Unicode', '<p>Caf&eacute; &#x1F680; &nbsp; &amp;lt;</p>', 'Café 🚀 \u00a0 &lt;', 1],
    ['macro body without configuration', '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">foo</ac:parameter><ac:plain-text-body><![CDATA[foo]]></ac:plain-text-body></ac:structured-macro>', 'foo', 1],
    ['non-overlapping occurrences', '<p>aaaa</p>', 'aa', 2],
    ['consecutive explicit line breaks', '<p>foo<br/><br/>bar</p>', 'foo\n\nbar', 1],
    ['leading explicit line breaks', '<p><br/><br/>foo</p>', '\n\nfoo', 1],
    ['line breaks across inline elements', '<p>foo<br/><strong><br/>bar</strong></p>', 'foo\n\nbar', 1],
    ['structural boundaries remain normalized', '<div><p>foo</p></div><div><p>bar</p></div>', 'foo\nbar', 1]
  ])('%s', async (_name, storage, textSelection, count) => {
    page(storage);
    await client.createInlineCommentV2('123', '<p>review</p>', { textSelection });
    expect(mock.history.post).toHaveLength(1);
    expect(JSON.parse(mock.history.post[0].data).inlineCommentProperties).toEqual({
      textSelection,
      textSelectionMatchCount: count,
      textSelectionMatchIndex: 0
    });
  });

  test.each([
    ['href', '<a href="https://example.com/hidden">link</a>', 'hidden'],
    ['comment', '<p>visible<!-- hidden --></p>', 'hidden'],
    ['macro parameter', '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">hidden</ac:parameter><ac:plain-text-body><![CDATA[visible]]></ac:plain-text-body></ac:structured-macro>', 'hidden'],
    ['synthetic list marker', '<ol><li>first</li></ol>', '1. first'],
    ['neighboring paragraphs', '<p>foo</p><p>bar</p>', 'foobar'],
    ['line break', '<p>foo<br/>bar</p>', 'foobar'],
    ['neighboring table cells', '<table><tr><td>foo</td><td>bar</td></tr></table>', 'foobar'],
    ['hidden link destination', '<ac:link><ri:page ri:content-title="hidden"/><ac:plain-text-link-body><![CDATA[visible]]></ac:plain-text-link-body></ac:link>', 'hidden']
  ])('does not match %s', async (_name, storage, textSelection) => {
    page(storage);
    await expect(client.createInlineCommentV2('123', '<p>review</p>', { textSelection }))
      .rejects.toThrow('was not found');
    expect(mock.history.post).toHaveLength(0);
  });

  test('counts visible occurrences and converts the second CLI match to API index 1', async () => {
    page('<p><a href="https://example.com/foo">foo</a> foo</p>');
    await client.createInlineCommentV2('123', '<p>review</p>', { textSelection: 'foo', matchIndex: 2 });
    expect(JSON.parse(mock.history.post[0].data).inlineCommentProperties).toEqual({
      textSelection: 'foo', textSelectionMatchCount: 2, textSelectionMatchIndex: 1
    });
  });

  test('rejects a match index that would only exist in the hidden href', async () => {
    page('<p><a href="https://example.com/foo">foo</a> foo</p>');
    await expect(client.createInlineCommentV2('123', '<p>review</p>', { textSelection: 'foo', matchIndex: 3 }))
      .rejects.toThrow('occurs 2 times');
    expect(mock.history.post).toHaveLength(0);
  });
});
