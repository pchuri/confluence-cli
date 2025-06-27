const axios = require('axios');
const { convert } = require('html-to-text');
const MarkdownIt = require('markdown-it');

class ConfluenceClient {
  constructor(config) {
    this.baseURL = `https://${config.domain}/rest/api`;
    this.token = config.token;
    this.domain = config.domain;
    this.markdown = new MarkdownIt();
    
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });
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
    // Use Confluence's markdown macro instead of HTML
    return `<ac:structured-macro ac:name="markdown">
      <ac:parameter ac:name="atlassian-macro-output-type">BLOCK</ac:parameter>
      <ac:plain-text-body><![CDATA[${markdown}]]></ac:plain-text-body>
    </ac:structured-macro>`;
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
    // First, get the current page to get the version number
    const currentPage = await this.client.get(`/content/${pageId}`);
    const currentVersion = currentPage.data.version.number;

    let storageContent = content;
    
    if (format === 'markdown') {
      storageContent = this.markdownToStorage(content);
    } else if (format === 'html') {
      // Convert HTML directly to storage format (no macro wrapper)
      storageContent = content;
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
}

module.exports = ConfluenceClient;
