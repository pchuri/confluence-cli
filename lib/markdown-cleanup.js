// Shared fence-aware markdown cleanup for storage-walker and html-to-markdown.
// Both converters need the same set of operations:
//   1. Size opening/closing fences against the entity-decoded code body so a
//      payload containing literal backticks (or numeric entities that decode
//      to backticks) does not close its own fence.
//   2. Split the post-conversion text on fenced code boundaries using a
//      CommonMark line-anchored matcher so prose `\`\`\`` cannot be mis-paired
//      with a real fence opening.
//   3. Apply a 5-step whitespace cleanup chain only outside fenced code.
//   4. Provide the LIST_INDENT / HARD_BREAK sentinels storage-walker uses to
//      indent list continuation lines and carry <br/> through inline
//      whitespace collapse, so neither step 3 nor the collapse can erase them.
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

// List-item continuation indent emitted by StorageWalker. A private-use
// codepoint (not matched by \s or [ \t]) so the whitespace cleanup chain
// below cannot strip or collapse it; the walker swaps it back to spaces
// after cleanup. Literal occurrences in user content are escaped with
// SENTINEL_ESC first (escapeSentinels / restoreSentinels) so they survive.
// HARD_BREAK marks a <br/> inside a context whose inline run is
// whitespace-collapsed (list items, table cells, task bodies); the owning
// context resolves it to its own line-break syntax.
// Keep every regex below in sync with these constants — they are all
// derived from them, so do not hardcode the codepoints elsewhere.
const LIST_INDENT = '\uE000';
const SENTINEL_ESC = '\uE001';
const HARD_BREAK = '\uE002';
const LIST_INDENT_RE = new RegExp(LIST_INDENT, 'g');
const LIST_INDENT_RUN_RE = new RegExp(`${LIST_INDENT}+`, 'g');
const HARD_BREAK_RE = new RegExp(HARD_BREAK, 'g');
const SENTINEL_CHARS_RE = new RegExp(`[${LIST_INDENT}${SENTINEL_ESC}${HARD_BREAK}]`, 'g');
const SENTINEL_ESCAPED_RE = new RegExp(`${SENTINEL_ESC}([esb])`, 'g');
const SENTINEL_CODES = { [SENTINEL_ESC]: 'e', [LIST_INDENT]: 's', [HARD_BREAK]: 'b' };
const SENTINEL_BY_CODE = { e: SENTINEL_ESC, s: LIST_INDENT, b: HARD_BREAK };

// Reversibly escape literal sentinel codepoints in user text.
function escapeSentinels(text) {
  return text.replace(SENTINEL_CHARS_RE, (ch) => SENTINEL_ESC + SENTINEL_CODES[ch]);
}

// Inverse of escapeSentinels. Run after the sentinels have been resolved.
function restoreSentinels(text) {
  return text.replace(SENTINEL_ESCAPED_RE, (_, k) => SENTINEL_BY_CODE[k]);
}

// Remove LIST_INDENT runs (for contexts that flatten a list to one line).
function stripListIndent(text) {
  return text.replace(LIST_INDENT_RUN_RE, '');
}

// Turn LIST_INDENT back into spaces and restore escaped literals. Any
// HARD_BREAK its owning context failed to resolve degrades to a newline.
function finalizeListIndent(text) {
  return restoreSentinels(text.replace(LIST_INDENT_RE, ' ').replace(HARD_BREAK_RE, '\n'));
}

// Split text on fenced code boundaries. Returns an alternating sequence of
// segments where even indices are outside-fence text and odd indices are
// full fenced blocks (delimiters included).
//
// CommonMark: a fence opens on a line of up to 3 spaces + 3+ backticks and
// closes on a line of equal-length backticks followed only by whitespace.
// Anchoring to line boundaries (^ / $ with the m flag) prevents prose
// backticks (e.g. a paragraph documenting markdown syntax) from being
// mis-paired with a real fence opening.
//
// Fences emitted inside list items by StorageWalker are indented with
// LIST_INDENT instead of spaces (any depth), and a fence that opens on the
// item's marker line is joined to the marker with LIST_INDENT (`-<LIST_INDENT>\`\`\``).
// Both forms are recognised. A plain-space marker prefix (`- \`\`\``) is
// deliberately NOT accepted, so html-to-markdown output is unaffected.
const FENCE_SOURCE =
  `^(?: {0,3}|${LIST_INDENT}*(?:(?:[-*+]|\\d{1,9}[.)])${LIST_INDENT})?)(\`{3,})[^\\n]*\\n`
  + `[\\s\\S]*?\\n(?: {0,3}|${LIST_INDENT}*)\\1[\\t ]*$`;

function splitOnFences(text) {
  const result = [];
  const re = new RegExp(FENCE_SOURCE, 'gm');
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    result.push(text.slice(lastIdx, m.index));
    result.push(m[0]);
    lastIdx = m.index + m[0].length;
  }
  result.push(text.slice(lastIdx));
  return result;
}

// Whitespace cleanup safe to apply to text that sits outside fenced code.
// Strips trailing whitespace, strips leading whitespace except where it
// signals a list/blockquote/inline-code marker, ensures a blank line after
// headers, collapses 3+ blank lines, and squashes runs of inline whitespace.
function cleanupOutsideFence(text) {
  let out = text;
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/^[ \t]+(?!([`>]|[*+-] |\d+[.)] ))/gm, '');
  out = out.replace(/^(#{1,6}[^\n]+)\n(?!\n)/gm, '$1\n\n');
  out = out.replace(/\n\s*\n\s*\n+/g, '\n\n');
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
  escapeSentinels,
  stripListIndent,
  finalizeListIndent,
  fenceLength,
  splitOnFences,
  cleanupOutsideFence,
  cleanupWithFences,
};
