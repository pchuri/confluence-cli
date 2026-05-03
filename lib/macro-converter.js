const MarkdownIt = require('markdown-it');
const { StorageWalker } = require('./storage-walker');
const { htmlToStorage } = require('./html-to-storage');

const VALID_LINK_STYLES = ['smart', 'plain', 'wiki'];
const CALLOUT_MARKERS = ['info', 'warning', 'note'];
// U+E000 (Unicode Private Use Area) is used as the stash placeholder
// delimiter. Declared as an explicit escape so the byte is visible in source
// and survives editor / formatter / lint passes that strip invisible chars.
const STASH_DELIM = '\uE000';

// Inline HTML tags that markdown has no native syntax for. The walker emits
// them as raw HTML on storage\u2192markdown, so they must round-trip back through
// markdownToStorage; without this whitelist, MarkdownIt (html: false) escapes
// them to literal `&lt;...&gt;` and the formatting is lost.
const PASSTHROUGH_TAG_RE = /<\/?(?:u|sub|sup|mark)\b[^>]*>/gi;
// Single-backtick inline code spans. Block-level code (fenced + indented) is
// detected via MarkdownIt's tokenizer in `_findCodeRanges` because a regex
// can't reliably distinguish a 4-space-indented code block from a list-item
// continuation that happens to align to four spaces.
const INLINE_CODE_RE = /`[^`\n]+`/g;

class MacroConverter {
  constructor({ isCloud = false, webUrlPrefix = '', buildUrl = null, linkStyle = null } = {}) {
    this._isCloud = isCloud;
    this.webUrlPrefix = webUrlPrefix;
    this.buildUrl = buildUrl || ((pathOrUrl) => pathOrUrl);
    this.linkStyle = VALID_LINK_STYLES.includes(linkStyle)
      ? linkStyle
      : (isCloud ? 'smart' : 'wiki');
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
    const stashHtml = (text) => text.replace(PASSTHROUGH_TAG_RE, (m) => {
      htmlStash.push(m);
      return `${STASH_DELIM}H${htmlStash.length - 1}${STASH_DELIM}`;
    });

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
      (m, i) => htmlStash[+i] ?? m,
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
