# Confluence CLI

A powerful command-line interface for Atlassian Confluence that allows you to read, search, and manage your Confluence content from the terminal.

## Features

- 📖 **Read pages** - Get page content in text or HTML format
- 🔍 **Search** - Find pages using Confluence's powerful search
- ℹ️ **Page info** - Get detailed information about pages
- 🏠 **List spaces** - View all available Confluence spaces
- ✏️ **Create pages** - Create new pages with support for Markdown, HTML, or Storage format
- 📝 **Update pages** - Update existing page content and titles
- 🛠️ **Edit workflow** - Export page content for editing and re-import
- 🔧 **Easy setup** - Simple configuration with environment variables or interactive setup

## Installation

```bash
npm install -g confluence-cli
```

Or run directly with npx:
```bash
npx confluence-cli
```

## Quick Start

1. **Initialize configuration:**
   ```bash
   confluence init
   ```

2. **Read a page:**
   ```bash
   confluence read 123456789
   ```

3. **Search for pages:**
   ```bash
   confluence search "my search term"
   ```

4. **Create a new page:**
   ```bash
   confluence create "My New Page" SPACEKEY --content "Hello World!"
   ```

5. **Update a page:**
   ```bash
   confluence update 123456789 --content "Updated content"
   ```

## Configuration

### Option 1: Interactive Setup
```bash
confluence init
```

### Option 2: Environment Variables
```bash
export CONFLUENCE_DOMAIN="your-domain.atlassian.net"
export CONFLUENCE_API_TOKEN="your-api-token"
```

### Getting Your API Token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label (e.g., "confluence-cli")
4. Copy the generated token

## Usage

### Read a Page
```bash
# Read by page ID
confluence read 123456789

# Read in HTML format
confluence read 123456789 --format html

# Read by URL
confluence read "https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/123456789/Page+Title"
```

### Create a New Page
```bash
# Create with inline content
confluence create "My New Page" SPACEKEY --content "This is my page content"

# Create from a file
confluence create "Documentation" SPACEKEY --file ./content.md --format markdown

# Create with HTML content
confluence create "Rich Content" SPACEKEY --file ./content.html --format html

# Create with Storage format (Confluence native)
confluence create "Advanced Page" SPACEKEY --file ./content.xml --format storage
```

### Create a Child Page
```bash
# Find parent page first
confluence find "Project Documentation" --space MYTEAM

# Create child page with inline content
confluence create-child "Meeting Notes" 123456789 --content "This is a child page"

# Create child page from file
confluence create-child "Technical Specifications" 123456789 --file ./content.md --format markdown

# Create child page with HTML content
confluence create-child "Report Summary" 123456789 --file ./content.html --format html
```

### Find Pages
```bash
# Find page by title
confluence find "Project Documentation"

# Find page by title in specific space
confluence find "Project Documentation" --space MYTEAM
```

### Update an Existing Page
```bash
# Update content only
confluence update 123456789 --content "Updated content"

# Update content from file
confluence update 123456789 --file ./updated-content.md --format markdown

# Update both title and content
confluence update 123456789 --title "New Title" --content "New content"

# Update from HTML file
confluence update 123456789 --file ./content.html --format html
```

### Edit Workflow
```bash
# Export page content for editing
confluence edit 123456789 --output ./page-content.xml

# Edit the file with your preferred editor
vim ./page-content.xml

# Update the page with your changes
confluence update 123456789 --file ./page-content.xml --format storage
```

# Read with HTML format
confluence read 123456789 --format html

# Read by URL (with pageId parameter)
confluence read "https://yourcompany.atlassian.net/wiki/spaces/SPACE/pages/123456789/Page+Title"
```

### Get Page Information
```bash
confluence info 123456789
```

### Search Pages
```bash
# Basic search
confluence search "search term"

# Limit results
confluence search "search term" --limit 5
```

### List Spaces
```bash
confluence spaces
```

### View Usage Statistics
```bash
confluence stats
```

## Commands

| Command | Description | Options |
|---------|-------------|---------|
| `init` | Initialize CLI configuration | - |
| `read <pageId>` | Read page content | `--format <html\|text>` |
| `info <pageId>` | Get page information | - |
| `search <query>` | Search for pages | `--limit <number>` |
| `spaces` | List all spaces | - |
| `stats` | View your usage statistics | - |

## Examples

```bash
# Setup
confluence init

# Read a page as text
confluence read 123456789

# Read a page as HTML
confluence read 123456789 --format html

# Get page details
confluence info 123456789

# Search with limit
confluence search "API documentation" --limit 3

# List all spaces
confluence spaces

# View usage statistics
confluence stats
```

## Development

```bash
# Clone the repository
git clone https://github.com/pchuri/confluence-cli.git
cd confluence-cli

# Install dependencies
npm install

# Run locally
npm start -- --help

# Run tests
npm test

# Lint code
npm run lint
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Roadmap

- [x] **Create and update pages** ✅
- [ ] Page templates
- [ ] Bulk operations
- [ ] Export pages to different formats
- [ ] Integration with other Atlassian tools (Jira)
- [ ] Page attachments management
- [ ] Comments and reviews

## Support & Feedback

### 💬 We'd love to hear from you!

Your feedback helps make confluence-cli better for everyone. Here's how you can share your thoughts:

#### 🐛 Found a bug?
1. Check the [Issues](https://github.com/pchuri/confluence-cli/issues) page
2. Create a new [bug report](https://github.com/pchuri/confluence-cli/issues/new?template=bug_report.md)

#### 💡 Have a feature idea?
1. Create a [feature request](https://github.com/pchuri/confluence-cli/issues/new?template=feature_request.md)
2. Join our [Discussions](https://github.com/pchuri/confluence-cli/discussions) to chat with the community

#### 📝 General feedback?
- Share your experience with a [feedback issue](https://github.com/pchuri/confluence-cli/issues/new?template=feedback.md)
- Rate us on [NPM](https://www.npmjs.com/package/confluence-cli)
- Star the repo if you find it useful! ⭐

#### 🤝 Want to contribute?
Check out our [Contributing Guide](CONTRIBUTING.md) - all contributions are welcome!

### 📈 Usage Analytics

To help us understand how confluence-cli is being used and improve it, we collect anonymous usage statistics. This includes:
- Command usage frequency (no personal data)
- Error patterns (to fix bugs faster)
- Feature adoption metrics

You can opt-out anytime by setting: `export CONFLUENCE_CLI_ANALYTICS=false`

---

Made with ❤️ for the Confluence community
