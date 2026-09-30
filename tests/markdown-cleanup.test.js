const {
  LIST_INDENT,
  QUOTE_MARK,
  HARD_BREAK,
  escapeSentinels,
  finalizeSentinels,
  fenceLength,
  splitOnFences,
  isFenceOpenLine,
  cleanupOutsideFence,
  cleanupWithFences,
} = require('../lib/markdown-cleanup');

describe('markdown-cleanup fenceLength', () => {
  test('empty body returns the 3-backtick floor', () => {
    expect(fenceLength('')).toBe(3);
  });

  test('body with no backticks returns the 3-backtick floor', () => {
    expect(fenceLength('plain text\nno ticks here')).toBe(3);
  });

  test('body with single backtick still returns the 3-backtick floor', () => {
    expect(fenceLength('inline `code` here')).toBe(3);
  });

  test('body with a 3-backtick run escalates to 4', () => {
    expect(fenceLength('before\n```\nafter')).toBe(4);
  });

  test('body with a 4-backtick run escalates to 5', () => {
    expect(fenceLength('x ```` y')).toBe(5);
  });

  test('longest run wins when multiple runs of different lengths exist', () => {
    expect(fenceLength('a `` b ``` c `````` d')).toBe(7);
  });
});

describe('markdown-cleanup splitOnFences', () => {
  test('empty input returns a single empty segment', () => {
    expect(splitOnFences('')).toEqual(['']);
  });

  test('input with no fences returns a single segment with the input', () => {
    const text = 'just prose\nwith newlines';
    expect(splitOnFences(text)).toEqual([text]);
  });

  test('alternating segments invariant: even indices are outside, odd are full fences', () => {
    const text = 'before\n```js\nx = 1\n```\nafter';
    const segments = splitOnFences(text);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe('before\n');
    expect(segments[1]).toBe('```js\nx = 1\n```');
    expect(segments[2]).toBe('\nafter');
  });

  test('multiple fences each get their own odd-indexed segment', () => {
    const text = 'a\n```\nb\n```\nc\n```py\nd\n```\ne';
    const segments = splitOnFences(text);
    expect(segments).toHaveLength(5);
    expect(segments[1]).toBe('```\nb\n```');
    expect(segments[3]).toBe('```py\nd\n```');
  });

  test('opening fence indented up to 3 spaces is recognized', () => {
    const text = '   ```js\nx\n   ```\n';
    const segments = splitOnFences(text);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toBe('   ```js\nx\n   ```');
  });

  test('opening fence indented 4+ spaces is treated as prose (not a fence)', () => {
    const text = '    ```js\nx\n    ```\n';
    expect(splitOnFences(text)).toEqual([text]);
  });

  test('greedy quantifier backtracks: 4-tick open with 3-tick close pairs at the 3-tick boundary', () => {
    // The greedy `(\`{3,})` first tries to capture 4 backticks, then backtracks
    // to 3 when no 4-tick close exists. Neither converter ever emits a
    // mismatched fence, so this lenient behavior is harmless in practice — the
    // test pins it so future tightening is a deliberate decision, not a regression.
    const text = '````md\nbody\n```\nstill body';
    expect(splitOnFences(text)).toEqual(['', '````md\nbody\n```', '\nstill body']);
  });

  test('matched 4-tick fence captures 3-tick payload as inner content', () => {
    const text = 'before\n````md\nfoo\n```\nbar\n````\nafter';
    const segments = splitOnFences(text);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toBe('````md\nfoo\n```\nbar\n````');
  });

  test('close line with trailing tabs/spaces is allowed', () => {
    const text = '```js\nx\n```   \t\nafter';
    const segments = splitOnFences(text);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toBe('```js\nx\n```   \t');
  });

  test('prose containing mid-line ``` does not open a fence', () => {
    const text = 'see ``` here\nand ``` there';
    expect(splitOnFences(text)).toEqual([text]);
  });

  test('a close line must follow \\n, not \\r or U+2028', () => {
    expect(splitOnFences('```\na\u2028```\nb\n```')).toEqual(['', '```\na\u2028```\nb\n```', '']);
    expect(splitOnFences('```\n\r```\n')).toEqual(['```\n\r```\n']);
  });

  test('a line whose info string contains backticks does not open a fence', () => {
    const text = '``` `` ``` is two backticks\na     b\n```\nkeep    this\n```';
    expect(splitOnFences(text)).toEqual(['``` `` ``` is two backticks\na     b\n', '```\nkeep    this\n```', '']);
  });
});

describe('markdown-cleanup cleanupOutsideFence', () => {
  test('strips trailing whitespace per line', () => {
    expect(cleanupOutsideFence('foo   \nbar\t\n')).toBe('foo\nbar\n');
  });

  test('strips leading whitespace on plain lines', () => {
    expect(cleanupOutsideFence('   hello')).toBe('hello');
  });

  test('leaves a single leading space before list / blockquote / inline-code markers', () => {
    // The negative lookahead protects the marker from being glued to start of
    // line: greedy `[ \t]+` backtracks until the position immediately after
    // the match is no longer at the marker, leaving exactly one space behind.
    expect(cleanupOutsideFence('  - item')).toBe(' - item');
    expect(cleanupOutsideFence('  > quote')).toBe(' > quote');
    expect(cleanupOutsideFence('  `code`')).toBe(' `code`');
    expect(cleanupOutsideFence('  1. ordered')).toBe(' 1. ordered');
  });

  test('does not strip a marker that already starts at column 0', () => {
    expect(cleanupOutsideFence('- item')).toBe('- item');
    expect(cleanupOutsideFence('> quote')).toBe('> quote');
    expect(cleanupOutsideFence('`code`')).toBe('`code`');
    expect(cleanupOutsideFence('1. ordered')).toBe('1. ordered');
  });

  test('inserts a blank line after a header that lacks one', () => {
    expect(cleanupOutsideFence('# Title\nnext')).toBe('# Title\n\nnext');
  });

  test('does not double-space a header that already has a blank line after it', () => {
    expect(cleanupOutsideFence('# Title\n\nnext')).toBe('# Title\n\nnext');
  });

  test('collapses 3+ blank lines to a single blank line', () => {
    expect(cleanupOutsideFence('a\n\n\n\nb')).toBe('a\n\nb');
  });

  test('squashes runs of inline whitespace to a single space', () => {
    expect(cleanupOutsideFence('a    b\tc')).toBe('a b c');
  });
});

describe('markdown-cleanup cleanupWithFences', () => {
  test('returns trimmed empty string for empty input', () => {
    expect(cleanupWithFences('')).toBe('');
  });

  test('trims leading and trailing whitespace from the result', () => {
    expect(cleanupWithFences('\n\n  hello\n\n')).toBe('hello');
  });

  test('applies cleanup outside fences but leaves fenced content untouched', () => {
    const text = '   prose   line\n\n```js\n  const x = 1;  \n```\n   tail';
    expect(cleanupWithFences(text)).toBe('prose line\n\n```js\n  const x = 1;  \n```\ntail');
  });

  test('preserves consecutive blank lines and trailing spaces inside a fence', () => {
    const text = 'a\n\n```text\nx\n\n\n\ny   \n```\nb';
    expect(cleanupWithFences(text)).toBe('a\n\n```text\nx\n\n\n\ny   \n```\nb');
  });

  test('applies cleanup between two adjacent fenced blocks', () => {
    const text = '```js\na\n```\n\n\n\n   ```py\nb\n   ```';
    expect(cleanupWithFences(text)).toBe('```js\na\n```\n\n   ```py\nb\n   ```');
  });
});

describe('markdown-cleanup LIST_INDENT sentinel', () => {
  const I = LIST_INDENT;

  test('recognises a fence indented with LIST_INDENT at any depth', () => {
    const text = `- a\n${I}${I}${I}${I}\`\`\`js\n${I}${I}${I}${I}x  =  1\n${I}${I}${I}${I}\`\`\`\nafter`;
    const segs = splitOnFences(text);
    expect(segs).toHaveLength(3);
    expect(segs[1]).toBe(`${I}${I}${I}${I}\`\`\`js\n${I}${I}${I}${I}x  =  1\n${I}${I}${I}${I}\`\`\``);
  });

  test('recognises a fence joined to a list marker with LIST_INDENT', () => {
    for (const marker of ['-', '*', '+', '1.', '10.', '3)']) {
      const text = `${I}${I}${marker}${I}\`\`\`js\n${I}${I}${I}${I}x  =  1\n${I}${I}${I}${I}\`\`\``;
      expect(splitOnFences(text)).toEqual(['', text, '']);
    }
  });

  test('does NOT treat a plain-space marker prefix as a fence', () => {
    expect(splitOnFences('- ```js\nx  =  1\n```')).toHaveLength(1);
  });

  test('cleanupWithFences leaves sentinel-indented fence bodies untouched', () => {
    const text = `-${I}\`\`\`js\n${I}${I}a  =  1\n${I}${I}\`\`\``;
    expect(finalizeSentinels(cleanupWithFences(text))).toBe('- ```js\n  a  =  1\n  ```');
  });

  test('escapeSentinels / finalizeSentinels round-trip literal codepoints', () => {
    const literal = '\uE000a\uE001b\uE001s\uE001e\uE002c\uE001q';
    expect(finalizeSentinels(`${I}${QUOTE_MARK}${escapeSentinels(literal)}`)).toBe(` >${literal}`);
  });
});

describe('markdown-cleanup QUOTE_MARK sentinel (#244)', () => {
  const I = LIST_INDENT;
  const Q = QUOTE_MARK;

  test('recognises a quoted fence, with or without the space after the mark', () => {
    for (const p of [`${Q} `, Q, `${Q} ${Q} `, `${Q}${Q}`]) {
      const text = `${p}\`\`\`js\n${p}x   y\n${p.trimEnd()}\n${p}  z\n${p}\`\`\``;
      expect(splitOnFences(`${Q} before\n${text}\n${Q} after`)).toEqual([`${Q} before\n`, text, `\n${Q} after`]);
    }
  });

  test('recognises quote marks mixed with LIST_INDENT and a joined list marker', () => {
    const cases = [
      [`${Q} -${I}\`\`\``, `${Q} ${I}${I}\`\`\``],
      [`${I}${I}${Q} \`\`\``, `${I}${I}${Q} \`\`\``],
      [`-${I}${Q} \`\`\``, `${I}${I}${Q} \`\`\``],
      [`${Q} ${I}${I}1.${I}\`\`\``, `${Q} ${I}${I}${I}${I}${I}\`\`\``],
      [`-${I}-${I}\`\`\``, `${I}${I}${I}${I}\`\`\``],
    ];
    for (const [open, close] of cases) {
      // Body lines carry the same container prefix as the close line.
      const text = `${open}\n${close.replace(/`+$/, '')}a   b\n${close}`;
      expect(splitOnFences(text)).toEqual(['', text, '']);
    }
  });

  test('a quoted fence only closes at the quote depth it opened at', () => {
    const quotedOpen = `${Q} \`\`\`\n${Q} a   b\n\n\`\`\`\nc   d\n\`\`\``;
    expect(splitOnFences(quotedOpen)).toEqual([`${Q} \`\`\`\n${Q} a   b\n\n`, '```\nc   d\n```', '']);
    const topOpen = `\`\`\`\nx\n${Q} \`\`\`\n${Q} y\n\`\`\``;
    expect(splitOnFences(topOpen)).toEqual(['', topOpen, '']);
    const nested = `${Q} ${Q} \`\`\`\n${Q} ${Q} a\n${Q} \`\`\`\n${Q} ${Q} \`\`\``;
    expect(splitOnFences(nested)).toEqual([nested]);
  });

  test('a quoted fence never closes past the end of its blockquote', () => {
    const text = `${Q} \`\`\`\n\nmid     text\n\n${Q} **NOTE**\n${Q} \`\`\`js\n${Q} keep   1\n${Q} \`\`\``;
    expect(splitOnFences(text)).toEqual([
      `${Q} \`\`\`\n\nmid     text\n\n${Q} **NOTE**\n`,
      `${Q} \`\`\`js\n${Q} keep   1\n${Q} \`\`\``,
      '',
    ]);
    const shallower = `${Q} ${Q} \`\`\`\n${Q} ${Q} a\n${Q} b\n${Q} ${Q} \`\`\``;
    expect(splitOnFences(shallower)).toEqual([shallower]);
  });

  test('blockquote end is found with list-indent and marker prefixes too', () => {
    const text = `${Q} -${I}\`\`\`\n${Q} ${I}${I}a   b\n${I}${I}c\n${Q} ${I}${I}\`\`\``;
    expect(splitOnFences(text)).toEqual([text]);
  });

  test('does NOT treat a literal `> ` prefix as a fence', () => {
    expect(splitOnFences('> ```js\n> x  =  1\n> ```')).toHaveLength(1);
    expect(splitOnFences('- > ```js\n  > x  =  1\n  > ```')).toHaveLength(1);
  });

  test('cleanupWithFences leaves quoted fence bodies untouched and finalizes the marks', () => {
    const text = `${Q} **INFO**\n${Q} \`\`\`\n${Q} x   y\n${Q}   z\n${Q} \`\`\`\n${Q}\n${Q} a    b`;
    expect(finalizeSentinels(cleanupWithFences(text))).toBe('> **INFO**\n> ```\n> x   y\n>   z\n> ```\n>\n> a b');
  });

  test('isFenceOpenLine matches only sentinel-prefixed fence openings', () => {
    expect(isFenceOpenLine('```js')).toBe(true);
    expect(isFenceOpenLine(`${Q} \`\`\``)).toBe(true);
    expect(isFenceOpenLine(`-${I}${Q} \`\`\``)).toBe(true);
    expect(isFenceOpenLine(`${Q} 10.${I}\`\`\`js`)).toBe(true);
    expect(isFenceOpenLine(`${Q} **INFO**`)).toBe(false);
    expect(isFenceOpenLine('> ```')).toBe(false);
    expect(isFenceOpenLine('- ```')).toBe(false);
    expect(isFenceOpenLine('``')).toBe(false);
    expect(isFenceOpenLine(`${Q} \`\`\` \`\` \`\`\``)).toBe(false);
  });

  test('finalizeSentinels degrades an unresolved HARD_BREAK to a newline', () => {
    expect(finalizeSentinels(`a${HARD_BREAK}b`)).toBe('a\nb');
  });

  test('escapeSentinels / finalizeSentinels round-trip literal U+E003 next to the other sentinels', () => {
    const literal = '\uE003\uE001b\uE002\uE000';
    expect(finalizeSentinels(`${I}${HARD_BREAK}${escapeSentinels(literal)}`)).toBe(` \n${literal}`);
  });
});
