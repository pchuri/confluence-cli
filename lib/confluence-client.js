const axios = require('axios');
const { convert } = require('html-to-text');

class ConfluenceClient {
  constructor(config) {
    this.baseURL = `https://${config.domain}/rest/api`;
    this.token = config.token;
    this.domain = config.domain;
    
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
}

module.exports = ConfluenceClient;
