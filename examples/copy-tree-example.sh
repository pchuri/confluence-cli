#!/bin/bash

# Confluence CLI - 페이지 트리 복사 예제
# 이 스크립트는 페이지와 모든 하위 페이지를 새로운 위치로 복사하는 방법을 보여줍니다.

echo "📋 Confluence CLI - 페이지 트리 복사 예제"
echo "=================================================="

# 사전 요구사항
echo ""
echo "📝 사전 요구사항:"
echo "- confluence CLI가 올바르게 설정되어 있어야 합니다 (confluence init)"
echo "- 원본 페이지와 대상 위치에 대한 적절한 권한이 필요합니다"
echo "- 페이지 생성 권한이 있는지 확인하세요"
echo ""

# 1단계: 복사할 원본 페이지 찾기
echo "1️⃣ 복사할 원본 페이지 찾기"
echo "=============================="
echo ""
echo "방법 1: 제목으로 페이지 찾기"
echo "confluence find \"프로젝트 문서\" --space MYTEAM"
echo ""
echo "방법 2: 검색으로 페이지 찾기"
echo "confluence search \"프로젝트\""
echo ""
echo "📝 위 명령어 결과에서 원본 페이지 ID를 확인하세요 (예: 123456789)"
echo ""

# 2단계: 대상 부모 페이지 찾기
echo "2️⃣ 대상 부모 페이지 찾기"
echo "========================="
echo ""
echo "confluence find \"백업\" --space BACKUP"
echo "또는"
echo "confluence find \"아카이브\" --space ARCHIVE"
echo ""
echo "📝 대상 부모 페이지 ID를 확인하세요 (예: 987654321)"
echo ""

# 3단계: 페이지 트리 복사 실행
echo "3️⃣ 페이지 트리 복사 실행"
echo "========================"
echo ""

echo "📄 방법 1: 기본 복사 (모든 하위 페이지 포함)"
echo 'confluence copy-tree 123456789 987654321 "프로젝트 문서 (백업)"'
echo ""

echo "📄 방법 2: 깊이 제한 복사 (3단계까지만)"
echo 'confluence copy-tree 123456789 987654321 "프로젝트 문서 (요약)" --max-depth 3'
echo ""

echo "📄 방법 3: 특정 페이지 제외하고 복사"
echo 'confluence copy-tree 123456789 987654321 "프로젝트 문서 (정리본)" --exclude "임시*,테스트*,*draft*"'
echo ""

echo "📄 방법 4: 조용한 모드 (진행상황 표시 안함)"
echo 'confluence copy-tree 123456789 987654321 --quiet'
echo ""

# 실제 사용 예제
echo "💡 실제 사용 예제"
echo "================="
echo ""
echo "# 1. 원본 페이지 ID 찾기"
echo 'SOURCE_ID=$(confluence find "프로젝트 문서" --space MYTEAM | grep "ID:" | awk "{print \$2}")'
echo ""
echo "# 2. 대상 부모 페이지 ID 찾기"
echo 'TARGET_ID=$(confluence find "백업 폴더" --space BACKUP | grep "ID:" | awk "{print \$2}")'
echo ""
echo "# 3. 날짜와 함께 백업 복사"
echo 'confluence copy-tree $SOURCE_ID $TARGET_ID "프로젝트 문서 백업 - $(date +%Y%m%d)"'
echo ""

# 고급 사용법
echo "🚀 고급 사용법"
echo "============="
echo ""
echo "1. 대용량 페이지 트리 복사 (진행상황 모니터링)"
echo "   confluence copy-tree 123456789 987654321 | tee copy-log.txt"
echo ""
echo "2. 특정 패턴 제외 (여러 패턴)"
echo "   confluence copy-tree 123456789 987654321 --exclude \"임시*,테스트*,*draft*,*temp*\""
echo ""
echo "3. 얕은 복사 (1단계 하위만)"
echo "   confluence copy-tree 123456789 987654321 --max-depth 1"
echo ""

# 주의사항 및 팁
echo "⚠️  주의사항 및 팁"
echo "=================="
echo "- 큰 페이지 트리는 복사하는데 시간이 오래 걸릴 수 있습니다"
echo "- API 레이트 리밋을 피하기 위해 페이지 간 짧은 지연이 있습니다"
echo "- 복사 중 오류가 발생하면 부분적으로 복사된 페이지들이 남을 수 있습니다"
echo "- 권한이 부족한 페이지는 건너뛰고 계속 진행됩니다"
echo "- 복사 후에는 링크와 참조가 올바른지 확인하세요"
echo "- 테스트용 소규모 트리로 먼저 테스트해보는 것을 권장합니다"
echo ""

echo "📊 복사 결과 확인"
echo "================"
echo "복사 완료 후 다음 명령어로 결과를 확인할 수 있습니다:"
echo ""
echo "# 복사된 루트 페이지 정보 확인"
echo "confluence info [새로운페이지ID]"
echo ""
echo "# 복사된 페이지의 하위 페이지들 확인"
echo "confluence search \"복사본\" --limit 20"
echo ""

echo "✅ 예제 완료!"
echo "실제 사용 시에는 위의 예제 명령어에서 실제 페이지 ID를 대입하여 사용하세요."
