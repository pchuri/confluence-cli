#!/bin/bash

# 실제 Project Documentation 페이지 하위에 테스트 페이지 생성 예제
# 이 스크립트는 일반적인 Confluence 설정에서 작동합니다.

echo "🔍 Project Documentation 페이지 하위에 테스트 페이지 생성"
echo "=============================================================="

# 1단계: 부모 페이지 찾기
echo ""
echo "1️⃣ 부모 페이지 찾기..."
echo "실행: confluence find \"Project Documentation\" --space MYTEAM"
echo ""

# 실제 실행할 때는 아래 주석을 해제하세요
# confluence find "Project Documentation" --space MYTEAM

echo "📝 위 명령어 결과에서 페이지 ID를 확인하세요 (예: 123456789)"
echo ""

# 2단계: 페이지 정보 확인
echo "2️⃣ 페이지 정보 확인..."
echo "실행: confluence info [페이지ID]"
echo "예시: confluence info 123456789"
echo ""

# 3단계: 페이지 내용 읽기 (선택사항)
echo "3️⃣ 페이지 내용 확인 (선택사항)..."
echo "실행: confluence read [페이지ID] | head -20"
echo "예시: confluence read 123456789 | head -20"
echo ""

# 4단계: 테스트 페이지 생성
echo "4️⃣ 하위 테스트 페이지 생성..."
echo ""

# 간단한 텍스트 콘텐츠로 테스트 페이지 생성
echo "📄 방법 1: 간단한 텍스트 콘텐츠로 생성"
echo 'confluence create-child "Test Page - $(date +%Y%m%d)" [부모페이지ID] --content "이것은 CLI로 생성된 테스트 페이지입니다. 생성 시간: $(date)"'
echo ""

# 마크다운 파일에서 테스트 페이지 생성
echo "📄 방법 2: 마크다운 파일에서 생성"
echo "confluence create-child \"Test Documentation - $(date +%Y%m%d)\" [부모페이지ID] --file ./sample-page.md --format markdown"
echo ""

# HTML 콘텐츠로 생성
echo "📄 방법 3: HTML 콘텐츠로 생성"
echo 'confluence create-child "Test HTML Page" [부모페이지ID] --content "<h1>테스트 페이지</h1><p>이것은 <strong>HTML</strong>로 작성된 테스트 페이지입니다.</p>" --format html'
echo ""

echo "💡 실제 사용 예제:"
echo "=============================="
echo "# 1. 부모 페이지 ID 찾기"
echo 'PARENT_ID=$(confluence find "Project Documentation" --space MYTEAM | grep "ID:" | cut -d" " -f2)'
echo ""
echo "# 2. 테스트 페이지 생성"
echo 'confluence create-child "테스트 페이지 - $(date +%Y%m%d_%H%M)" $PARENT_ID --content "CLI 테스트용 페이지입니다."'
echo ""

echo "⚠️  주의사항:"
echo "- confluence CLI가 올바르게 설정되어 있어야 합니다 (confluence init)"
echo "- 해당 Confluence 인스턴스에 대한 적절한 권한이 있어야 합니다"
echo "- 페이지 생성 권한이 있는지 확인하세요"
echo "- 테스트 후에는 불필요한 페이지를 정리하세요"
