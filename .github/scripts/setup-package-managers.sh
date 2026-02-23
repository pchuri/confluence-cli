#!/bin/bash

# Package Manager Setup Assistant
# This script guides you through setting up Homebrew and Winget distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/../templates"

echo "📦 Package Manager Setup Assistant for confluence-cli"
echo "===================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }

# Function to prompt for confirmation
confirm() {
    read -p "$1 (y/n): " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
}

echo "This script will help you set up:"
echo "  1. Homebrew tap repository (pchuri/homebrew-confluence-cli)"
echo "  2. Winget package manifests (fork of microsoft/winget-pkgs)"
echo "  3. GitHub secrets for automation"
echo ""

# Step 1: Homebrew Tap Setup
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Homebrew Tap Repository Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

print_info "First, create a new GitHub repository:"
echo "  Repository name: homebrew-confluence-cli"
echo "  Owner: pchuri"
echo "  Visibility: Public"
echo "  Initialize: No (we'll add files manually)"
echo ""
echo "  Create it at: https://github.com/new"
echo ""

if confirm "Have you created the repository?"; then
    print_success "Great! Proceeding with setup..."

    # Clone the repository
    echo ""
    print_info "Cloning the homebrew-confluence-cli repository..."

    HOMEBREW_DIR="$HOME/homebrew-confluence-cli"

    if [ -d "$HOMEBREW_DIR" ]; then
        print_warning "Directory $HOMEBREW_DIR already exists. Skipping clone."
    else
        git clone https://github.com/pchuri/homebrew-confluence-cli.git "$HOMEBREW_DIR"
        print_success "Repository cloned to $HOMEBREW_DIR"
    fi

    cd "$HOMEBREW_DIR"

    # Create Formula directory
    mkdir -p Formula

    # Copy formula file
    print_info "Creating Homebrew formula..."
    cp "$TEMPLATES_DIR/homebrew-formula.rb" Formula/confluence-cli.rb
    print_success "Formula created at Formula/confluence-cli.rb"

    # Copy README
    print_info "Creating README..."
    cp "$TEMPLATES_DIR/homebrew-README.md" README.md
    print_success "README created"

    # Commit and push
    git add Formula/confluence-cli.rb README.md
    git commit -m "Initial Homebrew formula for confluence-cli v1.19.0"

    print_info "Pushing to GitHub..."
    git push origin main || git push origin master

    print_success "Homebrew tap repository set up successfully!"
    print_info "Test it with: brew tap pchuri/confluence-cli && brew install confluence-cli"

else
    print_warning "Skipping Homebrew tap setup. You can run this script again later."
fi

# Step 2: Winget Package Setup
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Winget Package Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

print_info "First, fork the microsoft/winget-pkgs repository:"
echo "  1. Go to: https://github.com/microsoft/winget-pkgs"
echo "  2. Click 'Fork' in the top right"
echo "  3. Select your account (pchuri)"
echo ""

if confirm "Have you forked the repository?"; then
    print_success "Great! Proceeding with Winget setup..."

    # Clone the fork
    echo ""
    print_info "Cloning your winget-pkgs fork..."

    WINGET_DIR="$HOME/winget-pkgs"

    if [ -d "$WINGET_DIR" ]; then
        print_warning "Directory $WINGET_DIR already exists. Using existing directory."
        cd "$WINGET_DIR"
    else
        git clone https://github.com/pchuri/winget-pkgs.git "$WINGET_DIR"
        cd "$WINGET_DIR"
        print_success "Repository cloned to $WINGET_DIR"
    fi

    # Create manifest directory
    MANIFEST_DIR="manifests/p/pchuri/confluence-cli/1.19.0"
    mkdir -p "$MANIFEST_DIR"

    # Copy manifest files
    print_info "Creating Winget manifest files..."
    cp "$TEMPLATES_DIR/winget-version.yaml" "$MANIFEST_DIR/pchuri.confluence-cli.yaml"
    cp "$TEMPLATES_DIR/winget-installer.yaml" "$MANIFEST_DIR/pchuri.confluence-cli.installer.yaml"
    cp "$TEMPLATES_DIR/winget-locale.yaml" "$MANIFEST_DIR/pchuri.confluence-cli.locale.en-US.yaml"
    print_success "Manifest files created in $MANIFEST_DIR"

    # Upload Windows ZIP to GitHub release
    echo ""
    print_warning "MANUAL STEP REQUIRED:"
    echo "  1. Go to: https://github.com/pchuri/confluence-cli/releases/tag/v1.19.0"
    echo "  2. Click 'Edit release'"
    echo "  3. Upload the file: $PROJECT_ROOT/dist/confluence-cli-1.19.0-win.zip"
    echo "  4. Click 'Update release'"
    echo ""

    if confirm "Have you uploaded the ZIP file to the release?"; then
        # Commit and push
        git add "$MANIFEST_DIR"
        git commit -m "New package: pchuri.confluence-cli version 1.19.0"

        print_info "Pushing to your fork..."
        git push origin master

        print_success "Manifest files pushed to your fork!"

        echo ""
        print_info "Now create a Pull Request:"
        echo "  1. Go to: https://github.com/microsoft/winget-pkgs/compare"
        echo "  2. Click 'compare across forks'"
        echo "  3. Set: base: microsoft/winget-pkgs master ← head: pchuri/winget-pkgs master"
        echo "  4. Title: 'New package: pchuri.confluence-cli version 1.19.0'"
        echo "  5. Click 'Create pull request'"
        echo ""

        if confirm "Have you created the Pull Request?"; then
            print_success "Winget package setup complete!"
            print_info "The PR may take 1-2 weeks for review. You'll be notified when approved."
        fi
    else
        print_warning "Please upload the ZIP file manually and create the PR."
    fi

else
    print_warning "Skipping Winget package setup. You can run this script again later."
fi

# Step 3: GitHub Secrets
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3: GitHub Secrets Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

print_info "You need to create two GitHub Personal Access Tokens (PATs):"
echo ""
echo "  1. HOMEBREW_TAP_TOKEN"
echo "     - Scope: repo"
echo "     - Purpose: Update homebrew-confluence-cli repository"
echo ""
echo "  2. WINGET_TOKEN"
echo "     - Scopes: repo, workflow"
echo "     - Purpose: Create PRs to winget-pkgs"
echo ""
echo "Create PATs at: https://github.com/settings/tokens"
echo ""

print_info "Then add them as secrets:"
echo "  1. Go to: https://github.com/pchuri/confluence-cli/settings/secrets/actions"
echo "  2. Click 'New repository secret'"
echo "  3. Add both secrets with the names above"
echo ""

if confirm "Have you added both GitHub secrets?"; then
    print_success "All secrets configured!"
else
    print_warning "Remember to add the secrets before the next release!"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

print_success "Package manager setup is complete!"
echo ""
echo "Next steps:"
echo "  • Test Homebrew: brew tap pchuri/confluence-cli && brew install confluence-cli"
echo "  • Wait for Winget PR approval (1-2 weeks)"
echo "  • On next release, automation will handle everything!"
echo ""
echo "Documentation:"
echo "  • Setup guide: .github/PACKAGE_MANAGER_SETUP.md"
echo "  • Implementation status: .github/PACKAGE_MANAGER_IMPLEMENTATION.md"
echo ""

print_success "All done! 🎉"
