# Markdown-Confluence Plugin

A [markdown-it](https://github.com/markdown-it/markdown-it) plugin that converts Markdown directly to Confluence Storage Format. No more dealing with intermediate HTML conversions - this goes straight to what Confluence expects.

## Features

- **Direct Storage Format**: Outputs Confluence storage format right away (not HTML)
- **Admonitions**: Those nice info/warning/note boxes using `[!info]`, `[!warning]`, `[!note]`
- **Code Blocks**: Fenced code blocks become Confluence code macros with syntax highlighting
- **Images**: Handles both attachments and external URLs
- **Tables**: Full markdown table support
- **HTML Passthrough**: Embed raw HTML (SVG, complex tables, etc.) when you need it
- **Cloud/Server Support**: Works with both Confluence Cloud and Server/Data Center
- **Custom Macros**: Add your own Confluence macros easily

## Basic Usage

```javascript
const MarkdownIt = require('markdown-it');
const confluencePlugin = require('./lib/markdown-confluence');

const md = new MarkdownIt().use(confluencePlugin, {
  isCloud: false,  // true for Confluence Cloud
  allowHtmlPassthrough: true
});

const markdown = `
# Hello Confluence

This is **bold** and this is *italic*.

\`\`\`javascript
console.log("Hello!");
\`\`\`

[!info]
This is an info box.
`;

const storage = md.render(markdown);
```

### Using with ConfluenceClient

The plugin is already integrated into `ConfluenceClient`:

```javascript
const ConfluenceClient = require('./lib/confluence-client');

const client = new ConfluenceClient({
  domain: 'your-domain.atlassian.net',
  email: 'your-email@example.com',
  token: 'your-api-token'
});

// Just works
const storage = client.markdownToStorage(markdown);
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `isCloud` | boolean | `false` | Cloud or Server? (affects link formatting) |
| `macros` | object | `{}` | Your custom macro handlers |
| `allowHtmlPassthrough` | boolean | `true` | Let raw HTML through (useful for SVG) |

## What's Supported

### Headings

```markdown
# H1
## H2
### H3
```

### Text Formatting

```markdown
**bold** and *italic* and `inline code`
```

### Code Blocks

````markdown
```javascript
function hello() {
  console.log("Hello!");
}
```
````

Becomes:
```xml
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">javascript</ac:parameter>
  <ac:plain-text-body><![CDATA[function hello() {
  console.log("Hello!");
}]]></ac:plain-text-body>
</ac:structured-macro>
```

### Admonitions

```markdown
[!info]
This is an info box.

[!warning]
This is a warning.

[!note]
This is a note.
```

These become the info/warning/note macros in Confluence.

### Images

```markdown
![Alt text](attachments/image.png)
![External](https://example.com/image.png)
```

Local paths are treated as attachments, HTTP URLs as external images.

### Links

Links render differently depending on whether you're targeting Cloud or Server:

**Cloud:**
```xml
<a href="https://example.com" data-card-appearance="inline">Link</a>
```

**Server/DC:**
```xml
<ac:link><ri:url ri:value="https://example.com" /><ac:plain-text-link-body><![CDATA[Link]]></ac:plain-text-link-body></ac:link>
```

### Tables

```markdown
| Name | Role |
|------|------|
| Alice | Developer |
| Bob | Manager |
```

Confluence requires `<p>` tags inside cells, so the plugin adds them automatically.

### Lists

```markdown
- Item 1
- Item 2
  - Nested item

1. First
2. Second
```

Works as expected. List items also get wrapped with `<p>` tags (Confluence requirement).

## Custom Macros

You can add your own macro handlers pretty easily:

### Option 1: Pass in options

```javascript
const md = new MarkdownIt().use(confluencePlugin, {
  isCloud: false,
  macros: {
    fence: (tokens, idx) => {
      const token = tokens[idx];
      if (token.info === 'mermaid') {
        return `<ac:structured-macro ac:name="mermaid-macro">
          <ac:plain-text-body><![CDATA[${token.content}]]></ac:plain-text-body>
        </ac:structured-macro>`;
      }
      return null; // return null to fall back to default handler
    }
  }
});
```

**Note:** When your custom handler returns `null` or `undefined`, the plugin automatically falls back to the default handler. This lets you selectively override specific cases while keeping default behavior for everything else.

### Option 2: Register after the fact

```javascript
const md = new MarkdownIt().use(confluencePlugin);

confluencePlugin.registerMacro(md, 'custom_token', (tokens, idx) => {
  return `<ac:structured-macro ac:name="my-macro">
    <ac:parameter ac:name="param">value</ac:parameter>
  </ac:structured-macro>`;
});
```

### Example: PlantUML and Mermaid

```javascript
const md = new MarkdownIt().use(confluencePlugin, {
  macros: {
    fence: (tokens, idx) => {
      const token = tokens[idx];
      
      if (token.info === 'plantuml') {
        return `<ac:structured-macro ac:name="plantuml">
          <ac:plain-text-body><![CDATA[${token.content}]]></ac:plain-text-body>
        </ac:structured-macro>`;
      }
      
      if (token.info === 'mermaid') {
        return `<ac:structured-macro ac:name="mermaid-macro">
          <ac:plain-text-body><![CDATA[${token.content}]]></ac:plain-text-body>
        </ac:structured-macro>`;
      }
      
      return null; // let the default code block handler take it
    }
  }
});
```

## HTML Passthrough

Sometimes you need to embed HTML that doesn't have a markdown equivalent (like SVG):

```markdown
# My Page

<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="40" fill="red" />
</svg>

Back to markdown.
```

The HTML just passes through as-is. Turn it off if you don't want this:

```javascript
const md = new MarkdownIt().use(confluencePlugin, {
  allowHtmlPassthrough: false
});
```

## How It Works

The plugin works in three phases:

1. **Preprocessing**: Transforms the markdown source before parsing (e.g. converts `[!info]` to blockquote format with hidden markers)

2. **Rendering**: Overrides markdown-it's renderer to output Confluence storage format instead of plain HTML

3. **Post-processing**: Cleans things up (removes markers, wraps cells with `<p>` tags, etc.)

## Migrating from Old Code

If you were using the old approach, the new plugin is already integrated:

```javascript
// Old way (still works but deprecated)
client.setupConfluenceMarkdownExtensions();
const storage = client.htmlToConfluenceStorage(html);

// New way
const storage = client.markdownToStorage(markdown);
```

## Examples

Check out `tests/convert.test.js` for working examples - look for the "markdown-confluence plugin" test suite which has comprehensive examples of all features.

## References

- [Confluence Storage Format](https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html)
- [markdown-it](https://github.com/markdown-it/markdown-it)
- [markdown-it Plugin Development](https://github.com/markdown-it/markdown-it/blob/master/docs/development.md)
