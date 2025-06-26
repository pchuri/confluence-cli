#!/bin/bash

# Example script showing how to use confluence-cli

echo "🚀 Confluence CLI Examples"
echo "========================="

# Check if confluence command is available
if ! command -v confluence &> /dev/null; then
    echo "❌ confluence command not found. Please install confluence-cli first:"
    echo "   npm install -g confluence-cli"
    exit 1
fi

echo ""
echo "📋 Listing all spaces..."
confluence spaces

echo ""
echo "🔍 Searching for 'API' documentation..."
confluence search "API" --limit 5

echo ""
echo "ℹ️  Getting information about a specific page..."
# Replace this with an actual page ID from your Confluence
read -p "Enter a page ID to get info: " PAGE_ID
if [ ! -z "$PAGE_ID" ]; then
    confluence info "$PAGE_ID"
    
    echo ""
    read -p "Do you want to read this page? (y/N): " READ_PAGE
    if [ "$READ_PAGE" = "y" ] || [ "$READ_PAGE" = "Y" ]; then
        echo ""
        echo "📖 Reading page content..."
        confluence read "$PAGE_ID" | head -20
        echo ""
        echo "(Showing first 20 lines only)"
    fi
fi

echo ""
echo "✅ Examples completed!"
echo "💡 Run 'confluence --help' for more commands"
