# Confluence CLI

A powerful command-line interface for Atlassian Confluence that allows you to read, search, and manage your Confluence content from the terminal.

## Features

- 📖 **Read pages** - Get page content in text or HTML format
- 🔍 **Search** - Find pages using Confluence's powerful search
- ℹ️ **Page info** - Get detailed information about pages
- 🏠 **List spaces** - View all available Confluence spaces
- ✏️ **Create pages** - Create new pages with support for Markdown, HTML, or Storage format
- 📝 **Update pages** - Update existing page content and titles
- 🗑️ **Delete pages** - Delete (or move to trash) pages by ID or URL
- 📎 **Attachments** - List or download page attachments
- 💬 **Comments** - List, create, and delete page comments (footer or inline)
- 📦 **Export** - Save a page and its attachments to a local folder
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

4. **List child pages:**
   ```bash
   confluence children 123456789
   ```

5. **Create a new page:**
   ```bash
   confluence create "My New Page" SPACEKEY --content "Hello World!"
   ```

6. **Update a page:**
   ```bash
   confluence update 123456789 --content "Updated content"
   ```

## Configuration

### Option 1: Interactive Setup
```bash
confluence init
```

The wizard helps you choose the right API endpoint and authentication method. It recommends `/wiki/rest/api` for Atlassian Cloud domains (e.g., `*.atlassian.net`) and `/rest/api` for self-hosted/Data Center instances, then prompts for Basic (email + token) or Bearer authentication.

### Option 2: Non-interactive Setup (CLI Flags)

Provide all required configuration via command-line flags. Perfect for CI/CD pipelines, Docker builds, and AI coding agents.

**Complete non-interactive mode** (all required fields provided):
```bash
confluence init \
  --domain "company.atlassian.net" \
  --api-path "/wiki/rest/api" \
  --auth-type "basic" \
  --email "user@example.com" \
  --token "your-api-token"
```

**Hybrid mode** (some fields provided, rest via prompts):
```bash
# Domain and token provided, will prompt for auth method and email
confluence init --domain "company.atlassian.net" --token "your-api-token"

# Email indicates basic auth, will prompt for domain and token
confluence init --email "user@example.com" --token "your-api-token"
```

**Available flags:**
- `-d, --domain <domain>` - Confluence domain (e.g., `company.atlassian.net`)
- `-p, --api-path <path>` - REST API path (e.g., `/wiki/rest/api`)
- `-a, --auth-type <type>` - Authentication type: `basic` or `bearer`
- `-e, --email <email>` - Email for basic authentication
- `-t, --token <token>` - API token

⚠️ **Security note:** While flags work, storing tokens in shell history is risky. Prefer environment variables (Option 3) for production environments.

### Option 3: Environment Variables
```bash
export CONFLUENCE_DOMAIN="your-domain.atlassian.net"
export CONFLUENCE_API_TOKEN="your-api-token"
export CONFLUENCE_EMAIL="your.email@example.com"  # required when using basic auth
export CONFLUENCE_API_PATH="/wiki/rest/api"         # Cloud default; use /rest/api for Server/DC
# Optional: set to 'bearer' for self-hosted/Data Center instances
export CONFLUENCE_AUTH_TYPE="basic"
```

`CONFLUENCE_API_PATH` defaults to `/wiki/rest/api` for Atlassian Cloud domains and `/rest/api` otherwise. Override it when your site lives under a custom reverse proxy or on-premises path. `CONFLUENCE_AUTH_TYPE` defaults to `basic` when an email is present and falls back to `bearer` otherwise.

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

# Read in markdown format
confluence read 123456789 --format markdown

# Read by URL (must contain pageId parameter)
confluence read "https://your-domain.atlassian.net/wiki/viewpage.action?pageId=123456789"
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

### List or Download Attachments
```bash
# List all attachments on a page
confluence attachments 123456789

# Filter by filename and limit the number returned
confluence attachments 123456789 --pattern "*.png" --limit 5

# Download matching attachments to a directory
confluence attachments 123456789 --pattern "*.png" --download --dest ./downloads
```

### Comments
```bash
# List all comments (footer + inline)
confluence comments 123456789

# List inline comments as markdown
confluence comments 123456789 --location inline --format markdown

# Create a footer comment
confluence comment 123456789 --content "Looks good to me!"

# Create an inline comment
confluence comment 123456789 \
  --location inline \
  --content "Consider renaming this" \
  --inline-selection "foo" \
  --inline-original-selection "foo"

# Reply to a comment
confluence comment 123456789 --parent 998877 --content "Agree with this"

# Delete a comment
confluence comment-delete 998877
```

Inline comment creation note (Confluence Cloud): Creating inline comments requires editor-generated highlight metadata (`matchIndex`, `lastFetchTime`, `serializedHighlights`, plus the selection text). The public REST API does not provide these fields, so inline creation and inline replies can fail with a 400 unless you supply the full `--inline-properties` payload captured from the editor. Footer comments and replies are fully supported.

### Export a Page with Attachments
```bash
# Export page content (markdown by default) and all attachments
confluence export 123456789 --dest ./exports

# Custom content format/filename and attachment filtering
confluence export 123456789 --format html --file content.html --pattern "*.png"

# Skip attachments if you only need the content file
confluence export 123456789 --skip-attachments
```

### List Spaces
```bash
confluence spaces
```

### List Child Pages
```bash
# List direct child pages
confluence children 123456789

# List all descendants recursively
confluence children 123456789 --recursive

# Display as tree structure
confluence children 123456789 --recursive --format tree

# Show page IDs and URLs
confluence children 123456789 --show-id --show-url

# Limit recursion depth
confluence children 123456789 --recursive --max-depth 3

# Output as JSON for scripting
confluence children 123456789 --recursive --format json > children.json
```

### Find a Page by Title
```bash
# Find page by title
confluence find "Project Documentation"

# Find page by title in a specific space
confluence find "Project Documentation" --space MYTEAM
```

### Create a New Page
```bash
# Create with inline content and markdown format
confluence create "My New Page" SPACEKEY --content "**Hello** World!" --format markdown

# Create from a file
confluence create "Documentation" SPACEKEY --file ./content.md --format markdown
```

### Create a Child Page
```bash
# Create child page with inline content
confluence create-child "Meeting Notes" 123456789 --content "This is a child page"

# Create child page from a file
confluence create-child "Tech Specs" 123456789 --file ./specs.md --format markdown
```

### Copy Page Tree
```bash
# Copy a page and all its children to a new location
confluence copy-tree 123456789 987654321 "Project Docs (Copy)"

# Copy with maximum depth limit (only 3 levels deep)
confluence copy-tree 123456789 987654321 --max-depth 3

# Exclude pages by title (supports wildcards * and ?; case-insensitive)
confluence copy-tree 123456789 987654321 --exclude "temp*,test*,*draft*"

# Control pacing and naming
confluence copy-tree 123456789 987654321 --delay-ms 150 --copy-suffix " (Backup)"

# Dry run (preview only)
confluence copy-tree 123456789 987654321 --dry-run

# Quiet mode (suppress progress output)
confluence copy-tree 123456789 987654321 --quiet
```

Notes:
- Preserves the original parent-child hierarchy when copying.
- Continues on errors: failed pages are logged and the copy proceeds.
- Exclude patterns use simple globbing: `*` matches any sequence, `?` matches any single character, and special regex characters are treated literally.
- Large trees may take time; the CLI applies a small delay between sibling page creations to avoid rate limits (configurable via `--delay-ms`).
- Root title suffix defaults to ` (Copy)`; override with `--copy-suffix`. Child pages keep their original titles.
- Use `--fail-on-error` to exit non-zero if any page fails to copy.

### Update an Existing Page
```bash
# Update title only
confluence update 123456789 --title "A Newer Title for the Page"

# Update content only from a string
confluence update 123456789 --content "Updated page content."

# Update content from a file
confluence update 123456789 --file ./updated-content.md --format markdown

# Update both title and content
confluence update 123456789 --title "New Title" --content "And new content"
```

### Delete a Page
```bash
# Delete by page ID (prompts for confirmation)
confluence delete 123456789

# Delete by URL
confluence delete "https://your-domain.atlassian.net/wiki/viewpage.action?pageId=123456789"

# Skip confirmation (useful for scripts)
confluence delete 123456789 --yes
```

### Edit Workflow
The `edit` and `update` commands work together to create a seamless editing workflow.
```bash
# 1. Export page content to a file (in Confluence storage format)
confluence edit 123456789 --output ./page-to-edit.xml

# 2. Edit the file with your preferred editor
vim ./page-to-edit.xml

# 3. Update the page with your changes
confluence update 123456789 --file ./page-to-edit.xml --format storage
```

### View Usage Statistics
```bash
confluence stats
```

## Commands

| Command | Description | Options |
|---|---|---|
| `init` | Initialize CLI configuration | |
| `read <pageId_or_url>` | Read page content | `--format <html\|text\|markdown>` |
| `info <pageId_or_url>` | Get page information | |
| `search <query>` | Search for pages | `--limit <number>` |
| `spaces` | List all available spaces | |
| `find <title>` | Find a page by its title | `--space <spaceKey>` |
| `children <pageId>` | List child pages of a page | `--recursive`, `--max-depth <number>`, `--format <list\|tree\|json>`, `--show-url`, `--show-id` |
| `create <title> <spaceKey>` | Create a new page | `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>`|
| `create-child <title> <parentId>` | Create a child page | `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>` |
| `copy-tree <sourcePageId> <targetParentId> [newTitle]` | Copy page tree with all children | `--max-depth <number>`, `--exclude <patterns>`, `--delay-ms <ms>`, `--copy-suffix <text>`, `--dry-run`, `--fail-on-error`, `--quiet` |
| `update <pageId>` | Update a page's title or content | `--title <string>`, `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>` |
| `delete <pageId_or_url>` | Delete a page by ID or URL | `--yes` |
| `edit <pageId>` | Export page content for editing | `--output <file>` |
| `attachments <pageId_or_url>` | List or download attachments for a page | `--limit <number>`, `--pattern <glob>`, `--download`, `--dest <directory>` |
| `comments <pageId_or_url>` | List comments for a page | `--format <text\|markdown\|json>`, `--limit <number>`, `--start <number>`, `--location <inline\|footer\|resolved>`, `--depth <root\|all>`, `--all` |
| `comment <pageId_or_url>` | Create a comment on a page | `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>`, `--parent <commentId>`, `--location <inline\|footer>`, `--inline-selection <text>`, `--inline-original-selection <text>`, `--inline-marker-ref <ref>`, `--inline-properties <json>` |
| `comment-delete <commentId>` | Delete a comment by ID | `--yes` |
| `export <pageId_or_url>` | Export a page to a directory with its attachments | `--format <html\|text\|markdown>`, `--dest <directory>`, `--file <filename>`, `--attachments-dir <name>`, `--pattern <glob>`, `--referenced-only`, `--skip-attachments` |
| `stats` | View your usage statistics | |

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
- [x] Comments
- [ ] Reviews

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
