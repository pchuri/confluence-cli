# [1.2.1](https://github.com/pchuri/confluence-cli/compare/v1.2.0...v1.2.1) (2025-06-27)


### Bug Fixes

* **format handling**: improve compatibility across Confluence instances
  - Switch from 'html' macro to 'markdown' macro for better compatibility
  - Change HTML processing to direct Storage format (no macro wrapper)
  - Add markdownToNativeStorage method for alternative conversion
  - Fix issues discovered during production testing in real Confluence environments

# [1.2.0](https://github.com/pchuri/confluence-cli/compare/v1.1.0...v1.2.0) (2025-06-27)


### Features

* implement page creation and update capabilities ([#2](https://github.com/pchuri/confluence-cli/issues/2)) ([b814ddf](https://github.com/pchuri/confluence-cli/commit/b814ddfd056aeac83cc7eb5d8d6db47ba9c70cdf))

# [1.2.0](https://github.com/pchuri/confluence-cli/compare/v1.1.0...v1.2.0) (2025-06-27)


### Features

* **page management**: add page creation and update capabilities ([NEW])
  - `confluence create` - Create new pages with support for Markdown, HTML, and Storage formats
  - `confluence update` - Update existing page content and titles
  - `confluence edit` - Export page content for editing workflow
  - Support for reading content from files or inline
  - Markdown to Confluence Storage format conversion
* **content formats**: support multiple input formats
<<<<<<< HEAD
  - Markdown format with automatic conversion using `markdown` macro
  - HTML format with direct Storage format integration
=======
  - Markdown format with automatic conversion
  - HTML format with Storage format wrapping
>>>>>>> origin/main
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
