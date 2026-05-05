/**
 * markdown-it plugin for Confluence storage format conversion
 *
 * Converts markdown directly to Confluence storage format instead of going through HTML.
 * Handles images, code blocks, those nice admonition boxes, and other Confluence stuff.
 *
 * Usage:
 *   const md = new MarkdownIt().use(confluencePlugin, options);
 *
 * Options:
 *   - isCloud: boolean - Cloud vs Server/DC (affects how links are rendered)
 *   - macros: object - Your custom macro handlers if you need them
 *   - allowHtmlPassthrough: boolean - Let raw HTML through (handy for SVGs)
 */

function confluencePlugin(md, options = {}) {
  const opts = {
    isCloud: false,
    macros: {},
    allowHtmlPassthrough: true,
    ...options
  };

  // Stash options on the markdown-it instance so we can access them later
  md.confluenceOptions = opts;

  // Turn on the extra markdown-it features we need
  md.enable(['table', 'strikethrough', 'linkify']);

  // HTML passthrough needs to be set up first, before other rules
  if (opts.allowHtmlPassthrough) {
    setupHtmlPassthrough(md);
  }

  // Setup preprocessing rules for Confluence syntax
  setupCoreRules(md);

  // Override renderer rules to output storage format
  setupRenderRules(md, opts);

  // Wrap the render function to do post-processing
  wrapRender(md);

  return md;
}

/**
 * Setup preprocessing rules
 * This runs before markdown-it parses the content
 */
function setupCoreRules(md) {
  md.core.ruler.before('normalize', 'confluence_macros', (state) => {
    let src = state.src;

    // Convert [!info] style admonitions to blockquote format
    // We use a special comment marker so we can detect them later
    src = src.replace(/\[!info\]\s*([\s\S]*?)(?=\n\s*\n|\n\s*\[!|$)/g, (_, content) => {
      return `> <!--ADMONITION:INFO-->\n> ${content.trim().replace(/\n/g, '\n> ')}`;
    });

    // Same for warnings
    src = src.replace(/\[!warning\]\s*([\s\S]*?)(?=\n\s*\n|\n\s*\[!|$)/g, (_, content) => {
      return `> <!--ADMONITION:WARNING-->\n> ${content.trim().replace(/\n/g, '\n> ')}`;
    });

    // And notes
    src = src.replace(/\[!note\]\s*([\s\S]*?)(?=\n\s*\n|\n\s*\[!|$)/g, (_, content) => {
      return `> <!--ADMONITION:NOTE-->\n> ${content.trim().replace(/\n/g, '\n> ')}`;
    });

    state.src = src;
  });
}

/**
 * Generate a UUID for Confluence macros
 * 
 */
function generateUUID() {
  return require('crypto').randomUUID();
}

/**
 * Setup HTML passthrough
 * Wraps raw HTML blocks in Confluence HTML macro
 */
function setupHtmlPassthrough(md) {
  // Need to tell markdown-it to allow HTML
  md.set({ html: true });

  // Wrap complete HTML blocks in Confluence HTML macro
  // HTML blocks are standalone chunks that markdown-it recognizes (e.g. <svg>...</svg> on its own lines)
  md.renderer.rules.html_block = function(tokens, idx) {
    const content = tokens[idx].content;
    const macroId = generateUUID();
    // Escape CDATA end markers
    const safeContent = content.replace(/]]>/g, ']]]]><![CDATA[>');
    return `<ac:structured-macro ac:name="html" ac:schema-version="1" ac:macro-id="${macroId}"><ac:plain-text-body><![CDATA[${safeContent}]]></ac:plain-text-body></ac:structured-macro>`;
  };

  // For inline HTML, just pass through as-is
  // We'll handle wrapping complete elements in post-processing
  md.renderer.rules.html_inline = function(tokens, idx) {
    return tokens[idx].content;
  };
}

/**
 * Setup all the renderer rules for Confluence storage format
 * This is where most of the work happens
 */
function setupRenderRules(md, opts) {
  // Headings are straightforward
  md.renderer.rules.heading_open = function(tokens, idx) {
    const level = tokens[idx].tag.substring(1);
    return `<h${level}>`;
  };

  md.renderer.rules.heading_close = function(tokens, idx) {
    const level = tokens[idx].tag.substring(1);
    return `</h${level}>`;
  };

  // Paragraphs
  md.renderer.rules.paragraph_open = () => '<p>';
  md.renderer.rules.paragraph_close = () => '</p>';

  // Bold and italic
  md.renderer.rules.strong_open = () => '<strong>';
  md.renderer.rules.strong_close = () => '</strong>';
  md.renderer.rules.em_open = () => '<em>';
  md.renderer.rules.em_close = () => '</em>';

  // Inline code
  md.renderer.rules.code_inline = (tokens, idx) => {
    return `<code>${escapeHtml(tokens[idx].content)}</code>`;
  };

  // Code blocks -> Confluence code macro
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const language = token.info || 'text';
    // Trim trailing newline and escape CDATA markers (just in case)
    const code = token.content.replace(/\n$/, '').replace(/]]>/g, ']]]]><![CDATA[>');

    return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`;
  };

  md.renderer.rules.code_block = (tokens, idx) => {
    const code = tokens[idx].content.replace(/\n$/, '').replace(/]]>/g, ']]]]><![CDATA[>');
    return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">text</ac:parameter><ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`;
  };

  // Lists
  md.renderer.rules.bullet_list_open = () => '<ul>';
  md.renderer.rules.bullet_list_close = () => '</ul>';
  md.renderer.rules.ordered_list_open = () => '<ol>';
  md.renderer.rules.ordered_list_close = () => '</ol>';
  md.renderer.rules.list_item_open = () => '<li>';
  md.renderer.rules.list_item_close = () => '</li>';

  // Blockquotes - we use placeholder comments that get replaced in post-processing
  // (easier than trying to capture nested content during rendering)
  md.renderer.rules.blockquote_open = () => '<!--BLOCKQUOTE_OPEN-->';
  md.renderer.rules.blockquote_close = () => '<!--BLOCKQUOTE_CLOSE-->';

  // Links - different format for Cloud vs Server
  md.renderer.rules.link_open = (tokens, idx) => {
    const href = tokens[idx].attrGet('href') || '';
    if (opts.isCloud) {
      // Cloud uses regular links with a special attribute
      return `<a href="${escapeHtml(href)}" data-card-appearance="inline">`;
    } else {
      // Server uses the ac:link format with CDATA
      return `<ac:link><ri:url ri:value="${escapeHtml(href)}" /><ac:plain-text-link-body><![CDATA[`;
    }
  };

  md.renderer.rules.link_close = () => {
    if (opts.isCloud) {
      return '</a>';
    } else {
      return ']]></ac:plain-text-link-body></ac:link>';
    }
  };

  // Images - check if it's an attachment or external URL
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const alt = token.content || '';
    const title = token.attrGet('title') || '';

    // If it doesn't start with http, assume it's an attachment
    if (src && !src.startsWith('http://') && !src.startsWith('https://')) {
      // Just grab the filename from the path
      const filename = src.split('/').pop();
      const altAttr = alt ? ` ac:alt="${escapeHtml(alt)}"` : '';
      const titleAttr = title ? ` ac:title="${escapeHtml(title)}"` : '';
      return `<ac:image${altAttr}${titleAttr}><ri:attachment ri:filename="${escapeHtml(filename)}" /></ac:image>`;
    } else {
      // External image
      const altAttr = alt ? ` ac:alt="${escapeHtml(alt)}"` : '';
      const titleAttr = title ? ` ac:title="${escapeHtml(title)}"` : '';
      return `<ac:image${altAttr}${titleAttr}><ri:url ri:value="${escapeHtml(src)}" /></ac:image>`;
    }
  };

  // Tables - pretty straightforward
  md.renderer.rules.table_open = () => '<table>';
  md.renderer.rules.table_close = () => '</table>';
  md.renderer.rules.thead_open = () => '<thead>';
  md.renderer.rules.thead_close = () => '</thead>';
  md.renderer.rules.tbody_open = () => '<tbody>';
  md.renderer.rules.tbody_close = () => '</tbody>';
  md.renderer.rules.tr_open = () => '<tr>';
  md.renderer.rules.tr_close = () => '</tr>';
  md.renderer.rules.th_open = () => '<th>';
  md.renderer.rules.th_close = () => '</th>';
  md.renderer.rules.td_open = () => '<td>';
  md.renderer.rules.td_close = () => '</td>';

  // Horizontal rule
  md.renderer.rules.hr = () => '<hr />';

  // Line breaks
  md.renderer.rules.softbreak = () => '\n';
  md.renderer.rules.hardbreak = () => '<br />\n';

  // Custom macro handlers if provided
  if (opts.macros && typeof opts.macros === 'object') {
    Object.keys(opts.macros).forEach(macroName => {
      const customHandler = opts.macros[macroName];
      if (typeof customHandler === 'function') {
        // Store the original default handler
        const defaultHandler = md.renderer.rules[macroName];

        // Wrap the custom handler to fall back to default if it returns null
        md.renderer.rules[macroName] = function(tokens, idx, options, env, self) {
          const result = customHandler(tokens, idx, options, env, self);

          // If custom handler returns null, use default handler
          if (result === null || result === undefined) {
            if (defaultHandler) {
              return defaultHandler(tokens, idx, options, env, self);
            }
            // No default handler, use the built-in render
            return self.renderToken(tokens, idx, options);
          }

          return result;
        };
      }
    });
  }
}

/**
 * Basic HTML escaping - can't trust user input!
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Post-process the rendered output
 * Handles blockquotes (converting them to macros) and wraps things with <p> tags
 */
function postProcessStorage(html) {
  let storage = html;

  // Wrap complete inline HTML elements (like one-line SVG) in HTML macros
  // Look for patterns like <p><svg ...>...</svg></p>
  storage = storage.replace(/<p>(<(svg|div|table|form)[^>]*>[\s\S]*?<\/\2>)<\/p>/g, (match, element) => {
    const macroId = generateUUID();
    const safeContent = element.replace(/]]>/g, ']]]]><![CDATA[>');
    return `<ac:structured-macro ac:name="html" ac:schema-version="1" ac:macro-id="${macroId}"><ac:plain-text-body><![CDATA[${safeContent}]]></ac:plain-text-body></ac:structured-macro>`;
  });

  // Convert <details> HTML macros to Confluence expand macro
  // Look for details/summary pattern wrapped in HTML macros
  storage = storage.replace(
    /<ac:structured-macro ac:name="html"[^>]*><ac:plain-text-body><!\[CDATA\[<details>\s*<summary>(.*?)<\/summary>\s*\]\]><\/ac:plain-text-body><\/ac:structured-macro>([\s\S]*?)<ac:structured-macro ac:name="html"[^>]*><ac:plain-text-body><!\[CDATA\[<\/details>\s*\]\]><\/ac:plain-text-body><\/ac:structured-macro>/g,
    (match, summaryText, content) => {
      const macroId = generateUUID();
      return `<ac:structured-macro ac:name="expand" ac:schema-version="1" ac:macro-id="${macroId}"><ac:parameter ac:name="title">${summaryText}</ac:parameter><ac:rich-text-body>${content}</ac:rich-text-body></ac:structured-macro>`;
    }
  );

  // Replace blockquote placeholders with actual Confluence macros
  storage = storage.replace(/<!--BLOCKQUOTE_OPEN-->([\s\S]*?)<!--BLOCKQUOTE_CLOSE-->/g, (_, content) => {
    // Check which type of admonition it is (or just a regular blockquote)
    if (content.includes('<!--ADMONITION:INFO-->')) {
      const cleanContent = content.replace(/<!--ADMONITION:INFO-->\s*/g, '');
      return `<ac:structured-macro ac:name="info"><ac:rich-text-body>${cleanContent}</ac:rich-text-body></ac:structured-macro>`;
    } else if (content.includes('<!--ADMONITION:WARNING-->')) {
      const cleanContent = content.replace(/<!--ADMONITION:WARNING-->\s*/g, '');
      return `<ac:structured-macro ac:name="warning"><ac:rich-text-body>${cleanContent}</ac:rich-text-body></ac:structured-macro>`;
    } else if (content.includes('<!--ADMONITION:NOTE-->')) {
      const cleanContent = content.replace(/<!--ADMONITION:NOTE-->\s*/g, '');
      return `<ac:structured-macro ac:name="note"><ac:rich-text-body>${cleanContent}</ac:rich-text-body></ac:structured-macro>`;
    } else {
      // Just a regular blockquote, default to info macro
      return `<ac:structured-macro ac:name="info"><ac:rich-text-body>${content}</ac:rich-text-body></ac:structured-macro>`;
    }
  });

  // Confluence wants <p> tags inside table cells
  // Only wrap if there isn't already a <p> tag
  storage = storage.replace(/<th>((?:(?!<\/?p>).)*?)<\/th>/g, (match, content) => {
    if (content.trim() && !content.trim().startsWith('<p>')) {
      return `<th><p>${content}</p></th>`;
    }
    return match;
  });

  storage = storage.replace(/<td>((?:(?!<\/?p>).)*?)<\/td>/g, (match, content) => {
    if (content.trim() && !content.trim().startsWith('<p>')) {
      return `<td><p>${content}</p></td>`;
    }
    return match;
  });

  // Same for list items (but don't wrap nested lists)
  storage = storage.replace(/<li>((?:(?!<\/?p>).)*?)<\/li>/g, (match, content) => {
    if (content.trim() && !content.trim().startsWith('<p>') && !content.trim().startsWith('<ul>') && !content.trim().startsWith('<ol>')) {
      return `<li><p>${content}</p></li>`;
    }
    return match;
  });

  return storage;
}

/**
 * Wrap the markdown-it render function to add our post-processing
 */
function wrapRender(md) {
  const originalRender = md.render.bind(md);
  md.render = function(src, env) {
    const html = originalRender(src, env);
    return postProcessStorage(html);
  };
}

/**
 * Helper to register custom macro handlers after initialization
 *
 * Example:
 *   const md = new MarkdownIt().use(confluencePlugin);
 *   confluencePlugin.registerMacro(md, 'mermaid', (tokens, idx) => {
 *     const content = tokens[idx].content;
 *     return `<ac:structured-macro ac:name="mermaid-macro">
 *       <ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body>
 *     </ac:structured-macro>`;
 *   });
 */
confluencePlugin.registerMacro = function(md, macroName, customHandler) {
  if (!md.confluenceOptions) {
    md.confluenceOptions = { macros: {} };
  }
  if (!md.confluenceOptions.macros) {
    md.confluenceOptions.macros = {};
  }
  md.confluenceOptions.macros[macroName] = customHandler;

  // Store the default handler before overriding
  const defaultHandler = md.renderer.rules[macroName];

  // Wrap to handle null returns
  md.renderer.rules[macroName] = function(tokens, idx, options, env, self) {
    const result = customHandler(tokens, idx, options, env, self);

    if (result === null || result === undefined) {
      if (defaultHandler) {
        return defaultHandler(tokens, idx, options, env, self);
      }
      return self.renderToken(tokens, idx, options);
    }

    return result;
  };
};

module.exports = confluencePlugin;
