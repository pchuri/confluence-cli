// Shared fence-aware markdown cleanup for storage-walker and html-to-markdown.
// Both converters need the same set of operations:
//   1. Size opening/closing fences against the entity-decoded code body so a
//      payload containing literal backticks (or numeric entities that decode
//      to backticks) does not close its own fence.
//   2. Split the post-conversion text on fenced code boundaries using a
//      CommonMark line-anchored matcher so prose `\`\`\`` cannot be mis-paired
//      with a real fence opening.
//   3. Apply a 5-step whitespace cleanup chain only outside fenced code.
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

// Split text on fenced code boundaries. Returns an alternating sequence of
// segments where even indices are outside-fence text and odd indices are
// full fenced blocks (delimiters included).
//
// CommonMark: a fence opens on a line of up to 3 spaces + 3+ backticks and
// closes on a line of equal-length backticks followed only by whitespace.
// Anchoring to line boundaries (^ / $ with the m flag) prevents prose
// backticks (e.g. a paragraph documenting markdown syntax) from being
// mis-paired with a real fence opening.
function splitOnFences(text) {
  const result = [];
  const re = /^ {0,3}(`{3,})[^\n]*\n[\s\S]*?\n {0,3}\1[\t ]*$/gm;
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
  fenceLength,
  splitOnFences,
  cleanupOutsideFence,
  cleanupWithFences,
};
