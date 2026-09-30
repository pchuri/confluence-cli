// Shared fence-aware markdown cleanup for storage-walker and html-to-markdown.
// Both converters need the same set of operations:
//   1. Size opening/closing fences against the entity-decoded code body so a
//      payload containing literal backticks (or numeric entities that decode
//      to backticks) does not close its own fence.
//   2. Split the post-conversion text on fenced code boundaries using a
//      CommonMark line-anchored matcher so prose `\`\`\`` cannot be mis-paired
//      with a real fence opening.
//   3. Apply a 5-step whitespace cleanup chain only outside fenced code.
//   4. Provide the LIST_INDENT / QUOTE_MARK / HARD_BREAK sentinels:
//      LIST_INDENT is the list continuation indent both converters emit,
//      QUOTE_MARK the storage-walker blockquote prefix, and HARD_BREAK carries
//      a storage-walker <br/> through inline whitespace collapse. Step 3
//      cannot strip that indentation and step 2 still sees nested fences.
//
// Keeping these helpers in one place prevents the converters from drifting
// apart again — see issue #149 for the history.

// CommonMark allows fenced code with N≥3 backticks where the body contains
// no run of N+ backticks. Pick the smallest N satisfying both. Caller must
// pass an entity-decoded body — numeric entity refs like `&#96;` are
// backticks once decoded, so sizing before decode would leave the fence
// breakable when the entities resolve.
function fenceLength(decodedBody) {
  let max = 0;
  const runs = decodedBody.match(/`+/g);
  if (runs) {
    for (const r of runs) if (r.length > max) max = r.length;
  }
  return Math.max(3, max + 1);
}

// List-item continuation indent emitted by StorageWalker and
// html-to-markdown. A private-use codepoint (not matched by \s or [ \t]) so
// the whitespace cleanup chain below cannot strip or collapse it; each
// converter swaps it back to spaces after cleanup. QUOTE_MARK plays the same
// role for the walker's `>` blockquote prefix: it lets splitOnFences
// recognise quoted fences without also matching `>`-prefixed text from
// html-to-markdown. Literal occurrences in user content are escaped with
// SENTINEL_ESC first (escapeSentinels / restoreSentinels) so they survive.
// HARD_BREAK marks a <br/> inside a context whose inline run is
// whitespace-collapsed (list items, table cells, task bodies); the owning
// context resolves it to its own line-break syntax.
// Keep every regex below in sync with these constants — they are all
// derived from them, so do not hardcode the codepoints elsewhere.
const LIST_INDENT = '\uE000';
const SENTINEL_ESC = '\uE001';
const QUOTE_MARK = '\uE002';
const HARD_BREAK = '\uE003';
const LIST_INDENT_RE = new RegExp(LIST_INDENT, 'g');
const LIST_INDENT_RUN_RE = new RegExp(`${LIST_INDENT}+`, 'g');
const QUOTE_MARK_RE = new RegExp(QUOTE_MARK, 'g');
const HARD_BREAK_RE = new RegExp(HARD_BREAK, 'g');
const SENTINEL_CHARS_RE = new RegExp(`[${LIST_INDENT}${SENTINEL_ESC}${QUOTE_MARK}${HARD_BREAK}]`, 'g');
const SENTINEL_ESCAPED_RE = new RegExp(`${SENTINEL_ESC}([esqb])`, 'g');
const SENTINEL_KEYS = { [SENTINEL_ESC]: 'e', [LIST_INDENT]: 's', [QUOTE_MARK]: 'q', [HARD_BREAK]: 'b' };
const SENTINEL_BY_KEY = { e: SENTINEL_ESC, s: LIST_INDENT, q: QUOTE_MARK, b: HARD_BREAK };

// Reversibly escape literal sentinel codepoints in user text.
function escapeSentinels(text) {
  return text.replace(SENTINEL_CHARS_RE, (ch) => SENTINEL_ESC + SENTINEL_KEYS[ch]);
}

// Inverse of escapeSentinels. Run after the sentinels have been finalized.
function restoreSentinels(text) {
  return text.replace(SENTINEL_ESCAPED_RE, (_, k) => SENTINEL_BY_KEY[k]);
}

// Remove LIST_INDENT runs (for contexts that flatten a list to one line).
function stripListIndent(text) {
  return text.replace(LIST_INDENT_RUN_RE, '');
}

// Turn LIST_INDENT back into spaces and QUOTE_MARK into `>`, degrade any
// HARD_BREAK its owning context failed to resolve to a newline, then restore
// escaped literals.
function finalizeSentinels(text) {
  return restoreSentinels(
    text.replace(LIST_INDENT_RE, ' ').replace(QUOTE_MARK_RE, '>').replace(HARD_BREAK_RE, '\n'),
  );
}

// Split text on fenced code boundaries. Returns an alternating sequence of
// segments where even indices are outside-fence text and odd indices are
// full fenced blocks (delimiters included).
//
// CommonMark: a fence opens on a line of up to 3 spaces + 3+ backticks and
// an info string without backticks, and closes on a line of equal-length
// backticks followed only by whitespace. Anchoring to line boundaries
// (^ / $ with the m flag) and rejecting backticks in the info string keep
// prose backticks (e.g. a paragraph documenting markdown syntax, or inline
// code rendered as ``` `` ```) from being mis-paired with a real fence.
//
// Both converters prefix fences nested in lists with sentinels, and
// StorageWalker does the same for quotes:
// list continuation indent is LIST_INDENT (any depth), a fence on an item's
// marker line is joined to the marker with LIST_INDENT (`-<LIST_INDENT>\`\`\``),
// and each quote level is QUOTE_MARK plus an optional space. Any mix of
// these is recognised. A quoted fence only closes at the quote depth it
// opened at, and never past the end of its blockquote — the first later line
// at a shallower depth (the walker prefixes every quoted line, blank ones
// included). A plain-space marker prefix (`- \`\`\``) or a literal `> ` prefix is
// deliberately NOT accepted, so literal backticks leading an html-to-markdown
// list item, or `>`-prefixed html-to-markdown text, never pair with a fence.
const CLOSE_PREFIX_UNIT = `(?:${LIST_INDENT}|${QUOTE_MARK} ?)`;
const OPEN_PREFIX_UNIT = `(?:${LIST_INDENT}|${QUOTE_MARK} ?|(?:[-*+]|\\d{1,9}[.)])${LIST_INDENT})`;
const FENCE_OPEN_SOURCE = `^( {0,3}|${OPEN_PREFIX_UNIT}*)(\`{3,})[^\`\\n]*\\n`;
const FENCE_OPEN_LINE_RE = new RegExp(`^${OPEN_PREFIX_UNIT}*\`{3,}[^\`\\n]*$`);
const LINE_PREFIX_RE = new RegExp(`${OPEN_PREFIX_UNIT}*`, 'y');

// True when the single line `line` is a fence opening, either bare or behind
// sentinel prefixes only (not plain-space indentation). StorageWalker uses
// it to decide whether a list item's first line must be joined to its marker
// with LIST_INDENT.
function isFenceOpenLine(line) {
  return FENCE_OPEN_LINE_RE.test(line);
}

function quoteDepth(prefix) {
  return (prefix.match(QUOTE_MARK_RE) || []).length;
}

const FENCE_CLOSE_SOURCE = `^( {0,3}|${CLOSE_PREFIX_UNIT}*)(\`{3,})[\\t ]*$`;

// First index in the ascending array `arr` whose value is >= `x`.
function lowerBound(arr, x, key = (v) => v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Start offsets of every line, grouped by the line's quote depth (the
// QUOTE_MARKs in its leading sentinel prefix), in text order.
function indexLineDepths(text) {
  const byDepth = new Map();
  for (let start = 0; start <= text.length;) {
    LINE_PREFIX_RE.lastIndex = start;
    const depth = quoteDepth(LINE_PREFIX_RE.exec(text)[0]);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth).push(start);
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    start = nl + 1;
  }
  return byDepth;
}

// Offset of the first line at or after `from` whose quote depth is below
// `depth` — where a blockquote at `depth` ends — or Infinity.
function quoteEnd(lineDepths, from, depth) {
  let end = Infinity;
  for (const [d, starts] of lineDepths) {
    if (d >= depth) continue;
    const i = lowerBound(starts, from);
    if (i < starts.length && starts[i] < end) end = starts[i];
  }
  return end;
}

// Index every candidate close line once per splitOnFences call, so each
// opener is a lookup instead of a scan to the end of the text. Shape:
// depth → { lens: backtick lengths, descending; byLen: len → [start, end][]
// in text order }.
function indexFenceCloses(text) {
  const byDepth = new Map();
  const re = new RegExp(FENCE_CLOSE_SOURCE, 'gm');
  let m;
  while ((m = re.exec(text)) !== null) {
    // `^` with the m flag also matches after \r / U+2028 / U+2029; a close
    // line must follow a real \n.
    if (m.index > 0 && text[m.index - 1] !== '\n') continue;
    const depth = quoteDepth(m[1]);
    const len = m[2].length;
    if (!byDepth.has(depth)) byDepth.set(depth, { lens: [], byLen: new Map() });
    const entry = byDepth.get(depth);
    if (!entry.byLen.has(len)) entry.byLen.set(len, []);
    entry.byLen.get(len).push([m.index, m.index + m[0].length]);
  }
  for (const entry of byDepth.values()) {
    entry.lens = [...entry.byLen.keys()].sort((a, b) => b - a);
  }
  return byDepth;
}

// End offset of the line closing a fence of `maxLen` backticks opened at
// quote depth `depth`, starting at or after `from` and before `limit`; -1 if
// there is none. The earliest close of exactly `maxLen` wins; failing that,
// the earliest of the longest shorter run (down to 3) — the lenient pairing
// the original single-regex matcher had via backtracking.
function findFenceClose(closes, from, limit, maxLen, depth) {
  const entry = closes.get(depth);
  if (!entry) return -1;
  for (const len of entry.lens) {
    if (len > maxLen) continue;
    const list = entry.byLen.get(len);
    const i = lowerBound(list, from, (c) => c[0]);
    if (i < list.length && list[i][0] < limit) return list[i][1];
  }
  return -1;
}

function splitOnFences(text) {
  const result = [];
  const closes = indexFenceCloses(text);
  let lineDepths = null;
  const re = new RegExp(FENCE_OPEN_SOURCE, 'gm');
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const depth = quoteDepth(m[1]);
    let limit = Infinity;
    if (depth > 0) {
      lineDepths = lineDepths || indexLineDepths(text);
      limit = quoteEnd(lineDepths, re.lastIndex, depth);
    }
    // Starting one past the opener's newline requires a body line, as before.
    const end = findFenceClose(closes, re.lastIndex + 1, limit, m[2].length, depth);
    if (end === -1) continue;
    result.push(text.slice(lastIdx, m.index));
    result.push(text.slice(m.index, end));
    lastIdx = end;
    re.lastIndex = end;
  }
  result.push(text.slice(lastIdx));
  return result;
}

// Whitespace cleanup safe to apply to text that sits outside fenced code.
// Strips trailing whitespace, strips leading whitespace except where it
// signals a list/blockquote/inline-code marker, ensures a blank line after
// headers, collapses 3+ blank lines, and squashes runs of inline whitespace.
// Collapse runs of blank (or whitespace-only) lines to a single blank line.
function collapseBlankLines(text) {
  return text.replace(/\n\s*\n\s*\n+/g, '\n\n');
}

function cleanupOutsideFence(text) {
  let out = text;
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/^[ \t]+(?!([`>]|[*+-] |\d+[.)] ))/gm, '');
  out = out.replace(/^(#{1,6}[^\n]+)\n(?!\n)/gm, '$1\n\n');
  out = collapseBlankLines(out);
  out = out.replace(/[ \t]+/g, ' ');
  return out;
}

// Apply outside-fence cleanup while leaving fenced code untouched, then
// trim leading and trailing whitespace from the joined result.
function cleanupWithFences(text) {
  const segments = splitOnFences(text);
  return segments
    .map((seg, i) => (i % 2 === 1 ? seg : cleanupOutsideFence(seg)))
    .join('')
    .trim();
}

module.exports = {
  LIST_INDENT,
  HARD_BREAK,
  QUOTE_MARK,
  escapeSentinels,
  stripListIndent,
  finalizeSentinels,
  fenceLength,
  splitOnFences,
  isFenceOpenLine,
  collapseBlankLines,
  cleanupOutsideFence,
  cleanupWithFences,
};
