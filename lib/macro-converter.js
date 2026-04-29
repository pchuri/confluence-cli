const MarkdownIt = require('markdown-it');
const { htmlToMarkdown } = require('./html-to-markdown');

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
      // `> [!info]` GitHub-style alerts are left alone. The latter would
      // otherwise expand to a nested blockquote that the storage handler's
      // lazy regex cannot balance, producing malformed XML.
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
    let storage = html;

    storage = storage.replace(/<h([1-6])>(.*?)<\/h[1-6]>/g, '<h$1>$2</h$1>');

    storage = storage.replace(/<p>(.*?)<\/p>/g, '<p>$1</p>');

    storage = storage.replace(/<strong>(.*?)<\/strong>/g, '<strong>$1</strong>');

    storage = storage.replace(/<em>(.*?)<\/em>/g, '<em>$1</em>');

    storage = storage.replace(/<ul>(.*?)<\/ul>/gs, '<ul>$1</ul>');
    storage = storage.replace(/<li>(.*?)<\/li>/g, '<li><p>$1</p></li>');

    storage = storage.replace(/<ol>(.*?)<\/ol>/gs, '<ol>$1</ol>');

    storage = storage.replace(/<pre><code(?:\s+class="language-(\w+)")?>(.*?)<\/code><\/pre>/gs, (_, lang, code) => {
      const language = lang || 'text';
      const decodedCode = code.replace(/\n$/, '')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      const safeCode = decodedCode.replace(/]]>/g, ']]]]><![CDATA[>');
      return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${safeCode}]]></ac:plain-text-body></ac:structured-macro>`;
    });

    storage = storage.replace(/<code>(.*?)<\/code>/g, '<code>$1</code>');

    // **TOC** paragraph → Confluence Table of Contents macro (uses macro defaults)
    storage = storage.replace(
      /<p><strong>TOC<\/strong><\/p>/g,
      '<ac:structured-macro ac:name="toc" />'
    );

    storage = storage.replace(/<blockquote>(.*?)<\/blockquote>/gs, (_, content) => {
      // Detect the marker only when it sits at the very start of the first
      // paragraph, immediately followed by a `</p>` close (separated form) or
      // a `\n` (same-line body form). This is the same anchor condition the
      // strip step uses below, so detection and stripping stay in sync.
      // Without this anchor, a quotation that merely *mentions* `**INFO**` —
      // e.g. `> Use **INFO** at the start.` — would be silently wrapped in an
      // info macro, surprising the author.
      const marker = CALLOUT_MARKERS.find((m) =>
        new RegExp(`<p><strong>${m.toUpperCase()}<\\/strong>(<\\/p>|\\s*\\n)`).test(content)
      );
      if (!marker) {
        // Plain blockquote — `> …` is a quotation, not an alert. Use the
        // `> **INFO**` / `> **WARNING**` / `> **NOTE**` markers above to
        // produce a Confluence info / warning / note macro instead.
        return `<blockquote>${content}</blockquote>`;
      }
      // Strip the leading `<strong>MARKER</strong>`. markdown-it produces two
      // shapes depending on whether a blank `>` line separates marker and body:
      //   case A (separated):  `<p><strong>MARKER</strong></p>\n<p>body</p>`
      //   case B (same-line):  `<p><strong>MARKER</strong>\nbody</p>`
      // The original cleanup only handled case A, so case B leaked the marker
      // into the rendered macro body. README's recommended `> **INFO**\n> body`
      // form parses as case B — exactly the form that broke.
      const cleanContent = content.replace(
        new RegExp(`<p><strong>${marker.toUpperCase()}<\\/strong>(<\\/p>\\s*|\\s*\\n)`),
        (_, tail) => tail.startsWith('</p>') ? '' : '<p>'
      );
      return `<ac:structured-macro ac:name="${marker}">
          <ac:rich-text-body>${cleanContent}</ac:rich-text-body>
        </ac:structured-macro>`;
    });

    storage = storage.replace(/<table>(.*?)<\/table>/gs, '<table>$1</table>');
    storage = storage.replace(/<thead>(.*?)<\/thead>/gs, '<thead>$1</thead>');
    storage = storage.replace(/<tbody>(.*?)<\/tbody>/gs, '<tbody>$1</tbody>');
    storage = storage.replace(/<tr>(.*?)<\/tr>/gs, '<tr>$1</tr>');
    storage = storage.replace(/<th>(.*?)<\/th>/g, '<th><p>$1</p></th>');
    storage = storage.replace(/<td>(.*?)<\/td>/g, '<td><p>$1</p></td>');

    // **ANCHOR: id** paragraph → Confluence anchor macro
    storage = storage.replace(
      /<p><strong>ANCHOR: (.*?)<\/strong><\/p>/g,
      '<ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">$1</ac:parameter></ac:structured-macro>'
    );

    // **EXPAND: title** … **EXPAND_END** → Confluence expand macro. Runs
    // after code/blockquote/table conversion so the body can contain those
    // macros. Strips inline HTML from the title because Confluence's storage
    // normalizer treats <ac:parameter> as text-only — it silently truncates
    // at the first '<' and rejects <s> outright with HTTP 500. Entities
    // (&amp;, &lt;) survive because the regex requires a literal '<'.
    storage = storage.replace(
      /<p><strong>EXPAND: (.*?)<\/strong><\/p>\s*([\s\S]*?)\s*<p><strong>EXPAND_END<\/strong><\/p>/g,
      (_, title, body) => {
        const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
        return `<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">${cleanTitle}</ac:parameter><ac:rich-text-body>${body.trim()}</ac:rich-text-body></ac:structured-macro>`;
      }
    );

    // Same-page anchor links (href="#id") → ac:link with ac:anchor. Must run
    // before the general link conversion below so the #id pattern is not
    // consumed by the generic <a href> replacement (and so it works under
    // all linkStyle modes, including "plain" which leaves <a> tags as-is).
    storage = storage.replace(/<a href="#(.*?)">(.*?)<\/a>/gs, (_, anchor, body) => {
      const text = body
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'');
      return `<ac:link ac:anchor="${anchor}"><ac:plain-text-link-body><![CDATA[${text}]]></ac:plain-text-link-body></ac:link>`;
    });

    // Convert links based on linkStyle:
    //   "smart" — Cloud smart links (<a data-card-appearance="inline">)
    //   "plain" — simple <a href>; workaround for "Cannot handle: DefaultLink"
    //             errors on custom-domain Cloud instances
    //   "wiki"  — Server/DC ac:link + ri:url storage format
    if (this.linkStyle === 'smart') {
      storage = storage.replace(/<a href="(.*?)">(.*?)<\/a>/g, '<a href="$1" data-card-appearance="inline">$2</a>');
    } else if (this.linkStyle === 'wiki') {
      storage = storage.replace(/<a href="(.*?)">(.*?)<\/a>/g, '<ac:link><ri:url ri:value="$1" /><ac:plain-text-link-body><![CDATA[$2]]></ac:plain-text-link-body></ac:link>');
    }
    // "plain" — leave <a href> tags as-is

    storage = storage.replace(/<hr\s*\/?>/g, '<hr />');

    return storage;
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
    let markdown = storage;

    const labels = this.detectLanguageLabels(markdown);

    markdown = markdown.replace(/<ac:structured-macro ac:name="toc"[^>]*\s*\/>/g, '');
    markdown = markdown.replace(/<ac:structured-macro ac:name="toc"[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');

    markdown = markdown.replace(/<ac:structured-macro ac:name="floatmenu"[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');

    markdown = markdown.replace(/<ac:image[^>]*>\s*<ri:attachment\s+ri:filename="([^"]+)"[^>]*\s*\/>\s*<\/ac:image>/g, (_, filename) => {
      return `![${filename}](${attachmentsDir}/${filename})`;
    });

    markdown = markdown.replace(/<ac:image[^>]*><ri:attachment\s+ri:filename="([^"]+)"[^>]*><\/ri:attachment><\/ac:image>/g, (_, filename) => {
      return `![${filename}](${attachmentsDir}/${filename})`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="mermaid-macro"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, code) => {
      return `\n\`\`\`mermaid\n${code.trim()}\n\`\`\`\n`;
    });

    // Titled expand macros → **EXPAND: title** / **EXPAND_END** markers
    // (round-trip with markdownToStorage). Must run before the generic
    // <details> fallback below, which would otherwise drop the title.
    markdown = markdown.replace(
      /<ac:structured-macro ac:name="expand"[^>]*>[\s\S]*?<ac:parameter ac:name="title">([\s\S]*?)<\/ac:parameter>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g,
      '\n**EXPAND: $1**\n\n$2\n\n**EXPAND_END**\n'
    );

    // Title-less expand macros (e.g. created in the Confluence UI without a
    // title) fall back to <details>/<summary> with a localized default label.
    markdown = markdown.replace(/<ac:structured-macro ac:name="expand"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, content) => {
      return `\n<details>\n<summary>${labels.expandDetails}</summary>\n\n${content}\n\n</details>\n`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="code"[^>]*>[\s\S]*?<ac:parameter ac:name="language">([^<]*)<\/ac:parameter>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, lang, code) => {
      return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, code) => {
      return `\n\`\`\`\n${code}\n\`\`\`\n`;
    });

    // Emit the README-recommended `> **MARKER**` blockquote form rather than
    // the bare `[!marker]` shorthand. The bare form has no explicit body
    // terminator, so a blank line inside a multi-paragraph body is
    // indistinguishable from the body ending — round-tripping such a body
    // through markdownToStorage drops every paragraph after the first.
    // The `>` prefix gives the blockquote-based handler an unambiguous body
    // boundary, so multi-paragraph callouts survive download → re-upload.
    // markdownToStorage still accepts the bare `[!marker]` form on input for
    // backwards compatibility with already-downloaded files.
    //
    // Wrap the output with leading + trailing `\n` to combine with the single
    // `\n` that htmlToMarkdown emits around adjacent `<p>` tags. Without
    // these, a following `<p>after</p>` lazy-continues into the blockquote
    // body and lands inside the macro on re-upload (blockquote semantics —
    // unlike code fences, blockquotes have no closing delimiter).
    for (const marker of CALLOUT_MARKERS) {
      const re = new RegExp(`<ac:structured-macro ac:name="${marker}"[^>]*>[\\s\\S]*?<ac:rich-text-body>([\\s\\S]*?)<\\/ac:rich-text-body>[\\s\\S]*?<\\/ac:structured-macro>`, 'g');
      markdown = markdown.replace(re, (_, content) => {
        const body = htmlToMarkdown(content).trim();
        const quotedBody = body
          .split('\n')
          .map((line) => (line.length === 0 ? '>' : `> ${line}`))
          .join('\n');
        const header = `> **${marker.toUpperCase()}**`;
        const inner = body.length === 0 ? header : `${header}\n${quotedBody}`;
        return `\n${inner}\n`;
      });
    }

    // anchor macro → **ANCHOR: id** marker (round-trip with markdownToStorage).
    // Must run before the generic <ac:structured-macro> catch-all below, which
    // would otherwise drop the anchor entirely.
    markdown = markdown.replace(
      /<ac:structured-macro ac:name="anchor"[^>]*>[\s\S]*?<ac:parameter ac:name="">([\s\S]*?)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g,
      '\n**ANCHOR: $1**\n'
    );

    markdown = markdown.replace(/<ac:task-list>([\s\S]*?)<\/ac:task-list>/g, (_, content) => {
      const tasks = [];
      const taskRegex = /<ac:task>[\s\S]*?<ac:task-status>([^<]*)<\/ac:task-status>[\s\S]*?<ac:task-body>([\s\S]*?)<\/ac:task-body>[\s\S]*?<\/ac:task>/g;
      let match;
      while ((match = taskRegex.exec(content)) !== null) {
        const status = match[1];
        let taskBody = match[2];
        taskBody = taskBody.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const checkbox = status === 'complete' ? '[x]' : '[ ]';
        if (taskBody) {
          tasks.push(`- ${checkbox} ${taskBody}`);
        }
      }
      return tasks.length > 0 ? '\n' + tasks.join('\n') + '\n' : '';
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="panel"[^>]*>[\s\S]*?<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, title, content) => {
      const cleanContent = htmlToMarkdown(content);
      return `\n> **${title}**\n>\n${cleanContent.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}\n`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="include"[^>]*>[\s\S]*?<ac:parameter ac:name="">[\s\S]*?<ac:link>[\s\S]*?<ri:page\s+ri:space-key="([^"]+)"\s+ri:content-title="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:link>[\s\S]*?<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, spaceKey, title) => {
      if (spaceKey.startsWith('~')) {
        const spacePath = `display/${spaceKey}/${encodeURIComponent(title)}`;
        return `\n> 📄 **${labels.includePage}**: [${title}](${this.buildUrl(`${this.webUrlPrefix}/${spacePath}`)})\n`;
      } else {
        return `\n> 📄 **${labels.includePage}**: [${title}](${this.buildUrl(`${this.webUrlPrefix}/spaces/${spaceKey}/pages/[PAGE_ID_HERE]`)}) _(manual link correction required)_\n`;
      }
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="(shared-block|include-shared-block)"[^>]*>[\s\S]*?<ac:parameter ac:name="shared-block-key">([^<]*)<\/ac:parameter>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, macroType, blockKey, content) => {
      const cleanContent = htmlToMarkdown(content);
      return `\n> **${labels.sharedBlock}: ${blockKey}**\n>\n${cleanContent.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}\n`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="include-shared-block"[^>]*>[\s\S]*?<ac:parameter ac:name="shared-block-key">([^<]*)<\/ac:parameter>[\s\S]*?<ac:parameter ac:name="page">[\s\S]*?<ac:link>[\s\S]*?<ri:page\s+ri:space-key="([^"]+)"\s+ri:content-title="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:link>[\s\S]*?<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, blockKey, spaceKey, pageTitle) => {
      return `\n> 📄 **${labels.includeSharedBlock}**: ${blockKey} (${labels.fromPage}: ${pageTitle} [link needs manual correction])\n`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="view-file"[^>]*>[\s\S]*?<ac:parameter ac:name="name">[\s\S]*?<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, filename) => {
      return `\n📎 [${filename}](${attachmentsDir}/${filename})\n`;
    });

    markdown = markdown.replace(/<ac:structured-macro ac:name="view-file"[^>]*>[\s\S]*?<ac:parameter ac:name="name">[\s\S]*?<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:parameter>[\s\S]*?<ac:parameter ac:name="height">([^<]*)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, filename, _height) => {
      return `\n📎 [${filename}](${attachmentsDir}/${filename})\n`;
    });

    markdown = markdown.replace(/<ac:layout>/g, '');
    markdown = markdown.replace(/<\/ac:layout>/g, '');
    markdown = markdown.replace(/<ac:layout-section[^>]*>/g, '');
    markdown = markdown.replace(/<\/ac:layout-section>/g, '');
    markdown = markdown.replace(/<ac:layout-cell[^>]*>/g, '');
    markdown = markdown.replace(/<\/ac:layout-cell>/g, '');

    markdown = markdown.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');

    // ac:link with ac:anchor → [text](#id) (round-trip with markdownToStorage).
    // Must run before the <ac:link[^>]*>…</ac:link> catch-all below, which
    // would otherwise drop the anchor link entirely.
    markdown = markdown.replace(
      /<ac:link ac:anchor="([^"]*)">\s*<ac:plain-text-link-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-link-body>\s*<\/ac:link>/g,
      '[$2](#$1)'
    );

    markdown = markdown.replace(/<ac:link><ri:url ri:value="([^"]*)" \/><ac:plain-text-link-body><!\[CDATA\[([^\]]*)\]\]><\/ac:plain-text-link-body><\/ac:link>/g, '[$2]($1)');

    markdown = markdown.replace(/<ac:link>\s*<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/>\s*<\/ac:link>/g, '[$1]');
    markdown = markdown.replace(/<ac:link>\s*<ri:page[^>]*ri:content-title="([^"]*)"[^>]*>\s*<\/ri:page>\s*<\/ac:link>/g, '[$1]');

    markdown = markdown.replace(/<ac:link[^>]*>[\s\S]*?<ac:link-body>([\s\S]*?)<\/ac:link-body>[\s\S]*?<\/ac:link>/g, '$1');

    markdown = markdown.replace(/<ac:link[^>]*>[\s\S]*?<\/ac:link>/g, '');

    markdown = htmlToMarkdown(markdown);

    return markdown;
  }
}

module.exports = MacroConverter;
module.exports.VALID_LINK_STYLES = VALID_LINK_STYLES;
