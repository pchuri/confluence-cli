const axios = require('axios');
const fs = require('fs');
const https = require('https');
const path = require('path');
const FormData = require('form-data');
const { convert } = require('html-to-text');
const MacroConverter = require('./macro-converter');

function createSemaphore(limit) {
  let active = 0;
  const waiters = [];
  return {
    async acquire() {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise(resolve => waiters.push(resolve));
    },
    release() {
      if (waiters.length > 0) {
        const next = waiters.shift();
        next();
      } else {
        active--;
      }
    }
  };
}

class ConfluenceClient {
  constructor(config) {
    this.domain = config.domain;
    const rawProtocol = (config.protocol || 'https').trim().toLowerCase();
    this.protocol = (rawProtocol === 'http' || rawProtocol === 'https') ? rawProtocol : 'https';
    this.token = config.token;
    this.email = config.email;
    this.cookie = config.cookie;
    this.authType = (config.authType || (this.email ? 'basic' : 'bearer')).toLowerCase();
    this.forceCloud = !!config.forceCloud;
    this.mtls = config.mtls;
    this.apiPath = this.sanitizeApiPath(config.apiPath);
    this.webUrlPrefix = this.apiPath.startsWith('/wiki/') ? '/wiki' : '';
    this.baseURL = `${this.protocol}://${this.domain}${this.apiPath}`;
    this.converter = new MacroConverter({
      isCloud: this.isCloud(),
      webUrlPrefix: this.webUrlPrefix,
      buildUrl: (pathOrUrl) => this.buildUrl(pathOrUrl),
    });
    this.markdown = this.converter.markdown;

    const headers = {
      'Content-Type': 'application/json',
      ...this.buildAuthHeaders()
    };

    const clientOptions = {
      baseURL: this.baseURL,
      headers
    };
    const httpsAgent = this.buildHttpsAgent();
    if (httpsAgent) {
      clientOptions.httpsAgent = httpsAgent;
    }

    this.client = axios.create(clientOptions);

    this.client.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) {
          const hints = ['Authentication failed (401 Unauthorized).'];
          if (this.isScopedToken()) {
            hints.push(
              'You are using a scoped API token (api.atlassian.com). Please verify:',
              '  - Your token has the required scopes (e.g., read:confluence-content.all, read:confluence-content.summary, read:confluence-space.summary)',
              '  - Your Cloud ID in the API path is correct',
              '  - Your email matches the account that created the token',
              'See: https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/'
            );
          } else if (this.authType === 'basic' && this.isCloud()) {
            hints.push(
              'Please verify your email and API token are correct.',
              'Generate a token at: https://id.atlassian.com/manage-profile/security/api-tokens'
            );
          } else if (this.authType === 'basic') {
            hints.push(
              'Please verify your username and password are correct.'
            );
          } else if (this.authType === 'mtls') {
            hints.push(
              'Please verify your client certificate, client key, and CA certificate are correct and trusted by the server.'
            );
          } else if (this.authType === 'cookie') {
            hints.push(
              'Please verify your cookie is valid and not expired.',
              'You may need to re-authenticate through your Enterprise SSO to get a fresh cookie.'
            );
          } else {
            hints.push(
              'Please verify your personal access token is valid and not expired.'
            );
          }
          error.message = hints.join('\n');
        }
        return Promise.reject(error);
      }
    );
  }

  isCloud() {
    return this.isScopedToken() || (this.domain && this.domain.trim().toLowerCase().endsWith('.atlassian.net')) || this.forceCloud;
  }

  isScopedToken() {
    const d = (this.domain || '').trim().toLowerCase();
    return d === 'api.atlassian.com' || this.apiPath?.includes('/ex/confluence/');
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
      throw new Error('Basic authentication requires an email address or username.');
    }

    const encodedCredentials = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    return `Basic ${encodedCredentials}`;
  }

  buildAuthHeader() {
    if (this.authType === 'mtls' || this.authType === 'cookie') {
      return null;
    }

    if (!this.token) {
      throw new Error(`Authentication type "${this.authType}" requires a token or password.`);
    }

    return this.authType === 'basic' ? this.buildBasicAuthHeader() : `Bearer ${this.token}`;
  }

  buildAuthHeaders() {
    const headers = {};
    const authHeader = this.buildAuthHeader();
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    if (this.authType === 'cookie' && this.cookie) {
      headers.Cookie = this.cookie;
    }
    return headers;
  }

  buildHttpsAgent() {
    if (this.protocol !== 'https' || !this.mtls) {
      return null;
    }

    const options = {};

    if (this.mtls.caCert) {
      if (!fs.existsSync(this.mtls.caCert)) {
        throw new Error(`CA certificate file not found: ${this.mtls.caCert}`);
      }
      options.ca = fs.readFileSync(this.mtls.caCert);
    }
    if (this.mtls.clientCert) {
      if (!fs.existsSync(this.mtls.clientCert)) {
        throw new Error(`Client certificate file not found: ${this.mtls.clientCert}`);
      }
      options.cert = fs.readFileSync(this.mtls.clientCert);
    }
    if (this.mtls.clientKey) {
      if (!fs.existsSync(this.mtls.clientKey)) {
        throw new Error(`Client key file not found: ${this.mtls.clientKey}`);
      }
      // Warn if private key file is readable by others (Unix only)
      if (process.platform !== 'win32') {
        try {
          const keyStats = fs.statSync(this.mtls.clientKey);
          const keyMode = keyStats.mode & 0o777;
          if (keyMode & 0o077) {
            console.error(
              `Warning: Client key file "${this.mtls.clientKey}" has mode ${keyMode.toString(8)}. ` +
              'Private keys should not be readable by other users (recommended: 0600). ' +
              `Fix with: chmod 600 "${this.mtls.clientKey}"`
            );
          }
        } catch {
          // Ignore stat errors — the read below will surface them
        }
      }
      options.key = fs.readFileSync(this.mtls.clientKey);
    }

    if (Object.keys(options).length === 0) {
      return null;
    }

    return new https.Agent(options);
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

      const prettyMatch = pageIdOrUrl.match(/\/pages\/(\d+)(?:[/?#]|$)/);
      if (prettyMatch) {
        return prettyMatch[1];
      }

      // Handle tiny links (/wiki/x/<code>)
      const tinyLinkMatch = pageIdOrUrl.match(/\/wiki\/x\/([A-Za-z0-9_-]+)/);
      if (tinyLinkMatch) {
        try {
          const response = await this.client.get(pageIdOrUrl, {
            maxRedirects: 0,
            validateStatus: (status) => status >= 300 && status < 400
          });
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            return this.extractPageId(redirectUrl);
          }
        } catch (error) {
          if (error.response && error.response.headers && error.response.headers.location) {
            return this.extractPageId(error.response.headers.location);
          }
        }
        throw new Error(`Could not resolve page ID from tiny link: ${pageIdOrUrl}`);
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
   * Escape a string for safe use inside a CQL double-quoted literal.
   * Only escapes characters that can break out of the literal: backslash and
   * double quote. Wildcards (*, ?) and fuzzy (~) are left as-is so existing
   * search semantics are preserved.
   */
  escapeCql(str) {
    if (typeof str !== 'string') {
      return '';
    }
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  /**
   * Search for pages
   */
  async search(query, limit = 10, rawCql = false) {
    const cql = rawCql ? query : `text ~ "${this.escapeCql(query)}"`;
    const response = await this.client.get('/search', {
      params: {
        cql,
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
      const escapedKey = userKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const userLinkRegex = new RegExp(
        `<ac:link>\\s*<ri:user\\s+ri:userkey="${escapedKey}"\\s*/>\\s*</ac:link>`,
        'g'
      );
      resolvedHtml = resolvedHtml.replace(userLinkRegex, () => `@${displayName}`);
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
          url: webui ? this.buildUrl(`${this.webUrlPrefix}${webui}`) : ''
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
        const url = webui ? this.buildUrl(`${this.webUrlPrefix}${webui}`) : '';
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
    const downloadRequestConfig = {
      responseType: options.responseType || 'stream',
      headers: this.buildAuthHeaders()
    };
    const httpsAgent = this.buildHttpsAgent();
    if (httpsAgent) {
      downloadRequestConfig.httpsAgent = httpsAgent;
    }
    const downloadResponse = await axios.get(downloadUrl, downloadRequestConfig);
    return downloadResponse.data;
  }

  /**
   * Upload an attachment to a page
   */
  async uploadAttachment(pageIdOrUrl, filePath, options = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('File path is required for attachment upload.');
    }

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const pageId = await this.extractPageId(pageIdOrUrl);
    const form = new FormData();
    form.append('file', fs.createReadStream(resolvedPath), { filename: path.basename(resolvedPath) });

    if (options.comment !== undefined && options.comment !== null) {
      form.append('comment', options.comment, { contentType: 'text/plain; charset=utf-8' });
    }

    if (typeof options.minorEdit === 'boolean') {
      form.append('minorEdit', options.minorEdit ? 'true' : 'false');
    }

    const method = options.replace ? 'put' : 'post';
    const response = await this.client.request({
      url: `/content/${pageId}/child/attachment`,
      method,
      headers: {
        ...form.getHeaders(),
        'X-Atlassian-Token': 'nocheck'
      },
      data: form,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const results = Array.isArray(response.data?.results)
      ? response.data.results.map((item) => this.normalizeAttachment(item))
      : [];

    return {
      results,
      raw: response.data
    };
  }

  /**
   * Delete an attachment by ID
   */
  async deleteAttachment(pageIdOrUrl, attachmentId) {
    if (!attachmentId) {
      throw new Error('Attachment ID is required.');
    }

    const pageId = await this.extractPageId(pageIdOrUrl);
    await this.client.delete(`/content/${pageId}/child/attachment/${attachmentId}`);
    return { id: String(attachmentId), pageId: String(pageId) };
  }

  /**
   * List content properties for a page with pagination support
   */
  async listProperties(pageIdOrUrl, options = {}) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    const limit = this.parsePositiveInt(options.limit, 25);
    const start = this.parsePositiveInt(options.start, 0);
    const params = { limit, start };

    const response = await this.client.get(`/content/${pageId}/property`, { params });
    const results = Array.isArray(response.data.results) ? response.data.results : [];

    return {
      results,
      nextStart: this.parseNextStart(response.data?._links?.next)
    };
  }

  /**
   * Fetch all content properties for a page, honoring an optional maxResults cap
   */
  async getAllProperties(pageIdOrUrl, options = {}) {
    const pageSize = this.parsePositiveInt(options.pageSize || options.limit, 25);
    const maxResults = this.parsePositiveInt(options.maxResults, null);
    let start = this.parsePositiveInt(options.start, 0);
    const properties = [];

    let hasNext = true;
    while (hasNext) {
      const page = await this.listProperties(pageIdOrUrl, {
        limit: pageSize,
        start
      });
      properties.push(...page.results);

      if (maxResults && properties.length >= maxResults) {
        return properties.slice(0, maxResults);
      }

      hasNext = page.nextStart !== null && page.nextStart !== undefined;
      if (hasNext) {
        start = page.nextStart;
      }
    }

    return properties;
  }

  /**
   * Get a single content property by key
   */
  async getProperty(pageIdOrUrl, key) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    const response = await this.client.get(`/content/${pageId}/property/${encodeURIComponent(key)}`);
    return response.data;
  }

  /**
   * Set (create or update) a content property
   */
  async setProperty(pageIdOrUrl, key, value) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    const encodedKey = encodeURIComponent(key);

    let version = 1;
    try {
      const existing = await this.client.get(`/content/${pageId}/property/${encodedKey}`);
      version = existing.data.version.number + 1;
    } catch (err) {
      if (!err.response || err.response.status !== 404) {
        throw err;
      }
    }

    const response = await this.client.put(`/content/${pageId}/property/${encodedKey}`, {
      key,
      value,
      version: { number: version }
    });
    return response.data;
  }

  /**
   * Delete a content property by key
   */
  async deleteProperty(pageIdOrUrl, key) {
    const pageId = await this.extractPageId(pageIdOrUrl);
    await this.client.delete(`/content/${pageId}/property/${encodeURIComponent(key)}`);
    return { pageId: String(pageId), key };
  }

  markdownToStorage(markdown) {
    return this.converter.markdownToStorage(markdown);
  }

  htmlToConfluenceStorage(html) {
    return this.converter.htmlToConfluenceStorage(html);
  }

  markdownToNativeStorage(markdown) {
    return this.converter.markdownToNativeStorage(markdown);
  }

  setupConfluenceMarkdownExtensions() {
    this.converter.setupConfluenceMarkdownExtensions();
  }

  detectLanguageLabels(text) {
    return this.converter.detectLanguageLabels(text);
  }

  storageToMarkdown(storage, options = {}) {
    return this.converter.storageToMarkdown(storage, options);
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
   * Move a page to a new parent location
   */
  async movePage(pageIdOrUrl, newParentIdOrUrl, newTitle = null) {
    // Resolve both IDs from URLs if needed
    const pageId = await this.extractPageId(pageIdOrUrl);
    const newParentId = await this.extractPageId(newParentIdOrUrl);

    // Fetch current page
    const response = await this.client.get(`/content/${pageId}`, {
      params: { expand: 'body.storage,version,space' }
    });
    const { version, title, body, space } = response.data;

    // Fetch new parent to get its space (for validation)
    const parentResponse = await this.client.get(`/content/${newParentId}`, {
      params: { expand: 'space' }
    });
    const parentSpace = parentResponse.data.space;

    // Validate same space
    if (parentSpace.key !== space.key) {
      throw new Error(
        `Cannot move page across spaces. Page is in space "${space.key}" ` +
        `but new parent is in space "${parentSpace.key}". ` +
        'Pages can only be moved within the same space.'
      );
    }

    // Proceed with move
    const pageData = {
      id: pageId,
      type: 'page',
      title: newTitle || title,
      space: { key: space.key },
      body: {
        storage: {
          value: body.storage.value,
          representation: 'storage'
        }
      },
      version: { number: version.number + 1 },
      ancestors: [{ id: newParentId }]
    };

    const updateResponse = await this.client.put(`/content/${pageId}`, pageData);
    return updateResponse.data;
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
    let cql = `title = "${this.escapeCql(title)}"`;
    if (spaceKey) {
      cql += ` AND space = "${this.escapeCql(spaceKey)}"`;
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
    const semaphore = createSemaphore(10);
    return this._collectDescendants(pageId, maxDepth, currentDepth, semaphore);
  }

  async _collectDescendants(pageId, maxDepth, currentDepth, semaphore) {
    if (currentDepth >= maxDepth) {
      return [];
    }

    await semaphore.acquire();
    let children;
    try {
      children = await this.getChildPages(pageId);
    } finally {
      semaphore.release();
    }

    // Attach parentId so we can later reconstruct hierarchy if needed
    const childrenWithParent = children.map(child => ({ ...child, parentId: pageId }));

    const grandChildrenLists = await Promise.all(
      children.map(child =>
        this._collectDescendants(child.id, maxDepth, currentDepth + 1, semaphore)
      )
    );

    return childrenWithParent.concat(...grandChildrenLists);
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

  buildUrl(path) {
    const normalized = path && !path.startsWith('/') ? `/${path}` : (path || '');
    return `${this.protocol}://${this.domain}${normalized}`;
  }

  toAbsoluteUrl(pathOrUrl) {
    if (!pathOrUrl) {
      return null;
    }

    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }

    const pathWithPrefix = this.webUrlPrefix && !pathOrUrl.startsWith(this.webUrlPrefix)
      ? `${this.webUrlPrefix}${pathOrUrl}`
      : pathOrUrl;
    return this.buildUrl(pathWithPrefix);
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

ConfluenceClient.createLocalConverter = function () {
  return new MacroConverter();
};

module.exports = ConfluenceClient;
