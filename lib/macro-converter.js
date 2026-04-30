const MarkdownIt = require('markdown-it');
const { StorageWalker } = require('./storage-walker');
const { htmlToStorage } = require('./html-to-storage');

const VALID_LINK_STYLES = ['smart', 'plain', 'wiki'];
const CALLOUT_MARKERS = ['info', 'warning', 'note'];
// U+E000 (Unicode Private Use Area) is used as the stash placeholder
// delimiter. Declared as an explicit escape so the byte is visible in source
// and survives editor / formatter / lint passes that strip invisible chars.
const STASH_DELIM = '\uE000';

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
    const html = this.markdown.render(markdown);
    return this.htmlToConfluenceStorage(html);
  }

  markdownToNativeStorage(markdown) {
    const html = this.markdown.render(markdown);
    return this.htmlToConfluenceStorage(html);
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
    return walker.walk(storage);
  }
}

module.exports = MacroConverter;
module.exports.VALID_LINK_STYLES = VALID_LINK_STYLES;
