# 우연한 식탁 (Wooyeon Table)

매주 목요일 저녁, 처음 보는 사람들과 함께하는 소셜 다이닝 서비스의 MVP입니다.
2026 우연한식탁 MVP 개발 해커톤 출품작입니다.

- **참가자 웹앱** (`/`): 신청·결제, 자동 매칭 결과 확인, 단체방, 식사 후 피드백
- **운영자 어드민** (`/admin`): 자동 매칭 모니터링과 예외 처리

## 기술 스택
- Next.js (App Router), TypeScript, Tailwind CSS
- Supabase (DB, 인증)
- Vercel (배포)

## 로컬 실행
```bash
npm install
cp .env.example .env.local   # Supabase 값 입력
npm run dev
```

## 가상데이터 적재
주최측 설문 데이터(294명)는 원본 소유자가 따로 있어 저장소에 올리지 않습니다.
```bash
python3 scripts/clean_virtual_data.py <가상데이터.xlsx 경로>   # data/private/에 정제본 생성 (git 제외)
node --env-file=.env.local scripts/seed-base.mjs                # base 샌드박스에 적재, 다시 실행해도 같은 결과
```
- 정제: MBTI 표기 정규화, 관심사 선택지 사전 매칭, 지역 자유입력을 서울 4개 지역으로 변환, "없음" 계열 통일
- 지난 날짜(5/21~10/15)는 회차 이력으로 합성: 4~6명·나이 차 8살 이내 테이블, 만남·피드백·상호 호감·비선호 관계
- 연락처·인스타 ID 컬럼은 읽지 않습니다

## 개발 방식
기획·설계 판단은 직접 하고, 코드 작성과 데이터 분석에는 AI 코딩 도구를 활용했습니다.
