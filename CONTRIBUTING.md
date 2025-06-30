# Contributing to Confluence CLI

Thank you for your interest in contributing to Confluence CLI! This document provides guidelines and information about contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please be respectful and considerate in all interactions.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a branch for your changes
4. Make your changes
5. Test your changes
6. Submit a pull request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/confluence-cli.git
cd confluence-cli

# Install dependencies
npm install

# Set up your test environment
export CONFLUENCE_DOMAIN="your-test-domain.atlassian.net"
export CONFLUENCE_API_TOKEN="your-test-token"

# Test the CLI locally
node bin/confluence.js --help
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-page-creation` - for new features
- `fix/search-pagination` - for bug fixes
- `docs/update-readme` - for documentation updates
- `refactor/client-architecture` - for refactoring

### Commit Messages

Write clear, descriptive commit messages:
```
feat: add page creation functionality

- Add create command to CLI
- Implement createPage method in client
- Add tests for page creation
- Update README with new command
```

Use conventional commit format:
- `feat:` - new features
- `fix:` - bug fixes
- `docs:` - documentation changes
- `style:` - formatting changes
- `refactor:` - code refactoring
- `test:` - adding tests
- `chore:` - maintenance tasks

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Check test coverage
npm run test:coverage

# Manual testing
node bin/confluence.js read 123456789
```

### Test Guidelines

- Write tests for new functionality
- Ensure existing tests pass
- Aim for good test coverage
- Use descriptive test names
- Mock external API calls

## Submitting Changes

1. **Push your changes** to your fork
2. **Create a pull request** against the main branch
3. **Fill out the PR template** with:
   - Description of changes
   - Type of change (bug fix, feature, etc.)
   - Testing performed
   - Screenshots (if applicable)

### Pull Request Guidelines

- Keep PRs focused and atomic
- Include tests for new functionality
- Update documentation as needed
- Ensure CI passes
- Request review from maintainers

## Coding Standards

### JavaScript Style

- Use ES6+ features when appropriate
- Follow existing code style
- Use meaningful variable names
- Add comments for complex logic
- Keep functions small and focused

### Markdown Support

The CLI includes enhanced markdown support with:

- **Native Confluence Storage Format**: Converts markdown to native Confluence elements instead of HTML macros
- **Confluence Extensions**: Support for admonitions (`[!info]`, `[!warning]`, `[!note]`)
- **Bidirectional Conversion**: Convert from markdown to storage format and back
- **Rich Elements**: Tables, code blocks, lists, links, and formatting

Example markdown with Confluence extensions:
```markdown
# My Page

[!info]
This is an info admonition that will render as a Confluence info macro.

```javascript
console.log("Code blocks preserve syntax highlighting");
```

| Feature | Status |
|---------|--------|
| Tables  | ✅     |
| Lists   | ✅     |
```

### File Structure

```
bin/                 # CLI entry points
lib/                 # Core library code
  ├── confluence-client.js
  ├── config.js
  └── utils.js
tests/               # Test files
docs/                # Additional documentation
```

### Error Handling

- Always handle errors gracefully
- Provide helpful error messages
- Use appropriate exit codes
- Log errors appropriately

### Documentation

- Update README for new features
- Add JSDoc comments for functions
- Update CHANGELOG for releases
- Include usage examples

## Feature Requests

Before implementing major features:

1. **Check existing issues** to avoid duplication
2. **Create an issue** to discuss the feature
3. **Get maintainer feedback** before starting work
4. **Follow the agreed approach** in implementation

## Bug Reports

When reporting bugs:

1. **Check existing issues** first
2. **Provide reproduction steps**
3. **Include environment details**:
   - Node.js version
   - OS and version
   - CLI version
4. **Share error messages** and logs

## Development Tips

### Local Testing

```bash
# Test against your Confluence instance
export CONFLUENCE_DOMAIN="your-domain.atlassian.net"
export CONFLUENCE_API_TOKEN="your-token"

# Test commands
node bin/confluence.js spaces
node bin/confluence.js search "test"
node bin/confluence.js read 123456789
```

### Debugging

```bash
# Enable debug mode
DEBUG=confluence-cli node bin/confluence.js read 123456789

# Use Node.js debugger
node --inspect-brk bin/confluence.js read 123456789
```

## Release Process

For maintainers:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create git tag
4. Push to npm
5. Create GitHub release

## Questions?

If you have questions about contributing:

1. Check existing documentation
2. Search closed issues
3. Ask in a new issue
4. Contact maintainers

Thank you for contributing to Confluence CLI! 🚀
