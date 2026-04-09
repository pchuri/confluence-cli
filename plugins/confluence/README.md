# confluence

A Claude Code plugin for [confluence-cli](https://github.com/pchuri/confluence-cli). Gives Claude Code full knowledge of all confluence-cli commands so it can read, search, create, update, move, delete, and convert Confluence pages and attachments on your behalf.

## Installation

Add the marketplace and install the plugin:

```bash
/plugin marketplace add pchuri/confluence-cli
/plugin install confluence@pchuri-confluence-cli
```

## Prerequisites

confluence-cli must be installed and configured:

```bash
npm install -g confluence-cli
confluence init
```

See the [main README](../../README.md) for full configuration options.

## What this plugin provides

- **Skill: confluence** (model-invoked) — Claude Code automatically activates this skill when your task involves Confluence. It covers all 30+ CLI commands, configuration, common workflows, and error handling.
