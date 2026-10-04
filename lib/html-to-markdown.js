const {
  LIST_INDENT,
  escapeSentinels,
  finalizeSentinels,
  fenceLength,
  escapeFenceLikeText,
  splitOnFences,
  cleanupWithFences,
} = require('./markdown-cleanup');

const NAMED_ENTITIES = {
  aring: 'å', auml: 'ä', ouml: 'ö',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ccedil: 'ç', szlig: 'ß', yuml: 'ÿ',
  eth: 'ð', thorn: 'þ',
  Aring: 'Å', Auml: 'Ä', Ouml: 'Ö',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Euml: 'Ë',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã',
  Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Otilde: 'Õ',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü',
  Iacute: 'Í', Igrave: 'Ì', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ', Ccedil: 'Ç', Szlig: 'SS', Yuml: 'Ÿ',
  Eth: 'Ð', Thorn: 'Þ'
};

// Lists nested deeper than this are flattened into the enclosing item's
// text (the pre-#243 behaviour) so rendering recursion stays bounded.
// Same value as StorageWalker's DEFAULT_MAX_DEPTH.
const MAX_LIST_DEPTH = 256;

// Flatten the inline content of a list item onto one line, matching the
// historical regex converter: paragraphs and any remaining tags become
// spaces and whitespace runs collapse.
function flattenItemText(text) {
  return text
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Render an <li> as the walker does (storage-walker renderListItemBody):
// runs of inline text are flattened, while nested lists and fenced code
// emitted by the <pre> rule keep their own lines. A nested list may follow
// its lead-in text directly; any other boundary needs a blank line so
// trailing text does not lazily continue the nested list's last item.
// Returns the body and whether it opens with a fence.
function renderListItem(item) {
  const blocks = [];
  for (const part of item.parts) {
    if (typeof part !== 'string') {
      const text = renderList(part);
      if (text) blocks.push({ text, kind: 'list' });
      continue;
    }
    splitOnFences(part).forEach((seg, i) => {
      if (i % 2 === 1) {
        blocks.push({ text: seg, kind: 'fence' });
        return;
      }
      const text = flattenItemText(seg);
      if (text) blocks.push({ text, kind: 'text' });
    });
  }
  let body = '';
  blocks.forEach((block, i) => {
    if (i > 0) body += block.kind === 'list' && blocks[i - 1].kind !== 'list' ? '\n' : '\n\n';
    body += block.text;
  });
  return { body, fenceLead: blocks.length > 0 && blocks[0].kind === 'fence' };
}

// Continuation lines are indented with LIST_INDENT so the whitespace
// cleanup chain cannot collapse them; finalizeSentinels restores spaces.
// A fence on the marker line is joined with LIST_INDENT so splitOnFences
// still recognises it and leaves the body untouched. Only real fences get
// that join: literal text starting with backticks keeps a plain space, so
// it can never pair with a later fence.
function renderList(list) {
  let counter = 1;
  const lines = [];
  for (const item of list.items) {
    const { body, fenceLead } = renderListItem(item);
    if (!body) continue;
    const marker = list.ordered ? `${counter++}.` : '-';
    const indent = LIST_INDENT.repeat(marker.length + 1);
    const [first, ...rest] = body.split('\n');
    lines.push(`${marker}${fenceLead ? LIST_INDENT : ' '}${first}`);
    for (const line of rest) lines.push(line ? indent + line : '');
  }
  return lines.join('\n');
}

// Tokenize list tags and pair each </ul> / </ol> with the innermost open
// list, whatever its type. Tags are already normalised to `<name>` /
// `</name>` (attributes stripped) by the time lists are converted. Opens
// left unpaired keep `pair === -1`; every token inside a paired span is
// itself paired, so building a paired list never runs off the end.
function tokenizeLists(src) {
  const tokens = [];
  const open = [];
  const re = /<(\/?)(ul|ol|li)>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const token = { start: m.index, end: re.lastIndex, close: m[1] === '/', name: m[2], pair: -1 };
    if (token.name !== 'li') {
      if (!token.close) {
        open.push(tokens.length);
      } else if (open.length > 0) {
        const o = open.pop();
        tokens[o].pair = tokens.length;
        token.pair = o;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

function pushText(item, text) {
  const last = item.parts.length - 1;
  if (last >= 0 && typeof item.parts[last] === 'string') item.parts[last] += text;
  else item.parts.push(text);
}

// Build the tree for the paired list spanning tokens[from]..tokens[to].
// `<li>` implicitly closes an open sibling item, and a list placed directly
// inside another list attaches to the preceding item (as browsers render
// it), so text following it stays in that item. Other text sitting
// directly inside a list, outside any <li>, is dropped as before.
function buildList(src, tokens, from, to) {
  const root = { ordered: tokens[from].name === 'ol', items: [] };
  const stack = [root];
  let depth = 1;
  let cursor = tokens[from].end;
  for (let i = from + 1; i <= to; i++) {
    const t = tokens[i];
    const top = stack[stack.length - 1];
    if (!top.items) pushText(top, src.slice(cursor, t.start));
    cursor = t.end;
    if (t.close) {
      if (t.name !== 'li') {
        while (!stack[stack.length - 1].items) stack.pop();
        stack.pop();
        depth--;
      } else if (!top.items) {
        stack.pop();
      }
      continue;
    }
    if (t.name === 'li') {
      if (!top.items) stack.pop();
      const item = { parts: [] };
      stack[stack.length - 1].items.push(item);
      stack.push(item);
      continue;
    }
    let parent = top;
    if (parent.items) {
      if (parent.items.length === 0) parent.items.push({ parts: [] });
      parent = parent.items[parent.items.length - 1];
      stack.push(parent);
    }
    if (depth >= MAX_LIST_DEPTH) {
      cursor = tokens[t.pair].end;
      pushText(parent, src.slice(t.start, cursor));
      i = t.pair;
      continue;
    }
    const list = { ordered: t.name === 'ol', items: [] };
    parent.parts.push(list);
    stack.push(list);
    depth++;
  }
  return root;
}

// Replace every top-level paired <ul>/<ol> with its markdown rendering.
// Unclosed lists are left in place for the later tag-stripping passes.
function convertLists(src) {
  const tokens = tokenizeLists(src);
  let out = '';
  let copied = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.close || t.name === 'li' || t.pair < 0) continue;
    const rendered = renderList(buildList(src, tokens, i, t.pair));
    out += src.slice(copied, t.start) + '\n' + (rendered ? rendered + '\n' : '');
    copied = tokens[t.pair].end;
    i = t.pair;
  }
  return out + src.slice(copied);
}

// Code regions and tags (attribute values may hold backticks) are left alone;
// only the prose between them is escaped. Backtick entities in prose are
// decoded first, since the entity pass runs after the fence-aware cleanup and
// would otherwise reintroduce a literal fence line, and NBSP entities count as
// indentation for the same reason. A tag must start with a letter, `/` or `!`
// so prose like `a < b` is not mistaken for one. The code-region patterns are
// only used when a closing tag exists, which keeps unclosed `<pre>` / `<code>`
// from rescanning the rest of the input on every attempt.
const BACKTICK_ENTITY_RE = /&#0*96;|&#x0*60;/gi;
const NBSP_ENTITY = '&nbsp;|&#0*160;|&#x0*a0;';
function fenceProtectedRe(html) {
  const parts = [];
  if (/<\/pre/i.test(html)) parts.push('<pre(?![\\w-])[\\s\\S]*?<\\/pre>');
  if (/<\/code/i.test(html)) parts.push('<code(?![\\w-])[^>]*>[\\s\\S]*?<\\/code>');
  parts.push('<[A-Za-z/!][^>]*>');
  return new RegExp(parts.join('|'), 'gi');
}
function escapeLiteralFences(html) {
  const escapeProse = (text) => escapeFenceLikeText(text.replace(BACKTICK_ENTITY_RE, '`'), NBSP_ENTITY);
  let out = '';
  let last = 0;
  for (const m of html.matchAll(fenceProtectedRe(html))) {
    out += escapeProse(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + escapeProse(html.slice(last));
}

function htmlToMarkdown(html) {
  let markdown = escapeLiteralFences(escapeSentinels(html));

  markdown = markdown.replace(/<time\s+datetime="([^"]+)"[^>]*(?:\/>|>\s*<\/time>)/g, '$1');

  // Convert <a href="url">text</a> to [text](url) before generic attribute stripping.
  // Allows attributes anywhere in the opening tag so smart links / inline cards
  // (e.g. <a href="..." data-card-appearance="inline">) are preserved.
  markdown = markdown.replace(
    /<a\s+[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
    (_, href, text) => `[${text}](${href})`
  );

  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**');

  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*');

  // Multi-line <pre><code> → fenced block. Must run before the inline <code>
  // rule and before catch-all tag stripping so indentation-sensitive bodies
  // are wrapped in fences and skipped by the cleanup chain below.
  markdown = markdown.replace(
    /<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g,
    (_, codeAttrs, body) => {
      // Stop the language token at whitespace so multi-class conventions
      // like Prism / highlight.js (`class="language-js hljs"`) don't leak
      // sibling class names into the fence info string.
      const langMatch = codeAttrs.match(/class="language-([^"\s]+)/);
      const lang = langMatch ? langMatch[1] : '';
      const trimmed = body.replace(/^\n+|\n+$/g, '');
      // Size against entity-decoded content: the entity-decode pass runs
      // after this rule, so `&#96;` / `&#x60;` would otherwise expose
      // backticks inside the fence post-emission and break it.
      const decoded = trimmed
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
      const fence = '`'.repeat(fenceLength(decoded));
      return `\n${fence}${lang}\n${trimmed}\n${fence}\n`;
    }
  );

  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`');

  // A self-closing (XHTML) list is empty; drop it before normalisation turns
  // it into a bare `<ul>` that would steal the enclosing list's close tag.
  markdown = markdown.replace(/<(?:ul|ol)\b[^>]*\/>/g, '');

  markdown = markdown.replace(/<(\w+)[^>]*>/g, '<$1>');
  markdown = markdown.replace(/<\/(\w+)[^>]*>/g, '</$1>');

  markdown = markdown.replace(/<h([1-6])>(.*?)<\/h[1-6]>/g, (_, level, text) => {
    return '\n' + '#'.repeat(parseInt(level)) + ' ' + text.trim() + '\n';
  });

  markdown = markdown.replace(/<table>(.*?)<\/table>/gs, (_, content) => {
    const rows = [];
    let isHeader = true;

    const rowMatches = content.match(/<tr>(.*?)<\/tr>/gs);
    if (rowMatches) {
      rowMatches.forEach(rowMatch => {
        const cells = [];
        const cellContent = rowMatch.replace(/<tr>(.*?)<\/tr>/s, '$1');

        const cellMatches = cellContent.match(/<t[hd]>(.*?)<\/t[hd]>/gs);
        if (cellMatches) {
          cellMatches.forEach(cellMatch => {
            let cellText = cellMatch.replace(/<t[hd]>(.*?)<\/t[hd]>/s, '$1');
            cellText = cellText.replace(/<p>/g, '').replace(/<\/p>/g, ' ');
            cellText = cellText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            cells.push(cellText || ' ');
          });
        }

        if (cells.length > 0) {
          rows.push('| ' + cells.join(' | ') + ' |');

          if (isHeader) {
            rows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
            isHeader = false;
          }
        }
      });
    }

    return rows.length > 0 ? '\n' + rows.join('\n') + '\n' : '';
  });

  markdown = convertLists(markdown);

  markdown = markdown.replace(/<p>(.*?)<\/p>/gs, (_, content) => {
    return '\n' + content.trim() + '\n';
  });

  markdown = markdown.replace(/<br\s*\/?>/g, '\n');

  markdown = markdown.replace(/<hr\s*\/?>/g, '\n---\n');

  markdown = markdown.replace(/<(?!\/?(details|summary)\b)[^>]+>/g, ' ');

  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&amp;/g, '&');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&apos;/g, '\'');
  markdown = markdown.replace(/&ldquo;/g, '"');
  markdown = markdown.replace(/&rdquo;/g, '"');
  markdown = markdown.replace(/&lsquo;/g, '\'');
  markdown = markdown.replace(/&rsquo;/g, '\'');
  markdown = markdown.replace(/&mdash;/g, '—');
  markdown = markdown.replace(/&ndash;/g, '–');
  markdown = markdown.replace(/&hellip;/g, '...');
  markdown = markdown.replace(/&bull;/g, '•');
  markdown = markdown.replace(/&copy;/g, '©');
  markdown = markdown.replace(/&reg;/g, '®');
  markdown = markdown.replace(/&trade;/g, '™');
  // Decoded codepoints are escaped like literal input so an entity for a
  // LIST_INDENT sentinel is not turned into indentation.
  markdown = markdown.replace(/&#(\d+);/g,
    (_, code) => escapeSentinels(String.fromCharCode(parseInt(code, 10))));
  markdown = markdown.replace(/&#x([0-9a-fA-F]+);/g,
    (_, code) => escapeSentinels(String.fromCharCode(parseInt(code, 16))));

  markdown = markdown.replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] || match);

  return finalizeSentinels(cleanupWithFences(markdown));
}

module.exports = {
  htmlToMarkdown,
  NAMED_ENTITIES
};
