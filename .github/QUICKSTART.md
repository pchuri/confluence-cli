# Quick Start: Package Manager Setup

This guide will get you up and running with Homebrew and Winget distribution in ~30 minutes.

## Prerequisites

✅ Windows ZIP package built and ready: `dist/confluence-cli-1.19.0-win.zip`
✅ SHA256 hashes calculated (see templates)
✅ All template files created in `.github/templates/`

## Option 1: Automated Setup (Recommended)

Run the setup assistant:

```bash
.github/scripts/setup-package-managers.sh
```

This interactive script will guide you through:
1. Creating the Homebrew tap repository
2. Setting up Winget manifests
3. Configuring GitHub secrets

## Option 2: Manual Setup (Step by Step)

### Part 1: Homebrew Tap (~15 minutes)

#### 1. Create Repository
- Go to https://github.com/new
- Name: `homebrew-confluence-cli`
- Public repository
- Click "Create repository"

#### 2. Set Up Repository

```bash
# Clone the new repository
git clone https://github.com/pchuri/homebrew-confluence-cli.git
cd homebrew-confluence-cli

# Create Formula directory
mkdir -p Formula

# Copy template files (from confluence-cli repo)
cp /path/to/confluence-cli/.github/templates/homebrew-formula.rb Formula/confluence-cli.rb
cp /path/to/confluence-cli/.github/templates/homebrew-README.md README.md

# Commit and push
git add .
git commit -m "Initial Homebrew formula for confluence-cli v1.19.0"
git push origin main
```

#### 3. Test Installation

```bash
brew tap pchuri/confluence-cli
brew install confluence-cli
confluence --version  # Should show 1.19.0
```

#### 4. Create GitHub Token

- Go to https://github.com/settings/tokens
- Click "Generate new token (classic)"
- Name: `confluence-cli-homebrew`
- Scope: ✅ repo
- Expiration: 1 year
- Click "Generate token"
- **Copy the token immediately!**

#### 5. Add Secret to confluence-cli Repository

- Go to https://github.com/pchuri/confluence-cli/settings/secrets/actions
- Click "New repository secret"
- Name: `HOMEBREW_TAP_TOKEN`
- Value: [paste token]
- Click "Add secret"

✅ **Homebrew setup complete!**

---

### Part 2: Winget Package (~30 minutes + review wait)

#### 1. Fork winget-pkgs

- Go to https://github.com/microsoft/winget-pkgs
- Click "Fork"
- Select your account (pchuri)

#### 2. Upload Windows ZIP to Release

- Go to https://github.com/pchuri/confluence-cli/releases/tag/v1.19.0
- Click "Edit release"
- Drag and drop: `dist/confluence-cli-1.19.0-win.zip`
- Click "Update release"

#### 3. Create Manifest Files

```bash
# Clone your fork
git clone https://github.com/pchuri/winget-pkgs.git
cd winget-pkgs

# Create directory structure
mkdir -p manifests/p/pchuri/confluence-cli/1.19.0

# Copy template files (from confluence-cli repo)
cp /path/to/confluence-cli/.github/templates/winget-version.yaml \
   manifests/p/pchuri/confluence-cli/1.19.0/pchuri.confluence-cli.yaml

cp /path/to/confluence-cli/.github/templates/winget-installer.yaml \
   manifests/p/pchuri/confluence-cli/1.19.0/pchuri.confluence-cli.installer.yaml

cp /path/to/confluence-cli/.github/templates/winget-locale.yaml \
   manifests/p/pchuri/confluence-cli/1.19.0/pchuri.confluence-cli.locale.en-US.yaml

# Commit and push
git add manifests/p/pchuri/confluence-cli/
git commit -m "New package: pchuri.confluence-cli version 1.19.0"
git push origin master
```

#### 4. Create Pull Request

- Go to https://github.com/microsoft/winget-pkgs/compare
- Click "compare across forks"
- Set: `base: microsoft/winget-pkgs:master` ← `head: pchuri:master`
- Title: `New package: pchuri.confluence-cli version 1.19.0`
- Click "Create pull request"

#### 5. Create GitHub Token

- Go to https://github.com/settings/tokens
- Click "Generate new token (classic)"
- Name: `confluence-cli-winget`
- Scopes: ✅ repo, ✅ workflow
- Expiration: 1 year
- Click "Generate token"
- **Copy the token immediately!**

#### 6. Add Secret to confluence-cli Repository

- Go to https://github.com/pchuri/confluence-cli/settings/secrets/actions
- Click "New repository secret"
- Name: `WINGET_TOKEN`
- Value: [paste token]
- Click "Add secret"

#### 7. Wait for Review

- Winget maintainers will review your PR (1-2 weeks)
- Respond to any feedback
- Once approved, future versions will be automated!

✅ **Winget setup complete!**

---

## Testing the Setup

### Test Homebrew Installation

```bash
brew tap pchuri/confluence-cli
brew install confluence-cli
confluence --version
confluence --help
```

### Test Winget Installation (Windows)

```powershell
winget install pchuri.confluence-cli
confluence --version
confluence --help
```

### Test Automation (Next Release)

When you create the next release (via semantic-release):

1. Monitor GitHub Actions: `.github/workflows/package-managers.yml`
2. Verify Homebrew formula updated
3. Verify Windows ZIP uploaded
4. Verify Winget PR created

---

## Troubleshooting

### Homebrew: Formula not found

```bash
# Update tap
brew update
brew tap --repair

# Or re-tap
brew untap pchuri/confluence-cli
brew tap pchuri/confluence-cli
```

### Winget: Package not found

The package won't be searchable until the PR is approved and merged. Test with:

```powershell
# Install from local manifest (for testing)
winget install --manifest path/to/manifests/p/pchuri/confluence-cli/1.19.0
```

### GitHub Actions: Token permission errors

- Ensure tokens have correct scopes
- Tokens expire - regenerate if needed
- Update secrets in repository settings

---

## What Happens on Next Release?

When semantic-release publishes a new version:

1. ✅ GitHub Actions workflow triggers automatically
2. ✅ Homebrew formula updates in tap repository
3. ✅ Windows ZIP builds and uploads to release
4. ✅ Winget PR created automatically
5. ✅ Users can install new version immediately (Homebrew) or after PR approval (Winget)

**Zero manual work required!** 🎉

---

## Files Created

All templates are ready in `.github/templates/`:

- ✅ `homebrew-formula.rb` - Homebrew formula with correct SHA256
- ✅ `homebrew-README.md` - Tap repository README
- ✅ `winget-version.yaml` - Winget version manifest
- ✅ `winget-installer.yaml` - Winget installer manifest (with SHA256)
- ✅ `winget-locale.yaml` - Winget locale manifest

---

## Need Help?

- 📖 Detailed guide: `.github/PACKAGE_MANAGER_SETUP.md`
- 📊 Implementation status: `.github/PACKAGE_MANAGER_IMPLEMENTATION.md`
- 🤖 Automated setup: `.github/scripts/setup-package-managers.sh`

---

**Estimated total time:** ~45 minutes + Winget review wait (1-2 weeks)

After initial setup, everything is automated! 🚀
