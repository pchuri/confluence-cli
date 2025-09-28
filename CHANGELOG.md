# [1.8.0](https://github.com/pchuri/confluence-cli/compare/v1.7.0...v1.8.0) (2025-09-28)


### Features

* make Confluence API path configurable ([#14](https://github.com/pchuri/confluence-cli/issues/14)) ([be000e0](https://github.com/pchuri/confluence-cli/commit/be000e0d92881d65329b84bad6555dcad0bbb455)), closes [#13](https://github.com/pchuri/confluence-cli/issues/13)

## [Unreleased]

### Added
- Make the Confluence REST base path configurable to support both `/rest/api` and `/wiki/rest/api`.

# [1.7.0](https://github.com/pchuri/confluence-cli/compare/v1.6.0...v1.7.0) (2025-09-28)


### Features

* support basic auth for Atlassian API tokens ([#12](https://github.com/pchuri/confluence-cli/issues/12)) ([e80ea9b](https://github.com/pchuri/confluence-cli/commit/e80ea9b7913d5f497b60bf72149737b6f704c6b8))

# [1.6.0](https://github.com/pchuri/confluence-cli/compare/v1.5.0...v1.6.0) (2025-09-05)


### Features

* Add copy-tree command for recursive page copying with children ([#9](https://github.com/pchuri/confluence-cli/issues/9)) ([29efa5b](https://github.com/pchuri/confluence-cli/commit/29efa5b2f8edeee1c5072ad8d7077f38f860c2ba))

# [1.5.0](https://github.com/pchuri/confluence-cli/compare/v1.4.1...v1.5.0) (2025-08-13)


### Features

* Align README with implementation and fix update command ([#7](https://github.com/pchuri/confluence-cli/issues/7)) ([87f48e0](https://github.com/pchuri/confluence-cli/commit/87f48e03c6310bb9bfc7fda2930247c0d61414ec))

## [1.4.1](https://github.com/pchuri/confluence-cli/compare/v1.4.0...v1.4.1) (2025-06-30)


### Bug Fixes

* correct version display in CLI ([#6](https://github.com/pchuri/confluence-cli/issues/6)) ([36f8419](https://github.com/pchuri/confluence-cli/commit/36f8419b309ae1ff99fa94c12ace9a527ee3f162))

# [1.4.0](https://github.com/pchuri/confluence-cli/compare/v1.3.2...v1.4.0) (2025-06-30)


### Features

* Enhanced Markdown Support with Bidirectional Conversion ([#5](https://github.com/pchuri/confluence-cli/issues/5)) ([d17771b](https://github.com/pchuri/confluence-cli/commit/d17771b40d8d60ed68c0ac0a3594fed6b9a4e771))

## [1.3.2](https://github.com/pchuri/confluence-cli/compare/v1.3.1...v1.3.2) (2025-06-27)


### Bug Fixes

* resolve merge conflict in CHANGELOG.md ([8565c1a](https://github.com/pchuri/confluence-cli/commit/8565c1a90243663f206285e5af3616541ee1a1d0))

## [1.3.1](https://github.com/pchuri/confluence-cli/compare/v1.3.0...v1.3.1) (2025-06-27)


### Bug Fixes

* clean up duplicate CHANGELOG entries ([0163deb](https://github.com/pchuri/confluence-cli/commit/0163deb7f007e1d64ce4693eb8e86280d27eb6cc))

# [1.3.0](https://github.com/pchuri/confluence-cli/compare/v1.2.0...v1.3.0) (2025-06-27)


### Bug Fixes

* improve format handling based on production testing ([820f9cd](https://github.com/pchuri/confluence-cli/commit/820f9cdc7e59b6aa4b676eda6cff7e22865ec8fb))


### Features

* implement page creation and update capabilities ([3c43b19](https://github.com/pchuri/confluence-cli/commit/3c43b19765f94318d01fea3a22b324ada00a77d1))

# [1.2.1](https://github.com/pchuri/confluence-cli/compare/v1.2.0...v1.2.1) (2025-06-27)


### Bug Fixes

* **format handling**: improve compatibility across Confluence instances
  - Switch from 'html' macro to 'markdown' macro for better compatibility
  - Change HTML processing to direct Storage format (no macro wrapper)
  - Add markdownToNativeStorage method for alternative conversion
  - Fix issues discovered during production testing in real Confluence environments

# [1.2.0](https://github.com/pchuri/confluence-cli/compare/v1.1.0...v1.2.0) (2025-06-27)


### Features

* **page management**: add page creation and update capabilities ([#2](https://github.com/pchuri/confluence-cli/issues/2)) ([b814ddf](https://github.com/pchuri/confluence-cli/commit/b814ddfd056aeac83cc7eb5d8d6db47ba9c70cdf))
  - `confluence create` - Create new pages with support for Markdown, HTML, and Storage formats
  - `confluence update` - Update existing page content and titles
  - `confluence edit` - Export page content for editing workflow
  - Support for reading content from files or inline
  - Markdown to Confluence Storage format conversion
* **content formats**: support multiple input formats
  - Markdown format with automatic conversion using `markdown` macro
  - HTML format with direct Storage format integration
  - Native Confluence Storage format
* **examples**: add sample files and demo scripts for new features

### Breaking Changes

* None - all new features are additive

# [1.1.0](https://github.com/pchuri/confluence-cli/compare/v1.0.0...v1.1.0) (2025-06-26)


### Features

* add analytics tracking to spaces command ([265e8f4](https://github.com/pchuri/confluence-cli/commit/265e8f42b5ba86fb50398e8b1fcfd1d85fcc54d9))
* add community feedback and analytics infrastructure ([a7ff6e8](https://github.com/pchuri/confluence-cli/commit/a7ff6e87cdc92d98f3d927ee98fac9e33aedbaae))

# 1.0.0 (2025-06-26)


### Bug Fixes

* add explicit permissions for GitHub Actions ([fa36b29](https://github.com/pchuri/confluence-cli/commit/fa36b2974b1261c144a415ced324383b35a938fb))
* add NODE_AUTH_TOKEN for npm authentication ([2031314](https://github.com/pchuri/confluence-cli/commit/2031314ad01fc1d9b4f9557a3d1321a046cad8f3))
* resolve eslint errors and npm publish warnings ([b93285e](https://github.com/pchuri/confluence-cli/commit/b93285ee098d96c8b750dbf2be5a93f28f44706c))


### Features

* initial release of confluence-cli ([ec04e06](https://github.com/pchuri/confluence-cli/commit/ec04e06bb0c785dcff84dabcafeeb60bf9e1658f))

# Confluence CLI Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-26

### Added
- Initial release of Confluence CLI
- Read Confluence pages by ID or URL
- Search functionality with customizable limits
- Page information display
- List all Confluence spaces
- Interactive configuration setup
- Environment variable support
- HTML and text output formats
- Comprehensive README with examples
- MIT License

### Features
- `confluence init` - Interactive configuration setup
- `confluence read <pageId>` - Read page content with format options
- `confluence info <pageId>` - Display page information
- `confluence search <query>` - Search pages with optional limit
- `confluence spaces` - List all available spaces

### Dependencies
- commander for CLI framework
- axios for HTTP requests
- chalk for colored output
- inquirer for interactive prompts
- html-to-text for content conversion
- ora for loading indicators
