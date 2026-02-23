# Package Manager Setup Guide

This guide explains how to set up Homebrew and Winget distribution for confluence-cli.

## Prerequisites

1. **GitHub Personal Access Tokens (PATs):**
   - `HOMEBREW_TAP_TOKEN`: PAT with `repo` scope for `pchuri/homebrew-confluence-cli`
   - `WINGET_TOKEN`: PAT with `repo` and `workflow` scope for forking/PRs to `microsoft/winget-pkgs`

2. **Required Repositories:**
   - Create `pchuri/homebrew-confluence-cli` (public)
   - Fork `microsoft/winget-pkgs`

---

## Part 1: Homebrew Tap Setup

### Step 1: Create Homebrew Tap Repository

1. Go to https://github.com/new
2. Repository name: `homebrew-confluence-cli`
3. Description: "Homebrew tap for confluence-cli"
4. Set to **Public**
5. Click "Create repository"

### Step 2: Initialize Tap Repository

```bash
# Clone the new repository
git clone https://github.com/pchuri/homebrew-confluence-cli.git
cd homebrew-confluence-cli

# Create Formula directory
mkdir -p Formula

# Create the formula file (see template below)
# Save as Formula/confluence-cli.rb
```

### Step 3: Homebrew Formula Template

Save this as `Formula/confluence-cli.rb` in your `homebrew-confluence-cli` repository:

```ruby
class ConfluenceCli < Formula
  desc "Command-line interface for Atlassian Confluence"
  homepage "https://github.com/pchuri/confluence-cli"
  url "https://registry.npmjs.org/confluence-cli/-/confluence-cli-1.19.0.tgz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/confluence --version")
  end
end
```

**To get the SHA256 hash for the current version:**

```bash
# Download the npm tarball
curl -L https://registry.npmjs.org/confluence-cli/-/confluence-cli-1.19.0.tgz -o confluence-cli.tgz

# Calculate SHA256
shasum -a 256 confluence-cli.tgz

# Use the hash in the formula
```

### Step 4: Create README.md

Save this as `README.md` in your `homebrew-confluence-cli` repository:

```markdown
# Homebrew Tap for confluence-cli

Official Homebrew tap for [confluence-cli](https://github.com/pchuri/confluence-cli) - A command-line interface for Atlassian Confluence.

## Installation

```bash
brew tap pchuri/confluence-cli
brew install confluence-cli
```

## Usage

After installation, run:

```bash
confluence --help
```

## Updating

```bash
brew upgrade confluence-cli
```

## Uninstall

```bash
brew uninstall confluence-cli
brew untap pchuri/confluence-cli
```

## About

This tap provides the Homebrew formula for confluence-cli, automatically updated on each release via GitHub Actions.

For issues or feature requests, visit the [main repository](https://github.com/pchuri/confluence-cli).
```

### Step 5: Commit and Push

```bash
git add Formula/confluence-cli.rb README.md
git commit -m "Initial Homebrew formula for confluence-cli"
git push origin main
```

### Step 6: Test the Formula

```bash
# Test installation from your tap
brew tap pchuri/confluence-cli
brew install confluence-cli

# Verify it works
confluence --version
which confluence

# Test actual functionality
confluence --help
```

### Step 7: Add GitHub Secret

1. Go to `https://github.com/pchuri/confluence-cli/settings/secrets/actions`
2. Click "New repository secret"
3. Name: `HOMEBREW_TAP_TOKEN`
4. Value: Your GitHub PAT with `repo` scope
5. Click "Add secret"

**The formula will now automatically update on each release via GitHub Actions!**

---

## Part 2: Winget Package Setup

### Step 1: Fork winget-pkgs Repository

1. Go to https://github.com/microsoft/winget-pkgs
2. Click "Fork" in the top right
3. Select your account (pchuri)
4. Click "Create fork"

### Step 2: Create Initial Winget Manifests

Create these three files in your fork for the current version (1.19.0):

#### File 1: Version Manifest

Path: `manifests/p/pchuri/confluence-cli/1.19.0/pchuri.confluence-cli.yaml`

```yaml
PackageIdentifier: pchuri.confluence-cli
PackageVersion: 1.19.0
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
```

#### File 2: Installer Manifest

Path: `manifests/p/pchuri/confluence-cli/1.19.0/pchuri.confluence-cli.installer.yaml`

```yaml
PackageIdentifier: pchuri.confluence-cli
PackageVersion: 1.19.0
InstallerType: zip
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/pchuri/confluence-cli/releases/download/v1.19.0/confluence-cli-1.19.0-win.zip
    InstallerSha256: REPLACE_WITH_ACTUAL_SHA256
ManifestType: installer
ManifestVersion: 1.6.0
```

#### File 3: Locale Manifest

Path: `manifests/p/pchuri/confluence-cli/1.19.0/pchuri.confluence-cli.locale.en-US.yaml`

```yaml
PackageIdentifier: pchuri.confluence-cli
PackageVersion: 1.19.0
PackageLocale: en-US
Publisher: pchuri
PublisherUrl: https://github.com/pchuri
PublisherSupportUrl: https://github.com/pchuri/confluence-cli/issues
PackageName: Confluence CLI
PackageUrl: https://github.com/pchuri/confluence-cli
License: MIT
LicenseUrl: https://github.com/pchuri/confluence-cli/blob/main/LICENSE
ShortDescription: Command-line interface for Atlassian Confluence
Description: A powerful command-line interface for Atlassian Confluence that allows you to read, search, and manage your Confluence content from the terminal.
Tags:
  - cli
  - confluence
  - atlassian
  - documentation
  - wiki
ManifestType: defaultLocale
ManifestVersion: 1.6.0
```

### Step 3: Build and Upload Windows ZIP

First, you need to manually create the Windows ZIP for version 1.19.0:

```bash
# In your confluence-cli repository
cd /path/to/confluence-cli

# Install archiver dependency
npm install archiver

# Install production dependencies only
npm ci --omit=dev

# Build the Windows package
npm run package:win

# This creates: dist/confluence-cli-1.19.0-win.zip
# The script will also print the SHA256 hash
```

### Step 4: Upload ZIP to GitHub Release

1. Go to https://github.com/pchuri/confluence-cli/releases/tag/v1.19.0
2. Click "Edit release"
3. Drag and drop `dist/confluence-cli-1.19.0-win.zip` to the assets section
4. Click "Update release"
5. Copy the SHA256 hash and update the installer manifest

### Step 5: Submit Initial PR to winget-pkgs

```bash
# In your winget-pkgs fork
cd /path/to/winget-pkgs

# Create manifests directory structure
mkdir -p manifests/p/pchuri/confluence-cli/1.19.0

# Copy the three manifest files to this directory

# Commit and push
git add manifests/p/pchuri/confluence-cli/
git commit -m "New package: pchuri.confluence-cli version 1.19.0"
git push origin main

# Create PR to microsoft/winget-pkgs
# Go to https://github.com/microsoft/winget-pkgs
# Click "Pull requests" → "New pull request"
# Click "compare across forks"
# Select: base: master ← head: pchuri:main
# Create PR with title: "New package: pchuri.confluence-cli version 1.19.0"
```

### Step 6: Validate Manifests Locally (Optional)

Install Winget validation tool:

```powershell
# On Windows, install winget-create
winget install Microsoft.WingetCreate

# Validate manifests
winget validate --manifest manifests/p/pchuri/confluence-cli/1.19.0
```

### Step 7: Add GitHub Secret

1. Go to `https://github.com/pchuri/confluence-cli/settings/secrets/actions`
2. Click "New repository secret"
3. Name: `WINGET_TOKEN`
4. Value: Your GitHub PAT with `repo` and `workflow` scope
5. Click "Add secret"

### Step 8: Wait for Approval

The winget-pkgs maintainers will review your PR. This can take a few days to a week. Once approved, future versions will be automated via GitHub Actions!

---

## Testing the Automation

After both setups are complete, you can test the automation:

### Test with a Patch Release

1. Make a small change to confluence-cli
2. Commit and push
3. semantic-release will create a new version (e.g., 1.19.1)
4. Monitor GitHub Actions workflow: `.github/workflows/package-managers.yml`
5. Verify:
   - Homebrew formula updated in tap repository
   - Windows ZIP uploaded to GitHub release
   - Winget PR created automatically

### Manual Testing

**Homebrew:**
```bash
brew tap pchuri/confluence-cli
brew install confluence-cli
confluence --version
```

**Winget:**
```powershell
winget install pchuri.confluence-cli
confluence --version
```

---

## Troubleshooting

### Homebrew Formula Update Fails

- Check that `HOMEBREW_TAP_TOKEN` has correct permissions
- Verify the token has access to `pchuri/homebrew-confluence-cli`
- Check the GitHub Actions logs for specific errors

### Winget PR Creation Fails

- Verify `WINGET_TOKEN` has `repo` and `workflow` scopes
- Check that your winget-pkgs fork is up to date
- Ensure the ZIP was successfully uploaded to GitHub release

### ZIP Archive Missing Dependencies

- Make sure you run `npm ci --omit=dev` before `npm run package:win`
- Check that `node_modules` exists before running the package script
- Verify the archiver package is installed

### Users Report "Node.js not found"

- Both Homebrew and Winget packages require Node.js to be installed
- Update README to emphasize Node.js requirement
- Users need to install Node.js separately

---

## Maintenance

### Ongoing (Automated)

On each release, GitHub Actions will:
- ✅ Calculate SHA256 of npm tarball
- ✅ Update Homebrew formula in tap repository
- ✅ Build Windows ZIP archive
- ✅ Upload ZIP to GitHub release assets
- ✅ Submit PR to winget-pkgs with updated manifests

### Periodic (Manual)

- Monitor winget-pkgs PRs for maintainer feedback (~1-2 weeks after submission)
- Respond to installation issues reported in tap repository (rare)
- Update documentation if package manager formats change (yearly)

### Future Enhancements

- Submit to homebrew-core after 6+ months of stability
- Consider Chocolatey for additional Windows distribution
- Add Scoop as alternative Windows package manager
- Create Docker image for containerized usage

---

## Success Criteria

✅ Homebrew tap repository created and accessible
✅ Initial Homebrew formula works and installs correctly
✅ Winget initial PR submitted and approved
✅ GitHub Actions secrets configured
✅ Automation successfully tested with a release
✅ Both installation methods documented in README
✅ Users can successfully install via all three methods

---

## Support

For issues related to:
- **confluence-cli functionality**: https://github.com/pchuri/confluence-cli/issues
- **Homebrew tap**: https://github.com/pchuri/homebrew-confluence-cli/issues
- **Winget package**: Comment on relevant winget-pkgs PR or create issue

---

**Last Updated:** 2026-02-23
