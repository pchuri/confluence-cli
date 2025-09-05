#!/bin/bash

#!/bin/bash

# Create a test page under the Project Documentation page
# This script demonstrates typical Confluence CLI usage.

echo "🔍 Create a test page under Project Documentation"
echo "================================================"

# Step 1: Find the parent page
echo ""
echo "1️⃣ Find the parent page..."
echo "Run: confluence find \"Project Documentation\" --space MYTEAM"
echo ""

# For real execution, uncomment below
# confluence find "Project Documentation" --space MYTEAM

echo "📝 Note the page ID from the output (e.g., 123456789)"
echo ""

# Step 2: Inspect page info
echo "2️⃣ Inspect page info..."
echo "Run: confluence info [PAGE_ID]"
echo "Example: confluence info 123456789"
echo ""

# Step 3: Read page content (optional)
echo "3️⃣ Read content (optional)..."
echo "Run: confluence read [PAGE_ID] | head -20"
echo "Example: confluence read 123456789 | head -20"
echo ""

# Step 4: Create a child test page
echo "4️⃣ Create child test page..."
echo ""

# Simple text content
echo "📄 Option 1: Simple text content"
echo 'confluence create-child "Test Page - $(date +%Y%m%d)" [PARENT_PAGE_ID] --content "This is a test page created via CLI. Created at: $(date)"'
echo ""

# From Markdown file
echo "📄 Option 2: From Markdown file"
echo "confluence create-child \"Test Documentation - $(date +%Y%m%d)\" [PARENT_PAGE_ID] --file ./sample-page.md --format markdown"
echo ""

# From HTML content
echo "📄 Option 3: From HTML content"
echo 'confluence create-child "Test HTML Page" [PARENT_PAGE_ID] --content "<h1>Test Page</h1><p>This is a <strong>HTML</strong> example page.</p>" --format html'
echo ""

echo "💡 Practical example:"
echo "=============================="
echo "# 1. Get parent page ID"
echo 'PARENT_ID=$(confluence find "Project Documentation" --space MYTEAM | grep "ID:" | cut -d" " -f2)'
echo ""
echo "# 2. Create test page"
echo 'confluence create-child "Test Page - $(date +%Y%m%d_%H%M)" $PARENT_ID --content "Page for CLI testing."'
echo ""

echo "⚠️  Notes:"
echo "- confluence CLI must be set up (confluence init)"
echo "- You need appropriate permissions on the Confluence instance"
echo "- Ensure you have page creation permission"
echo "- Clean up test pages afterward"
