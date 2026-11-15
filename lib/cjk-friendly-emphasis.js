'use strict';

// CJK-friendly emphasis for markdown-it: a CommonJS port of
// markdown-it-cjk-friendly 3.0.0 (https://github.com/tats-u/markdown-cjk-friendly),
// which implements the CommonMark amendment in that repository's
// specification.md. That package's license notice, which this file keeps:
//
// Copyright (c) 2024 Tatsunori Uchino
//
// markdown-it:
//
// Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
//
// Why: CommonMark decides whether `*`/`**`/`~~` can open or close by looking
// at punctuation next to the run, which fails for CJK text written without
// spaces. `**「括弧」**の直後` stays literal: the closing `**` follows `」`
// (punctuation) and precedes `の` (a letter), so it is not right-flanking. The
// amendment treats a CJK character on either side like whitespace for `*` and
// `~`; `_` keeps its rule against opening or closing inside a word. Like the
// original, a general-use variation selector (U+FE00..U+FE0E) right before a
// delimiter run is looked through to the character it modifies, so
// `a**x”\uFE00**b` and `”\uFE00__x__` parse differently from stock
// markdown-it even without CJK. Any other input with no CJK character next to
// a delimiter run parses exactly as stock markdown-it does.
//
// The package itself is not a dependency because it and get-east-asian-width
// are ESM-only, which this CommonJS CLI cannot require on every Node version
// it supports (nor under Jest before Node 24.9).

const eaw = require('./east-asian-width-data');

function inRanges(ranges, cp) {
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cp < ranges[mid * 2]) high = mid - 1;
    else if (cp > ranges[mid * 2 + 1]) low = mid + 1;
    else return true;
  }
  return false;
}

const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;
const HANGUL = /^\p{sc=Hangul}/u;
const SPACE_SEPARATOR = /^\p{Zs}/u;

// true when cp is CJK, false when not, null when it depends on the
// neighbouring variation selector (East Asian Width "Ambiguous").
function isCjkBase(cp) {
  if (cp < 0x1100) return false;
  if (inRanges(eaw.fullwidth, cp) || inRanges(eaw.halfwidth, cp)) return true;
  if (inRanges(eaw.wide, cp)) return !EMOJI_PRESENTATION.test(String.fromCodePoint(cp));
  if (inRanges(eaw.ambiguous, cp)) return null;
  // Neutral Hangul jamo (U+1160..U+11FF) are CJK; every other Neutral or
  // Narrow code point is not.
  return HANGUL.test(String.fromCodePoint(cp));
}

// A quotation mark followed by U+FE01 is the fullwidth (CJK) form
// (StandardizedVariants.txt, East Asian punctuation positional variants).
function isTwoPreviousCjk(cp, vs) {
  const base = isCjkBase(cp);
  if (base !== null) return base;
  return vs === 0xfe01 && (cp === 0x2018 || cp === 0x2019 || cp === 0x201c || cp === 0x201d);
}

// An ideographic variation selector (U+E0100..U+E01EF) only follows a CJK
// ideograph, so it counts as CJK itself.
function isPreviousCjk(cp) {
  const base = isCjkBase(cp);
  if (base !== null) return base;
  return cp >= 0xe0100 && cp <= 0xe01ef;
}

function isNextCjk(cp) {
  return isCjkBase(cp) === true;
}

function isGeneralUseVs(cp) {
  return cp >= 0xfe00 && cp <= 0xfe0e;
}

// The code point that ends just before `pos`, and where it starts. A lone
// surrogate reads as U+FFFD, as markdown-it's own scanDelims does.
function charBefore(src, pos) {
  if (pos <= 0) return [0x20, -1];
  const c = src.charCodeAt(pos - 1);
  if ((c & 0xfc00) === 0xdc00) {
    const h = pos >= 2 ? src.charCodeAt(pos - 2) : 0;
    if ((h & 0xfc00) === 0xd800) return [0x10000 + ((h - 0xd800) << 10) + (c - 0xdc00), pos - 2];
    return [0xfffd, pos - 1];
  }
  if ((c & 0xfc00) === 0xd800) return [0xfffd, pos - 1];
  return [c, pos - 1];
}

function charAt(src, pos, max) {
  if (pos >= max) return 0x20;
  const c = src.charCodeAt(pos);
  if ((c & 0xfc00) === 0xd800) {
    const l = src.charCodeAt(pos + 1);
    return (l & 0xfc00) === 0xdc00 ? 0x10000 + ((c - 0xd800) << 10) + (l - 0xdc00) : 0xfffd;
  }
  if ((c & 0xfc00) === 0xdc00) return 0xfffd;
  return c;
}

function cjkFriendlyEmphasis(md) {
  const { isWhiteSpace, isMdAsciiPunct, isPunctChar } = md.utils;
  const isPunct = (cp) => isMdAsciiPunct(cp) || isPunctChar(String.fromCodePoint(cp));
  const BaseState = md.inline.State;

  class CjkFriendlyState extends BaseState {
    scanDelims(start, canSplitWord) {
      const max = this.posMax;
      const marker = this.src.charCodeAt(start);

      const [lastChar, lastCharPos] = charBefore(this.src, start);
      // A general-use variation selector modifies the character before it;
      // judge that character instead, unless it is a space.
      let lastMainChar = lastChar;
      let twoPrevChar = null;
      if (isGeneralUseVs(lastChar)) {
        twoPrevChar = charBefore(this.src, lastCharPos)[0];
        if (!SPACE_SEPARATOR.test(String.fromCodePoint(twoPrevChar))) lastMainChar = twoPrevChar;
      }

      let pos = start;
      while (pos < max && this.src.charCodeAt(pos) === marker) pos++;
      const count = pos - start;
      const nextChar = charAt(this.src, pos, max);

      const isLastWhiteSpace = isWhiteSpace(lastMainChar);
      const isNextWhiteSpace = isWhiteSpace(nextChar);
      if (isLastWhiteSpace || isNextWhiteSpace) {
        return { can_open: !isNextWhiteSpace, can_close: !isLastWhiteSpace, length: count };
      }

      const isLastPunct = isPunct(lastMainChar);
      const isNextPunct = isPunct(nextChar);
      // With no whitespace on either side, this is markdown-it's rule for `_`
      // (canSplitWord false) reduced; `*` and `~` relax it below.
      let leftFlanking = isLastPunct;
      let rightFlanking = isNextPunct;
      if (canSplitWord) {
        const isEitherCjk = isNextCjk(nextChar) ||
          (twoPrevChar !== null ? isTwoPreviousCjk(twoPrevChar, lastChar) : isPreviousCjk(lastChar));
        leftFlanking = leftFlanking || isEitherCjk || !isNextPunct;
        rightFlanking = rightFlanking || isEitherCjk || !isLastPunct;
      }
      return { can_open: leftFlanking, can_close: rightFlanking, length: count };
    }
  }

  md.inline.State = CjkFriendlyState;
}

module.exports = cjkFriendlyEmphasis;
