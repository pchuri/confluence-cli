const { Parser, DomHandler } = require('htmlparser2');
const { decodeHTML } = require('entities');
const {
  LIST_INDENT,
  HARD_BREAK,
  QUOTE_MARK,
  escapeSentinels,
  stripListIndent,
  finalizeSentinels,
  fenceLength,
  isFenceOpenLine,
  splitOnFences,
  collapseBlankLines,
  cleanupWithFences,
} = require('./markdown-cleanup');
const { decodePlantuml } = require('./plantuml-codec');

const DEFAULT_MAX_DEPTH = 256;

// <li> children that start their own markdown block. Everything else is
// treated as inline content of the item's lead-in line.
const LIST_ITEM_BLOCK_TAGS = new Set([
  'p', 'ul', 'ol', 'table', 'blockquote', 'pre', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ac:task-list', 'details',
]);
// ac:structured-macro names (see handleMacro) that render as a standalone
// markdown block. Other macros (anchor, view-file, status, …) stay inline
// so they do not split the item's lead-in line. `tip` renders nothing
// today; it is listed so a future callout handler is treated as a block.
const LIST_ITEM_BLOCK_MACROS = new Set([
  'code', 'info', 'warning', 'note', 'tip', 'panel', 'expand',
  'mermaid-macro', 'plantuml', 'plantumlcloud',
  'include', 'shared-block', 'include-shared-block',
]);
// A task checkbox rendered as its own line (see renderListItemBody).
const BARE_CHECKBOX_RE = /^\[[ xX]\]$/;
// First lines that start a block able to interrupt a paragraph: a fence,
// ATX heading, quote, table, HTML block, list item or thematic break.
// Anything else would be absorbed into a `[ ]` line above it.
// (Quotes start with QUOTE_MARK; fences are matched by isFenceOpenLine.)
const PARAGRAPH_INTERRUPT_RE = new RegExp(
  `^(?:#{1,6}(?:\\s|$)|[>|<${QUOTE_MARK}]|[-*+](?:[\\s${LIST_INDENT}]|$)|\\d{1,9}[.)](?:[\\s${LIST_INDENT}]|$)`
  + '|(?:\\*[ \\t]*){3,}$|(?:-[ \\t]*){3,}$|(?:_[ \\t]*){3,}$)',
);
function interruptsParagraph(block) {
  if (block.list) return true;
  const line = block.text.split('\n')[0];
  return isFenceOpenLine(line) || PARAGRAPH_INTERRUPT_RE.test(line);
}

// Blocks whose markdown ends on a closed line (ATX heading, thematic
// break, code fence), so a following list line cannot be absorbed into
// them. Keyed by tag name, or ac:name for structured macros.
const CLOSED_LIST_ITEM_BLOCKS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'code', 'mermaid-macro', 'plantuml', 'plantumlcloud',
]);

// CommonMark ordered list markers are 1–9 digits, so numbers are 0..MAX.
const MAX_LIST_NUMBER = 999999999;
// Elements looked through when checking whether a callout body opens with
// an ordered list.
const TRANSPARENT_LIST_WRAPPERS = new Set([
  'div', 'p', 'span', 'ac:layout', 'ac:layout-section', 'ac:layout-cell',
]);
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

const HARD_BREAK_RE = new RegExp(HARD_BREAK, 'g');
const HARD_BREAK_PAD_RE = new RegExp(` *${HARD_BREAK} *`, 'g');
const HARD_BREAK_EDGE_RE = new RegExp(`^[ ${HARD_BREAK}]+|[ ${HARD_BREAK}]+$`, 'g');

// A line that follows a hard break is still paragraph text, but CommonMark
// would let some line starts interrupt the paragraph (nested list, heading,
// blockquote, fence), turn the line above into a setext heading, or make it
// a GFM table header (delimiter row). Escape
// just those openers; inline syntax such as `**bold**` is left alone. A
// backtick run followed by more backticks is a code span, not a fence.
function escapeContinuationLine(line) {
  if (/^(?:[-=]+|(?:[-*_] *){3,})$/.test(line)
    || (/^[-:| ]+$/.test(line) && line.includes('|') && line.includes('-'))
    || /^(?:[-+*](?= |$)|#{1,6}(?= |$)|>|~{3}|`{3,}[^`]*$)/.test(line)) {
    return '\\' + line;
  }
  return line.replace(/^(\d{1,9})([.)])(?= |$)/, '$1\\$2');
}

// Decode HTML entity references, matching the original htmlToMarkdown
// bit-for-bit: nbsp / ldquo / rdquo / lsquo / rsquo / hellip → ASCII,
// other named entities (eacute, mdash, copy, …) → Unicode via the
// entities lib, numeric refs → codepoints. Only `&…;` sequences are
// touched — literal Unicode characters already in the text pass through
// unchanged.
const ENTITY_ASCII_MAP = {
  nbsp: ' ',
  ldquo: '"',
  rdquo: '"',
  lsquo: '\'',
  rsquo: '\'',
  hellip: '...',
};

// Every piece of user text (text nodes, CDATA bodies, attribute values)
// passes through here, so it is also where literal sentinel codepoints
// are escaped; StorageWalker.cleanup() restores them.
function decodeEntities(text) {
  if (!text) return '';
  return escapeSentinels(text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch (_) {
        return match;
      }
    }
    if (Object.prototype.hasOwnProperty.call(ENTITY_ASCII_MAP, body)) {
      return ENTITY_ASCII_MAP[body];
    }
    return decodeHTML(`&${body};`);
  }));
}

// Prefix every line with a blockquote marker. QUOTE_MARK stands in for `>`
// until cleanup() so splitOnFences can recognise quoted fences and leave
// their bodies byte-exact; blank lines get a bare marker. Runs of blank
// lines outside fences are collapsed first, as cleanup() does at top level —
// once quoted they are no longer blank and would accumulate on each
// storage → markdown → storage round-trip.
function quoteLines(text) {
  return splitOnFences(text)
    .map((seg, i) => (i % 2 === 1 ? seg : collapseBlankLines(seg)))
    .join('')
    .split('\n')
    .map((line) => (line.length === 0 ? QUOTE_MARK : `${QUOTE_MARK} ${line}`))
    .join('\n');
}

class StorageDepthExceededError extends Error {
  constructor(maxDepth) {
    super(`Storage XML nesting exceeds limit of ${maxDepth} levels`);
    this.name = 'StorageDepthExceededError';
    this.maxDepth = maxDepth;
  }
}

class StorageWalker {
  constructor({
    attachmentsDir = 'attachments',
    labels = {},
    buildUrl = (u) => u,
    webUrlPrefix = '',
    maxDepth = DEFAULT_MAX_DEPTH,
  } = {}) {
    this.attachmentsDir = attachmentsDir;
    this.labels = labels;
    this.buildUrl = buildUrl;
    this.webUrlPrefix = webUrlPrefix;
    this.maxDepth = maxDepth;
  }

  walk(storage) {
    this._depth = 0;
    this._markdownLinkLabelDepth = 0;
    this._markdownCodeSpanDepth = 0;
    // >0 while walking inline content whose whitespace is collapsed (list
    // item, table cell, task body); <br/> then emits HARD_BREAK instead of a
    // newline the collapse would erase. The outermost such context owns
    // resolving it.
    this._hardBreakDepth = 0;
    this.warnings = [];

    // htmlparser2 in xmlMode is lenient: malformed input (unclosed tags,
    // crossed nesting) is auto-closed without raising. We need to surface
    // those events so callers can flag pages that were silently repaired.
    //
    // The handler emits onclosetag(name, isImplied) for *every* tag that
    // wasn't matched by an explicit </tag> — including legitimate XML
    // self-closing tags like `<br/>` and `<ri:attachment/>`. We
    // distinguish the two by tracking each open tag's index range: a
    // self-closing tag's open and close events share the same
    // (startIndex, endIndex), while a genuinely auto-closed tag's close
    // event lands at a later position in the source.
    const handler = new DomHandler(null, { xmlMode: true });
    const openStack = [];
    const origOnOpenTag = handler.onopentag.bind(handler);
    const origOnCloseTag = handler.onclosetag.bind(handler);
    handler.onopentag = (...args) => {
      openStack.push({ sIdx: parser.startIndex, eIdx: parser.endIndex });
      origOnOpenTag(...args);
    };
    handler.onclosetag = (...args) => {
      const [name, isImplied] = args;
      const opened = openStack.pop();
      if (isImplied) {
        const selfClosing =
          opened
          && opened.sIdx === parser.startIndex
          && opened.eIdx === parser.endIndex;
        if (!selfClosing) {
          const offset = parser.endIndex;
          this.warnings.push({ type: 'implicit-close', tag: name, offset });
          if (process.env.CONFLUENCE_CLI_VERBOSE) {
            process.stderr.write(
              `StorageWalker: auto-closed <${name}> at offset ${offset}\n`,
            );
          }
        }
      }
      origOnCloseTag(...args);
    };

    const parser = new Parser(handler, {
      xmlMode: true,
      recognizeSelfClosing: true,
      decodeEntities: true,
    });
    parser.write(storage);
    parser.end();

    return this.cleanup(this.walkNodes(handler.dom));
  }

  walkNodes(nodes) {
    if (!nodes) return '';
    return nodes.map((n) => this.walkNode(n)).join('');
  }

  walkNode(node) {
    if (!node) return '';
    switch (node.type) {
    case 'text':
      // htmlparser2 in xmlMode only decodes the five XML entities (&amp;
      // &lt; &gt; &quot; &apos;). Confluence storage prose still ships HTML
      // named entities like &nbsp;, &eacute;, &ndash;, so decode them here
      // before they reach markdown output.
      return this.renderText(node.data || '');
    case 'cdata':
      return this.walkNodes(node.children);
    case 'comment':
    case 'directive':
      return '';
    case 'tag':
    case 'script':
    case 'style':
      return this.walkElement(node);
    default:
      return '';
    }
  }

  walkElement(node) {
    if (++this._depth > this.maxDepth) {
      this._depth--;
      throw new StorageDepthExceededError(this.maxDepth);
    }
    try {
      return this._dispatchElement(node);
    } finally {
      this._depth--;
    }
  }

  _dispatchElement(node) {
    const tag = node.name;
    switch (tag) {
    case 'p':
      return '\n' + this.walkNodes(node.children).trim() + '\n';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = parseInt(tag.charAt(1), 10);
      return '\n' + '#'.repeat(level) + ' ' + this.walkNodes(node.children).trim() + '\n';
    }
    case 'strong': case 'b':
      return '**' + this.walkNodes(node.children) + '**';
    case 'em': case 'i':
      return '*' + this.walkNodes(node.children) + '*';
    case 's': case 'del':
      return '~~' + this.walkNodes(node.children) + '~~';
    case 'code': {
      // A code span cannot hold a line break; keep the historical space.
      const hardBreakDepth = this._hardBreakDepth;
      this._hardBreakDepth = 0;
      this._markdownCodeSpanDepth++;
      try {
        return this.renderCodeSpan(this.walkNodes(node.children));
      } finally {
        this._markdownCodeSpanDepth--;
        this._hardBreakDepth = hardBreakDepth;
      }
    }
    case 'br':
      return this._hardBreakDepth > 0 ? HARD_BREAK : '\n';
    case 'hr':
      return '\n---\n';
    case 'a': {
      const href = decodeEntities((node.attribs && node.attribs.href) || '');
      if (!href) return this.walkNodes(node.children);
      this._markdownLinkLabelDepth++;
      let inner;
      try {
        inner = this.walkNodes(node.children);
      } finally {
        this._markdownLinkLabelDepth--;
      }
      return `[${inner}](${href})`;
    }
    case 'time':
      return this.renderText((node.attribs && node.attribs.datetime) || '')
        || this.walkNodes(node.children);
    case 'ul':
      return this.handleList(node, false);
    case 'ol':
      return this.handleList(node, true);
    case 'li':
      return this.walkNodes(node.children);
    case 'table':
      return this.handleTable(node);
    case 'thead': case 'tbody': case 'tfoot': case 'tr': case 'th': case 'td':
      return this.walkNodes(node.children);
    case 'blockquote':
      return this.handleBlockquote(node);
    case 'details': case 'summary':
    case 'u': case 'sub': case 'sup': case 'mark':
      return `<${tag}>` + this.walkNodes(node.children) + `</${tag}>`;
    case 'ac:structured-macro':
      return this.handleMacro(node);
    case 'ac:image':
      return this.handleImage(node);
    case 'ac:link':
      return this.handleAcLink(node);
    case 'ac:task-list':
      return this.handleTaskList(node);
    case 'ac:layout': case 'ac:layout-section': case 'ac:layout-cell':
    case 'ac:rich-text-body': case 'ac:link-body':
      return this.walkNodes(node.children);
    case 'ri:url': case 'ri:page': case 'ri:attachment':
    case 'ac:plain-text-body': case 'ac:plain-text-link-body':
    case 'ac:parameter':
      return '';
    default:
      return this.walkNodes(node.children);
    }
  }

  handleList(node, ordered) {
    const bodies = (node.children || [])
      .filter((c) => c.type === 'tag' && c.name === 'li')
      .map((item) => this.renderListItemBody(item.children))
      .filter(Boolean);
    const start = ordered ? resolveListStart(node.attribs && node.attribs.start, bodies.length) : 1;
    let counter = start;
    let out = '';
    for (const body of bodies) {
      out += this.formatListItem(ordered ? `${counter++}.` : '-', body);
    }
    // Only `1.` may interrupt a paragraph, so any other start needs a blank
    // line to stay a list after preceding inline text.
    if (!out) return '';
    return (start === 1 ? '\n' : '\n\n') + out;
  }

  formatListItem(marker, body) {
    // CommonMark: continuation lines (nested lists, extra paragraphs,
    // code fences) must be indented to the item's content column.
    const indent = LIST_INDENT.repeat(marker.length + 1);
    const [first, ...rest] = body.split('\n');
    // `- ---` would parse as a top-level thematic break; `- ***` is an
    // <hr> inside the item.
    const lead = first === '---' ? '***' : first;
    // A fence on the marker line (possibly behind a nested marker or
    // quote prefix) is joined with LIST_INDENT so splitOnFences still
    // recognises it and leaves the body untouched.
    const sep = isFenceOpenLine(lead) ? LIST_INDENT : ' ';
    let out = `${marker}${sep}${lead}\n`;
    for (const line of rest) out += (line ? indent + line : '') + '\n';
    return out;
  }

  // Render <li> children as a sequence of blocks. Runs of inline content
  // keep the historical whitespace collapse (source newlines / indentation
  // inside prose are not meaningful); block children keep their own line
  // structure so nested lists, paragraphs and code survive.
  //
  // `checkbox` (task items) is prefixed to the first line of the body.
  // Before a block that can interrupt a paragraph it stands alone on the
  // marker line, followed directly (no blank line) by that block: GFM only
  // renders a lone `[ ]` as a checkbox when it is not a paragraph of its
  // own. A plain <li> holding such a bare `[ ]` followed by that kind of
  // block (markdown → storage output for the item) is rendered the same
  // way, so the round-trip is stable.
  renderListItemBody(children, checkbox = '') {
    const blocks = [];
    let inline = '';
    const flushInline = () => {
      const text = this.renderInlineRun(inline);
      if (text) blocks.push({ text, list: false, prefixable: true });
      inline = '';
    };
    for (const child of children || []) {
      if (this.isListItemBlock(child)) {
        const text = child.name === 'p'
          ? this.renderInlineRun(this.walkWithHardBreaks([child]))
          : this.walkNode(child).trim();
        if (!text) continue;
        flushInline();
        const list = child.name === 'ul' || child.name === 'ol' || child.name === 'ac:task-list';
        const name = child.name === 'ac:structured-macro' ? child.attribs && child.attribs['ac:name'] : child.name;
        blocks.push({
          text,
          list,
          prefixable: child.name === 'p',
          closed: CLOSED_LIST_ITEM_BLOCKS.has(name),
        });
      } else {
        inline += this.walkWithHardBreaks([child]);
      }
    }
    flushInline();
    let box = checkbox;
    if (!box && blocks.length > 1 && blocks[0].prefixable && BARE_CHECKBOX_RE.test(blocks[0].text)
      && interruptsParagraph(blocks[1])) {
      box = blocks.shift().text;
    }
    if (box && blocks.length > 0) {
      const first = blocks[0];
      if (first.prefixable || !interruptsParagraph(first)) {
        first.text = `${box} ${first.text}`;
      } else {
        // `[ ]` directly above `---` would be read as a setext heading.
        if (first.text === '---') first.text = '***';
        blocks.unshift({ text: box, list: false, bareCheckbox: true });
      }
    }
    let out = '';
    blocks.forEach((block, i) => {
      if (i > 0) {
        // A list may follow its lead-in line or another list directly
        // (tight). Any other boundary needs a blank line, otherwise text
        // after a nested list would lazily continue that list's last item.
        // An ordered list not starting at 1 cannot interrupt a paragraph,
        // so after a lead-in it stays tight only behind a block that cannot
        // absorb it.
        const prev = blocks[i - 1];
        const tight = prev.bareCheckbox
          || (block.list && (prev.list || prev.closed || !NON_ONE_ORDERED_MARKER_RE.test(block.text)));
        out += tight ? '\n' : '\n\n';
      }
      out += block.text;
    });
    return out;
  }

  walkWithHardBreaks(nodes) {
    this._hardBreakDepth++;
    try {
      return this.walkNodes(nodes);
    } finally {
      this._hardBreakDepth--;
    }
  }

  // Collapse whitespace in an inline run, keeping HARD_BREAK as the only
  // line boundary and dropping breaks (and spaces) at either edge.
  collapseInline(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(HARD_BREAK_PAD_RE, HARD_BREAK)
      .replace(HARD_BREAK_EDGE_RE, '');
  }

  renderInlineRun(text) {
    return this.renderHardBreaks(this.collapseInline(stripListIndent(text)));
  }

  // Resolve HARD_BREAK to a CommonMark backslash hard break. Trailing-space
  // breaks would not survive cleanupOutsideFence. Inside an enclosing
  // collapsing context (table cell, outer list item) the sentinel is left
  // for that context to resolve.
  renderHardBreaks(text) {
    if (this._hardBreakDepth > 0 || !text.includes(HARD_BREAK)) return text;
    const lines = text.split(HARD_BREAK);
    return lines
      .map((line, i) => {
        const out = i === 0 ? line : escapeContinuationLine(line);
        // An odd run of trailing backslashes (`C:\temp\`) would escape the
        // break's own `\`; double the last one so it stays literal.
        const trailing = out.match(/\\*$/)[0].length;
        return i < lines.length - 1 && trailing % 2 === 1 ? out + '\\' : out;
      })
      .join('\\\n');
  }

  isListItemBlock(node) {
    if (node.type !== 'tag') return false;
    if (node.name === 'ac:structured-macro') {
      return LIST_ITEM_BLOCK_MACROS.has(node.attribs && node.attribs['ac:name']);
    }
    return LIST_ITEM_BLOCK_TAGS.has(node.name);
  }

  handleTable(node) {
    const rows = [];
    const trs = this.findAllDescendants(node, 'tr');
    let isHeader = true;
    for (const tr of trs) {
      const cells = (tr.children || []).filter((c) => c.type === 'tag' && (c.name === 'th' || c.name === 'td'));
      if (cells.length === 0) continue;
      // GFM table rows cannot span lines, so <br/> stays inline HTML.
      const cellTexts = cells.map((cell) =>
        this.collapseInline(stripListIndent(this.walkWithHardBreaks(cell.children)))
          .replace(HARD_BREAK_RE, '<br>') || ' '
      );
      rows.push('| ' + cellTexts.join(' | ') + ' |');
      if (isHeader) {
        rows.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
        isHeader = false;
      }
    }
    return rows.length > 0 ? '\n' + rows.join('\n') + '\n' : '';
  }

  handleBlockquote(node) {
    const inner = this.walkNodes(node.children).trim();
    if (!inner) return '';
    return '\n' + quoteLines(inner) + '\n';
  }

  handleMacro(node) {
    const name = node.attribs && node.attribs['ac:name'];
    switch (name) {
    case 'toc':
    case 'floatmenu':
      return '';
    case 'expand':
      return this.handleExpand(node);
    case 'code':
      return this.handleCode(node);
    case 'info': case 'warning': case 'note':
      return this.handleCallout(node, name);
    case 'anchor':
      return this.handleAnchor(node);
    case 'panel':
      return this.handlePanel(node);
    case 'mermaid-macro':
      return this.handleMermaid(node);
    case 'plantuml':
      return this.handlePlantuml(node);
    case 'plantumlcloud':
      return this.handlePlantumlCloud(node);
    case 'include':
      return this.handleInclude(node);
    case 'shared-block':
    case 'include-shared-block':
      return this.handleSharedBlock(node, name);
    case 'view-file':
      return this.handleViewFile(node);
    default:
      return '';
    }
  }

  handleExpand(node) {
    const titleParam = this.findParamByName(node, 'title');
    const title = (titleParam ? this.getTextContent(titleParam) : '').trim();
    const body = this.getMacroBody(node);
    if (title) {
      return `\n**EXPAND: ${title}**\n\n${this.walkNodes(body).trim()}\n\n**EXPAND_END**\n`;
    }
    return `\n<details>\n<summary>${this.labels.expandDetails || 'Expand Details'}</summary>\n\n${this.walkNodes(body).trim()}\n\n</details>\n`;
  }

  handleCode(node) {
    const langParam = this.findParamByName(node, 'language');
    const lang = langParam ? this.getTextContent(langParam) : '';
    const plainBody = this.findChildByName(node, 'ac:plain-text-body');
    const code = plainBody ? this.getRawText(plainBody) : '';
    const fence = '`'.repeat(fenceLength(code));
    return `\n${fence}${lang}\n${code}\n${fence}\n`;
  }

  handleCallout(node, marker) {
    const body = this.getMacroBody(node);
    const inner = this.walkNodes(body).trim();
    const header = `**${marker.toUpperCase()}**`;
    // The header is a paragraph, so a leading list not starting at 1 needs
    // a blank quote line to stay a list.
    const sep = this.opensWithOrderedList(body) && NON_ONE_ORDERED_MARKER_RE.test(inner) ? '\n\n' : '\n';
    return `\n${quoteLines(inner.length === 0 ? header : `${header}${sep}${inner}`)}\n`;
  }

  // Whether the first node with text content is an <ol>, looking through
  // transparent wrappers. Checked structurally so the body is not rendered
  // twice.
  opensWithOrderedList(nodes) {
    for (const node of nodes || []) {
      if (node.type === 'text') {
        if (decodeEntities(node.data).trim()) return false;
        continue;
      }
      if (node.type !== 'tag' || !this.getTextContent(node).trim()) continue;
      if (TRANSPARENT_LIST_WRAPPERS.has(node.name)) return this.opensWithOrderedList(node.children);
      return node.name === 'ol';
    }
    return false;
  }

  handleAnchor(node) {
    const param = this.findParamByName(node, '');
    const id = (param ? this.getTextContent(param) : '').trim();
    if (!id) return '';
    return `\n**ANCHOR: ${id}**\n`;
  }

  handlePanel(node) {
    const titleParam = this.findParamByName(node, 'title');
    const title = (titleParam ? this.getTextContent(titleParam) : '').trim();
    const body = this.getMacroBody(node);
    // Trim before quoting — walkNodes wraps every <p> with a leading and
    // trailing \n, so untrimmed body splits into ['', 'body', ''] and emits
    // extra `>` blank lines that bracket the real content.
    const cleanContent = this.walkNodes(body).trim();
    if (!title && !cleanContent) return '';
    if (!title) return `\n${quoteLines(cleanContent)}\n`;
    if (!cleanContent) return `\n${quoteLines(`**${title}**`)}\n`;
    return `\n${quoteLines(`**${title}**\n\n${cleanContent}`)}\n`;
  }

  handleMermaid(node) {
    const plainBody = this.findChildByName(node, 'ac:plain-text-body');
    const code = plainBody ? this.getRawText(plainBody).trim() : '';
    const fence = '`'.repeat(fenceLength(code));
    return `\n${fence}mermaid\n${code}\n${fence}\n`;
  }

  handlePlantuml(node) {
    const plainBody = this.findChildByName(node, 'ac:plain-text-body');
    const code = plainBody ? this.getRawText(plainBody).trim() : '';
    const fence = '`'.repeat(fenceLength(code));
    return `\n${fence}plantuml\n${code}\n${fence}\n`;
  }

  // `compressed` is documented as mandatory `true`, so there is no
  // uncompressed branch: try to inflate and fall back to the raw payload.
  // Plain (uncompressed) markup never inflates successfully, so it survives
  // verbatim through the same path.
  handlePlantumlCloud(node) {
    const dataParam = this.findParamByName(node, 'data');
    const payload = dataParam ? this.getRawText(dataParam).trim() : '';
    const decoded = decodePlantuml(payload);
    // Lossless fallback: an undecodable payload is emitted verbatim rather
    // than dropped, so nothing is silently lost on read.
    const code = decoded === null ? payload : escapeSentinels(decoded.trim());
    const fence = '`'.repeat(fenceLength(code));
    return `\n${fence}plantuml\n${code}\n${fence}\n`;
  }

  handleInclude(node) {
    const param = this.findParamByName(node, '');
    if (!param) return '';
    const acLink = this.findChildByName(param, 'ac:link');
    if (!acLink) return '';
    const riPage = this.findChildByName(acLink, 'ri:page');
    if (!riPage) return '';
    const spaceKey = decodeEntities(riPage.attribs['ri:space-key'] || '');
    const title = decodeEntities(riPage.attribs['ri:content-title'] || '');
    const escapedTitle = this.escapeMarkdownText(title);
    const label = this.labels.includePage || 'Include Page';
    if (spaceKey.startsWith('~')) {
      // Encode the unescaped title: an escaped sentinel would be
      // percent-encoded and never restored by cleanup().
      const spacePath = `display/${spaceKey}/${encodeURIComponent(finalizeSentinels(title))}`;
      return `\n> 📄 **${label}**: [${escapedTitle}](${this.buildUrl(`${this.webUrlPrefix}/${spacePath}`)})\n`;
    }
    return `\n> 📄 **${label}**: [${escapedTitle}](${this.buildUrl(`${this.webUrlPrefix}/spaces/${spaceKey}/pages/[PAGE_ID_HERE]`)}) _(manual link correction required)_\n`;
  }

  handleSharedBlock(node, type) {
    const blockKeyParam = this.findParamByName(node, 'shared-block-key');
    const blockKey = (blockKeyParam ? this.getTextContent(blockKeyParam) : '').trim();
    const pageParam = this.findParamByName(node, 'page');
    if (pageParam && type === 'include-shared-block') {
      const acLink = this.findChildByName(pageParam, 'ac:link');
      if (acLink) {
        const riPage = this.findChildByName(acLink, 'ri:page');
        if (riPage) {
          const pageTitle = this.escapeMarkdownText(decodeEntities(riPage.attribs['ri:content-title'] || ''));
          const includeLabel = this.labels.includeSharedBlock || 'Include Shared Block';
          const fromPageLabel = this.labels.fromPage || 'from page';
          const keyPart = blockKey ? `: ${blockKey} ` : ' ';
          return `\n> 📄 **${includeLabel}**${keyPart}(${fromPageLabel}: ${pageTitle} [link needs manual correction])\n`;
        }
      }
    }
    const body = this.getMacroBody(node);
    // See handlePanel — trim to avoid bracketing `>` blank lines.
    const cleanContent = this.walkNodes(body).trim();
    const sharedLabel = this.labels.sharedBlock || 'Shared Block';
    if (!blockKey && !cleanContent) return '';
    const header = blockKey ? `**${sharedLabel}: ${blockKey}**` : `**${sharedLabel}**`;
    if (!cleanContent) return `\n${quoteLines(header)}\n`;
    return `\n${quoteLines(`${header}\n\n${cleanContent}`)}\n`;
  }

  handleViewFile(node) {
    const nameParam = this.findParamByName(node, 'name');
    if (!nameParam) return '';
    const riAttachment = this.findChildByName(nameParam, 'ri:attachment');
    if (!riAttachment) return '';
    const filename = decodeEntities(riAttachment.attribs['ri:filename'] || '');
    return `\n📎 [${filename}](${this.attachmentsDir}/${filename})\n`;
  }

  handleImage(node) {
    const riAttachment = this.findChildByName(node, 'ri:attachment');
    if (riAttachment) {
      const filename = this.renderText(riAttachment.attribs['ri:filename'] || '');
      return `![${filename}](${this.attachmentsDir}/${filename})`;
    }
    const riUrl = this.findChildByName(node, 'ri:url');
    if (riUrl) {
      const url = this.renderText(riUrl.attribs['ri:value'] || '');
      if (!url) return '';
      return `![](${url})`;
    }
    return '';
  }

  handleAcLink(node) {
    const attribs = node.attribs || {};
    // ac:anchor and ri:url branches both require an explicit link body —
    // without one the original regex pipeline dropped the link entirely
    // rather than emitting a visibly-empty `[](url)` marker. Match that.
    if (attribs['ac:anchor']) {
      const linkBody = this.findChildByName(node, 'ac:plain-text-link-body');
      const text = linkBody ? this.getRawText(linkBody) : '';
      if (!text) return '';
      return `[${text}](#${decodeEntities(attribs['ac:anchor'])})`;
    }
    const riUrl = this.findChildByName(node, 'ri:url');
    if (riUrl) {
      const url = decodeEntities(riUrl.attribs['ri:value'] || '');
      const linkBody = this.findChildByName(node, 'ac:plain-text-link-body');
      const text = linkBody ? this.getRawText(linkBody) : '';
      if (!text) return '';
      return `[${text}](${url})`;
    }
    const linkBody = this.findChildByName(node, 'ac:link-body');
    if (linkBody) {
      return this.walkNodes(linkBody.children).trim();
    }
    const riPage = this.findChildByName(node, 'ri:page');
    if (riPage) {
      const title = this.escapeMarkdownText(decodeEntities(riPage.attribs['ri:content-title'] || ''));
      return `[${title}]`;
    }
    return '';
  }

  // A nested task list appears either inside <ac:task-body> or, as the
  // Confluence Cloud editor writes it, as a sibling <ac:task-list> right
  // after its parent <ac:task> (e.g. https://github.com/james-allan-lloyd/
  // marked-space/blob/main/example/team/task-list.md). Both render as the
  // parent item's children.
  handleTaskList(node) {
    const groups = [];
    for (const child of node.children || []) {
      if (child.type !== 'tag') continue;
      if (child.name === 'ac:task') {
        groups.push({ task: child, nested: [] });
      } else if (child.name === 'ac:task-list') {
        if (groups.length === 0) groups.push({ task: null, nested: [] });
        groups[groups.length - 1].nested.push(child);
      }
    }
    let out = '';
    for (const { task, nested } of groups) {
      if (!task) {
        // A sibling list with no preceding task has no parent to nest
        // under; keep its items at this level.
        const text = nested.map((list) => this.walkNode(list).trim()).filter(Boolean).join('\n');
        if (text) out += text + '\n';
        continue;
      }
      const status = this.findChildByName(task, 'ac:task-status');
      const body = this.findChildByName(task, 'ac:task-body');
      const statusText = status ? this.getTextContent(status) : '';
      const checkbox = statusText === 'complete' ? '[x]' : '[ ]';
      const children = [...((body && body.children) || []), ...nested];
      const text = this.renderListItemBody(children, checkbox);
      if (text) out += this.formatListItem('-', text);
    }
    return out ? '\n' + out : '';
  }

  findParamByName(node, name) {
    if (!node || !node.children) return null;
    for (const child of node.children) {
      if (child.type === 'tag' && child.name === 'ac:parameter' && child.attribs['ac:name'] === name) {
        return child;
      }
    }
    return null;
  }

  findChildByName(node, name) {
    if (!node || !node.children) return null;
    for (const child of node.children) {
      if (child.type === 'tag' && child.name === name) return child;
    }
    return null;
  }

  findAllDescendants(node, name) {
    const result = [];
    const visit = (n) => {
      if (!n) return;
      if (n.type === 'tag' && n.name === name) result.push(n);
      if (n.children) n.children.forEach(visit);
    };
    if (node.children) node.children.forEach(visit);
    return result;
  }

  getMacroBody(node) {
    const body = this.findChildByName(node, 'ac:rich-text-body');
    return body ? body.children : [];
  }

  getTextContent(node) {
    return decodeEntities(this._collectText(node));
  }

  // Escape markdown structural characters in text that will be interpolated
  // into link syntax (`[text](url)`). Confluence page titles can legitimately
  // contain `()` / `[]`, and a maliciously-crafted title could otherwise inject
  // a sibling link or break downstream parsers. Backslash is escaped so that
  // an existing `\` in a title isn't reinterpreted as a markdown escape.
  escapeMarkdownText(s) {
    if (!s) return '';
    return s.replace(/([\\`*_[\]()~|<>])/g, '\\$1');
  }

  renderText(text) {
    const decodedText = decodeEntities(text);
    return this._markdownLinkLabelDepth > 0 && this._markdownCodeSpanDepth === 0
      ? this.escapeMarkdownText(decodedText)
      : decodedText;
  }

  renderCodeSpan(content) {
    const backtickRuns = content.match(/`+/g) || [];
    const longestRun = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
    const delimiter = '`'.repeat(longestRun + 1);
    const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
    return `${delimiter}${padding}${content}${padding}${delimiter}`;
  }

  _collectText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.data || '';
    if (node.children) return node.children.map((c) => this._collectText(c)).join('');
    return '';
  }

  getRawText(node) {
    // Apply entity decoding once at the top level. Internal recursion uses
    // the raw helper so nested CDATA segments are not double-decoded.
    return decodeEntities(this._collectRawText(node));
  }

  _collectRawText(node) {
    if (!node || !node.children) return '';
    let out = '';
    for (const child of node.children) {
      if (child.type === 'text') out += child.data || '';
      else if (child.type === 'cdata') out += this._collectRawText(child);
    }
    return out;
  }

  cleanup(text) {
    return finalizeSentinels(cleanupWithFences(text));
  }
}

module.exports = { StorageWalker, StorageDepthExceededError, DEFAULT_MAX_DEPTH };
