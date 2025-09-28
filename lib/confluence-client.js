const axios = require('axios');
const { convert } = require('html-to-text');
const MarkdownIt = require('markdown-it');

class ConfluenceClient {
  constructor(config) {
    this.domain = config.domain;
    this.token = config.token;
    this.email = config.email;
    this.authType = (config.authType || (this.email ? 'basic' : 'bearer')).toLowerCase();
    this.baseURL = `https://${this.domain}/rest/api`;
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
  extractPageId(pageIdOrUrl) {
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
      
      // Handle display URLs - would need to search by space and title
      const displayMatch = pageIdOrUrl.match(/\/display\/([^/]+)\/(.+)/);
      if (displayMatch) {
        throw new Error('Display URLs not yet supported. Please use page ID or viewpage URL with pageId parameter.');
      }
    }

    return pageIdOrUrl;
  }

  /**
   * Read a Confluence page content
   */
  async readPage(pageIdOrUrl, format = 'text') {
    const pageId = this.extractPageId(pageIdOrUrl);
    
    const response = await this.client.get(`/content/${pageId}`, {
      params: {
        expand: 'body.storage'
      }
    });

    const htmlContent = response.data.body.storage.value;
    
    if (format === 'html') {
      return htmlContent;
    }
    
    if (format === 'markdown') {
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
    const pageId = this.extractPageId(pageIdOrUrl);
    
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
   */
  storageToMarkdown(storage) {
    let markdown = storage;
    
    // Remove table of contents macro
    markdown = markdown.replace(/<ac:structured-macro ac:name="toc"[^>]*\s*\/>/g, '');
    markdown = markdown.replace(/<ac:structured-macro ac:name="toc"[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');
    
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
    
    // Remove other unhandled macros (replace with empty string for now)
    markdown = markdown.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '');
    
    // Convert links
    markdown = markdown.replace(/<ac:link><ri:url ri:value="([^"]*)" \/><ac:plain-text-link-body><!\[CDATA\[([^\]]*)\]\]><\/ac:plain-text-link-body><\/ac:link>/g, '[$2]($1)');
    
    // Convert remaining HTML to markdown
    markdown = this.htmlToMarkdown(markdown);
    
    return markdown;
  }

  /**
   * Convert basic HTML to markdown
   */
  htmlToMarkdown(html) {
    let markdown = html;
    
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
    
    // Remove any remaining HTML tags
    markdown = markdown.replace(/<[^>]+>/g, ' ');
    
    // Clean up whitespace and HTML entities
    markdown = markdown.replace(/&nbsp;/g, ' ');
    markdown = markdown.replace(/&lt;/g, '<');
    markdown = markdown.replace(/&gt;/g, '>');
    markdown = markdown.replace(/&amp;/g, '&');
    markdown = markdown.replace(/&quot;/g, '"');
    
    // Clean up extra whitespace
    markdown = markdown.replace(/\n\s*\n\s*\n+/g, '\n\n');
    markdown = markdown.replace(/[ \t]+/g, ' ');
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
    const pageId = this.extractPageId(pageIdOrUrl);
    
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
}

module.exports = ConfluenceClient;
