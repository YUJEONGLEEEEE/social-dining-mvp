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

## 개발 방식
기획·설계 판단은 직접 하고, 코드 작성과 데이터 분석에는 AI 코딩 도구를 활용했습니다.
