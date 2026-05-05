const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ConfluenceClient = require('../lib/confluence-client');

const CLI = path.resolve(__dirname, '../bin/index.js');

function run(args, input) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input,
    timeout: 10000,
  });
}

describe('createLocalConverter', () => {
  test('creates instance without server config', () => {
    const converter = ConfluenceClient.createLocalConverter();
    expect(converter).toBeInstanceOf(ConfluenceClient);
    expect(converter.markdown).toBeDefined();
  });

  test('converts markdown to storage format', () => {
    const converter = ConfluenceClient.createLocalConverter();
    const result = converter.markdownToStorage('# Hello');
    expect(result).toContain('<h1>');
    expect(result).toContain('Hello');
  });

  test('converts storage to markdown', () => {
    const converter = ConfluenceClient.createLocalConverter();
    const result = converter.storageToMarkdown('<h1>Hello</h1><p>World</p>');
    expect(result).toContain('# Hello');
    expect(result).toContain('World');
  });
});

describe('markdown-confluence plugin', () => {
  let converter;

  beforeEach(() => {
    converter = ConfluenceClient.createLocalConverter();
  });

  describe('basic formatting', () => {
    test('converts bold text', () => {
      const result = converter.markdownToStorage('**bold**');
      expect(result).toContain('<strong>bold</strong>');
    });

    test('converts italic text', () => {
      const result = converter.markdownToStorage('*italic*');
      expect(result).toContain('<em>italic</em>');
    });

    test('converts inline code', () => {
      const result = converter.markdownToStorage('`code`');
      expect(result).toContain('<code>code</code>');
    });

    test('converts headings', () => {
      const result = converter.markdownToStorage('# H1\n## H2\n### H3');
      expect(result).toContain('<h1>H1</h1>');
      expect(result).toContain('<h2>H2</h2>');
      expect(result).toContain('<h3>H3</h3>');
    });
  });

  describe('code blocks', () => {
    test('converts fenced code block with language', () => {
      const result = converter.markdownToStorage('```javascript\nconst x = 1;\n```');
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">javascript</ac:parameter>');
      expect(result).toContain('<![CDATA[const x = 1;]]>');
    });

    test('converts fenced code block without language', () => {
      const result = converter.markdownToStorage('```\nplain text\n```');
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">text</ac:parameter>');
    });

    test('escapes CDATA end markers in code', () => {
      const result = converter.markdownToStorage('```\nsome]]>code\n```');
      expect(result).toContain(']]]]><![CDATA[>');
    });
  });

  describe('admonitions', () => {
    test('converts info admonition', () => {
      const result = converter.markdownToStorage('[!info]\nThis is info.');
      expect(result).toContain('<ac:structured-macro ac:name="info">');
      expect(result).toContain('This is info.');
      expect(result).not.toContain('<!--ADMONITION:INFO-->');
    });

    test('converts warning admonition', () => {
      const result = converter.markdownToStorage('[!warning]\nBe careful!');
      expect(result).toContain('<ac:structured-macro ac:name="warning">');
      expect(result).toContain('Be careful!');
    });

    test('converts note admonition', () => {
      const result = converter.markdownToStorage('[!note]\nTake note.');
      expect(result).toContain('<ac:structured-macro ac:name="note">');
      expect(result).toContain('Take note.');
    });

    test('converts regular blockquote to info macro', () => {
      const result = converter.markdownToStorage('> Just a quote');
      expect(result).toContain('<ac:structured-macro ac:name="info">');
      expect(result).toContain('Just a quote');
    });
  });

  describe('lists', () => {
    test('converts unordered list with paragraph wrapping', () => {
      const result = converter.markdownToStorage('- Item 1\n- Item 2');
      expect(result).toContain('<ul>');
      expect(result).toContain('<li><p>Item 1</p></li>');
      expect(result).toContain('<li><p>Item 2</p></li>');
    });

    test('converts ordered list', () => {
      const result = converter.markdownToStorage('1. First\n2. Second');
      expect(result).toContain('<ol>');
      expect(result).toContain('<li><p>First</p></li>');
      expect(result).toContain('<li><p>Second</p></li>');
    });

    test('handles nested lists', () => {
      const result = converter.markdownToStorage('- Outer\n  - Inner');
      expect(result).toContain('<ul>');
      expect(result).toContain('<li><p>Outer</p>');
      expect(result).toMatch(/<ul>[\s\S]*<li><p>Inner<\/p><\/li>/);
    });
  });

  describe('links', () => {
    test('converts links for server (non-cloud)', () => {
      const result = converter.markdownToStorage('[link](https://example.com)');
      expect(result).toContain('<ac:link>');
      expect(result).toContain('<ri:url ri:value="https://example.com" />');
      expect(result).toContain('<![CDATA[link]]>');
    });

    test('escapes HTML in link URLs', () => {
      const result = converter.markdownToStorage('[link](https://example.com?a=1&b=2)');
      expect(result).toContain('&amp;');
    });
  });

  describe('images', () => {
    test('converts attachment images', () => {
      const result = converter.markdownToStorage('![alt text](attachments/image.png)');
      expect(result).toContain('<ac:image');
      expect(result).toContain('ac:alt="alt text"');
      expect(result).toContain('<ri:attachment ri:filename="image.png" />');
    });

    test('converts external images', () => {
      const result = converter.markdownToStorage('![alt](https://example.com/img.png)');
      expect(result).toContain('<ac:image');
      expect(result).toContain('ac:alt="alt"');
      expect(result).toContain('<ri:url ri:value="https://example.com/img.png" />');
    });

    test('handles images with title', () => {
      const result = converter.markdownToStorage('![alt](image.png "title")');
      expect(result).toContain('ac:alt="alt"');
      expect(result).toContain('ac:title="title"');
    });
  });

  describe('tables', () => {
    test('converts markdown table with header wrapping', () => {
      const markdown = '| Name | Age |\n|------|-----|\n| Bob | 30 |';
      const result = converter.markdownToStorage(markdown);
      expect(result).toContain('<table>');
      expect(result).toContain('<thead>');
      expect(result).toContain('<th><p>Name</p></th>');
      expect(result).toContain('<th><p>Age</p></th>');
      expect(result).toContain('<tbody>');
      expect(result).toContain('<td><p>Bob</p></td>');
      expect(result).toContain('<td><p>30</p></td>');
    });
  });

  describe('HTML passthrough', () => {
    test('wraps HTML blocks in HTML macro', () => {
      // HTML blocks are recognized when on their own lines
      const svg = '<svg width="100" height="100">\n  <circle cx="50" cy="50" r="40" />\n</svg>';
      const result = converter.markdownToStorage(svg);
      expect(result).toContain('<ac:structured-macro ac:name="html"');
      expect(result).toContain('ac:schema-version="1"');
      expect(result).toContain('ac:macro-id=');
      expect(result).toContain('<![CDATA[<svg');
      expect(result).toContain('<circle');
      // Should be wrapped in a single macro
      expect((result.match(/ac:structured-macro/g) || []).length).toBe(2); // one open, one close
    });

    test('passes inline HTML through as-is', () => {
      // Inline HTML is not wrapped because wrapping individual tags breaks multi-tag structures
      const result = converter.markdownToStorage('Text <span>inline</span> more text');
      expect(result).toContain('<span>inline</span>');
      expect(result).not.toContain('<ac:structured-macro ac:name="html"');
    });

    test('escapes CDATA markers in HTML blocks', () => {
      const html = '<div>test]]>end</div>';
      const result = converter.markdownToStorage(html);
      expect(result).toContain('test]]]]><![CDATA[>end');
    });

    test('generates unique macro IDs for separate HTML blocks', () => {
      const markdown = '<div>first</div>\n\n<div>second</div>';
      const result = converter.markdownToStorage(markdown);
      // Extract macro IDs
      const macroIds = result.match(/ac:macro-id="([^"]+)"/g);
      expect(macroIds).toHaveLength(2);
      expect(macroIds[0]).not.toBe(macroIds[1]);
    });

    test('keeps complex multi-line SVG intact in single macro', () => {
      const svg = `<svg id="my-svg" width="100%" xmlns="http://www.w3.org/2000/svg">
  <g></g>
  <g class="commit-bullets"></g>
</svg>`;
      const result = converter.markdownToStorage(svg);

      // Should have exactly one HTML macro (open + close tags)
      const macroCount = (result.match(/<ac:structured-macro ac:name="html"/g) || []).length;
      expect(macroCount).toBe(1);

      // Should contain the complete SVG structure
      expect(result).toContain('my-svg');
      expect(result).toContain('<g></g>');
      expect(result).toContain('commit-bullets');
    });

    test('wraps one-line SVG in single HTML macro', () => {
      // SVG all on one line (common from diagram generators)
      const svg = '<svg id="test" width="100%"><g/><g class="bullets"></g></svg>';
      const result = converter.markdownToStorage(svg);

      // Should be wrapped in HTML macro
      expect(result).toContain('<ac:structured-macro ac:name="html"');
      expect(result).toContain('<![CDATA[<svg id="test"');

      // Should have exactly one HTML macro
      const macroCount = (result.match(/<ac:structured-macro ac:name="html"/g) || []).length;
      expect(macroCount).toBe(1);

      // Should contain the complete SVG with all inner tags
      expect(result).toContain('<g/>');
      expect(result).toContain('class="bullets"');
      expect(result).toContain('</svg>');
    });

    test('wraps one-line complex SVG with many attributes', () => {
      const svg = '<svg id="my-svg" width="100%" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="max-width: 911.008px; background-color: white;" viewBox="-303 -36 911 638"><g/><g></g></svg>';
      const result = converter.markdownToStorage(svg);

      // Should wrap in single HTML macro
      expect(result).toContain('<ac:structured-macro ac:name="html"');
      const macroCount = (result.match(/<ac:structured-macro ac:name="html"/g) || []).length;
      expect(macroCount).toBe(1);

      // Should preserve all attributes and content
      expect(result).toContain('my-svg');
      expect(result).toContain('xmlns:xlink');
      expect(result).toContain('viewBox');
    });

    test('converts details/summary to expand macro', () => {
      const markdown = `<details>
<summary>View code</summary>

\`\`\`javascript
console.log("test");
\`\`\`

</details>`;

      const result = converter.markdownToStorage(markdown);

      // Should convert to expand macro
      expect(result).toContain('<ac:structured-macro ac:name="expand"');
      expect(result).toContain('<ac:parameter ac:name="title">View code</ac:parameter>');
      expect(result).toContain('<ac:rich-text-body>');

      // Code block should be inside
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('console.log');

      // Should NOT have leftover HTML macros for details/summary
      expect(result).not.toContain('CDATA[<details>');
      expect(result).not.toContain('CDATA[</details>');
    });
  });

  describe('custom macros', () => {
    test('supports custom fence handler for mermaid diagrams', () => {
      const MarkdownIt = require('markdown-it');
      const confluencePlugin = require('../lib/markdown-confluence');

      const md = new MarkdownIt().use(confluencePlugin, {
        isCloud: false,
        macros: {
          fence: (tokens, idx) => {
            const token = tokens[idx];
            if (token.info === 'mermaid') {
              const content = token.content.replace(/\n$/, '');
              return `<ac:structured-macro ac:name="mermaid-macro"><ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body></ac:structured-macro>`;
            }
            return null; // use default
          }
        }
      });

      const markdown = '```mermaid\ngraph TD\n  A --> B\n```';
      const result = md.render(markdown);

      expect(result).toContain('<ac:structured-macro ac:name="mermaid-macro">');
      expect(result).toContain('graph TD');
      expect(result).toContain('A --> B');
      expect(result).not.toContain('<ac:parameter ac:name="language">');
    });

    test('supports custom fence handler for plantuml', () => {
      const MarkdownIt = require('markdown-it');
      const confluencePlugin = require('../lib/markdown-confluence');

      const md = new MarkdownIt().use(confluencePlugin, {
        macros: {
          fence: (tokens, idx) => {
            const token = tokens[idx];
            if (token.info === 'plantuml') {
              return `<ac:structured-macro ac:name="plantuml"><ac:plain-text-body><![CDATA[${token.content.replace(/\n$/, '')}]]></ac:plain-text-body></ac:structured-macro>`;
            }
            return null;
          }
        }
      });

      const markdown = '```plantuml\n@startuml\nAlice -> Bob\n@enduml\n```';
      const result = md.render(markdown);

      expect(result).toContain('<ac:structured-macro ac:name="plantuml">');
      expect(result).toContain('@startuml');
      expect(result).toContain('Alice -> Bob');
    });

    test('falls back to default handler when custom macro returns null', () => {
      const MarkdownIt = require('markdown-it');
      const confluencePlugin = require('../lib/markdown-confluence');

      const md = new MarkdownIt().use(confluencePlugin, {
        macros: {
          fence: (tokens, idx) => {
            const token = tokens[idx];
            // Only handle mermaid, let everything else fall through
            if (token.info === 'mermaid') {
              return `<ac:structured-macro ac:name="mermaid-macro"><ac:plain-text-body><![CDATA[${token.content}]]></ac:plain-text-body></ac:structured-macro>`;
            }
            return null;
          }
        }
      });

      const markdown = '```javascript\nconst x = 1;\n```';
      const result = md.render(markdown);

      // Should use default code macro
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">javascript</ac:parameter>');
    });

    test('registerMacro works after initialization', () => {
      const MarkdownIt = require('markdown-it');
      const confluencePlugin = require('../lib/markdown-confluence');

      const md = new MarkdownIt().use(confluencePlugin);

      // Register a custom handler after setup
      confluencePlugin.registerMacro(md, 'fence', (tokens, idx) => {
        const token = tokens[idx];
        if (token.info === 'draw') {
          return `<ac:structured-macro ac:name="drawio"><ac:plain-text-body><![CDATA[${token.content}]]></ac:plain-text-body></ac:structured-macro>`;
        }
        return null;
      });

      const markdown = '```draw\n<diagram>test</diagram>\n```';
      const result = md.render(markdown);

      expect(result).toContain('<ac:structured-macro ac:name="drawio">');
      expect(result).toContain('<diagram>test</diagram>');
    });

    test('handles multiple custom diagram types', () => {
      const MarkdownIt = require('markdown-it');
      const confluencePlugin = require('../lib/markdown-confluence');

      const md = new MarkdownIt().use(confluencePlugin, {
        macros: {
          fence: (tokens, idx) => {
            const token = tokens[idx];
            const content = token.content.replace(/\n$/, '');

            if (token.info === 'mermaid') {
              return `<ac:structured-macro ac:name="mermaid-macro"><ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body></ac:structured-macro>`;
            }

            if (token.info === 'plantuml') {
              return `<ac:structured-macro ac:name="plantuml"><ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body></ac:structured-macro>`;
            }

            if (token.info === 'graphviz') {
              return `<ac:structured-macro ac:name="graphviz"><ac:plain-text-body><![CDATA[${content}]]></ac:plain-text-body></ac:structured-macro>`;
            }

            return null; // default handler for everything else
          }
        }
      });

      const markdown = `
\`\`\`mermaid
graph LR
  A --> B
\`\`\`

\`\`\`plantuml
@startuml
Alice -> Bob
@enduml
\`\`\`

\`\`\`graphviz
digraph G {
  A -> B
}
\`\`\`

\`\`\`javascript
// regular code
\`\`\`
`;
      const result = md.render(markdown);

      expect(result).toContain('<ac:structured-macro ac:name="mermaid-macro">');
      expect(result).toContain('graph LR');
      expect(result).toContain('<ac:structured-macro ac:name="plantuml">');
      expect(result).toContain('@startuml');
      expect(result).toContain('<ac:structured-macro ac:name="graphviz">');
      expect(result).toContain('digraph G');
      // Regular code should still use code macro
      expect(result).toContain('<ac:parameter ac:name="language">javascript</ac:parameter>');
    });
  });

  describe('complex scenarios', () => {
    test('handles mixed content', () => {
      const markdown = `# Title

This is **bold** and *italic*.

\`\`\`javascript
const x = 1;
\`\`\`

[!info]
Important note here.

- List item
- Another item

| Col 1 | Col 2 |
|-------|-------|
| A     | B     |
`;
      const result = converter.markdownToStorage(markdown);
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('<em>italic</em>');
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:structured-macro ac:name="info">');
      expect(result).toContain('<ul>');
      expect(result).toContain('<table>');
    });
  });
});

describe('convert command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-convert-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeInput(name, content) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  test('markdown to storage via stdout', () => {
    const inputFile = writeInput('input.md', '# Hello\n\nWorld\n');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    expect(output).toContain('<h1>');
    expect(output).toContain('Hello');
    expect(output).toContain('World');
  });

  test('markdown to storage via files', () => {
    const inputFile = writeInput('input.md', '# Test\n\nParagraph\n');
    const outputFile = path.join(tmpDir, 'output.xml');
    run(['convert', '--input-file', inputFile, '--output-file', outputFile, '--input-format', 'markdown', '--output-format', 'storage']);
    const output = fs.readFileSync(outputFile, 'utf-8');
    expect(output).toContain('<h1>');
    expect(output).toContain('Test');
  });

  test('storage to markdown', () => {
    const inputFile = writeInput('input.xml', '<h1>Title</h1><p>Content</p>');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'storage', '--output-format', 'markdown']);
    expect(output).toContain('# Title');
    expect(output).toContain('Content');
  });

  test('markdown to html', () => {
    const inputFile = writeInput('input.md', '**bold**');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'html']);
    expect(output).toContain('<strong>bold</strong>');
  });

  test('storage to text', () => {
    const inputFile = writeInput('input.xml', '<h1>Title</h1><p>Content</p>');
    const output = run(['convert', '--input-file', inputFile, '--input-format', 'storage', '--output-format', 'text']);
    expect(output.toLowerCase()).toContain('title');
    expect(output).toContain('Content');
  });

  test('errors on missing --input-format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--output-format', 'storage'])).toThrow();
  });

  test('errors on missing --output-format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--input-format', 'markdown'])).toThrow();
  });

  test('errors on same input and output format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--input-format', 'markdown', '--output-format', 'markdown'])).toThrow();
  });

  test('errors on invalid format', () => {
    const inputFile = writeInput('input.md', '');
    expect(() => run(['convert', '--input-file', inputFile, '--input-format', 'xml', '--output-format', 'storage'])).toThrow();
  });
});
