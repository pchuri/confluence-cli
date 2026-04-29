const { fenceLength, cleanupWithFences } = require('./markdown-cleanup');

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

function htmlToMarkdown(html) {
  let markdown = html;

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

  markdown = markdown.replace(/<ul>(.*?)<\/ul>/gs, (_, content) => {
    let listItems = '';
    const itemMatches = content.match(/<li>(.*?)<\/li>/gs);
    if (itemMatches) {
      itemMatches.forEach(itemMatch => {
        let itemText = itemMatch.replace(/<li>(.*?)<\/li>/s, '$1');
        itemText = itemText.replace(/<p>/g, '').replace(/<\/p>/g, ' ');
        itemText = itemText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (itemText) {
          listItems += '- ' + itemText + '\n';
        }
      });
    }
    return '\n' + listItems;
  });

  markdown = markdown.replace(/<ol>(.*?)<\/ol>/gs, (_, content) => {
    let listItems = '';
    let counter = 1;
    const itemMatches = content.match(/<li>(.*?)<\/li>/gs);
    if (itemMatches) {
      itemMatches.forEach(itemMatch => {
        let itemText = itemMatch.replace(/<li>(.*?)<\/li>/s, '$1');
        itemText = itemText.replace(/<p>/g, '').replace(/<\/p>/g, ' ');
        itemText = itemText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (itemText) {
          listItems += `${counter++}. ${itemText}\n`;
        }
      });
    }
    return '\n' + listItems;
  });

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
  markdown = markdown.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  markdown = markdown.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  markdown = markdown.replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] || match);

  return cleanupWithFences(markdown);
}

module.exports = {
  htmlToMarkdown,
  NAMED_ENTITIES
};
