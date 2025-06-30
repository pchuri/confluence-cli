const ConfluenceClient = require('../lib/confluence-client');

describe('ConfluenceClient', () => {
  let client;
  
  beforeEach(() => {
    client = new ConfluenceClient({
      domain: 'test.atlassian.net',
      token: 'test-token'
    });
  });

  describe('extractPageId', () => {
    test('should return numeric page ID as is', () => {
      expect(client.extractPageId('123456789')).toBe('123456789');
      expect(client.extractPageId(123456789)).toBe(123456789);
    });

    test('should extract page ID from URL with pageId parameter', () => {
      const url = 'https://test.atlassian.net/wiki/spaces/TEST/pages/123456789/Page+Title';
      expect(client.extractPageId(url + '?pageId=987654321')).toBe('987654321');
    });

    test('should throw error for display URLs', () => {
      const displayUrl = 'https://test.atlassian.net/display/TEST/Page+Title';
      expect(() => client.extractPageId(displayUrl)).toThrow('Display URLs not yet supported');
    });
  });

  describe('markdownToStorage', () => {
    test('should convert basic markdown to native Confluence storage format', () => {
      const markdown = '# Hello World\n\nThis is a **test** page with *italic* text.';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<h1>Hello World</h1>');
      expect(result).toContain('<p>This is a <strong>test</strong> page with <em>italic</em> text.</p>');
      expect(result).not.toContain('<ac:structured-macro ac:name="html">');
    });

    test('should convert code blocks to Confluence code macro', () => {
      const markdown = '```javascript\nconsole.log("Hello World");\n```';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">javascript</ac:parameter>');
      expect(result).toContain('console.log(&quot;Hello World&quot;);');
    });

    test('should convert lists to native Confluence format', () => {
      const markdown = '- Item 1\n- Item 2\n\n1. First\n2. Second';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ul>');
      expect(result).toContain('<li><p>Item 1</p></li>');
      expect(result).toContain('<ol>');
      expect(result).toContain('<li><p>First</p></li>');
    });

    test('should convert Confluence admonitions', () => {
      const markdown = '[!info]\nThis is an info message';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:structured-macro ac:name="info">');
      expect(result).toContain('This is an info message');
    });

    test('should convert tables to native Confluence format', () => {
      const markdown = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<table>');
      expect(result).toContain('<th><p>Header 1</p></th>');
      expect(result).toContain('<td><p>Cell 1</p></td>');
    });

    test('should convert links to Confluence link format', () => {
      const markdown = '[Example Link](https://example.com)';
      const result = client.markdownToStorage(markdown);
      
      expect(result).toContain('<ac:link>');
      expect(result).toContain('ri:value="https://example.com"');
      expect(result).toContain('Example Link');
    });
  });

  describe('storageToMarkdown', () => {
    test('should convert Confluence storage format to markdown', () => {
      const storage = '<h1>Hello World</h1><p>This is a <strong>test</strong> page.</p>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('# Hello World');
      expect(result).toContain('**test**');
    });

    test('should convert Confluence code macro to markdown', () => {
      const storage = '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">javascript</ac:parameter><ac:plain-text-body><![CDATA[console.log("Hello");]]></ac:plain-text-body></ac:structured-macro>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('```javascript');
      expect(result).toContain('console.log("Hello");');
      expect(result).toContain('```');
    });

    test('should convert Confluence macros to admonitions', () => {
      const storage = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>This is info</p></ac:rich-text-body></ac:structured-macro>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('[!info]');
      expect(result).toContain('This is info');
    });

    test('should convert Confluence links to markdown', () => {
      const storage = '<ac:link><ri:url ri:value="https://example.com" /><ac:plain-text-link-body><![CDATA[Example]]></ac:plain-text-link-body></ac:link>';
      const result = client.storageToMarkdown(storage);
      
      expect(result).toContain('[Example](https://example.com)');
    });
  });

  describe('htmlToMarkdown', () => {
    test('should convert basic HTML to markdown', () => {
      const html = '<h2>Title</h2><p>Some <strong>bold</strong> and <em>italic</em> text.</p>';
      const result = client.htmlToMarkdown(html);
      
      expect(result).toContain('## Title');
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
    });

    test('should convert HTML lists to markdown', () => {
      const html = '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>';
      const result = client.htmlToMarkdown(html);
      
      expect(result).toContain('- Item 1');
      expect(result).toContain('- Item 2');
    });

    test('should convert HTML tables to markdown', () => {
      const html = '<table><tr><th><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></table>';
      const result = client.htmlToMarkdown(html);
      
      expect(result).toContain('| Header |');
      expect(result).toContain('| --- |');
      expect(result).toContain('| Cell |');
    });
  });

  describe('page creation and updates', () => {
    test('should have required methods for page management', () => {
      expect(typeof client.createPage).toBe('function');
      expect(typeof client.updatePage).toBe('function');
      expect(typeof client.getPageForEdit).toBe('function');
      expect(typeof client.createChildPage).toBe('function');
      expect(typeof client.findPageByTitle).toBe('function');
    });
  });
});
