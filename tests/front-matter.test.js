const {
  FrontMatterError,
  parseFrontMatter,
  serializeFrontMatter,
  prependFrontMatter,
  parsePropertyKeys,
} = require('../lib/front-matter');

describe('parseFrontMatter', () => {
  test('returns the body untouched when there is no front matter', () => {
    const text = '# Title\n\nBody\n';
    expect(parseFrontMatter(text)).toEqual({ properties: null, body: text });
  });

  test('extracts the properties map and strips the block from the body', () => {
    const text = [
      '---',
      'properties:',
      '  content-appearance-published: full-width',
      '  settings:',
      '    color: red',
      '    tags: [a, b]',
      '---',
      '',
      '# Title',
      '',
    ].join('\n');

    expect(parseFrontMatter(text)).toEqual({
      properties: {
        'content-appearance-published': 'full-width',
        settings: { color: 'red', tags: ['a', 'b'] },
      },
      body: '# Title\n',
    });
  });

  test('handles CRLF line endings, a BOM, and a "..." closing line', () => {
    const text = '\uFEFF---\r\nproperties:\r\n  width: full-width\r\n...\r\n\r\nBody\r\n';
    expect(parseFrontMatter(text)).toEqual({
      properties: { width: 'full-width' },
      body: 'Body\r\n',
    });
  });

  test('ignores other top-level keys', () => {
    const text = '---\ntitle: Ignored\ntags: [x]\nproperties:\n  a: 1\n---\nBody';
    expect(parseFrontMatter(text)).toEqual({ properties: { a: 1 }, body: 'Body' });
  });

  test('returns an empty map when front matter has no properties', () => {
    expect(parseFrontMatter('---\ntitle: x\n---\nBody')).toEqual({ properties: {}, body: 'Body' });
    expect(parseFrontMatter('---\n---\nBody')).toEqual({ properties: {}, body: 'Body' });
  });

  test('keeps a later thematic break in the body', () => {
    const text = '---\nproperties:\n  a: b\n---\nIntro\n\n---\n\nMore\n';
    expect(parseFrontMatter(text).body).toBe('Intro\n\n---\n\nMore\n');
  });

  test('keeps nulls nested inside a value', () => {
    const { properties } = parseFrontMatter('---\nproperties:\n  a:\n    b: null\n    c: [1, null]\n---\n');
    expect(properties).toEqual({ a: { b: null, c: [1, null] } });
  });

  test('does not convert dates into Date objects', () => {
    const { properties } = parseFrontMatter('---\nproperties:\n  reviewed: 2026-10-05\n---\n');
    expect(properties.reviewed).toBe('2026-10-05');
  });

  test.each([
    ['unterminated block', '---\nproperties:\n  a: b\n', /no closing/],
    ['invalid YAML', '---\nproperties: [a\n---\n', /Invalid YAML/],
    ['non-mapping root', '---\n- a\n- b\n---\n', /must be a YAML mapping/],
    ['non-mapping properties', '---\nproperties: [a, b]\n---\n', /"properties" must be a mapping/],
    ['null value', '---\nproperties:\n  a:\n---\n', /has no value/],
    ['non-finite number', '---\nproperties:\n  a: [1, .inf]\n---\n', /non-finite number/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseFrontMatter(text)).toThrow(FrontMatterError);
    expect(() => parseFrontMatter(text)).toThrow(message);
  });
});

describe('serializeFrontMatter', () => {
  test('returns an empty string when there are no properties', () => {
    expect(serializeFrontMatter({})).toBe('');
    expect(serializeFrontMatter(null)).toBe('');
  });

  test('renders properties in insertion order and round-trips through the parser', () => {
    const properties = {
      'content-appearance-published': 'full-width',
      settings: { color: 'red', count: 3, enabled: true, tags: ['a', 'b'] },
      reviewed: '2026-10-05',
    };
    const block = serializeFrontMatter(properties);

    expect(block.startsWith('---\nproperties:\n  content-appearance-published: full-width\n')).toBe(true);
    expect(block.endsWith('---\n\n')).toBe(true);
    expect(parseFrontMatter(`${block}# Body\n`)).toEqual({ properties, body: '# Body\n' });
  });
});

describe('prependFrontMatter', () => {
  test('leaves the body alone when there are no properties', () => {
    expect(prependFrontMatter({}, '# Title\n')).toBe('# Title\n');
  });

  test('emits an empty block when the body starts with a thematic break', () => {
    const body = '---\n\nNote: kept\n\n---\n';
    const output = prependFrontMatter({}, body);

    expect(output).toBe(`---\nproperties: {}\n---\n\n${body}`);
    expect(parseFrontMatter(output)).toEqual({ properties: {}, body });
  });
});

describe('parsePropertyKeys', () => {
  test('splits, trims, and de-duplicates keys', () => {
    expect(parsePropertyKeys(' a, b ,a,,c ')).toEqual(['a', 'b', 'c']);
  });

  test('rejects an empty list', () => {
    expect(() => parsePropertyKeys(' , ')).toThrow(/at least one property key/);
  });
});
