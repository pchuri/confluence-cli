#!/bin/bash

# Confluence CLI Demo Script
# This script demonstrates the new page creation and update features

echo "🚀 Confluence CLI - Page Creation Demo"
echo "======================================"

# Note: Replace with your actual space key and ensure you have confluence-cli configured
SPACE_KEY="MYTEAM"  # Change this to your space key

echo ""
echo "1. Creating a page from Markdown file..."
echo "confluence create \"Sample Page from CLI\" $SPACE_KEY --file ./sample-page.md --format markdown"

echo ""
echo "2. Creating a page with inline content..."
echo "confluence create \"Quick Note\" $SPACE_KEY --content \"This is a quick note created from the CLI\" --format storage"

echo ""
echo "3. Updating a page (replace 123456789 with actual page ID)..."
echo "confluence update 123456789 --content \"This page has been updated via CLI\""

echo ""
echo "4. Getting page content for editing..."
echo "confluence edit 123456789 --output ./page-backup.xml"

echo ""
echo "5. Searching for pages..."
echo "confluence search \"CLI\""

echo ""
echo "6. Listing all spaces..."
echo "confluence spaces"

echo ""
echo "7. Finding a page by title..."
echo "confluence find \"Project Documentation\" --space MYTEAM"

echo ""
echo "8. Creating a child page under a parent page..."
echo "confluence create-child \"Test Page\" 123456789 --content \"This is a test page created as a child\""

echo ""
echo "9. Creating a child page from Markdown file..."
echo "confluence create-child \"Test Documentation\" 123456789 --file ./sample-page.md --format markdown"

echo ""
echo "💡 Tips:"
echo "- Use --format markdown to create pages from Markdown files"
echo "- Use --format html for HTML content"
echo "- Use --format storage for Confluence native format"
echo "- Always backup important pages before updating"
echo "- Use 'confluence find' to get page IDs by title"
echo "- Child pages inherit permissions from their parent"

echo ""
echo "📝 Edit workflow:"
echo "1. confluence edit [pageId] --output page.xml"
echo "2. Edit the file with your preferred editor"
echo "3. confluence update [pageId] --file page.xml --format storage"

echo ""
echo "🔍 Finding and creating child pages workflow:"
echo "1. confluence find \"Project Documentation\" --space MYTEAM"
echo "2. Note the page ID from the result"
echo "3. confluence create-child \"Meeting Notes\" [parentId] --content \"Child content\""
echo "4. Or use: confluence create-child \"Technical Docs\" [parentId] --file ./content.md --format markdown"
