---
name: confluence
description: Use confluence-cli to read, search, create, update, move, and delete Confluence pages and attachments from the terminal.
---

# confluence-cli Skill

A CLI tool for Atlassian Confluence. Lets you read, search, create, update, move, and delete pages and attachments from the terminal or from an agent.

## Installation

```sh
npm install -g confluence-cli
confluence --version   # verify install
```

## Configuration

**Preferred for agents — environment variables (no interactive prompt):**

| Variable | Description | Example |
|---|---|---|
| `CONFLUENCE_DOMAIN` | Your Confluence hostname | `company.atlassian.net` |
| `CONFLUENCE_API_PATH` | REST API base path | `/wiki/rest/api` (Cloud) or `/rest/api` (Server/DC) |
| `CONFLUENCE_AUTH_TYPE` | `basic` or `bearer` | `basic` |
| `CONFLUENCE_EMAIL` | Email address (basic auth only) | `user@company.com` |
| `CONFLUENCE_API_TOKEN` | API token or personal access token | `ATATT3x...` |
| `CONFLUENCE_PROFILE` | Named profile to use (optional) | `staging` |
| `CONFLUENCE_READ_ONLY` | Block all write operations when `true` | `true` |

**Global `--profile` flag (use a named profile for any command):**

```sh
confluence --profile <name> <command>
```

Config resolution works in two stages:
- **Direct env config:** If both `CONFLUENCE_DOMAIN` and `CONFLUENCE_API_TOKEN` are set, they are used directly and the config file / profiles are not consulted.
- **Profile-based config:** Otherwise, a profile is selected in this order: `--profile` flag > `CONFLUENCE_PROFILE` env > `activeProfile` in config > `default`.

**Non-interactive init (good for CI/CD scripts):**

```sh
confluence init \
  --domain "company.atlassian.net" \
  --api-path "/wiki/rest/api" \
  --auth-type basic \
  --email "user@company.com" \
  --token "ATATT3x..."
```

**Cloud vs Server/DC:**
- Atlassian Cloud (`*.atlassian.net`): use `--api-path "/wiki/rest/api"`, auth type `basic` with email + API token
- Atlassian Cloud (scoped token): use `--domain "api.atlassian.com"`, `--api-path "/ex/confluence/<your-cloud-id>/wiki/rest/api"`, auth type `basic` with email + scoped token. Get your Cloud ID from `https://<your-site>.atlassian.net/_edge/tenant_info`. Recommended for agents (least privilege).
- Self-hosted / Data Center: use `--api-path "/rest/api"`, auth type `bearer` with a personal access token (no email needed)

**Scoped API token for agents (recommended):**

```sh
export CONFLUENCE_DOMAIN="api.atlassian.com"
export CONFLUENCE_API_PATH="/ex/confluence/<your-cloud-id>/wiki/rest/api"
export CONFLUENCE_AUTH_TYPE="basic"
export CONFLUENCE_EMAIL="user@company.com"
export CONFLUENCE_API_TOKEN="your-scoped-token"
```

Required classic scopes for scoped tokens:
- Read-only: `read:confluence-content.all`, `read:confluence-content.summary`, `read:confluence-space.summary`, `search:confluence`
- Write: add `write:confluence-content`, `write:confluence-file`, `write:confluence-space`
- Attachments: `readonly:content.attachment:confluence` (download), `write:confluence-file` (upload)

**Read-only mode (recommended for AI agents):**

Prevents all write operations (create, update, delete, move, etc.) at the profile level. Useful when giving an AI agent access to Confluence for reading only.

```sh
# Via profile flag
confluence profile add agent --domain "company.atlassian.net" --token "xxx" --read-only

# Via environment variable (overrides config file)
export CONFLUENCE_READ_ONLY=true
```

When read-only mode is active, any write command exits with an error:
```
Error: This profile is in read-only mode. Write operations are not allowed.
```

`profile list` shows read-only profiles with a `[read-only]` badge.

---

## Page ID Resolution

Most commands accept `<pageId>` — a numeric ID or any of the supported URL formats below.

**Supported formats:**

| Format | Example |
|---|---|
| Numeric ID | `123456789` |
| `?pageId=` URL | `https://company.atlassian.net/wiki/viewpage.action?pageId=123456789` |
| Pretty `/pages/<id>` URL | `https://company.atlassian.net/wiki/spaces/SPACE/pages/123456789/Page+Title` |
| Display `/display/<space>/<title>` URL | `https://company.atlassian.net/wiki/display/SPACE/Page+Title` |

```sh
confluence read 123456789
confluence read "https://company.atlassian.net/wiki/viewpage.action?pageId=123456789"
confluence read "https://company.atlassian.net/wiki/spaces/MYSPACE/pages/123456789/My+Page"
```

> **Note:** Display-style URLs (`/display/<space>/<title>`) perform a title-based lookup, so the page title in the URL must match exactly. When possible, prefer numeric IDs or `/pages/<id>` URLs for reliability.

## Content Formats

| Format | Notes |
|---|---|
| `markdown` | Recommended for agent-generated content. Automatically converted by the API. |
| `storage` | Confluence XML storage format (default for create/update). Use for programmatic round-trips. |
| `html` | Raw HTML. |
| `text` | Plain text — for read/export output only, not for creation. |

---

## Commands Reference

### `init`

Initialize configuration. Saves credentials to `~/.confluence-cli/config.json`.

```sh
confluence init [--domain <domain>] [--api-path <path>] [--auth-type basic|bearer] [--email <email>] [--token <token>] [--read-only]
```

All flags are optional; omitting any flag triggers an interactive prompt for that field. Provide all flags to run fully non-interactive. Use the global `--profile` flag to save to a named profile:

```sh
confluence --profile staging init --domain "staging.example.com" --auth-type bearer --token "your-token"
```

---

### `read <pageId>`

Read page content. Outputs to stdout.

```sh
confluence read <pageId> [--format html|text|markdown]
```

| Option | Default | Description |
|---|---|---|
| `--format` | `text` | Output format: `html`, `text`, or `markdown` |

```sh
confluence read 123456789
confluence read 123456789 --format markdown
```

---

### `info <pageId>`

Get page metadata (title, ID, type, status, space).

```sh
confluence info <pageId>
```

```sh
confluence info 123456789
```

---

### `find <title>`

Find a page by exact or partial title. Returns the first match.

```sh
confluence find <title> [--space <spaceKey>]
```

| Option | Description |
|---|---|
| `--space` | Restrict search to a specific space key |

```sh
confluence find "Architecture Overview"
confluence find "API Reference" --space MYSPACE
```

---

### `search <query>`

Search pages using a keyword or CQL expression.

```sh
confluence search <query> [--limit <number>]
```

| Option | Default | Description |
|---|---|---|
| `--limit` | `10` | Maximum number of results |

```sh
confluence search "deployment pipeline"
confluence search "type=page AND space=MYSPACE" --limit 50
```

---

### `spaces`

List all accessible Confluence spaces (key and name).

```sh
confluence spaces
```

---

### `children <pageId>`

List child pages of a page.

```sh
confluence children <pageId> [--recursive] [--max-depth <number>] [--format list|tree|json] [--show-id] [--show-url]
```

| Option | Default | Description |
|---|---|---|
| `--recursive` | false | List all descendants recursively |
| `--max-depth` | `10` | Maximum depth for recursive listing |
| `--format` | `list` | Output format: `list`, `tree`, or `json` |
| `--show-id` | false | Show page IDs |
| `--show-url` | false | Show page URLs |

```sh
confluence children 123456789
confluence children 123456789 --recursive --format json
confluence children 123456789 --recursive --format tree --show-id
```

---

### `create <title> <spaceKey>`

Create a new top-level page in a space.

```sh
confluence create <title> <spaceKey> [--content <string>] [--file <path>] [--format storage|html|markdown]
```

| Option | Default | Description |
|---|---|---|
| `--content` | — | Inline content string |
| `--file` | — | Path to content file |
| `--format` | `storage` | Content format |

Either `--content` or `--file` is required.

```sh
confluence create "Project Overview" MYSPACE --content "# Hello" --format markdown
confluence create "Release Notes" MYSPACE --file ./notes.md --format markdown
```

Outputs the new page ID and URL on success.

---

### `create-child <title> <parentId>`

Create a child page under an existing page. Inherits the parent's space automatically.

```sh
confluence create-child <title> <parentId> [--content <string>] [--file <path>] [--format storage|html|markdown]
```

Options are identical to `create`. Either `--content` or `--file` is required.

```sh
confluence create-child "Chapter 1" 123456789 --content "Content here" --format markdown
confluence create-child "API Guide" 123456789 --file ./api.md --format markdown
```

---

### `update <pageId>`

Update an existing page's title and/or content. At least one of `--title`, `--content`, or `--file` is required.

```sh
confluence update <pageId> [--title <title>] [--content <string>] [--file <path>] [--format storage|html|markdown]
```

| Option | Default | Description |
|---|---|---|
| `--title` | — | New title |
| `--content` | — | Inline content string |
| `--file` | — | Path to content file |
| `--format` | `storage` | Content format |

```sh
confluence update 123456789 --title "New Title"
confluence update 123456789 --file ./updated.md --format markdown
confluence update 123456789 --title "New Title" --file ./updated.xml --format storage
```

---

### `move <pageId_or_url> <newParentId_or_url>`

Move a page to a new parent. Both pages must be in the same space.

```sh
confluence move <pageId_or_url> <newParentId_or_url> [--title <newTitle>]
```

| Option | Description |
|---|---|
| `--title` | Rename the page during the move |

```sh
confluence move 123456789 987654321
confluence move 123456789 987654321 --title "Renamed After Move"
```

---

### `delete <pageIdOrUrl>`

Delete (trash) a page by ID or URL.

```sh
confluence delete <pageIdOrUrl> [--yes]
```

| Option | Description |
|---|---|
| `--yes` | Skip confirmation prompt (required for non-interactive/agent use) |

```sh
confluence delete 123456789 --yes
```

---

### `edit <pageId>`

Fetch a page's raw storage-format content for editing locally.

```sh
confluence edit <pageId> [--output <file>]
```

| Option | Description |
|---|---|
| `--output` | Save content to a file (instead of printing to stdout) |

```sh
confluence edit 123456789 --output ./page.xml
# Edit page.xml, then:
confluence update 123456789 --file ./page.xml --format storage
```

---

### `export <pageId>`

Export a page and its attachments to a local directory.

```sh
confluence export <pageId> [--format html|text|markdown] [--dest <directory>] [--file <filename>] [--attachments-dir <name>] [--pattern <glob>] [--referenced-only] [--skip-attachments]
```

| Option | Default | Description |
|---|---|---|
| `--format` | `markdown` | Content format for the exported file |
| `--dest` | `.` | Base directory to export into |
| `--file` | `page.<ext>` | Filename for the content file |
| `--attachments-dir` | `attachments` | Subdirectory name for attachments |
| `--pattern` | — | Glob filter for attachments (e.g. `*.png`) |
| `--referenced-only` | false | Only download attachments referenced in the page content |
| `--skip-attachments` | false | Do not download attachments |

```sh
confluence export 123456789 --format markdown --dest ./docs
confluence export 123456789 --format markdown --dest ./docs --skip-attachments
confluence export 123456789 --pattern "*.png" --dest ./output
```

Creates a subdirectory named after the page title under `--dest`.

---

### `attachments <pageId>`

List or download attachments for a page.

```sh
confluence attachments <pageId> [--limit <n>] [--pattern <glob>] [--download] [--dest <directory>]
```

| Option | Default | Description |
|---|---|---|
| `--limit` | all | Maximum number of attachments to fetch |
| `--pattern` | — | Filter by filename glob (e.g. `*.pdf`) |
| `--download` | false | Download matching attachments |
| `--dest` | `.` | Directory to save downloads |

```sh
confluence attachments 123456789
confluence attachments 123456789 --pattern "*.pdf" --download --dest ./downloads
```

---

### `attachment-upload <pageId>`

Upload one or more files to a page. `--file` can be repeated for multiple files.

```sh
confluence attachment-upload <pageId> --file <path> [--file <path> ...] [--comment <text>] [--replace] [--minor-edit]
```

| Option | Description |
|---|---|
| `--file` | File to upload (required, repeatable) |
| `--comment` | Comment for the attachment(s) |
| `--replace` | Replace an existing attachment with the same filename |
| `--minor-edit` | Mark the upload as a minor edit |

```sh
confluence attachment-upload 123456789 --file ./report.pdf
confluence attachment-upload 123456789 --file ./a.png --file ./b.png --replace
```

---

### `attachment-delete <pageId> <attachmentId>`

Delete an attachment from a page.

```sh
confluence attachment-delete <pageId> <attachmentId> [--yes]
```

| Option | Description |
|---|---|
| `--yes` | Skip confirmation prompt |

```sh
confluence attachment-delete 123456789 att-987 --yes
```

---

### `comments <pageId>`

List comments for a page.

```sh
confluence comments <pageId> [--format text|markdown|json] [--limit <n>] [--start <n>] [--location inline,footer,resolved] [--depth all] [--all]
```

| Option | Default | Description |
|---|---|---|
| `--format` | `text` | Output format: `text`, `markdown`, or `json` |
| `--limit` | `25` | Maximum comments per page |
| `--start` | `0` | Start index for pagination |
| `--location` | — | Filter by location: `inline`, `footer`, `resolved` (comma-separated) |
| `--depth` | — | Leave empty for root-only; `all` for all nested replies |
| `--all` | false | Fetch all comments (ignores pagination) |

```sh
confluence comments 123456789
confluence comments 123456789 --format json --all
confluence comments 123456789 --location footer --depth all
```

---

### `comment <pageId>`

Create a comment on a page (footer or inline).

```sh
confluence comment <pageId> [--content <string>] [--file <path>] [--format storage|html|markdown] [--parent <commentId>] [--location footer|inline] [--inline-selection <text>] [--inline-original-selection <text>] [--inline-marker-ref <ref>] [--inline-properties <json>]
```

| Option | Default | Description |
|---|---|---|
| `--content` | — | Inline content string |
| `--file` | — | Path to content file |
| `--format` | `storage` | Content format |
| `--parent` | — | Reply to a comment by ID |
| `--location` | `footer` | `footer` or `inline` |
| `--inline-selection` | — | Highlighted selection text (inline only) |
| `--inline-original-selection` | — | Original selection text (inline only) |
| `--inline-marker-ref` | — | Marker reference (inline only) |
| `--inline-properties` | — | Full inline properties as JSON (advanced) |

Either `--content` or `--file` is required.

```sh
confluence comment 123456789 --content "Looks good!" --location footer
confluence comment 123456789 --content "See note" --parent 456 --location footer
```

> **Note on inline comments**: Creating a brand-new inline comment requires editor highlight metadata (`matchIndex`, `lastFetchTime`, `serializedHighlights`) that is only available in the Confluence editor. This metadata is not accessible via the REST API, so inline comment creation will typically fail with a 400 error. Use `--location footer` or reply to an existing inline comment with `--parent <commentId>` instead.

---

### `comment-delete <commentId>`

Delete a comment by its ID.

```sh
confluence comment-delete <commentId> [--yes]
```

| Option | Description |
|---|---|
| `--yes` | Skip confirmation prompt |

```sh
confluence comment-delete 456789 --yes
```

---

### `copy-tree <sourcePageId> <targetParentId> [newTitle]`

Copy a page and all its children to a new location.

```sh
confluence copy-tree <sourcePageId> <targetParentId> [newTitle] [--max-depth <depth>] [--exclude <patterns>] [--delay-ms <ms>] [--copy-suffix <suffix>] [--dry-run] [--fail-on-error] [--quiet]
```

| Option | Default | Description |
|---|---|---|
| `--max-depth` | `10` | Maximum depth to copy |
| `--exclude` | — | Comma-separated title patterns to exclude (supports wildcards) |
| `--delay-ms` | `100` | Delay between sibling creations in ms |
| `--copy-suffix` | `" (Copy)"` | Suffix appended to the root page title |
| `--dry-run` | false | Preview operations without creating pages |
| `--fail-on-error` | false | Exit with non-zero code if any page fails |
| `--quiet` | false | Suppress progress output |

```sh
# Preview first
confluence copy-tree 123456789 987654321 --dry-run

# Copy with a custom title
confluence copy-tree 123456789 987654321 "Backup Copy"

# Copy excluding certain pages
confluence copy-tree 123456789 987654321 --exclude "Draft*,Archive*"
```

---

### `profile list`

List all configuration profiles with the active profile marked.

```sh
confluence profile list
```

---

### `profile use <name>`

Switch the active configuration profile.

```sh
confluence profile use <name>
```

```sh
confluence profile use staging
```

---

### `profile add <name>`

Add a new configuration profile. Supports the same options as `init` (interactive, non-interactive, or hybrid).

```sh
confluence profile add <name> [--domain <domain>] [--api-path <path>] [--auth-type basic|bearer] [--email <email>] [--token <token>] [--protocol http|https] [--read-only]
```

Profile names may contain letters, numbers, hyphens, and underscores only.

```sh
confluence profile add staging --domain "staging.example.com" --auth-type bearer --token "xyz"
```

---

### `profile remove <name>`

Remove a configuration profile (prompts for confirmation). Cannot remove the only remaining profile.

```sh
confluence profile remove <name>
```

```sh
confluence profile remove staging
```

---

### `stats`

Show local usage statistics.

```sh
confluence stats
```

---

### `install-skill`

Copy the Claude Code skill documentation into your project's `.claude/skills/` directory so Claude Code can learn confluence-cli automatically.

```sh
confluence install-skill [--dest <directory>] [--yes]
```

| Option | Default | Description |
|---|---|---|
| `--dest` | `./.claude/skills/confluence` | Target directory |
| `--yes` | false | Skip overwrite confirmation |

```sh
confluence install-skill
```

---

## Common Agent Workflows

### Read → Edit → Update (round-trip)

```sh
# 1. Fetch raw storage XML
confluence edit 123456789 --output ./page.xml

# 2. Modify page.xml with your tool of choice

# 3. Push the updated content
confluence update 123456789 --file ./page.xml --format storage
```

### Build a documentation hierarchy

```sh
# Create root page, note the returned ID (e.g. 111222333)
confluence create "Project Overview" MYSPACE --content "# Overview" --format markdown

# Add children under it
confluence create-child "Architecture" 111222333 --content "# Architecture" --format markdown
confluence create-child "API Reference" 111222333 --file ./api.md --format markdown
confluence create-child "Runbooks" 111222333 --content "# Runbooks" --format markdown
```

### Copy a full page tree

```sh
# Preview first
confluence copy-tree 123456789 987654321 --dry-run

# Execute the copy
confluence copy-tree 123456789 987654321 "Backup Copy"
```

### Export a page for local editing

```sh
confluence export 123456789 --format markdown --dest ./local-docs
# => ./local-docs/<page-title>/page.md + ./local-docs/<page-title>/attachments/
```

### Process children as JSON

```sh
confluence children 123456789 --recursive --format json | jq '.[].id'
```

### Search and process results

```sh
confluence search "release notes" --limit 20
```

---

## Agent Tips

- **Always use `--yes`** on destructive commands (`delete`, `comment-delete`, `attachment-delete`) to avoid interactive prompts blocking the agent.
- **Prefer `--format markdown`** when creating or updating content from agent-generated text — it's the most natural format and the API converts it automatically.
- **Use `--format json`** on `children` and `comments` for machine-parseable output.
- **ANSI color codes**: stdout may contain ANSI escape sequences. Pipe through `| cat` or use `NO_COLOR=1` if your downstream tool doesn't handle them.
- **Page ID vs URL**: when you have a Confluence URL, extract `?pageId=<number>` and pass the number. Do not pass pretty/display URLs — they are not supported.
- **Cross-space moves**: `confluence move` only works within the same space. Moving across spaces is not supported.
- **Multiple instances**: Use `--profile <name>` or `CONFLUENCE_PROFILE` env var to target different Confluence instances without reconfiguring.
- **Read-only mode**: Set `CONFLUENCE_READ_ONLY=true` or use `--read-only` when creating profiles to prevent accidental writes. This is enforced at the CLI level — all write commands will be blocked.

## Error Patterns

| Error | Cause | Fix |
|---|---|---|
| `No configuration found` | No config file and no env vars set | Set env vars or run `confluence init` |
| `Cross-space moves are not supported` | `move` used across spaces | Copy with `copy-tree` instead |
| 400 on inline comment creation | Editor metadata required | Use `--location footer` or reply to existing inline comment with `--parent` |
| `File not found: <path>` | `--file` path doesn't exist | Check the path before calling the command |
| `At least one of --title, --file, or --content must be provided` | `update` called with no content options | Provide at least one of the required options |
| `Profile "<name>" not found!` | Specified profile doesn't exist | Run `confluence profile list` to see available profiles |
| `Cannot delete the only remaining profile.` | Tried to remove the last profile | Add another profile before removing |
| `This profile is in read-only mode` | Write command used with a read-only profile | Use a writable profile or remove `readOnly` from config |
