#!/bin/bash

# Confluence CLI - 페이지 트리 복사 예제
# 이 스크립트는 페이지와 모든 하위 페이지를 새로운 위치로 복사하는 방법을 보여줍니다.

echo "📋 Confluence CLI - Copy Page Tree Example"
echo "=================================================="

# 사전 요구사항
echo ""
echo "📝 Prerequisites:"
echo "- confluence CLI is set up (confluence init)"
echo "- You have access to source and target locations"
echo "- You have permissions to create pages"
echo ""

# 1단계: 복사할 원본 페이지 찾기
echo "1️⃣ Find the source page"
echo "=============================="
echo ""
echo "Method 1: Find by title"
echo "confluence find \"Project Docs\" --space MYTEAM"
echo ""
echo "Method 2: Search"
echo "confluence search \"Project\""
echo ""
echo "📝 Note the source page ID from the output (e.g., 123456789)"
echo ""

# 2단계: 대상 부모 페이지 찾기
echo "2️⃣ Find the target parent page"
echo "========================="
echo ""
echo "confluence find \"Backup\" --space BACKUP"
echo "or"
echo "confluence find \"Archive\" --space ARCHIVE"
echo ""
echo "📝 Note the target parent page ID (e.g., 987654321)"
echo ""

# 3단계: 페이지 트리 복사 실행
echo "3️⃣ Run copy"
echo "========================"
echo ""

echo "📄 Basic: copy with all children"
echo 'confluence copy-tree 123456789 987654321 "Project Docs (Backup)"'
echo ""

echo "📄 Depth-limited (3 levels)"
echo 'confluence copy-tree 123456789 987654321 "Project Docs (Summary)" --max-depth 3'
echo ""

echo "📄 Exclude patterns"
echo 'confluence copy-tree 123456789 987654321 "Project Docs (Clean)" --exclude "temp*,test*,*draft*"'
echo ""

echo "📄 Quiet mode"
echo 'confluence copy-tree 123456789 987654321 --quiet'
echo ""

echo "📄 Control pacing and naming"
echo 'confluence copy-tree 123456789 987654321 --delay-ms 150 --copy-suffix " (Backup)"'
echo ""

# 실제 사용 예제
echo "💡 Practical example"
echo "================="
echo ""
echo "# 1. Capture source page ID"
echo 'SOURCE_ID=$(confluence find "Project Docs" --space MYTEAM | grep "ID:" | awk "{print \$2}")'
echo ""
echo "# 2. Capture target parent ID"
echo 'TARGET_ID=$(confluence find "Backup Folder" --space BACKUP | grep "ID:" | awk "{print \$2}")'
echo ""
echo "# 3. Run backup with date suffix"
echo 'confluence copy-tree $SOURCE_ID $TARGET_ID "Project Docs Backup - $(date +%Y%m%d)"'
echo ""

# 고급 사용법
echo "🚀 Advanced"
echo "============="
echo ""
echo "1. Large trees with progress"
echo "   confluence copy-tree 123456789 987654321 | tee copy-log.txt"
echo ""
echo "2. Multiple exclude patterns"
echo "   confluence copy-tree 123456789 987654321 --exclude \"temp*,test*,*draft*,*temp*\""
echo ""
echo "3. Shallow copy (only direct children)"
echo "   confluence copy-tree 123456789 987654321 --max-depth 1"
echo ""

# 주의사항 및 팁
echo "⚠️  Notes and tips"
echo "=================="
echo "- Large trees may take time to copy"
echo "- A short delay between siblings helps avoid rate limits (tune with --delay-ms)"
echo "- Partial copies can remain if errors occur"
echo "- Pages without permission are skipped; run with --fail-on-error to fail the run"
echo "- Validate links and references after copying"
echo "- Try with a small tree first"
echo ""

echo "📊 Verify results"
echo "================"
echo "After completion, you can check the results:"
echo ""
echo "# Root page info"
echo "confluence info [새로운페이지ID]"
echo ""
echo "# Find copied pages"
echo "confluence search \"Copy\" --limit 20"
echo ""

echo "✅ Example complete!"
echo "Replace example IDs with real ones when running."
