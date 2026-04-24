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
- 📎 **Attachments** - List, download, upload, or delete page attachments
- 🏷️ **Properties** - List, get, set, and delete content properties (key-value metadata)
- 💬 **Comments** - List, create, and delete page comments (footer or inline)
- 📦 **Export** - Save a page and its attachments to a local folder
- 🛠️ **Edit workflow** - Export page content for editing and re-import
- 🔀 **Profiles** - Manage multiple Confluence instances with named configuration profiles
- 🔒 **Read-only mode** - Profile-level write protection for safe AI agent usage
- 🔄 **Format conversion** - Convert between Markdown, HTML, Storage, and text formats locally (no server required)
- 🔧 **Easy setup** - Simple configuration with environment variables or interactive setup

## Installation

### Homebrew (macOS/Linux)

```bash
brew install pchuri/tap/confluence-cli
```

### npm

```bash
npm install -g confluence-cli
```

Or run directly with npx:
```bash
npx confluence-cli
```

## Claude Code Integration

confluence-cli ships as a [Claude Code plugin](https://docs.anthropic.com/en/docs/claude-code/plugins). Once installed, Claude Code understands all confluence-cli commands automatically and receives updates when the skill is improved.

### Option 1: Install as Plugin (recommended)

Add the marketplace and install the plugin:

```bash
/plugin marketplace add pchuri/confluence-cli
/plugin install confluence@pchuri-confluence-cli
```

### Option 2: Install Skill manually

If you prefer not to use the plugin system, copy the skill documentation into your project:

```bash
confluence install-skill
```

This creates `.claude/skills/confluence/SKILL.md` in your current directory. Claude Code picks it up automatically.

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

The wizard helps you choose the right API endpoint and authentication method. It recommends `/wiki/rest/api` for Atlassian Cloud domains (e.g., `*.atlassian.net`) and `/rest/api` for self-hosted/Data Center instances, then prompts for Basic (email/username + token/password), Bearer, or client-certificate (mTLS) authentication.

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

**Scoped API token** (recommended for agents — least privilege):
```bash
# Replace <your-cloud-id> with your actual Cloud ID
confluence init \
  --domain "api.atlassian.com" \
  --api-path "/ex/confluence/<your-cloud-id>/wiki/rest/api" \
  --auth-type "basic" \
  --email "user@example.com" \
  --token "your-scoped-token"
```

**Named profile** (save to a specific profile):
```bash
confluence --profile staging init \
  --domain "staging.example.com" \
  --api-path "/rest/api" \
  --auth-type "bearer" \
  --token "your-personal-access-token"
```

**mTLS profile** (self-hosted or reverse-proxied Confluence APIs):
```bash
confluence --profile corp init \
  --domain "docs.example.com" \
  --api-path "/confluence/rest/api" \
  --auth-type "mtls" \
  --tls-client-cert "~/.certs/client.pem" \
  --tls-client-key "~/.certs/client.key" \
  --tls-ca-cert "~/.certs/ca-chain.pem"
```

**Cookie authentication profile** (Enterprise SSO):
```bash
confluence --profile sso init \
  --domain "confluence.company.com" \
  --api-path "/rest/api" \
  --auth-type "cookie" \
  --cookie "JSESSIONID=abc123xyz..."

# Multiple cookies are also supported:
confluence --profile sso init \
  --domain "confluence.company.com" \
  --auth-type "cookie" \
  --cookie "JSESSIONID=abc123; XSRF-TOKEN=xyz789"
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
- `-a, --auth-type <type>` - Authentication type: `basic`, `bearer`, `mtls`, or `cookie`
- `-e, --email <email>` - Email or username for basic authentication
- `-t, --token <token>` - API token or password
- `-c, --cookie <cookie>` - Cookie for Enterprise SSO authentication (e.g., `"JSESSIONID=..."`)
- `--tls-client-cert <path>` - Client certificate for mTLS authentication
- `--tls-client-key <path>` - Client private key for mTLS authentication
- `--tls-ca-cert <path>` - Optional CA certificate chain for mTLS authentication
- `--read-only` - Enable read-only mode (blocks all write operations)

⚠️ **Security note:** While flags work, storing tokens in shell history is risky. Prefer environment variables (Option 3) for production environments.

### Option 3: Environment Variables
```bash
export CONFLUENCE_DOMAIN="your-domain.atlassian.net"
export CONFLUENCE_API_TOKEN="your-api-token"      # or password for on-premise (alias: CONFLUENCE_PASSWORD)
export CONFLUENCE_EMAIL="your.email@example.com"  # required for basic auth (alias: CONFLUENCE_USERNAME for on-premise)
export CONFLUENCE_API_PATH="/wiki/rest/api"         # Cloud default; use /rest/api for Server/DC
# Optional: set to 'bearer' for self-hosted/Data Center instances
export CONFLUENCE_AUTH_TYPE="basic"
# Optional: select a named profile (overridden by --profile flag)
export CONFLUENCE_PROFILE="default"
```

**mTLS environment variables**:
```bash
export CONFLUENCE_DOMAIN="docs.example.com"
export CONFLUENCE_API_PATH="/confluence/rest/api"
export CONFLUENCE_AUTH_TYPE="mtls"
export CONFLUENCE_TLS_CLIENT_CERT="~/.certs/client.pem"
export CONFLUENCE_TLS_CLIENT_KEY="~/.certs/client.key"
export CONFLUENCE_TLS_CA_CERT="~/.certs/ca-chain.pem"  # optional
```

**Cookie environment variables** (Enterprise SSO):
```bash
export CONFLUENCE_DOMAIN="confluence.company.com"
export CONFLUENCE_API_PATH="/rest/api"
export CONFLUENCE_AUTH_TYPE="cookie"
export CONFLUENCE_COOKIE="JSESSIONID=abc123xyz..."
```

**Scoped API token** (recommended for agents):
```bash
export CONFLUENCE_DOMAIN="api.atlassian.com"
export CONFLUENCE_API_PATH="/ex/confluence/<your-cloud-id>/wiki/rest/api"
export CONFLUENCE_AUTH_TYPE="basic"
export CONFLUENCE_EMAIL="user@example.com"
export CONFLUENCE_API_TOKEN="your-scoped-token"
```

`CONFLUENCE_API_PATH` defaults to `/wiki/rest/api` for Atlassian Cloud domains and `/rest/api` otherwise. Override it when your site lives under a custom reverse proxy or on-premises path. `CONFLUENCE_AUTH_TYPE` defaults to `basic` when an email is present and falls back to `bearer` otherwise. For `mtls`, set `CONFLUENCE_TLS_CLIENT_CERT` and `CONFLUENCE_TLS_CLIENT_KEY`; `CONFLUENCE_TLS_CA_CERT` is optional.

**Custom domains on Confluence Cloud:**

If your Confluence Cloud instance uses a custom domain (e.g., `wiki.example.org` instead of `*.atlassian.net`), the CLI may misidentify it as a Server/Data Center instance and produce broken link formats. Set `CONFLUENCE_FORCE_CLOUD=true` to override the automatic detection:

```bash
export CONFLUENCE_FORCE_CLOUD=true
```

Or add `"forceCloud": true` to your profile in `~/.confluence-cli/config.json`:

```json
{
  "profiles": {
    "default": {
      "domain": "wiki.example.org",
      "forceCloud": true
    }
  }
}
```

**Link rendering on Cloud (`linkStyle`):**

Some Cloud instances — particularly custom-domain Cloud setups — fail to render smart links (`<a data-card-appearance="inline">`) and show "Cannot handle: DefaultLink" errors instead. If you hit this, set `linkStyle` to `plain` to emit simple `<a href>` tags, which render reliably everywhere:

```bash
export CONFLUENCE_LINK_STYLE=plain
```

Or per-profile:

```json
{
  "profiles": {
    "default": {
      "domain": "wiki.example.org",
      "forceCloud": true,
      "linkStyle": "plain"
    }
  }
}
```

Valid values: `smart` (Cloud smart links), `plain` (simple `<a href>`), `wiki` (Server/DC `ac:link`). When unset, the CLI picks `smart` for Cloud and `wiki` for Server/DC — existing behavior is unchanged.

**Read-only mode** (recommended for AI agents):
```bash
export CONFLUENCE_READ_ONLY=true
```
When set, all write operations (`create`, `update`, `delete`, etc.) are blocked at the CLI level. The environment variable overrides the profile's `readOnly` setting.

### Getting Your API Token

**Atlassian Cloud:**
1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label (e.g., "confluence-cli")
4. Copy the generated token

**Atlassian Cloud — Scoped API Token** (recommended for agents and automation):

Scoped tokens restrict access to specific Atlassian products and permissions, following the principle of least privilege. They use a different API gateway (`api.atlassian.com`) instead of your site domain.

1. Create a scoped token in your [Atlassian Admin settings](https://admin.atlassian.com)
2. Find your Cloud ID by visiting `https://<your-site>.atlassian.net/_edge/tenant_info`
3. Configure with:
   - **Domain:** `api.atlassian.com`
   - **API path:** `/ex/confluence/<your-cloud-id>/wiki/rest/api`
   - **Auth type:** `basic` (email + scoped token)

**Required scopes for scoped API tokens:**

When creating a scoped token, select the following [classic scopes](https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/) based on your needs:

| Scope | Required for |
|-------|-------------|
| `read:confluence-content.all` | Reading pages and blog posts (`read`, `info`) |
| `read:confluence-content.summary` | Reading content summaries and metadata (`read`, `info`) |
| `read:confluence-space.summary` | Listing spaces (`spaces`) |
| `search:confluence` | Searching content (`search`) |
| `readonly:content.attachment:confluence` | Downloading attachments (`attachments --download`) |
| `write:confluence-content` | Creating and updating pages (`create`, `update`) |
| `write:confluence-file` | Uploading attachments (`attachments --upload`) |
| `write:confluence-space` | Managing spaces |

For **read-only** usage, select at minimum: `read:confluence-content.all`, `read:confluence-content.summary`, `read:confluence-space.summary`, and `search:confluence`.

**On-premise / Data Center:** Use your Confluence username and password for basic authentication.

**mTLS-protected Confluence APIs:** Some self-hosted or reverse-proxied deployments authenticate at the TLS layer with a client certificate instead of sending an application-level token. In these environments, configure `authType=mtls` and provide certificate paths via CLI flags or environment variables. No `Authorization` header will be sent in mTLS mode.

**Enterprise SSO with Cookie Authentication:** For Confluence instances behind Enterprise SSO (SAML, OAuth, Okta, etc.) where API tokens or Basic/Bearer auth are not available, you can authenticate using session cookies. After logging in through your browser, extract the session cookie (typically `JSESSIONID` or similar) from your browser's dev tools and configure it via the `--cookie` flag or `CONFLUENCE_COOKIE` environment variable. The cookie is sent in the `Cookie` header instead of an `Authorization` header. Note that session cookies typically expire, so you'll need to refresh them periodically. For security, prefer `CONFLUENCE_COOKIE` env var or interactive prompt over `--cookie` flag since command-line arguments may be visible in shell history and process listings.

## Usage

### Read a Page
```bash
# Read by page ID
confluence read 123456789

# Read native Confluence storage content
confluence read 123456789 --format storage

# Read in markdown format
confluence read 123456789 --format markdown

# Read by URL (must contain pageId parameter)
confluence read "https://your-domain.atlassian.net/wiki/viewpage.action?pageId=123456789"
```

Use `--format storage` when you need Confluence's native storage representation, especially for macros and other Confluence-specific markup.

### Get Page Information
```bash
confluence info 123456789

# Emit machine-readable metadata
confluence info 123456789 --format json
```

Example JSON shape:
```json
{
  "id": "123456789",
  "title": "Architecture Overview",
  "type": "page",
  "status": "current",
  "spaceKey": "ENG",
  "parentId": "100200300",
  "version": 7,
  "url": "https://your-domain.atlassian.net/wiki/spaces/ENG/pages/123456789/Architecture+Overview"
}
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

### Upload Attachments
```bash
# Upload a single attachment
confluence attachment-upload 123456789 --file ./report.pdf

# Upload multiple files with a comment
confluence attachment-upload 123456789 --file ./a.pdf --file ./b.png --comment "v2"

# Replace an existing attachment by filename
confluence attachment-upload 123456789 --file ./diagram.png --replace
```

### Delete Attachments
```bash
# Delete an attachment by ID
confluence attachment-delete 123456789 998877

# Skip confirmation
confluence attachment-delete 123456789 998877 --yes
```

### Content Properties
```bash
# List all properties on a page
confluence property-list 123456789

# Get a specific property
confluence property-get 123456789 my-key

# Set a property (creates or updates with auto-versioning)
confluence property-set 123456789 my-key --value '{"color":"#ff0000"}'

# Set a property from a JSON file
confluence property-set 123456789 my-key --file ./property.json

# Delete a property
confluence property-delete 123456789 my-key

# Skip confirmation on delete
confluence property-delete 123456789 my-key --yes
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

`children --format json` returns structured metadata for each page, including `id`, `title`, `type`, `status`, `spaceKey`, `parentId`, `version`, and `url`. Recursive output also includes `depth`, and when available, `ancestors`.

Example recursive JSON item:
```json
{
  "pageId": "123456789",
  "childCount": 2,
  "children": [
    {
      "id": "200300400",
      "title": "Child Page",
      "type": "page",
      "status": "current",
      "spaceKey": "ENG",
      "parentId": "123456789",
      "version": 4,
      "url": "https://your-domain.atlassian.net/wiki/spaces/ENG/pages/200300400/Child+Page",
      "depth": 1,
      "ancestors": [
        {
          "id": "123456789",
          "type": "page",
          "title": "Architecture Overview"
        }
      ]
    }
  ]
}
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

### Move a Page to New Parent

```bash
# Move page by ID
confluence move 123456789 987654321

# Move page and rename it
confluence move 123456789 987654321 --title "Relocated Page"

# Move using URLs (for convenience)
confluence move "https://domain.atlassian.net/wiki/viewpage.action?pageId=123456789" \
                "https://domain.atlassian.net/wiki/viewpage.action?pageId=987654321"
```

**Note:** Pages can only be moved within the same Confluence space. Cross-space moves are not supported.

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

### Profile Management
```bash
# List all profiles and see which is active
confluence profile list

# Switch the active profile
confluence profile use staging

# Add a new profile interactively
confluence profile add staging

# Add a new profile non-interactively
confluence profile add staging --domain "staging.example.com" --auth-type bearer --token "xyz"

# Add a read-only profile (blocks all write operations)
confluence profile add agent --domain "company.atlassian.net" --auth-type basic --email "bot@example.com" --token "xyz" --read-only

# Remove a profile
confluence profile remove staging

# Use a specific profile for a single command
confluence --profile staging spaces
```

### Read-Only Mode

Read-only mode blocks all write operations at the CLI level, making it safe to hand the tool to AI agents (Claude Code, Copilot, etc.) without risking accidental edits.

**Enable via profile:**
```bash
# During init
confluence init --read-only

# When adding a profile
confluence profile add agent --domain "company.atlassian.net" --token "xyz" --read-only
```

**Enable via environment variable:**
```bash
export CONFLUENCE_READ_ONLY=true   # overrides profile setting
```

When read-only mode is active, any write command (`create`, `create-child`, `update`, `delete`, `move`, `edit`, `comment`, `attachment-upload`, `attachment-delete`, `property-set`, `property-delete`, `comment-delete`, `copy-tree`) exits with code 1 and prints an error message.

`confluence profile list` shows a `[read-only]` badge next to protected profiles.

### View Usage Statistics
```bash
confluence stats
```

## Commands

| Command | Description | Options |
|---|---|---|
| `init` | Initialize CLI configuration | `--read-only` |
| `read <pageId_or_url>` | Read page content | `--format <html\|text\|storage\|markdown>` |
| `info <pageId_or_url>` | Get page information | `--format <text\|json>` |
| `search <query>` | Search for pages | `--limit <number>` |
| `spaces` | List all available spaces | |
| `find <title>` | Find a page by its title | `--space <spaceKey>` |
| `children <pageId>` | List child pages of a page | `--recursive`, `--max-depth <number>`, `--format <list\|tree\|json>`, `--show-url`, `--show-id` |
| `create <title> <spaceKey>` | Create a new page | `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>`|
| `create-child <title> <parentId>` | Create a child page | `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>` |
| `copy-tree <sourcePageId> <targetParentId> [newTitle]` | Copy page tree with all children | `--max-depth <number>`, `--exclude <patterns>`, `--delay-ms <ms>`, `--copy-suffix <text>`, `--dry-run`, `--fail-on-error`, `--quiet` |
| `update <pageId>` | Update a page's title or content | `--title <string>`, `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>` |
| `move <pageId_or_url> <newParentId_or_url>` | Move a page to a new parent location | `--title <string>` |
| `delete <pageId_or_url>` | Delete a page by ID or URL | `--yes` |
| `edit <pageId>` | Export page content for editing | `--output <file>` |
| `attachments <pageId_or_url>` | List or download attachments for a page | `--limit <number>`, `--pattern <glob>`, `--download`, `--dest <directory>` |
| `attachment-upload <pageId_or_url>` | Upload attachments to a page | `--file <path>`, `--comment <text>`, `--replace`, `--minor-edit` |
| `attachment-delete <pageId_or_url> <attachmentId>` | Delete an attachment from a page | `--yes` |
| `comments <pageId_or_url>` | List comments for a page | `--format <text\|markdown\|json>`, `--limit <number>`, `--start <number>`, `--location <inline\|footer\|resolved>`, `--depth <root\|all>`, `--all` |
| `comment <pageId_or_url>` | Create a comment on a page | `--content <string>`, `--file <path>`, `--format <storage\|html\|markdown>`, `--parent <commentId>`, `--location <inline\|footer>`, `--inline-selection <text>`, `--inline-original-selection <text>`, `--inline-marker-ref <ref>`, `--inline-properties <json>` |
| `comment-delete <commentId>` | Delete a comment by ID | `--yes` |
| `property-list <pageId_or_url>` | List all content properties for a page | `--format <text\|json>`, `--limit <number>`, `--start <number>`, `--all` |
| `property-get <pageId_or_url> <key>` | Get a content property by key | `--format <text\|json>` |
| `property-set <pageId_or_url> <key>` | Set a content property (create or update) | `--value <json>`, `--file <path>`, `--format <text\|json>` |
| `property-delete <pageId_or_url> <key>` | Delete a content property by key | `--yes` |
| `export <pageId_or_url>` | Export a page to a directory with its attachments | `--format <html\|text\|markdown>`, `--dest <directory>`, `--file <filename>`, `--attachments-dir <name>`, `--pattern <glob>`, `--referenced-only`, `--skip-attachments` |
| `profile list` | List all configuration profiles | |
| `profile use <name>` | Set the active configuration profile | |
| `profile add <name>` | Add a new configuration profile | `-d, --domain`, `-p, --api-path`, `-a, --auth-type`, `-e, --email`, `-t, --token`, `--protocol`, `--read-only` |
| `profile remove <name>` | Remove a configuration profile | |
| `convert` | Convert between content formats locally (no server required) | `--input-file <path>`, `--output-file <path>`, `--input-format <markdown\|storage\|html>`, `--output-format <markdown\|storage\|html\|text>` |
| `stats` | View your usage statistics | |

**Global option:** `--profile <name>` — Use a specific profile for any command (overrides `CONFLUENCE_PROFILE` env var and active profile).

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

# Move a page to a new parent
confluence move 123456789 987654321

# Move and rename
confluence move 123456789 987654321 --title "New Title"

# Upload and delete an attachment
confluence attachment-upload 123456789 --file ./report.pdf
confluence attachment-delete 123456789 998877 --yes

# View usage statistics
confluence stats

# Profile management
confluence profile list
confluence profile use staging
confluence --profile staging spaces

# Convert markdown to Confluence storage format (no server required)
confluence convert --input-file doc.md --input-format markdown --output-format storage

# Pipe conversion via stdin/stdout
echo "# Hello" | confluence convert --input-format markdown --output-format storage

# Convert storage format back to markdown
confluence convert -i page.xml -o page.md --input-format storage --output-format markdown
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
- [x] Page attachments management (list, download, upload, delete)
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

confluence-cli tracks command usage statistics **locally** on your machine (`~/.confluence-cli/stats.json`). No data is sent to any external server. This includes:
- Command usage counts (success/error)

You can view your stats with `confluence stats`, or disable tracking by setting: `export CONFLUENCE_CLI_ANALYTICS=false`

---

Made with ❤️ for the Confluence community
