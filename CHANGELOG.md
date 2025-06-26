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
