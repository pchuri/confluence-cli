// HTML → Confluence storage walker. Parses with htmlparser2 using
// `decodeEntities: false` so attribute and text entities round-trip
// byte-identical. Dispatches by tag; unhandled tags pass through with
// attributes preserved.

const { parseDocument } = require('htmlparser2');

const VALID_LINK_STYLES = ['smart', 'plain', 'wiki'];
// Hard cap on input HTML nesting to keep the recursive walker off the JS
// stack ceiling for pathological / malicious input.
const DEFAULT_MAX_DEPTH = 256;

class HtmlDepthExceededError extends Error {
  constructor(maxDepth) {
    super(`HTML nesting exceeds limit of ${maxDepth} levels`);
    this.name = 'HtmlDepthExceededError';
    this.maxDepth = maxDepth;
  }
}
// Only `hr` is normalized to self-closing. `br` / `img` flow through in
// whatever shape the source had (markdown-it emits them without a slash).
const VOID_TAGS = new Set(['hr']);
const CALLOUT_MARKERS = ['info', 'warning', 'note'];

// Phrasing-content tags that trigger the `<li>` / `<th>` / `<td>` `<p>`-wrap
// quirk: if an item contains only inline children and no text-node newline,
// the walker wraps its content in `<p>`. markdown-it never emits the latter
// half of this set, but raw HTML input does, so they need the same treatment.
const INLINE_TAGS = new Set([
  'a', 'strong', 'em', 'code', 'br', 'img', 'span',
  'mark', 'sub', 'sup', 'ins', 'del', 'b', 'i', 'u', 'small', 's',
  'abbr', 'kbd', 'q', 'var', 'cite', 'time', 'dfn', 'samp',
]);

function shouldWrapInP(node) {
  if (!node.children) return true;
  for (const child of node.children) {
    if (child.type === 'text' && child.data.includes('\n')) return false;
    if (child.type === 'tag' && !INLINE_TAGS.has(child.name)) return false;
  }
  return true;
}

function isWhitespaceOnly(node) {
  return node.type === 'text' && /^\s*$/.test(node.data);
}

// Filter out whitespace-only text nodes so structural shape checks (single
// `<strong>` inside a paragraph, etc.) tolerate parser variations that emit
// trailing/leading whitespace text siblings.
function meaningfulChildren(node) {
  return (node.children || []).filter((c) => !isWhitespaceOnly(c));
}

// Detects `<p><strong>TOC</strong></p>` and `<p><strong>ANCHOR: id</strong></p>`
// macro markers. The strict "p > one strong > one text" shape is intentional —
// any embellishment must fall through to a plain paragraph.
function detectParagraphMarker(node) {
  if (node.name !== 'p') return null;
  const kids = meaningfulChildren(node);
  if (kids.length !== 1) return null;
  const strong = kids[0];
  if (strong.type !== 'tag' || strong.name !== 'strong') return null;
  const strongKids = meaningfulChildren(strong);
  if (strongKids.length !== 1) return null;
  const text = strongKids[0];
  if (text.type !== 'text') return null;
  if (text.data === 'TOC') return { kind: 'toc' };
  const anchor = text.data.match(/^ANCHOR: (.+)$/);
  if (anchor) return { kind: 'anchor', id: anchor[1] };
  return null;
}

// EXPAND open `<p><strong>EXPAND: …</strong></p>`. The title may contain
// nested inline HTML (em, code, a, s, …) which gets stripped later — so we
// only require that the strong's first text child starts with `EXPAND: `,
// not that it's the only child.
function isExpandOpen(node) {
  if (node.type !== 'tag' || node.name !== 'p') return false;
  const kids = meaningfulChildren(node);
  if (kids.length !== 1) return false;
  const strong = kids[0];
  if (strong.type !== 'tag' || strong.name !== 'strong') return false;
  if (!strong.children || strong.children.length === 0) return false;
  const first = strong.children[0];
  return first.type === 'text' && first.data.startsWith('EXPAND: ');
}

function isExpandClose(node) {
  if (node.type !== 'tag' || node.name !== 'p') return false;
  const kids = meaningfulChildren(node);
  if (kids.length !== 1) return false;
  const strong = kids[0];
  if (strong.type !== 'tag' || strong.name !== 'strong') return false;
  const strongKids = meaningfulChildren(strong);
  if (strongKids.length !== 1) return false;
  const text = strongKids[0];
  return text.type === 'text' && text.data === 'EXPAND_END';
}

// Replacement order matters for doubly-escaped input: the default order
// replaces the ampersand entity first, which over-decodes (the escaped
// form of an `<`-entity collapses all the way to `<`). `preserveDouble`
// reverses the order so the same input round-trips as `&lt;` instead.
// Both orderings are intentional — call sites pick via the option.
function decodeEntities(text, { preserveDouble = false } = {}) {
  if (preserveDouble) {
    // Apostrophe (`&#39;`) intentionally omitted from this branch: the
    // previous code-fence decoder didn't list it either, only the anchor
    // body decoder did. The asymmetry is preserved for byte parity.
    return text
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
}

// Anchor links (`href="#id"`) short-circuit linkStyle; external href
// branches on it.
function convertLink(node, ctx) {
  const attribs = node.attribs || {};
  const href = attribs.href || '';
  const inner = walkChildren(node, ctx);

  if (href.startsWith('#')) {
    const anchor = href.slice(1);
    const text = decodeEntities(inner);
    return `<ac:link ac:anchor="${anchor}"><ac:plain-text-link-body><![CDATA[${text}]]></ac:plain-text-link-body></ac:link>`;
  }

  switch (ctx.linkStyle) {
  case 'smart': {
    // Spread order forces policy: any pre-existing `data-card-appearance`
    // on the source `<a>` is overwritten — smart links must be inline.
    const merged = { ...attribs, 'data-card-appearance': 'inline' };
    return `<a${renderAttrs(merged)}>${inner}</a>`;
  }
  case 'wiki':
    return `<ac:link><ri:url ri:value="${href}" /><ac:plain-text-link-body><![CDATA[${inner}]]></ac:plain-text-link-body></ac:link>`;
  case 'plain':
  default:
    return `<a${renderAttrs(attribs)}>${inner}</a>`;
  }
}

// `> **INFO|WARNING|NOTE**` blockquotes become callout macros; others pass
// through. Detection runs structurally on the DOM so false-positives for
// mid-paragraph `**INFO**` are ruled out — the strong must be the first
// meaningful child of the first paragraph.
//
// Two markdown-it shapes:
//   separated: `<blockquote><p><strong>INFO</strong></p><p>body</p></blockquote>`
//   same-line: `<blockquote><p><strong>INFO</strong>\nbody</p></blockquote>`
function detectBlockquoteCallout(node) {
  const kids = meaningfulChildren(node);
  if (kids.length === 0) return null;
  const firstP = kids[0];
  if (firstP.type !== 'tag' || firstP.name !== 'p') return null;
  const pKids = firstP.children || [];
  const firstIdx = pKids.findIndex((c) => !isWhitespaceOnly(c));
  if (firstIdx < 0) return null;
  const strong = pKids[firstIdx];
  if (strong.type !== 'tag' || strong.name !== 'strong') return null;
  const strongKids = meaningfulChildren(strong);
  if (strongKids.length !== 1 || strongKids[0].type !== 'text') return null;
  const marker = CALLOUT_MARKERS.find((m) => strongKids[0].data === m.toUpperCase());
  if (!marker) return null;
  const tail = pKids.slice(firstIdx + 1);
  const tailHasContent = tail.some((c) => !isWhitespaceOnly(c));
  if (tailHasContent) {
    // Check tail[0] (not the first meaningful child): the body of
    // `> **INFO**\n> body` must literally start with a newline. A leading
    // whitespace-only text node without a newline (`<strong>INFO</strong>
    // body`) is prose continuation, not callout — it must be rejected here
    // even though `meaningfulChildren` would otherwise look past it.
    if (tail[0].type !== 'text' || !/^\s*\n/.test(tail[0].data)) return null;
  }
  return { marker, sameLine: tailHasContent, markerP: firstP, tail };
}

function convertBlockquote(node, ctx) {
  const detected = detectBlockquoteCallout(node);
  if (!detected) {
    return `<blockquote>${walkChildren(node, ctx)}</blockquote>`;
  }
  const { marker, sameLine, markerP, tail } = detected;
  const blockquoteKids = node.children || [];
  let body;
  if (sameLine) {
    // Same-line form: the strong's siblings inside the marker paragraph form
    // the body of the first `<p>`. Strip the leading newline that markdown-it
    // emits between strong and body text.
    const firstPBody = tail.map((c) => walkNode(c, ctx)).join('').replace(/^\s*\n/, '');
    const rest = blockquoteKids
      .filter((c) => c !== markerP)
      .map((c) => walkNode(c, ctx))
      .join('');
    body = `<p>${firstPBody}</p>${rest}`;
  } else {
    // Separated form: drop the marker paragraph entirely and walk the rest.
    // Leading whitespace from the now-removed paragraph's neighbor text node
    // is trimmed.
    body = blockquoteKids
      .filter((c) => c !== markerP)
      .map((c) => walkNode(c, ctx))
      .join('')
      .replace(/^\s+/, '');
  }
  return `<ac:structured-macro ac:name="${marker}">
          <ac:rich-text-body>${body}</ac:rich-text-body>
        </ac:structured-macro>`;
}

// Strict `<pre><code>` adjacency only — `<pre>` with whitespace siblings or
// any other shape falls through as plain `<pre>`. The body needs manual
// entity decode because the parser keeps entities raw and CDATA is opaque
// downstream.
function convertCodeBlock(node, ctx) {
  const children = node.children || [];
  const isCodeBlock = children.length === 1 &&
    children[0].type === 'tag' &&
    children[0].name === 'code';
  if (!isCodeBlock) {
    return `<pre>${walkChildren(node, ctx)}</pre>`;
  }
  const codeNode = children[0];
  const classAttr = codeNode.attribs.class || '';
  const langMatch = classAttr.match(/language-(\w+)/);
  const language = langMatch ? langMatch[1] : 'text';
  let body = '';
  for (const c of codeNode.children || []) {
    if (c.type === 'text') body += c.data;
  }
  body = decodeEntities(body.replace(/\n$/, ''), { preserveDouble: true })
    .replace(/]]>/g, ']]]]><![CDATA[>');
  return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body></ac:structured-macro>`;
}

// Re-escape literal `"` inside attribute values. htmlparser2 with
// `decodeEntities: false` keeps source-escaped entities intact, but a
// single-quoted source attribute (`<a title='he said "hi"'>`) lands a
// literal `"` here that would close the emitted double-quoted slot and
// corrupt the XML. `&` is left as-is so already-escaped sources
// (`&amp;`, `&quot;`, …) round-trip cleanly.
//
// Trust boundary: input is assumed to be valid HTML. A valid HTML
// attribute value cannot contain raw `<` or `>` (they must be entities),
// so they're not escaped here. Malformed input that smuggles raw
// angle brackets through would produce malformed XML.
function escapeAttrValue(v) {
  return String(v).replace(/"/g, '&quot;');
}

function renderAttrs(attribs) {
  if (!attribs) return '';
  return Object.keys(attribs)
    .map((k) => ` ${k}="${escapeAttrValue(attribs[k])}"`)
    .join('');
}

function walkChildren(node, ctx) {
  if (!node.children) return '';
  const children = node.children;
  const out = [];
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    // Sibling-level EXPAND span — collapse open/close pair into one macro
    // with everything between as the body. Pairs the first EXPAND_END
    // after this open: a nested EXPAND open/close pair inside the body
    // would have its close consumed by the outer open, leaving the
    // second close as an orphan paragraph. Same non-greedy behavior as
    // the previous regex pipeline.
    if (isExpandOpen(child)) {
      const endIdx = children.findIndex((c, j) => j > i && isExpandClose(c));
      if (endIdx !== -1) {
        const titleStrong = child.children[0];
        const titleHtml = walkChildren(titleStrong, ctx).replace(/^EXPAND: /, '');
        // Confluence's `<ac:parameter>` normalizer is text-only (rejects `<s>`
        // with HTTP 500, silently truncates at the first '<'). Strip literal
        // tags; entities survive because the rule requires a literal '<'.
        const cleanTitle = titleHtml.replace(/<[^>]+>/g, '').trim();
        const bodyHtml = children
          .slice(i + 1, endIdx)
          .map((c) => walkNode(c, ctx))
          .join('')
          .trim();
        out.push(`<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">${cleanTitle}</ac:parameter><ac:rich-text-body>${bodyHtml}</ac:rich-text-body></ac:structured-macro>`);
        i = endIdx + 1;
        continue;
      }
    }
    out.push(walkNode(child, ctx));
    i++;
  }
  return out.join('');
}

function walkNode(node, ctx) {
  if (node.type === 'text') return node.data;
  if (node.type !== 'tag') return '';
  if (++ctx.depth > ctx.maxDepth) {
    ctx.depth--;
    throw new HtmlDepthExceededError(ctx.maxDepth);
  }
  try {
    return dispatchTag(node, ctx);
  } finally {
    ctx.depth--;
  }
}

function dispatchTag(node, ctx) {
  switch (node.name) {
  case 'p': {
    const marker = detectParagraphMarker(node);
    if (marker && marker.kind === 'toc') return '<ac:structured-macro ac:name="toc" />';
    if (marker && marker.kind === 'anchor') {
      return `<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">${marker.id}</ac:parameter></ac:structured-macro>`;
    }
    return `<p${renderAttrs(node.attribs)}>${walkChildren(node, ctx)}</p>`;
  }
  case 'h1':
  case 'h2':
  case 'h3':
  case 'h4':
  case 'h5':
  case 'h6':
  case 'strong':
  case 'em':
    return `<${node.name}${renderAttrs(node.attribs)}>${walkChildren(node, ctx)}</${node.name}>`;
  case 'hr':
    return '<hr />';
  case 'br':
    return '<br>';
  case 'img':
    return `<img${renderAttrs(node.attribs)}>`;
  case 'ul':
  case 'ol':
    return `<${node.name}>${walkChildren(node, ctx)}</${node.name}>`;
  case 'li': {
    const inner = walkChildren(node, ctx);
    return shouldWrapInP(node) ? `<li><p>${inner}</p></li>` : `<li>${inner}</li>`;
  }
  case 'pre':
    return convertCodeBlock(node, ctx);
  case 'code':
    // Inline only — `<code>` inside `<pre>` is consumed by convertCodeBlock.
    return `<code${renderAttrs(node.attribs)}>${walkChildren(node, ctx)}</code>`;
  case 'a':
    return convertLink(node, ctx);
  case 'blockquote':
    return convertBlockquote(node, ctx);
  case 'table':
  case 'thead':
  case 'tbody':
  case 'tfoot':
  case 'tr':
    return `<${node.name}${renderAttrs(node.attribs)}>${walkChildren(node, ctx)}</${node.name}>`;
  case 'th':
  case 'td': {
    const inner = walkChildren(node, ctx);
    const open = `<${node.name}${renderAttrs(node.attribs)}>`;
    return shouldWrapInP(node) ? `${open}<p>${inner}</p></${node.name}>` : `${open}${inner}</${node.name}>`;
  }
  default:
    if (VOID_TAGS.has(node.name)) {
      return `<${node.name}${renderAttrs(node.attribs)} />`;
    }
    return `<${node.name}${renderAttrs(node.attribs)}>${walkChildren(node, ctx)}</${node.name}>`;
  }
}

function htmlToStorage(html, options = {}) {
  const isCloud = !!options.isCloud;
  const linkStyle = VALID_LINK_STYLES.includes(options.linkStyle)
    ? options.linkStyle
    : (isCloud ? 'smart' : 'wiki');
  const ctx = {
    linkStyle,
    depth: 0,
    maxDepth: typeof options.maxDepth === 'number' ? options.maxDepth : DEFAULT_MAX_DEPTH,
  };
  return walkChildren(parseDocument(html, { decodeEntities: false }), ctx);
}

module.exports = { htmlToStorage, HtmlDepthExceededError };
