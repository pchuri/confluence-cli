# Package Manager Implementation Status

Implementation of Homebrew and Winget installation options for confluence-cli.

## ✅ Completed in This Repository

### 1. Windows Packaging Script
- **File:** `scripts/package-win.js`
- **Status:** ✅ Created
- **Description:** Automated script to build Windows ZIP distribution
- **Features:**
  - Creates ZIP archive with all production dependencies
  - Excludes test files and dev dependencies
  - Calculates SHA256 hash for Winget manifest
  - Outputs to `dist/` directory

### 2. Package.json Updates
- **File:** `package.json`
- **Status:** ✅ Updated
- **Changes:**
  - Added `package:win` script
  - Added `archiver` dev dependency

### 3. GitHub Actions Workflow
- **File:** `.github/workflows/package-managers.yml`
- **Status:** ✅ Created
- **Triggers:** On `release.published` event
- **Jobs:**
  - `update-homebrew`: Updates Homebrew formula in tap repository
  - `update-winget`: Builds ZIP, uploads to release, submits PR to winget-pkgs
- **Required Secrets:**
  - `HOMEBREW_TAP_TOKEN` - For updating tap repository
  - `WINGET_TOKEN` - For creating PRs to winget-pkgs

### 4. Documentation Updates
- **File:** `README.md`
- **Status:** ✅ Updated
- **Changes:**
  - Added badges for npm, Homebrew, and Winget
  - Expanded Installation section with all three options
  - Added update instructions for each method
  - Emphasized Node.js requirement

### 5. Setup Guide
- **File:** `.github/PACKAGE_MANAGER_SETUP.md`
- **Status:** ✅ Created
- **Contents:**
  - Complete step-by-step instructions for Homebrew tap setup
  - Complete step-by-step instructions for Winget package setup
  - Testing procedures
  - Troubleshooting guide
  - Maintenance guidelines

---

## 🔄 Pending: External Repository Setup

### 1. Homebrew Tap Repository

**Repository:** `pchuri/homebrew-confluence-cli`

**Status:** ⏳ Needs to be created

**Required Files:**

1. **`Formula/confluence-cli.rb`** - Homebrew formula
   - Template provided in `PACKAGE_MANAGER_SETUP.md`
   - Update version and SHA256 hash for current release

2. **`README.md`** - Tap documentation
   - Template provided in setup guide
   - Explains installation and usage

**Steps:**
1. Create public GitHub repository `homebrew-confluence-cli`
2. Copy formula template and update version/SHA256
3. Copy README template
4. Commit and push to main branch
5. Test installation locally
6. Create GitHub PAT with `repo` scope
7. Add secret `HOMEBREW_TAP_TOKEN` to confluence-cli repository

**Estimated Time:** 30 minutes

---

### 2. Winget Package Manifests

**Repository:** Fork of `microsoft/winget-pkgs`

**Status:** ⏳ Needs to be created

**Required Files:**

Create directory: `manifests/p/pchuri/confluence-cli/1.19.0/`

1. **`pchuri.confluence-cli.yaml`** - Version manifest
2. **`pchuri.confluence-cli.installer.yaml`** - Installer manifest
3. **`pchuri.confluence-cli.locale.en-US.yaml`** - Locale manifest

All templates provided in `PACKAGE_MANAGER_SETUP.md`

**Steps:**
1. Fork `microsoft/winget-pkgs` repository
2. Create manifest directory structure
3. Build Windows ZIP for v1.19.0:
   ```bash
   npm install archiver
   npm ci --omit=dev
   npm run package:win
   ```
4. Upload ZIP to GitHub release v1.19.0
5. Copy SHA256 hash to installer manifest
6. Create all three manifest files
7. Submit PR to microsoft/winget-pkgs
8. Wait for maintainer approval (1-2 weeks)
9. Create GitHub PAT with `repo` and `workflow` scope
10. Add secret `WINGET_TOKEN` to confluence-cli repository

**Estimated Time:** 1-2 hours + review wait time

---

## 📋 Testing Checklist

After completing external setup:

### Homebrew Testing
- [ ] Can tap the repository: `brew tap pchuri/confluence-cli`
- [ ] Can install: `brew install confluence-cli`
- [ ] Binary is available: `which confluence`
- [ ] Version is correct: `confluence --version`
- [ ] Commands work: `confluence --help`
- [ ] Can upgrade: `brew upgrade confluence-cli`
- [ ] Can uninstall: `brew uninstall confluence-cli`

### Winget Testing (Windows)
- [ ] Can install: `winget install pchuri.confluence-cli`
- [ ] Binary is available: `where confluence`
- [ ] Version is correct: `confluence --version`
- [ ] Commands work: `confluence --help`
- [ ] Can upgrade: `winget upgrade pchuri.confluence-cli`
- [ ] Can uninstall: `winget uninstall pchuri.confluence-cli`

### Automation Testing
- [ ] Create test release (e.g., v1.19.1-test)
- [ ] Verify GitHub Actions workflow runs successfully
- [ ] Check Homebrew formula updated in tap repository
- [ ] Verify Windows ZIP uploaded to GitHub release
- [ ] Confirm Winget PR created automatically
- [ ] Test installation from updated packages

---

## 🔐 Required GitHub Secrets

Add these secrets in repository settings:
`https://github.com/pchuri/confluence-cli/settings/secrets/actions`

### 1. HOMEBREW_TAP_TOKEN
- **Type:** GitHub Personal Access Token (PAT)
- **Scope:** `repo` (full control of private repositories)
- **Purpose:** Allow GitHub Actions to push updates to homebrew-confluence-cli
- **Status:** ⏳ Pending

### 2. WINGET_TOKEN
- **Type:** GitHub Personal Access Token (PAT)
- **Scopes:** `repo`, `workflow`
- **Purpose:** Allow GitHub Actions to create PRs in winget-pkgs fork
- **Status:** ⏳ Pending

**To create a PAT:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name (e.g., "confluence-cli homebrew automation")
4. Select required scopes
5. Set expiration (recommend: 1 year)
6. Click "Generate token"
7. Copy the token immediately (won't be shown again!)

---

## 📊 Implementation Timeline

### Phase 1: Core Implementation (✅ COMPLETE)
- ✅ Create Windows packaging script
- ✅ Update package.json
- ✅ Create GitHub Actions workflow
- ✅ Update README documentation
- ✅ Create setup guide

### Phase 2: Homebrew Setup (⏳ PENDING)
**Estimated time: 30 minutes**
- ⏳ Create homebrew-confluence-cli repository
- ⏳ Add formula and README
- ⏳ Test local installation
- ⏳ Add GitHub secret

### Phase 3: Winget Setup (⏳ PENDING)
**Estimated time: 1-2 hours + review wait**
- ⏳ Fork winget-pkgs repository
- ⏳ Build Windows ZIP for v1.19.0
- ⏳ Upload to GitHub release
- ⏳ Create manifest files
- ⏳ Submit initial PR
- ⏳ Wait for maintainer approval
- ⏳ Add GitHub secret

### Phase 4: Testing & Verification (⏳ PENDING)
**Estimated time: 1 hour**
- ⏳ Test Homebrew installation
- ⏳ Test Winget installation
- ⏳ Verify automation with test release
- ⏳ Update documentation if needed

### Phase 5: Launch (⏳ PENDING)
- ⏳ Announce in CHANGELOG
- ⏳ Create announcement issue/discussion
- ⏳ Update social media / documentation sites

---

## 📝 Next Steps

### Immediate Actions Required:

1. **Create Homebrew Tap Repository**
   - Follow: `.github/PACKAGE_MANAGER_SETUP.md` → "Part 1: Homebrew Tap Setup"
   - Estimated time: 30 minutes

2. **Set Up Winget Package**
   - Follow: `.github/PACKAGE_MANAGER_SETUP.md` → "Part 2: Winget Package Setup"
   - Estimated time: 1-2 hours + review wait time

3. **Add GitHub Secrets**
   - Create and add `HOMEBREW_TAP_TOKEN`
   - Create and add `WINGET_TOKEN`
   - Estimated time: 10 minutes

4. **Test Automation**
   - Create a test release or wait for next semantic-release
   - Monitor GitHub Actions workflow
   - Verify both package managers update correctly

### Optional Enhancements (Future):

- Submit to homebrew-core (after 6 months of stability)
- Add Chocolatey support for Windows
- Add Scoop support for Windows
- Create Docker image
- Add installation analytics

---

## 📖 Documentation

All documentation has been updated:

1. **README.md** - User-facing installation instructions
2. **PACKAGE_MANAGER_SETUP.md** - Detailed setup guide for maintainers
3. **PACKAGE_MANAGER_IMPLEMENTATION.md** - This file, tracking progress

---

## 🎯 Success Criteria

The implementation will be considered successful when:

- ✅ Code changes committed to main repository
- ⏳ Homebrew tap repository is live and functional
- ⏳ Winget package is approved and published
- ⏳ GitHub Actions automation works on release
- ⏳ Users can install via all three methods
- ⏳ Documentation is complete and accurate
- ⏳ Both installation methods tested and verified

---

## 🐛 Known Issues / Considerations

1. **Node.js Dependency:** Both Homebrew and Winget packages require Node.js to be pre-installed. This is clearly documented but may confuse some users.

2. **Winget Review Time:** Initial Winget PR may take 1-2 weeks for review. Subsequent automated PRs are usually faster.

3. **ZIP Archive Size:** The Windows ZIP includes all node_modules, which can be large (~20-30 MB). This is acceptable for CLI tools.

4. **Homebrew Formula Updates:** The automation uses the npm tarball URL, so it depends on npm package being published first by semantic-release.

5. **Cross-Platform Testing:** Need to test on actual macOS, Linux, and Windows systems to ensure packages work correctly.

---

**Last Updated:** 2026-02-23
**Implementation Status:** Phase 1 Complete, Phases 2-5 Pending
