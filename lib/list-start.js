// Numbering rules for ordered lists, shared by StorageWalker and
// html-to-markdown so both converters render an <ol start> the same way.

// CommonMark ordered list markers are 1–9 digits, so numbers are 0..MAX.
const MAX_LIST_NUMBER = 999999999;

// An ordered list marker other than `1.`, which cannot interrupt a paragraph.
const NON_ONE_ORDERED_MARKER_RE = /^(?!1\.)\d+\./;

// Resolve an <ol start> attribute to the first marker number. Values
// markdown cannot express (negative, non-integer, or a run that would
// outgrow a 9-digit marker) fall back to 1.
function resolveListStart(value, count) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(raw)) return 1;
  const start = Number(raw);
  return start + Math.max(count - 1, 0) <= MAX_LIST_NUMBER ? start : 1;
}

module.exports = { MAX_LIST_NUMBER, NON_ONE_ORDERED_MARKER_RE, resolveListStart };
