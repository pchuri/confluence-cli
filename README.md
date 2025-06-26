# Confluence CLI

A powerful command-line interface for Atlassian Confluence that allows you to read, search, and manage your Confluence content from the terminal.

## Features

- 📖 **Read pages** - Get page content in text or HTML format
- 🔍 **Search** - Find pages using Confluence's powerful search
- ℹ️ **Page info** - Get detailed information about pages
- 🏠 **List spaces** - View all available Confluence spaces
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

## Commands

| Command | Description | Options |
|---------|-------------|---------|
| `init` | Initialize CLI configuration | - |
| `read <pageId>` | Read page content | `--format <html\|text>` |
| `info <pageId>` | Get page information | - |
| `search <query>` | Search for pages | `--limit <number>` |
| `spaces` | List all spaces | - |

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
```

## Development

```bash
# Clone the repository
git clone https://github.com/yourusername/confluence-cli.git
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

- [ ] Create and update pages
- [ ] Page templates
- [ ] Bulk operations
- [ ] Export pages to different formats
- [ ] Integration with other Atlassian tools (Jira)
- [ ] Page attachments management
- [ ] Comments and reviews

## Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/yourusername/confluence-cli/issues) page
2. Create a new issue if your problem isn't already reported
3. Provide detailed information about your environment and the issue

---

Made with ❤️ for the Confluence community
