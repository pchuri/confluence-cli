const MarkdownIt = require('markdown-it');
const cjkFriendlyEmphasis = require('../lib/cjk-friendly-emphasis');
const eaw = require('../lib/east-asian-width-data');
const MacroConverter = require('../lib/macro-converter');

function renderers() {
  const stock = new MarkdownIt().enable(['strikethrough']);
  const cjk = new MarkdownIt().enable(['strikethrough']).use(cjkFriendlyEmphasis);
  return { stock, cjk };
}

describe('cjkFriendlyEmphasis', () => {
  const { stock, cjk } = renderers();

  // Expected values are what markdown-it-cjk-friendly 3.0.0 renders.
  test.each([
    ['**「括弧」**の直後', '<strong>「括弧」</strong>の直後'],
    ['これは**私のやりたかったこと。**だからするの。', 'これは<strong>私のやりたかったこと。</strong>だからするの。'],
    ['税込**¥10,000**で入手できます。', '税込<strong>¥10,000</strong>で入手できます。'],
    ['**真，**她', '<strong>真，</strong>她'],
    ['太郎は**"こんにちわ"**といった', '太郎は<strong>&quot;こんにちわ&quot;</strong>といった'],
    ['**[製品ほげ](./product-foo)**と**[製品ふが](./product-bar)**をお試しください',
      '<strong><a href="./product-foo">製品ほげ</a></strong>と<strong><a href="./product-bar">製品ふが</a></strong>をお試しください'],
    ['*「強調」*の', '<em>「強調」</em>の'],
    ['~~「取消」~~の', '<s>「取消」</s>の'],
    // Korean: particles attach to the emphasized word.
    ['**스크립트(script)**라고', '<strong>스크립트(script)</strong>라고'],
    ['패키지를 발행하려면 **`npm publish`**를 실행하십시오.',
      '패키지를 발행하려면 <strong><code>npm publish</code></strong>를 실행하십시오.'],
    ['**(주)**는 회사입니다', '<strong>(주)</strong>는 회사입니다'],
    ['**100%**의 확률', '<strong>100%</strong>의 확률'],
    ['~~(취소)~~됨', '<s>(취소)</s>됨'],
  ])('emphasis next to CJK punctuation: %s', (src, expected) => {
    expect(stock.renderInline(src)).not.toBe(expected);
    expect(cjk.renderInline(src)).toBe(expected);
  });

  test.each([
    '**한국어**를',
    '**𠮷野家**の',
    '😀**「x」**😀',
    'foo**bar**baz',
    'a**"b"**c',
    '**Hello**world',
    // `_` keeps the CommonMark rule, as in the upstream extension.
    '__「括弧」__の',
    // Lone surrogates read as U+FFFD, as markdown-it itself does.
    '**\ud800**a',
  ])('unchanged from stock markdown-it: %s', (src) => {
    expect(cjk.renderInline(src)).toBe(stock.renderInline(src));
  });

  test('a quotation mark with VS2 counts as its fullwidth CJK form', () => {
    // U+201D followed by U+FE01 is the fullwidth form; with U+FE00 it is not,
    // and the variation selector is looked through to the punctuation.
    expect(cjk.renderInline('a**x”︁**b')).toBe('a<strong>x”︁</strong>b');
    expect(cjk.renderInline('a**x”︀**b')).toBe('a**x”︀**b');
  });

  test('a variation selector before a run is looked through, even without CJK', () => {
    // Both differ from stock markdown-it, as in markdown-it-cjk-friendly 3.0.0.
    expect(stock.renderInline('a**x”︀**b')).toBe('a<strong>x”︀</strong>b');
    expect(cjk.renderInline('a**x”︀**b')).toBe('a**x”︀**b');
    expect(stock.renderInline('”︀__x__')).toBe('”︀__x__');
    expect(cjk.renderInline('”︀__x__')).toBe('”︀<strong>x</strong>');
  });

  test('`_` still does not open or close inside a word', () => {
    expect(cjk.renderInline('漢字__強調__漢字')).toBe(stock.renderInline('漢字__強調__漢字'));
    expect(cjk.renderInline('漢字__強調__漢字')).toBe('漢字__強調__漢字');
  });

  test('MacroConverter renders it into storage', () => {
    const converter = new MacroConverter();
    const storage = converter.markdownToStorage('そして**「括弧」**の直後');
    expect(storage).toContain('<strong>「括弧」</strong>の直後');
    expect(storage).not.toContain('**');
  });
});

describe('east-asian-width-data', () => {
  test.each(Object.keys(eaw))('%s ranges are sorted, inclusive and disjoint', (key) => {
    const r = eaw[key];
    expect(r.length % 2).toBe(0);
    for (let i = 0; i < r.length; i += 2) {
      expect(r[i]).toBeLessThanOrEqual(r[i + 1]);
      if (i > 0) expect(r[i]).toBeGreaterThan(r[i - 1]);
    }
  });

  test('known code points land in the expected category', () => {
    const has = (key, cp) => {
      const r = eaw[key];
      for (let i = 0; i < r.length; i += 2) if (cp >= r[i] && cp <= r[i + 1]) return true;
      return false;
    };
    expect(has('fullwidth', 0x3000)).toBe(true); // ideographic space
    expect(has('fullwidth', 0xff01)).toBe(true); // fullwidth !
    expect(has('halfwidth', 0xff71)).toBe(true); // halfwidth katakana a
    expect(has('wide', 0x300c)).toBe(true); // 「
    expect(has('wide', 0x4e00)).toBe(true); // CJK ideograph
    expect(has('wide', 0x20bb7)).toBe(true); // 𠮷 (non-BMP)
    expect(has('ambiguous', 0x201c)).toBe(true); // “
    expect(has('wide', 0x41) || has('ambiguous', 0x41)).toBe(false); // A
  });
});
