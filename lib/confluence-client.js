const axios = require('axios');
const { convert } = require('html-to-text');
const MarkdownIt = require('markdown-it');

class ConfluenceClient {
  constructor(config) {
    this.domain = config.domain;
    this.token = config.token;
    this.email = config.email;
    this.authType = (config.authType || (this.email ? 'basic' : 'bearer')).toLowerCase();
    this.apiPath = this.sanitizeApiPath(config.apiPath);
    this.baseURL = `https://${this.domain}${this.apiPath}`;
    this.markdown = new MarkdownIt();
    this.setupConfluenceMarkdownExtensions();

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': this.authType === 'basic' ? this.buildBasicAuthHeader() : `Bearer ${this.token}`
    };

    this.client = axios.create({
      baseURL: this.baseURL,
      headers
    });
  }

  sanitizeApiPath(rawPath) {
    const fallback = '/rest/api';
    const value = (rawPath || '').trim();

    if (!value) {
      return fallback;
    }

    const withoutLeading = value.replace(/^\/+/, '');
    const normalized = `/${withoutLeading}`.replace(/\/+$/, '');
    return normalized || fallback;
  }

  buildBasicAuthHeader() {
    if (!this.email) {
      throw new Error('Basic authentication requires an email address.');
    }

    const encodedCredentials = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    return `Basic ${encodedCredentials}`;
  }

  /**
   * Extract page ID from URL or return the ID if it's already a number
   */
  async extractPageId(pageIdOrUrl) {
    if (typeof pageIdOrUrl === 'number' || /^\d+$/.test(pageIdOrUrl)) {
      return pageIdOrUrl;
    }

    // Check if it's a Confluence URL
    if (pageIdOrUrl.includes(this.domain)) {
      // Extract pageId from URL parameter
      const pageIdMatch = pageIdOrUrl.match(/pageId=(\d+)/);
      if (pageIdMatch) {
        return pageIdMatch[1];
      }
      
      // Handle display URLs - search by space and title
      const displayMatch = pageIdOrUrl.match(/\/display\/([^/]+)\/(.+)/);
      if (displayMatch) {
        const spaceKey = displayMatch[1];
        // Confluence friendly URLs for child pages might look like /display/SPACE/Parent/Child
        // We only want the last part as the title
        const urlPath = displayMatch[2];
        const lastSegment = urlPath.split('/').pop();

        // Confluence uses + for spaces in URL titles, but decodeURIComponent doesn't convert + to space
        const rawTitle = lastSegment.replace(/\+/g, '%20');
        const title = decodeURIComponent(rawTitle);

        try {
          const response = await this.client.get('/content', {
            params: {
              spaceKey: spaceKey,
              title: title,
              limit: 1
            }
          });

          if (response.data.results && response.data.results.length > 0) {
            return response.data.results[0].id;
          }
        } catch (error) {
          // Ignore error and fall through
          console.error('Error resolving page ID from display URL:', error);
        }

        throw new Error(`Could not resolve page ID from display URL: ${pageIdOrUrl}`);
      }
    }

    return pageIdOrUrl;
  }

  /**
   * Read a Confluence page content
   * @param {string} pageIdOrUrl - Page ID or URL
   * @param {string} format - Output format: 'text', 'html', or 'markdown'
   * @param {object} options - Additional options
   * @param {boolean} options.resolveUsers - Whether to resolve userkeys to display names (default: true for markdown)
   */
  async readPage(pageIdOrUrl, format = 'text', options = {}) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    
    const response = await this.client.get(`/content/${pageId}`, {
      params: {
        expand: 'body.storage'
      }
    });

    let htmlContent = response.data.body.storage.value;
    
    if (format === 'html') {
      return htmlContent;
    }
    
    if (format === 'markdown') {
      // Resolve userkeys to display names before converting to markdown
      const resolveUsers = options.resolveUsers !== false;
      if (resolveUsers) {
        const { html: resolvedHtml } = await this.resolveUserKeysInHtml(htmlContent);
        htmlContent = resolvedHtml;
      }
      
      // Resolve page links to full URLs
      const resolvePageLinks = options.resolvePageLinks !== false;
      if (resolvePageLinks) {
        htmlContent = await this.resolvePageLinksInHtml(htmlContent);
      }
      
      return this.storageToMarkdown(htmlContent);
    }
    
    // Convert HTML to text
    return convert(htmlContent, {
      wordwrap: 80,
      selectors: [
        { selector: 'h1', options: { uppercase: false } },
        { selector: 'h2', options: { uppercase: false } },
        { selector: 'h3', options: { uppercase: false } },
        { selector: 'table', options: { uppercaseHeaderCells: false } }
      ]
    });
  }

  /**
   * Get page information
   */
  async getPageInfo(pageIdOrUrl) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    
    const response = await this.client.get(`/content/${pageId}`, {
      params: {
        expand: 'space'
      }
    });

    return {
      title: response.data.title,
      id: response.data.id,
      type: response.data.type,
      status: response.data.status,
      space: response.data.space
    };
  }

  /**
   * Search for pages
   */
  async search(query, limit = 10) {
    const response = await this.client.get('/search', {
      params: {
        cql: `text ~ "${query}"`,
        limit: limit
      }
    });

    return response.data.results.map(result => {
      // Handle different result structures
      const content = result.content || result;
      return {
        id: content.id || 'Unknown',
        title: content.title || 'Untitled',
        type: content.type || 'Unknown',
        excerpt: result.excerpt || content.excerpt || ''
      };
    }).filter(item => item.id !== 'Unknown'); // Filter out items without valid IDs
  }

  /**
   * Get all spaces
   */
  async getSpaces() {
    const response = await this.client.get('/space', {
      params: {
        limit: 500
      }
    });

    return response.data.results.map(space => ({
      key: space.key,
      name: space.name,
      type: space.type
    }));
  }

  /**
   * Get user information by userkey
   * @param {string} userKey - The user key (e.g., "8ad05c43962471ed0196c26107d7000c")
   * @returns {Promise<{key: string, displayName: string, username: string}>}
   */
  async getUserByKey(userKey) {
    try {
      const response = await this.client.get('/user', {
        params: { key: userKey }
      });
      return {
        key: userKey,
        displayName: response.data.displayName || response.data.username || userKey,
        username: response.data.username || ''
      };
    } catch (error) {
      // Return full userkey as fallback if user not found
      return {
        key: userKey,
        displayName: userKey,
        username: ''
      };
    }
  }

  /**
   * Resolve all userkeys in HTML to display names
   * @param {string} html - HTML content with ri:user elements
   * @returns {Promise<{html: string, userMap: Map<string, string>}>}
   */
  async resolveUserKeysInHtml(html) {
    // Extract all unique userkeys
    const userKeyRegex = /ri:userkey="([^"]+)"/g;
    const userKeys = new Set();
    let match;
    while ((match = userKeyRegex.exec(html)) !== null) {
      userKeys.add(match[1]);
    }

    if (userKeys.size === 0) {
      return { html, userMap: new Map() };
    }

    // Fetch user info for all keys in parallel
    const userPromises = Array.from(userKeys).map(key => this.getUserByKey(key));
    const users = await Promise.all(userPromises);

    // Build userkey -> displayName map
    const userMap = new Map();
    users.forEach(user => {
      userMap.set(user.key, user.displayName);
    });

    // Replace userkey references with display names in HTML
    let resolvedHtml = html;
    userMap.forEach((displayName, userKey) => {
      // Replace <ac:link><ri:user ri:userkey="xxx" /></ac:link> with @displayName
      const userLinkRegex = new RegExp(
        `<ac:link>\\s*<ri:user\\s+ri:userkey="${userKey}"\\s*/>\\s*</ac:link>`,
        'g'
      );
      resolvedHtml = resolvedHtml.replace(userLinkRegex, `@${displayName}`);
    });

    return { html: resolvedHtml, userMap };
  }

  /**
   * Find a page by title and space key, return page info with URL
   * @param {string} spaceKey - Space key (e.g., "~huotui" or "TECH")
   * @param {string} title - Page title
   * @returns {Promise<{title: string, url: string} | null>}
   */
  async findPageByTitleAndSpace(spaceKey, title) {
    try {
      const response = await this.client.get('/content', {
        params: {
          spaceKey: spaceKey,
          title: title,
          limit: 1
        }
      });
      
      if (response.data.results && response.data.results.length > 0) {
        const page = response.data.results[0];
        const webui = page._links?.webui || '';
        return {
          title: page.title,
          url: webui ? `https://${this.domain}/wiki${webui}` : ''
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolve all page links in HTML to full URLs
   * @param {string} html - HTML content with ri:page elements
   * @returns {Promise<string>} - HTML with resolved page links
   */
  async resolvePageLinksInHtml(html) {
    // Extract all page links: <ri:page ri:space-key="xxx" ri:content-title="yyy" />
    const pageLinkRegex = /<ac:link>\s*<ri:page\s+ri:space-key="([^"]+)"\s+ri:content-title="([^"]+)"[^>]*(?:\/>|><\/ri:page>)\s*<\/ac:link>/g;
    const pageLinks = [];
    let match;
    
    while ((match = pageLinkRegex.exec(html)) !== null) {
      pageLinks.push({
        fullMatch: match[0],
        spaceKey: match[1],
        title: match[2]
      });
    }

    if (pageLinks.length === 0) {
      return html;
    }

    // Fetch page info for all links in parallel
    const pagePromises = pageLinks.map(async (link) => {
      const pageInfo = await this.findPageByTitleAndSpace(link.spaceKey, link.title);
      return {
        ...link,
        pageInfo
      };
    });
    
    const resolvedLinks = await Promise.all(pagePromises);

    // Replace page link references with markdown links
    let resolvedHtml = html;
    resolvedLinks.forEach(({ fullMatch, title, pageInfo }) => {
      let replacement;
      if (pageInfo && pageInfo.url) {
        replacement = `[${title}](${pageInfo.url})`;
      } else {
        // Fallback to just the title if page not found
        replacement = `[${title}]`;
      }
      resolvedHtml = resolvedHtml.replace(fullMatch, replacement);
    });

    return resolvedHtml;
  }

  /**
   * List attachments for a page with pagination support
   */
  async listAttachments(pageIdOrUrl, options = {}) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    const limit = this.parsePositiveInt(options.limit, 50);
    const start = this.parsePositiveInt(options.start, 0);
    const params = {
      limit,
      start
    };

    if (options.filename) {
      params.filename = options.filename;
    }

    const response = await this.client.get(`/content/${pageId}/child/attachment`, { params });
    const results = Array.isArray(response.data.results)
      ? response.data.results.map((item) => this.normalizeAttachment(item))
      : [];

    return {
      results,
      nextStart: this.parseNextStart(response.data?._links?.next)
    };
  }

  /**
   * Fetch all attachments for a page, honoring an optional maxResults cap
   */
  async getAllAttachments(pageIdOrUrl, options = {}) {
    const pageSize = this.parsePositiveInt(options.pageSize || options.limit, 50);
    const maxResults = this.parsePositiveInt(options.maxResults, null);
    const filename = options.filename;
    let start = this.parsePositiveInt(options.start, 0);
    const attachments = [];

    let hasNext = true;
    while (hasNext) {
      const page = await this.listAttachments(pageIdOrUrl, {
        limit: pageSize,
        start,
        filename
      });
      attachments.push(...page.results);

      if (maxResults && attachments.length >= maxResults) {
        return attachments.slice(0, maxResults);
      }

      hasNext = page.nextStart !== null && page.nextStart !== undefined;
      if (hasNext) {
        start = page.nextStart;
      }
    }

    return attachments;
  }

  /**
   * Download an attachment's data stream
   * Now uses the download link from attachment metadata instead of the broken REST API endpoint
   */
  async downloadAttachment(pageIdOrUrl, attachmentIdOrAttachment, options = {}) {
    let downloadUrl;

    // If the second argument is an attachment object with downloadLink, use it directly
    if (typeof attachmentIdOrAttachment === 'object' && attachmentIdOrAttachment.downloadLink) {
      downloadUrl = attachmentIdOrAttachment.downloadLink;
    } else {
      // Otherwise, fetch attachment info to get the download link
      const pageId = await this.extractPageId(pageIdOrUrl);
      const attachmentId = attachmentIdOrAttachment;
      const response = await this.client.get(`/content/${pageId}/child/attachment`, {
        params: { limit: 500 }
      });
      const attachment = response.data.results.find(att => att.id === String(attachmentId));
      if (!attachment) {
        throw new Error(`Attachment with ID ${attachmentId} not found on page ${pageId}`);
      }
      downloadUrl = this.toAbsoluteUrl(attachment._links?.download);
    }

    if (!downloadUrl) {
      throw new Error('Unable to determine download URL for attachment');
    }

    // Download directly using axios with the same auth headers
    const downloadResponse = await axios.get(downloadUrl, {
      responseType: options.responseType || 'stream',
      headers: {
        'Authorization': this.authType === 'basic' ? this.buildBasicAuthHeader() : `Bearer ${this.token}`
      }
    });
    return downloadResponse.data;
  }

  /**
   * Convert markdown to Confluence storage format
   */
  markdownToStorage(markdown) {
    // Convert markdown to HTML first
    const html = this.markdown.render(markdown);
    
    // Convert HTML to native Confluence storage format elements
    return this.htmlToConfluenceStorage(html);
  }

  /**
   * Convert HTML to native Confluence storage format
   */
  htmlToConfluenceStorage(html) {
    let storage = html;
    
    // Convert headings to native Confluence format
    storage = storage.replace(/<h([1-6])>(.*?)<\/h[1-6]>/g, '<h$1>$2</h$1>');
    
    // Convert paragraphs
    storage = storage.replace(/<p>(.*?)<\/p>/g, '<p>$1</p>');
    
    // Convert strong/bold text
    storage = storage.replace(/<strong>(.*?)<\/strong>/g, '<strong>$1</strong>');
    
    // Convert emphasis/italic text
    storage = storage.replace(/<em>(.*?)<\/em>/g, '<em>$1</em>');
    
    // Convert unordered lists
    storage = storage.replace(/<ul>(.*?)<\/ul>/gs, '<ul>$1</ul>');
    storage = storage.replace(/<li>(.*?)<\/li>/g, '<li><p>$1</p></li>');
    
    // Convert ordered lists
    storage = storage.replace(/<ol>(.*?)<\/ol>/gs, '<ol>$1</ol>');
    
    // Convert code blocks to Confluence code macro
    storage = storage.replace(/<pre><code(?:\s+class="language-(\w+)")?>(.*?)<\/code><\/pre>/gs, (_, lang, code) => {
      const language = lang || 'text';
      return `<ac:structured-macro ac:name="code">
        <ac:parameter ac:name="language">${language}</ac:parameter>
        <ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body>
      </ac:structured-macro>`;
    });
    
    // Convert inline code
    storage = storage.replace(/<code>(.*?)<\/code>/g, '<code>$1</code>');
    
    // Convert blockquotes to appropriate macros based on content
    storage = storage.replace(/<blockquote>(.*?)<\/blockquote>/gs, (_, content) => {
      // Check for admonition patterns
      if (content.includes('<strong>INFO</strong>')) {
        const cleanContent = content.replace(/<p><strong>INFO<\/strong><\/p>\s*/, '');
        return `<ac:structured-macro ac:name="info">
          <ac:rich-text-body>${cleanContent}</ac:rich-text-body>
        </ac:structured-macro>`;
      } else if (content.includes('<strong>WARNING</strong>')) {
        const cleanContent = content.replace(/<p><strong>WARNING<\/strong><\/p>\s*/, '');
        return `<ac:structured-macro ac:name="warning">
          <ac:rich-text-body>${cleanContent}</ac:rich-text-body>
        </ac:structured-macro>`;
      } else if (content.includes('<strong>NOTE</strong>')) {
        const cleanContent = content.replace(/<p><strong>NOTE<\/strong><\/p>\s*/, '');
        return `<ac:structured-macro ac:name="note">
          <ac:rich-text-body>${cleanContent}</ac:rich-text-body>
        </ac:structured-macro>`;
      } else {
        // Default to info macro for regular blockquotes
        return `<ac:structured-macro ac:name="info">
          <ac:rich-text-body>${content}</ac:rich-text-body>
        </ac:structured-macro>`;
      }
    });
    
    // Convert tables
    storage = storage.replace(/<table>(.*?)<\/table>/gs, '<table>$1</table>');
    storage = storage.replace(/<thead>(.*?)<\/thead>/gs, '<thead>$1</thead>');
    storage = storage.replace(/<tbody>(.*?)<\/tbody>/gs, '<tbody>$1</tbody>');
    storage = storage.replace(/<tr>(.*?)<\/tr>/gs, '<tr>$1</tr>');
    storage = storage.replace(/<th>(.*?)<\/th>/g, '<th><p>$1</p></th>');
    storage = storage.replace(/<td>(.*?)<\/td>/g, '<td><p>$1</p></td>');
    
    // Convert links
    storage = storage.replace(/<a href="(.*?)">(.*?)<\/a>/g, '<ac:link><ri:url ri:value="$1" /><ac:plain-text-link-body><![CDATA[$2]]></ac:plain-text-link-body></ac:link>');
    
    // Convert horizontal rules
    storage = storage.replace(/<hr\s*\/?>/g, '<hr />');
    
    // Clean up any remaining HTML entities and normalize whitespace
    storage = storage.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    
    return storage;
  }

  /**
   * Convert markdown to Confluence storage format using native storage format
   */
  markdownToNativeStorage(markdown) {
    // Convert markdown to HTML first
    const html = this.markdown.render(markdown);
    
    // Simple HTML to Storage format conversion
    // This is a basic implementation - for full support, we'd need a more sophisticated converter
    let storage = html
      .replace(/<h1>/g, '<h1>')
      .replace(/<\/h1>/g, '</h1>')
      .replace(/<h2>/g, '<h2>')
      .replace(/<\/h2>/g, '</h2>')
      .replace(/<h3>/g, '<h3>')
      .replace(/<\/h3>/g, '</h3>')
      .replace(/<p>/g, '<p>')
      .replace(/<\/p>/g, '</p>')
      .replace(/<strong>/g, '<strong>')
      .replace(/<\/strong>/g, '</strong>')
      .replace(/<em>/g, '<em>')
      .replace(/<\/em>/g, '</em>')
      .replace(/<ul>/g, '<ul>')
      .replace(/<\/ul>/g, '</ul>')
      .replace(/<ol>/g, '<ol>')
      .replace(/<\/ol>/g, '</ol>')
      .replace(/<li>/g, '<li>')
      .replace(/<\/li>/g, '</li>')
      .replace(/<code>/g, '<code>')
      .replace(/<\/code>/g, '</code>')
      .replace(/<pre><code>/g, '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[')
      .replace(/<\/code><\/pre>/g, ']]></ac:plain-text-body></ac:structured-macro>');
    
    return storage;
  }

  /**
   * Setup Confluence-specific markdown extensions
   */
  setupConfluenceMarkdownExtensions() {
    // Enable additional markdown-it features
    this.markdown.enable(['table', 'strikethrough', 'linkify']);
    
    // Add custom rule for Confluence macros in markdown
    this.markdown.core.ruler.before('normalize', 'confluence_macros', (state) => {
      const src = state.src;
      
      // Convert [!info] admonitions to info macro
      state.src = src.replace(/\[!info\]\s*([\s\S]*?)(?=\n\s*\n|\n\s*\[!|$)/g, (_, content) => {
        return `> **INFO**\n> ${content.trim().replace(/\n/g, '\n> ')}`;
      });
      
      // Convert [!warning] admonitions to warning macro
      state.src = state.src.replace(/\[!warning\]\s*([\s\S]*?)(?=\n\s*\n|\n\s*\[!|$)/g, (_, content) => {
        return `> **WARNING**\n> ${content.trim().replace(/\n/g, '\n> ')}`;
      });
      
      // Convert [!note] admonitions to note macro
      state.src = state.src.replace(/\[!note\]\s*([\s\S]*?)(?=\n\s*\n|\n\s*\[!|$)/g, (_, content) => {
        return `> **NOTE**\n> ${content.trim().replace(/\n/g, '\n> ')}`;
      });
      
      // Convert task lists to proper format
      state.src = state.src.replace(/^(\s*)- \[([ x])\] (.+)$/gm, (_, indent, checked, text) => {
        return `${indent}- [${checked}] ${text}`;
      });
    });
  }

  /**
   * Convert Confluence storage format to markdown
   * @param {string} storage - Confluence storage format HTML
   * @param {object} options - Conversion options
   * @param {string} options.attachmentsDir - Directory name for attachments (default: 'attachments')
   */
  storageToMarkdown(storage, options = {}) {
    const attachmentsDir = options.attachmentsDir || 'attachments';
    let markdown = storage;
    
    // Remove table of contents macro
    markdown = markdown.replace(/<ac:structured-macro ac:name="toc"[^>]*\s*\/>/g, '');
    markdown = markdown.replace(/<ac:structured-macro ac:name="toc"[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');
    
    // Remove floatmenu macro (floating table of contents)
    markdown = markdown.replace(/<ac:structured-macro ac:name="floatmenu"[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');
    
    // Convert Confluence images to markdown images
    // Format: <ac:image><ri:attachment ri:filename="image.png" /></ac:image>
    markdown = markdown.replace(/<ac:image[^>]*>\s*<ri:attachment\s+ri:filename="([^"]+)"[^>]*\s*\/>\s*<\/ac:image>/g, (_, filename) => {
      return `![${filename}](${attachmentsDir}/${filename})`;
    });
    
    // Also handle self-closing ac:image with ri:attachment
    markdown = markdown.replace(/<ac:image[^>]*><ri:attachment\s+ri:filename="([^"]+)"[^>]*><\/ri:attachment><\/ac:image>/g, (_, filename) => {
      return `![${filename}](${attachmentsDir}/${filename})`;
    });
    
    // Convert mermaid macro to mermaid code block
    markdown = markdown.replace(/<ac:structured-macro ac:name="mermaid-macro"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, code) => {
      return `\n\`\`\`mermaid\n${code.trim()}\n\`\`\`\n`;
    });
    
    // Convert expand macro - extract content from rich-text-body
    // Detect language based on content for the expand summary text
    const detectExpandSummary = (text) => {
      if (/[\u4e00-\u9fa5]/.test(text)) return '展开详情';      // Chinese
      if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return '詳細を表示'; // Japanese
      if (/[\uac00-\ud7af]/.test(text)) return '상세 보기';    // Korean
      if (/[\u0400-\u04ff]/.test(text)) return 'Подробнее';    // Russian/Cyrillic
      if (/[àâäéèêëïîôùûüÿœæç]/i.test(text)) return 'Détails'; // French
      if (/[äöüß]/i.test(text)) return 'Details';              // German
      if (/[áéíóúñ¿¡]/i.test(text)) return 'Detalles';         // Spanish
      return 'Expand Details';  // Default: English
    };
    const expandSummary = detectExpandSummary(markdown);
    markdown = markdown.replace(/<ac:structured-macro ac:name="expand"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, content) => {
      return `\n<details>\n<summary>${expandSummary}</summary>\n\n${content}\n\n</details>\n`;
    });
    
    // Convert Confluence code macros to markdown
    markdown = markdown.replace(/<ac:structured-macro ac:name="code"[^>]*>[\s\S]*?<ac:parameter ac:name="language">([^<]*)<\/ac:parameter>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, lang, code) => {
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    });
    
    // Convert code macros without language parameter
    markdown = markdown.replace(/<ac:structured-macro ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, code) => {
      return `\`\`\`\n${code}\n\`\`\``;
    });
    
    // Convert info macro to admonition
    markdown = markdown.replace(/<ac:structured-macro ac:name="info"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, content) => {
      const cleanContent = this.htmlToMarkdown(content);
      return `[!info]\n${cleanContent}`;
    });
    
    // Convert warning macro to admonition
    markdown = markdown.replace(/<ac:structured-macro ac:name="warning"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, content) => {
      const cleanContent = this.htmlToMarkdown(content);
      return `[!warning]\n${cleanContent}`;
    });
    
    // Convert note macro to admonition  
    markdown = markdown.replace(/<ac:structured-macro ac:name="note"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, content) => {
      const cleanContent = this.htmlToMarkdown(content);
      return `[!note]\n${cleanContent}`;
    });
    
    // Convert task list macros to markdown checkboxes
    // Note: This is independent of user resolution - it only converts <ac:task> structure to "- [ ]" or "- [x]" format
    markdown = markdown.replace(/<ac:task-list>([\s\S]*?)<\/ac:task-list>/g, (_, content) => {
      const tasks = [];
      // Match each task: <ac:task>...<ac:task-status>xxx</ac:task-status>...<ac:task-body>...</ac:task-body>...</ac:task>
      const taskRegex = /<ac:task>[\s\S]*?<ac:task-status>([^<]*)<\/ac:task-status>[\s\S]*?<ac:task-body>([\s\S]*?)<\/ac:task-body>[\s\S]*?<\/ac:task>/g;
      let match;
      while ((match = taskRegex.exec(content)) !== null) {
        const status = match[1];
        let taskBody = match[2];
        // Clean up HTML from task body, but preserve @username
        taskBody = taskBody.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const checkbox = status === 'complete' ? '[x]' : '[ ]';
        if (taskBody) {
          tasks.push(`- ${checkbox} ${taskBody}`);
        }
      }
      return tasks.length > 0 ? '\n' + tasks.join('\n') + '\n' : '';
    });
    
    // Remove other unhandled macros (replace with empty string for now)
    markdown = markdown.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');
    
    // Convert external URL links
    markdown = markdown.replace(/<ac:link><ri:url ri:value="([^"]*)" \/><ac:plain-text-link-body><!\[CDATA\[([^\]]*)\]\]><\/ac:plain-text-link-body><\/ac:link>/g, '[$2]($1)');
    
    // Convert internal page links - extract page title
    // Format: <ac:link><ri:page ri:space-key="xxx" ri:content-title="Page Title" /></ac:link>
    markdown = markdown.replace(/<ac:link>\s*<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/>\s*<\/ac:link>/g, '[$1]');
    markdown = markdown.replace(/<ac:link>\s*<ri:page[^>]*ri:content-title="([^"]*)"[^>]*>\s*<\/ri:page>\s*<\/ac:link>/g, '[$1]');
    
    // Remove any remaining ac:link tags that weren't matched
    markdown = markdown.replace(/<ac:link>[\s\S]*?<\/ac:link>/g, '');
    
    // Convert remaining HTML to markdown
    markdown = this.htmlToMarkdown(markdown);
    
    return markdown;
  }

  /**
   * Convert basic HTML to markdown
   */
  htmlToMarkdown(html) {
    let markdown = html;
    
    // Convert time elements to date text BEFORE removing attributes
    // Format: <time datetime="2025-09-16" /> or <time datetime="2025-09-16"></time>
    markdown = markdown.replace(/<time\s+datetime="([^"]+)"[^>]*(?:\/>|>\s*<\/time>)/g, '$1');
    
    // Convert strong/bold BEFORE removing HTML attributes
    markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**');
    
    // Convert emphasis/italic BEFORE removing HTML attributes
    markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*');
    
    // Convert code BEFORE removing HTML attributes
    markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`');
    
    // Remove HTML attributes from tags (but preserve content formatting)
    markdown = markdown.replace(/<(\w+)[^>]*>/g, '<$1>');
    markdown = markdown.replace(/<\/(\w+)[^>]*>/g, '</$1>');
    
    // Convert headings first (they don't contain other elements typically)
    markdown = markdown.replace(/<h([1-6])>(.*?)<\/h[1-6]>/g, (_, level, text) => {
      return '\n' + '#'.repeat(parseInt(level)) + ' ' + text.trim() + '\n';
    });
    
    // Convert tables BEFORE paragraphs
    markdown = markdown.replace(/<table>(.*?)<\/table>/gs, (_, content) => {
      const rows = [];
      let isHeader = true;
      
      // Extract table rows
      const rowMatches = content.match(/<tr>(.*?)<\/tr>/gs);
      if (rowMatches) {
        rowMatches.forEach(rowMatch => {
          const cells = [];
          const cellContent = rowMatch.replace(/<tr>(.*?)<\/tr>/s, '$1');
          
          // Extract cells (th or td)
          const cellMatches = cellContent.match(/<t[hd]>(.*?)<\/t[hd]>/gs);
          if (cellMatches) {
            cellMatches.forEach(cellMatch => {
              let cellText = cellMatch.replace(/<t[hd]>(.*?)<\/t[hd]>/s, '$1');
              // Clean up cell content - remove nested HTML but preserve text and some formatting
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
    
    // Convert unordered lists BEFORE paragraphs
    markdown = markdown.replace(/<ul>(.*?)<\/ul>/gs, (_, content) => {
      let listItems = '';
      const itemMatches = content.match(/<li>(.*?)<\/li>/gs);
      if (itemMatches) {
        itemMatches.forEach(itemMatch => {
          let itemText = itemMatch.replace(/<li>(.*?)<\/li>/s, '$1');
          // Clean up nested HTML but preserve some formatting
          itemText = itemText.replace(/<p>/g, '').replace(/<\/p>/g, ' ');
          itemText = itemText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (itemText) {
            listItems += '- ' + itemText + '\n';
          }
        });
      }
      return '\n' + listItems;
    });
    
    // Convert ordered lists BEFORE paragraphs
    markdown = markdown.replace(/<ol>(.*?)<\/ol>/gs, (_, content) => {
      let listItems = '';
      let counter = 1;
      const itemMatches = content.match(/<li>(.*?)<\/li>/gs);
      if (itemMatches) {
        itemMatches.forEach(itemMatch => {
          let itemText = itemMatch.replace(/<li>(.*?)<\/li>/s, '$1');
          // Clean up nested HTML but preserve some formatting
          itemText = itemText.replace(/<p>/g, '').replace(/<\/p>/g, ' ');
          itemText = itemText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (itemText) {
            listItems += `${counter++}. ${itemText}\n`;
          }
        });
      }
      return '\n' + listItems;
    });
    
    // Convert paragraphs (after lists and tables)
    markdown = markdown.replace(/<p>(.*?)<\/p>/g, (_, content) => {
      return content.trim() + '\n';
    });
    
    // Convert line breaks
    markdown = markdown.replace(/<br\s*\/?>/g, '\n');
    
    // Convert horizontal rules
    markdown = markdown.replace(/<hr\s*\/?>/g, '\n---\n');
    
    // Remove any remaining HTML tags, but preserve <details> and <summary> for GFM compatibility
    markdown = markdown.replace(/<(?!\/?(details|summary)\b)[^>]+>/g, ' ');
    
    // Clean up whitespace and HTML entities
    markdown = markdown.replace(/&nbsp;/g, ' ');
    markdown = markdown.replace(/&lt;/g, '<');
    markdown = markdown.replace(/&gt;/g, '>');
    markdown = markdown.replace(/&amp;/g, '&');
    markdown = markdown.replace(/&quot;/g, '"');
    markdown = markdown.replace(/&apos;/g, '\'');
    // Smart quotes and special characters
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
    // Numeric HTML entities
    markdown = markdown.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    markdown = markdown.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
    
    // Clean up extra whitespace for standard Markdown format
    // Remove trailing spaces from each line
    markdown = markdown.replace(/[ \t]+$/gm, '');
    // Remove leading spaces from lines (except for code blocks, blockquotes, and list items)
    markdown = markdown.replace(/^[ \t]+(?!([`>]|[*+-] |\d+[.)] ))/gm, '');
    // Ensure proper spacing after headings (# Title should be followed by blank line or content)
    markdown = markdown.replace(/^(#{1,6}[^\n]+)\n(?!\n)/gm, '$1\n\n');
    // Normalize multiple blank lines to double newline
    markdown = markdown.replace(/\n\s*\n\s*\n+/g, '\n\n');
    // Collapse multiple spaces to single space (but preserve newlines)
    markdown = markdown.replace(/[ \t]+/g, ' ');
    // Final trim
    markdown = markdown.trim();
    
    return markdown;
  }

  /**
   * Create a new Confluence page
   */
  async createPage(title, spaceKey, content, format = 'storage') {
    let storageContent = content;
    
    if (format === 'markdown') {
      storageContent = this.markdownToStorage(content);
    } else if (format === 'html') {
      // Convert HTML directly to storage format (no macro wrapper)
      storageContent = content;
    }

    const pageData = {
      type: 'page',
      title: title,
      space: {
        key: spaceKey
      },
      body: {
        storage: {
          value: storageContent,
          representation: 'storage'
        }
      }
    };

    const response = await this.client.post('/content', pageData);
    return response.data;
  }

  /**
   * Create a new Confluence page as a child of another page
   */
  async createChildPage(title, spaceKey, parentId, content, format = 'storage') {
    let storageContent = content;
    
    if (format === 'markdown') {
      storageContent = this.markdownToStorage(content);
    } else if (format === 'html') {
      // Convert HTML directly to storage format (no macro wrapper)
      storageContent = content;
    }

    const pageData = {
      type: 'page',
      title: title,
      space: {
        key: spaceKey
      },
      ancestors: [
        {
          id: parentId
        }
      ],
      body: {
        storage: {
          value: storageContent,
          representation: 'storage'
        }
      }
    };

    const response = await this.client.post('/content', pageData);
    return response.data;
  }

  /**
   * Update an existing Confluence page
   */
  async updatePage(pageId, title, content, format = 'storage') {
    // First, get the current page to get the version number and existing content
    const currentPage = await this.client.get(`/content/${pageId}`, {
      params: {
        expand: 'body.storage,version,space'
      }
    });
    const currentVersion = currentPage.data.version.number;

    let storageContent;

    if (content !== undefined && content !== null) {
      // If new content is provided, convert it to storage format
      if (format === 'markdown') {
        storageContent = this.markdownToStorage(content);
      } else if (format === 'html') {
        storageContent = this.htmlToConfluenceStorage(content); // Using the conversion function for robustness
      } else { // 'storage' format
        storageContent = content;
      }
    } else {
      // If no new content, use the existing content
      storageContent = currentPage.data.body.storage.value;
    }

    const pageData = {
      id: pageId,
      type: 'page',
      title: title || currentPage.data.title,
      space: currentPage.data.space,
      body: {
        storage: {
          value: storageContent,
          representation: 'storage'
        }
      },
      version: {
        number: currentVersion + 1
      }
    };

    const response = await this.client.put(`/content/${pageId}`, pageData);
    return response.data;
  }

  /**
   * Get page content for editing
   */
  async getPageForEdit(pageIdOrUrl) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    
    const response = await this.client.get(`/content/${pageId}`, {
      params: {
        expand: 'body.storage,version,space'
      }
    });

    return {
      id: response.data.id,
      title: response.data.title,
      content: response.data.body.storage.value,
      version: response.data.version.number,
      space: response.data.space
    };
  }

  /**
   * Search for a page by title and space
   */
  async findPageByTitle(title, spaceKey = null) {
    let cql = `title = "${title}"`;
    if (spaceKey) {
      cql += ` AND space = "${spaceKey}"`;
    }

    const response = await this.client.get('/search', {
      params: {
        cql: cql,
        limit: 1,
        expand: 'content.space'
      }
    });

    if (response.data.results.length === 0) {
      throw new Error(`Page not found: "${title}"`);
    }

    const result = response.data.results[0];
    const content = result.content || result;
    
    return {
      id: content.id,
      title: content.title,
      space: content.space || { key: spaceKey || 'Unknown', name: 'Unknown' },
      url: content._links?.webui || ''
    };
  }

  /**
   * Get child pages of a given page
   */
  async getChildPages(pageId, limit = 500) {
    const response = await this.client.get(`/content/${pageId}/child/page`, {
      params: {
        limit: limit,
        // Fetch lightweight payload; content fetched on-demand when copying
        expand: 'space,version'
      }
    });

    return response.data.results.map(page => ({
      id: page.id,
      title: page.title,
      type: page.type,
      status: page.status,
      space: page.space,
      version: page.version?.number || 1
    }));
  }

  /**
   * Get all descendant pages recursively
   */
  async getAllDescendantPages(pageId, maxDepth = 10, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const children = await this.getChildPages(pageId);
    // Attach parentId so we can later reconstruct hierarchy if needed
    const childrenWithParent = children.map(child => ({ ...child, parentId: pageId }));
    let allDescendants = [...childrenWithParent];

    for (const child of children) {
      const grandChildren = await this.getAllDescendantPages(
        child.id, 
        maxDepth, 
        currentDepth + 1
      );
      allDescendants = allDescendants.concat(grandChildren);
    }

    return allDescendants;
  }

  /**
   * Copy a page tree (page and all its descendants) to a new location
   */
  async copyPageTree(sourcePageId, targetParentId, newTitle = null, options = {}) {
    const {
      maxDepth = 10,
      excludePatterns = [],
      onProgress = null,
      quiet = false,
      delayMs = 100,
      copySuffix = ' (Copy)'
    } = options;

    // Get source page information
    const sourcePage = await this.getPageForEdit(sourcePageId);
    const sourceInfo = await this.getPageInfo(sourcePageId);
    
    // Determine new title
    const finalTitle = newTitle || `${sourcePage.title}${copySuffix}`;
    
    if (!quiet && onProgress) {
      onProgress(`Copying root: ${sourcePage.title} -> ${finalTitle}`);
    }

    // Create the root copied page
    const newRootPage = await this.createChildPage(
      finalTitle,
      sourceInfo.space.key,
      targetParentId,
      sourcePage.content,
      'storage'
    );

    if (!quiet && onProgress) {
      onProgress(`Root page created: ${newRootPage.title} (ID: ${newRootPage.id})`);
    }

    const result = {
      rootPage: newRootPage,
      copiedPages: [newRootPage],
      failures: [],
      totalCopied: 1,
    };

    // Precompile exclude patterns once for efficiency
    const compiledExclude = Array.isArray(excludePatterns)
      ? excludePatterns.filter(Boolean).map(p => this.globToRegExp(p))
      : [];

    await this.copyChildrenRecursive(
      sourcePageId,
      newRootPage.id,
      0,
      {
        spaceKey: sourceInfo.space.key,
        maxDepth,
        excludePatterns,
        compiledExclude,
        onProgress,
        quiet,
        delayMs,
      },
      result
    );

    result.totalCopied = result.copiedPages.length;
    return result;
  }

  /**
   * Build a tree structure from flat array of pages
   */
  buildPageTree(pages, rootPageId) {
    const pageMap = new Map();
    const tree = [];

    // Create nodes
    pages.forEach(page => {
      pageMap.set(page.id, { ...page, children: [] });
    });

    // Link by parentId if available; otherwise attach to root
    pages.forEach(page => {
      const node = pageMap.get(page.id);
      const parentId = page.parentId;
      if (parentId && pageMap.has(parentId)) {
        pageMap.get(parentId).children.push(node);
      } else if (parentId === rootPageId || !parentId) {
        tree.push(node);
      } else {
        // Parent not present in the list; treat as top-level under root
        tree.push(node);
      }
    });

    return tree;
  }

  /**
   * Recursively copy pages maintaining hierarchy
   */
  async copyChildrenRecursive(sourceParentId, targetParentId, currentDepth, opts, result) {
    const { spaceKey, maxDepth, excludePatterns, compiledExclude = [], onProgress, quiet, delayMs = 100 } = opts || {};

    if (currentDepth >= maxDepth) {
      return;
    }

    const children = await this.getChildPages(sourceParentId);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const patterns = (compiledExclude && compiledExclude.length) ? compiledExclude : excludePatterns;
      if (this.shouldExcludePage(child.title, patterns)) {
        if (!quiet && onProgress) {
          onProgress(`Skipped: ${child.title}`);
        }
        continue;
      }

      if (!quiet && onProgress) {
        onProgress(`Copying: ${child.title}`);
      }

      try {
        // Fetch full content to ensure complete copy
        const fullChild = await this.getPageForEdit(child.id);
        const newPage = await this.createChildPage(
          fullChild.title,
          spaceKey,
          targetParentId,
          fullChild.content,
          'storage'
        );

        result.copiedPages.push(newPage);
        if (!quiet && onProgress) {
          onProgress(`Created: ${newPage.title} (ID: ${newPage.id})`);
        }

        // Rate limiting safety: only pause between siblings
        if (delayMs > 0 && i < children.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // Recurse into this child's subtree
        await this.copyChildrenRecursive(child.id, newPage.id, currentDepth + 1, opts, result);
      } catch (error) {
        if (!quiet && onProgress) {
          const status = error?.response?.status;
          const statusText = error?.response?.statusText;
          const msg = status ? `${status} ${statusText || ''}`.trim() : error.message;
          onProgress(`Failed: ${child.title} - ${msg}`);
        }
        result.failures.push({
          id: child.id,
          title: child.title,
          error: error.message,
          status: error?.response?.status || null
        });
        // Continue with other pages (do not throw)
        continue;
      }
    }
  }

  /**
   * Convert a simple glob pattern to a safe RegExp
   * Supports '*' → '.*' and '?' → '.', escapes other regex metacharacters.
   */
  globToRegExp(pattern, flags = 'i') {
    // Escape regex special characters: . + ^ $ { } ( ) | [ ] \
    // Note: backslash must be escaped properly in string and class contexts
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escaped
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`, flags);
  }

  /**
   * Check if a page should be excluded based on patterns
   */
  shouldExcludePage(title, excludePatterns) {
    if (!excludePatterns || excludePatterns.length === 0) {
      return false;
    }

    return excludePatterns.some(pattern => {
      if (pattern instanceof RegExp) return pattern.test(title);
      return this.globToRegExp(pattern).test(title);
    });
  }

  matchesPattern(value, patterns) {
    if (!patterns) {
      return true;
    }

    const list = Array.isArray(patterns) ? patterns.filter(Boolean) : [patterns];
    if (list.length === 0) {
      return true;
    }

    return list.some((pattern) => this.globToRegExp(pattern).test(value));
  }

  normalizeAttachment(raw) {
    return {
      id: raw.id,
      title: raw.title,
      mediaType: raw.metadata?.mediaType || raw.type || '',
      fileSize: raw.extensions?.fileSize || 0,
      version: raw.version?.number || 1,
      downloadLink: this.toAbsoluteUrl(raw._links?.download)
    };
  }

  toAbsoluteUrl(pathOrUrl) {
    if (!pathOrUrl) {
      return null;
    }

    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }

    const normalized = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `https://${this.domain}${normalized}`;
  }

  parseNextStart(nextLink) {
    if (!nextLink) {
      return null;
    }

    const match = nextLink.match(/[?&]start=(\d+)/);
    if (!match) {
      return null;
    }

    const value = parseInt(match[1], 10);
    return Number.isNaN(value) ? null : value;
  }

  parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }
}

module.exports = ConfluenceClient;
