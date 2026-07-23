const MarkdownIt = require('markdown-it');
const { StorageWalker } = require('./storage-walker');
const { htmlToStorage } = require('./html-to-storage');
const { VALID_LINK_STYLES, resolveLinkStyle } = require('./link-style');

const CALLOUT_MARKERS = ['info', 'warning', 'note'];
// U+E000 (Unicode Private Use Area) is used as the stash placeholder
// delimiter. Declared as an explicit escape so the byte is visible in source
// and survives editor / formatter / lint passes that strip invisible chars.
const STASH_DELIM = '\uE000';

// Inline HTML tags that markdown has no native syntax for. The walker emits
// them as raw HTML on storage\u2192markdown, so they must round-trip back through
// markdownToStorage; without this whitelist, MarkdownIt (html: false) escapes
// them to literal `&lt;...&gt;` and the formatting is lost.
//
// The lookahead `(?=[\s/>])` after the tag name rejects strings that look
// like markdown autolinks (e.g. `<u@example.com>`, `<sub:foo>`) \u2014 a plain
// `\b` word boundary would let these through and break linkify.
//
// The body alternation `"[^"]*"|'[^']*'|[^>]` makes the match quote-aware
// so a literal `>` inside a quoted attribute value (e.g.
// `<mark title="1>0">`) does not terminate the tag prematurely.
const PASSTHROUGH_TAG_RE = /<\/?(?:br|u|sub|sup|mark|details|summary)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^>])*>/gi;
// Block-level HTML elements that should pass through WITHOUT markdown processing of their content. 
const PASSTHROUGH_BLOCK_RE = /<(svg|div)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;
// Single-backtick inline code spans. Block-level code (fenced + indented) is
// detected via MarkdownIt's tokenizer in `_findCodeRanges` because a regex
// can't reliably distinguish a 4-space-indented code block from a list-item
// continuation that happens to align to four spaces.
const INLINE_CODE_RE = /`[^`\n]+`/g;

// Escapes a restored passthrough tag for safe inclusion inside a double-quoted
// XML attribute value. Only used when a stash placeholder resolved into an
// attribute context (see `_renderMarkdownToHtml`); text-node placeholders are
// left raw. `&` is escaped first so the entity ampersands below are not
// double-escaped.
function escapeXmlAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class MacroConverter {
  constructor({ isCloud = false, webUrlPrefix = '', buildUrl = null, linkStyle = null } = {}) {
    this._isCloud = isCloud;
    this.webUrlPrefix = webUrlPrefix;
    this.buildUrl = buildUrl || ((pathOrUrl) => pathOrUrl);
    this.linkStyle = resolveLinkStyle({ isCloud, linkStyle });
    this.markdown = new MarkdownIt();
    this.setupConfluenceMarkdownExtensions();
  }

  isCloud() {
    return this._isCloud;
  }

  setupConfluenceMarkdownExtensions() {
    this.markdown.enable(['table', 'strikethrough', 'linkify']);

    this.markdown.core.ruler.before('normalize', 'confluence_macros', (state) => {
      // Stash fenced code blocks and inline code so the admonition rewrite
      // below cannot transform `[!info]` tokens that the author intended as
      // literal text inside code.
      const stash = [];
      state.src = state.src.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g, (m) => {
        stash.push(m);
        return `${STASH_DELIM}${stash.length - 1}${STASH_DELIM}`;
      });

      // Anchor `[!info]` to the start of a line (string start or after a
      // newline) so prose mid-paragraph, headings on the same line, and
      // `> [!info]` GitHub-style alerts are left alone.
      for (const m of CALLOUT_MARKERS) {
        const re = new RegExp(`(^|\\n)\\[!${m}\\]\\s*([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\s*\\[!|$)`, 'g');
        state.src = state.src.replace(re, (_, pre, content) =>
          `${pre}> **${m.toUpperCase()}**\n> ${content.trim().replace(/\n/g, '\n> ')}`
        );
      }

      // Fall back to the original match if the index is out of range so a
      // literal U+E000<digits>U+E000 in user prose survives untouched instead
      // of becoming the string "undefined".
      const restoreRe = new RegExp(`${STASH_DELIM}(\\d+)${STASH_DELIM}`, 'g');
      state.src = state.src.replace(restoreRe, (m, i) => stash[+i] ?? m);
    });
  }

  markdownToStorage(markdown) {
    return this.htmlToConfluenceStorage(this._renderMarkdownToHtml(markdown));
  }

  markdownToNativeStorage(markdown) {
    return this.htmlToConfluenceStorage(this._renderMarkdownToHtml(markdown));
  }

  // Pre-stashes whitelisted inline HTML so MarkdownIt won't escape it, renders,
  // then restores. Code regions (fenced, indented, and inline) are skipped so a
  // literal `<u>` typed inside a code block survives MarkdownIt's escape and
  // round-trips as text rather than as a real tag — which would otherwise be
  // smuggled past the escape and dropped by `convertCodeBlock`'s text-only
  // child collection in html-to-storage.
  _renderMarkdownToHtml(markdown) {
    const codeRanges = this._findCodeRanges(markdown);
    const htmlStash = [];
    const replaceStandaloneMarker = (text, marker, replacement) => {
      const line = `(^|\\n)([^\\S\\n]*)${marker}[^\\S\\n]*(?=\\n|$)`;
      return text.replace(new RegExp(line, 'gi'), (match, prefix, indent) => `${prefix}${indent}${replacement}`);
    };
    const replaceMacroPlaceholders = (text) => {
      let result = replaceStandaloneMarker(text, '<!--\\s*(?:\\[\\[)?_TOC_(?:\\]\\])?\\s*-->', '**TOC**');
      result = replaceStandaloneMarker(result, '<!--\\s*(?:\\[\\[)?_LISTING_(?:\\]\\])?\\s*-->', '**LISTING**');
      result = replaceStandaloneMarker(result, '\\[\\[_TOC_\\]\\]', '**TOC**');
      return replaceStandaloneMarker(result, '\\[\\[_LISTING_\\]\\]', '**LISTING**');
    };
    const stashHtml = (text) => {
      // block-level HTML (svg, div with all content) must be stashed before inline tags to avoid matching the closing tag as inline HTML
      let result = replaceMacroPlaceholders(text).replace(PASSTHROUGH_BLOCK_RE, (m) => {
        htmlStash.push(m);
        return `${STASH_DELIM}H${htmlStash.length - 1}${STASH_DELIM}`;
      });
      // Then stash inline HTML tags
      result = result.replace(PASSTHROUGH_TAG_RE, (m) => {
        htmlStash.push(m);
        return `${STASH_DELIM}H${htmlStash.length - 1}${STASH_DELIM}`;
      });
      return result;
    };

    let src = '';
    let pos = 0;
    for (const [start, end] of codeRanges) {
      src += stashHtml(markdown.slice(pos, start));
      src += markdown.slice(start, end);
      pos = end;
    }
    src += stashHtml(markdown.slice(pos));

    const html = this.markdown.render(src);
    return html.replace(
      new RegExp(`${STASH_DELIM}H(\\d+)${STASH_DELIM}`, 'g'),
      (m, i, offset, str) => {
        const raw = htmlStash[+i];
        if (raw == null) return m;
        // A placeholder can render into an attribute value (e.g. a link/image
        // `title` built from `[x](url "<br>")`). Restoring the raw tag there
        // would inject unescaped `<>"&` into an attribute, producing invalid
        // storage XML that Confluence rejects. Detect the attribute context by
        // checking whether the nearest preceding angle bracket opens a tag
        // (`<` after the last `>`), and XML-escape the restored value if so.
        // Text-node placeholders keep their raw tag, so body passthrough is
        // byte-identical.
        const before = str.slice(0, offset);
        if (before.lastIndexOf('<') > before.lastIndexOf('>')) {
          return escapeXmlAttr(raw);
        }
        return raw;
      },
    );
  }

  // Returns merged, sorted character ranges covering all code regions in the
  // markdown source — fenced and indented blocks via MarkdownIt's tokenizer
  // (which correctly distinguishes them from list-item continuations) and
  // single-backtick inline spans via regex (MarkdownIt parses these into
  // `code_inline` tokens but does not expose source positions for them).
  _findCodeRanges(markdown) {
    const tokens = this.markdown.parse(markdown, {});
    const lineStarts = [0];
    for (let i = 0; i < markdown.length; i++) {
      if (markdown[i] === '\n') lineStarts.push(i + 1);
    }
    const lineToChar = (n) => (n < lineStarts.length ? lineStarts[n] : markdown.length);

    const ranges = [];
    for (const tok of tokens) {
      if ((tok.type === 'code_block' || tok.type === 'fence') && tok.map) {
        ranges.push([lineToChar(tok.map[0]), lineToChar(tok.map[1])]);
      }
    }
    INLINE_CODE_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_CODE_RE.exec(markdown)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }

    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push([r[0], r[1]]);
      }
    }
    return merged;
  }

  htmlToConfluenceStorage(html) {
    return htmlToStorage(html, { isCloud: this._isCloud, linkStyle: this.linkStyle });
  }

  detectLanguageLabels(text) {
    const labels = {
      includePage: 'Include Page',
      sharedBlock: 'Shared Block',
      includeSharedBlock: 'Include Shared Block',
      fromPage: 'from page',
      expandDetails: 'Expand Details'
    };

    if (/[\u4e00-\u9fa5]/.test(text)) {
      labels.includePage = '包含页面';
      labels.sharedBlock = '共享块';
      labels.includeSharedBlock = '包含共享块';
      labels.fromPage = '来自页面';
      labels.expandDetails = '展开详情';
    } else if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      labels.includePage = 'ページを含む';
      labels.sharedBlock = '共有ブロック';
      labels.includeSharedBlock = '共有ブロックを含む';
      labels.fromPage = 'ページから';
      labels.expandDetails = '詳細を表示';
    } else if (/[\uac00-\ud7af]/.test(text)) {
      labels.includePage = '페이지 포함';
      labels.sharedBlock = '공유 블록';
      labels.includeSharedBlock = '공유 블록 포함';
      labels.fromPage = '페이지에서';
      labels.expandDetails = '상세 보기';
    } else if (/[\u0400-\u04ff]/.test(text)) {
      labels.includePage = 'Включить страницу';
      labels.sharedBlock = 'Общий блок';
      labels.includeSharedBlock = 'Включить общий блок';
      labels.fromPage = 'со страницы';
      labels.expandDetails = 'Подробнее';
    } else if ((text.match(/[àâäéèêëïîôùûüÿœæç]/gi) || []).length >= 2) {
      labels.includePage = 'Inclure la page';
      labels.sharedBlock = 'Bloc partagé';
      labels.includeSharedBlock = 'Inclure le bloc partagé';
      labels.fromPage = 'de la page';
      labels.expandDetails = 'Détails';
    } else if ((text.match(/[äöüß]/gi) || []).length >= 2) {
      labels.includePage = 'Seite einbinden';
      labels.sharedBlock = 'Gemeinsamer Block';
      labels.includeSharedBlock = 'Gemeinsamen Block einbinden';
      labels.fromPage = 'von Seite';
      labels.expandDetails = 'Details';
    } else if ((text.match(/[áéíóúñ¿¡]/gi) || []).length >= 2) {
      labels.includePage = 'Incluir página';
      labels.sharedBlock = 'Bloque compartido';
      labels.includeSharedBlock = 'Incluir bloque compartido';
      labels.fromPage = 'de la página';
      labels.expandDetails = 'Detalles';
    }

    return labels;
  }

  storageToMarkdown(storage, options = {}) {
    const attachmentsDir = options.attachmentsDir || 'attachments';
    const labels = this.detectLanguageLabels(storage);
    const walker = new StorageWalker({
      attachmentsDir,
      labels,
      buildUrl: this.buildUrl,
      webUrlPrefix: this.webUrlPrefix,
    });
    const result = walker.walk(storage);
    if (typeof options.onWarnings === 'function' && walker.warnings.length > 0) {
      options.onWarnings(walker.warnings);
    }
    return result;
  }
}

module.exports = MacroConverter;
module.exports.VALID_LINK_STYLES = VALID_LINK_STYLES;
