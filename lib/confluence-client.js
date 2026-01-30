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
   * Extract referenced attachment filenames from HTML content
   * @param {string} htmlContent - HTML content in storage format
   * @returns {Set<string>} Set of referenced attachment filenames
   */
  extractReferencedAttachments(htmlContent) {
    const referenced = new Set();
    
    // Extract from ac:image with ri:attachment
    const imageRegex = /<ac:image[^>]*>[\s\S]*?<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/?>[\s\S]*?<\/ac:image>/g;
    let match;
    while ((match = imageRegex.exec(htmlContent)) !== null) {
      referenced.add(match[1]);
    }
    
    // Extract from view-file macro
    const viewFileRegex = /<ac:structured-macro ac:name="view-file"[^>]*>[\s\S]*?<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/?>[\s\S]*?<\/ac:structured-macro>/g;
    while ((match = viewFileRegex.exec(htmlContent)) !== null) {
      referenced.add(match[1]);
    }
    
    // Extract from any ri:attachment references
    const attachmentRegex = /<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/?>/g;
    while ((match = attachmentRegex.exec(htmlContent)) !== null) {
      referenced.add(match[1]);
    }
    
    return referenced;
  }

  /**
   * Read a Confluence page content
   * @param {string} pageIdOrUrl - Page ID or URL
   * @param {string} format - Output format: 'text', 'html', or 'markdown'
   * @param {object} options - Additional options
   * @param {boolean} options.resolveUsers - Whether to resolve userkeys to display names (default: true for markdown)
   * @param {boolean} options.extractReferencedAttachments - Whether to extract referenced attachments (default: false)
   */
  async readPage(pageIdOrUrl, format = 'text', options = {}) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    
    const response = await this.client.get(`/content/${pageId}`, {
      params: {
        expand: 'body.storage'
      }
    });

    let htmlContent = response.data.body.storage.value;
    
    // Extract referenced attachments if requested
    if (options.extractReferencedAttachments) {
      this._referencedAttachments = this.extractReferencedAttachments(htmlContent);
    }
    
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
      
      // Resolve children macro to child pages list
      htmlContent = await this.resolveChildrenMacro(htmlContent, pageId);
      
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
   * Resolve children macro to child pages list
   * @param {string} html - HTML content with children macro
   * @param {string} pageId - Page ID to get children from
   * @returns {Promise<string>} - HTML with children macro replaced by markdown list
   */
  async resolveChildrenMacro(html, pageId) {
    // Check if there's a children macro (self-closing or with closing tag)
    const childrenMacroRegex = /<ac:structured-macro\s+ac:name="children"[^>]*(?:\/>|>[\s\S]*?<\/ac:structured-macro>)/g;
    const hasChildrenMacro = childrenMacroRegex.test(html);
    
    if (!hasChildrenMacro) {
      return html;
    }

    try {
      // Get child pages with full info including _links
      const response = await this.client.get(`/content/${pageId}/child/page`, {
        params: {
          limit: 500,
          expand: 'space,version'
        }
      });
      
      const childPages = response.data.results || [];
      
      if (childPages.length === 0) {
        // No children, remove the macro
        return html.replace(childrenMacroRegex, '');
      }

      // Convert child pages to markdown list
      // Format: - [Page Title](URL)
      const childPagesList = childPages.map(page => {
        const webui = page._links?.webui || '';
        const url = webui ? `https://${this.domain}/wiki${webui}` : '';
        if (url) {
          return `- [${page.title}](${url})`;
        } else {
          return `- ${page.title}`;
        }
      }).join('\n');

      // Replace children macro with markdown list
      return html.replace(childrenMacroRegex, `\n${childPagesList}\n`);
    } catch (error) {
      // If error getting children, just remove the macro
      console.error(`Error resolving children macro: ${error.message}`);
      return html.replace(childrenMacroRegex, '');
    }
  }

  /**
   * List comments for a page with pagination support
   */
  async listComments(pageIdOrUrl, options = {}) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    const limit = this.parsePositiveInt(options.limit, 25);
    const start = this.parsePositiveInt(options.start, 0);
    const params = {
      limit,
      start
    };

    const expand = options.expand || 'body.storage,history,version,extensions.inlineProperties,extensions.resolution,ancestors';
    if (expand) {
      params.expand = expand;
    }

    if (options.parentVersion !== undefined && options.parentVersion !== null) {
      params.parentVersion = options.parentVersion;
    }

    if (options.location) {
      params.location = options.location;
    }

    if (options.depth) {
      params.depth = options.depth;
    }

    const paramsSerializer = (input) => {
      const searchParams = new URLSearchParams();
      Object.entries(input || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item !== undefined && item !== null && item !== '') {
              searchParams.append(key, item);
            }
          });
          return;
        }
        searchParams.append(key, value);
      });
      return searchParams.toString();
    };

    const response = await this.client.get(`/content/${pageId}/child/comment`, {
      params,
      paramsSerializer
    });
    const results = Array.isArray(response.data?.results)
      ? response.data.results.map((item) => this.normalizeComment(item))
      : [];

    return {
      results,
      nextStart: this.parseNextStart(response.data?._links?.next)
    };
  }

  /**
   * Fetch all comments for a page, honoring an optional maxResults cap
   */
  async getAllComments(pageIdOrUrl, options = {}) {
    const pageSize = this.parsePositiveInt(options.pageSize || options.limit, 25);
    const maxResults = this.parsePositiveInt(options.maxResults, null);
    let start = this.parsePositiveInt(options.start, 0);
    const comments = [];

    let hasNext = true;
    while (hasNext) {
      const page = await this.listComments(pageIdOrUrl, {
        limit: pageSize,
        start,
        expand: options.expand,
        location: options.location,
        depth: options.depth,
        parentVersion: options.parentVersion
      });
      comments.push(...page.results);

      if (maxResults && comments.length >= maxResults) {
        return comments.slice(0, maxResults);
      }

      hasNext = page.nextStart !== null && page.nextStart !== undefined;
      if (hasNext) {
        start = page.nextStart;
      }
    }

    return comments;
  }

  normalizeComment(raw) {
    const history = raw?.history || {};
    const author = history.createdBy || {};
    const extensions = raw?.extensions || {};
    const ancestors = Array.isArray(raw?.ancestors)
      ? raw.ancestors.map((ancestor) => {
        const id = ancestor?.id ?? ancestor;
        return {
          id: id !== undefined && id !== null ? String(id) : null,
          type: ancestor?.type || null,
          title: ancestor?.title || null
        };
      }).filter((ancestor) => ancestor.id)
      : [];

    return {
      id: raw?.id,
      title: raw?.title,
      status: raw?.status,
      body: raw?.body?.storage?.value || '',
      author: {
        displayName: author.displayName || author.publicName || author.username || author.userKey || author.accountId || 'Unknown',
        accountId: author.accountId,
        userKey: author.userKey,
        username: author.username,
        email: author.email
      },
      createdAt: history.createdDate || null,
      version: raw?.version?.number || null,
      location: this.getCommentLocation(extensions),
      inlineProperties: extensions.inlineProperties || null,
      resolution: this.getCommentResolution(extensions),
      parentId: this.getCommentParentId(ancestors),
      ancestors,
      extensions
    };
  }

  getCommentParentId(ancestors = []) {
    if (!Array.isArray(ancestors) || ancestors.length === 0) {
      return null;
    }
    const commentAncestors = ancestors.filter((ancestor) => {
      const type = ancestor?.type ? String(ancestor.type).toLowerCase() : '';
      return type === 'comment';
    });
    if (commentAncestors.length === 0) {
      return null;
    }
    return commentAncestors[commentAncestors.length - 1].id || null;
  }

  getCommentLocation(extensions = {}) {
    const location = extensions.location;
    if (!location) {
      return null;
    }
    if (typeof location === 'string') {
      return location;
    }
    if (typeof location.value === 'string') {
      return location.value;
    }
    if (typeof location.name === 'string') {
      return location.name;
    }
    return null;
  }

  getCommentResolution(extensions = {}) {
    const resolution = extensions.resolution;
    if (!resolution) {
      return null;
    }
    if (typeof resolution === 'string') {
      return resolution;
    }
    if (typeof resolution.status === 'string') {
      return resolution.status;
    }
    if (typeof resolution.value === 'string') {
      return resolution.value;
    }
    return null;
  }

  formatCommentBody(storageValue, format = 'text') {
    const value = storageValue || '';
    if (format === 'storage' || format === 'html') {
      return value;
    }
    if (format === 'markdown') {
      return this.storageToMarkdown(value);
    }

    return convert(value, {
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
   * Create a comment on a page
   */
  async createComment(pageIdOrUrl, content, format = 'storage', options = {}) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    let storageContent = content;

    if (format === 'markdown') {
      storageContent = this.markdownToStorage(content);
    } else if (format === 'html') {
      storageContent = this.htmlToConfluenceStorage(content);
    }

    const commentData = {
      type: 'comment',
      container: {
        id: pageId,
        type: 'page'
      },
      body: {
        storage: {
          value: storageContent,
          representation: 'storage'
        }
      }
    };

    if (options.parentId) {
      commentData.ancestors = [{ id: options.parentId }];
    }

    const extensions = {};
    const location = options.location || (options.inlineProperties ? 'inline' : null);
    if (location) {
      extensions.location = location;
    }
    if (options.inlineProperties) {
      extensions.inlineProperties = options.inlineProperties;
    }
    if (Object.keys(extensions).length > 0) {
      commentData.extensions = extensions;
    }

    const response = await this.client.post('/content', commentData);
    return response.data;
  }

  /**
   * Delete a comment by ID
   */
  async deleteComment(commentId) {
    await this.client.delete(`/content/${commentId}`);
    return { id: String(commentId) };
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
    
    // Delegate to htmlToConfluenceStorage for proper conversion including code blocks
    return this.htmlToConfluenceStorage(html);
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
   * Detect language from text content and return appropriate labels
   * @param {string} text - Text content to analyze
   * @returns {object} Object with language-specific labels
   */
  detectLanguageLabels(text) {
    const labels = {
      includePage: 'Include Page',
      sharedBlock: 'Shared Block',
      includeSharedBlock: 'Include Shared Block',
      fromPage: 'from page',
      expandDetails: 'Expand Details'
    };
    
    if (/[\u4e00-\u9fa5]/.test(text)) {
      // Chinese
      labels.includePage = '包含页面';
      labels.sharedBlock = '共享块';
      labels.includeSharedBlock = '包含共享块';
      labels.fromPage = '来自页面';
      labels.expandDetails = '展开详情';
    } else if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
      // Japanese
      labels.includePage = 'ページを含む';
      labels.sharedBlock = '共有ブロック';
      labels.includeSharedBlock = '共有ブロックを含む';
      labels.fromPage = 'ページから';
      labels.expandDetails = '詳細を表示';
    } else if (/[\uac00-\ud7af]/.test(text)) {
      // Korean
      labels.includePage = '페이지 포함';
      labels.sharedBlock = '공유 블록';
      labels.includeSharedBlock = '공유 블록 포함';
      labels.fromPage = '페이지에서';
      labels.expandDetails = '상세 보기';
    } else if (/[\u0400-\u04ff]/.test(text)) {
      // Russian/Cyrillic
      labels.includePage = 'Включить страницу';
      labels.sharedBlock = 'Общий блок';
      labels.includeSharedBlock = 'Включить общий блок';
      labels.fromPage = 'со страницы';
      labels.expandDetails = 'Подробнее';
    } else if ((text.match(/[àâäéèêëïîôùûüÿœæç]/gi) || []).length >= 2) {
      // French (requires at least 2 French-specific characters to avoid false positives)
      labels.includePage = 'Inclure la page';
      labels.sharedBlock = 'Bloc partagé';
      labels.includeSharedBlock = 'Inclure le bloc partagé';
      labels.fromPage = 'de la page';
      labels.expandDetails = 'Détails';
    } else if ((text.match(/[äöüß]/gi) || []).length >= 2) {
      // German (requires at least 2 German-specific characters)
      // Note: French is checked before German because French regex includes more characters
      // that overlap with German (ä, ü). The threshold helps distinguish between them.
      labels.includePage = 'Seite einbinden';
      labels.sharedBlock = 'Gemeinsamer Block';
      labels.includeSharedBlock = 'Gemeinsamen Block einbinden';
      labels.fromPage = 'von Seite';
      labels.expandDetails = 'Details';
    } else if ((text.match(/[áéíóúñ¿¡]/gi) || []).length >= 2) {
      // Spanish (requires at least 2 Spanish-specific characters)
      labels.includePage = 'Incluir página';
      labels.sharedBlock = 'Bloque compartido';
      labels.includeSharedBlock = 'Incluir bloque compartido';
      labels.fromPage = 'de la página';
      labels.expandDetails = 'Detalles';
    }
    
    return labels;
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
    
    // Detect language from content
    const labels = this.detectLanguageLabels(markdown);
    
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
    markdown = markdown.replace(/<ac:structured-macro ac:name="expand"[^>]*>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, content) => {
      return `\n<details>\n<summary>${labels.expandDetails}</summary>\n\n${content}\n\n</details>\n`;
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
    
    // Convert panel macro to markdown blockquote with title
    markdown = markdown.replace(/<ac:structured-macro ac:name="panel"[^>]*>[\s\S]*?<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, title, content) => {
      const cleanContent = this.htmlToMarkdown(content);
      return `\n> **${title}**\n>\n${cleanContent.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}\n`;
    });
    
    // Convert include macro - extract page link and convert to markdown link
    // Handle both with and without parameter name
    markdown = markdown.replace(/<ac:structured-macro ac:name="include"[^>]*>[\s\S]*?<ac:parameter ac:name="">[\s\S]*?<ac:link>[\s\S]*?<ri:page\s+ri:space-key="([^"]+)"\s+ri:content-title="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:link>[\s\S]*?<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, spaceKey, title) => {
      // Try to build a proper URL - if spaceKey starts with ~, it's a user space
      if (spaceKey.startsWith('~')) {
        const spacePath = `display/${spaceKey}/${encodeURIComponent(title)}`;
        return `\n> 📄 **${labels.includePage}**: [${title}](https://${this.domain}/wiki/${spacePath})\n`;
      } else {
        // For non-user spaces, we cannot construct a valid link without the page ID.
        // Document that manual correction is required.
        return `\n> 📄 **${labels.includePage}**: [${title}](https://${this.domain}/wiki/spaces/${spaceKey}/pages/[PAGE_ID_HERE]) _(manual link correction required)_\n`;
      }
    });
    
    // Convert shared-block and include-shared-block macros - extract content
    markdown = markdown.replace(/<ac:structured-macro ac:name="(shared-block|include-shared-block)"[^>]*>[\s\S]*?<ac:parameter ac:name="shared-block-key">([^<]*)<\/ac:parameter>[\s\S]*?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>[\s\S]*?<\/ac:structured-macro>/g, (_, macroType, blockKey, content) => {
      const cleanContent = this.htmlToMarkdown(content);
      return `\n> **${labels.sharedBlock}: ${blockKey}**\n>\n${cleanContent.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}\n`;
    });
    
    // Convert include-shared-block with page parameter
    markdown = markdown.replace(/<ac:structured-macro ac:name="include-shared-block"[^>]*>[\s\S]*?<ac:parameter ac:name="shared-block-key">([^<]*)<\/ac:parameter>[\s\S]*?<ac:parameter ac:name="page">[\s\S]*?<ac:link>[\s\S]*?<ri:page\s+ri:space-key="([^"]+)"\s+ri:content-title="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:link>[\s\S]*?<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, blockKey, spaceKey, pageTitle) => {
      // The page ID is not available, so we cannot generate a valid link.
      // Instead, document that the link needs manual correction.
      return `\n> 📄 **${labels.includeSharedBlock}**: ${blockKey} (${labels.fromPage}: ${pageTitle} [link needs manual correction])\n`;
    });
    
    // Convert view-file macro to file link
    // Handle both orders: name first or height first
    markdown = markdown.replace(/<ac:structured-macro ac:name="view-file"[^>]*>[\s\S]*?<ac:parameter ac:name="name">[\s\S]*?<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, filename) => {
      return `\n📎 [${filename}](${attachmentsDir}/${filename})\n`;
    });
    
    // Also handle view-file with height parameter (which might appear after name)
    markdown = markdown.replace(/<ac:structured-macro ac:name="view-file"[^>]*>[\s\S]*?<ac:parameter ac:name="name">[\s\S]*?<ri:attachment\s+ri:filename="([^"]+)"[^>]*\/>[\s\S]*?<\/ac:parameter>[\s\S]*?<ac:parameter ac:name="height">([^<]*)<\/ac:parameter>[\s\S]*?<\/ac:structured-macro>/g, (_, filename, _height) => {
      return `\n📎 [${filename}](${attachmentsDir}/${filename})\n`;
    });
    
    // Remove layout macros but preserve content
    markdown = markdown.replace(/<ac:layout>/g, '');
    markdown = markdown.replace(/<\/ac:layout>/g, '');
    markdown = markdown.replace(/<ac:layout-section[^>]*>/g, '');
    markdown = markdown.replace(/<\/ac:layout-section>/g, '');
    markdown = markdown.replace(/<ac:layout-cell[^>]*>/g, '');
    markdown = markdown.replace(/<\/ac:layout-cell>/g, '');
    
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
   * Delete a Confluence page
   * Note: Confluence may move the page to trash depending on instance settings.
   */
  async deletePage(pageIdOrUrl) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    await this.client.delete(`/content/${pageId}`);
    return { id: String(pageId) };
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
