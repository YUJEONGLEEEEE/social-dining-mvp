import Link from "next/link";
import { startDemo } from "./actions";
import { Button } from "@/components/ui";

export default async function Landing({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-5 py-10">
      <p className="text-[15px] text-graphite">매주 목요일 저녁</p>
      <h1 className="mt-1 text-[34px] font-extrabold leading-tight tracking-[-0.035em]">
        우연한 식탁
      </h1>
      <p className="mt-3 text-[17px] leading-relaxed">
        처음 보는 사람들과 좋은 저녁 한 끼. 신청부터 자동 매칭, 식당 안내, 피드백까지 운영자 없이 돌아가는 소셜 다이닝 MVP예요.
      </p>

      <form action={startDemo} className="mt-8">
        <Button type="submit">데모 시작하기</Button>
      </form>
      {error === "start" && (
        <p role="alert" className="mt-3 text-[15px] text-danger">데모를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.</p>
      )}
      <p className="mt-3 text-[15px] text-graphite">
        누르면 나만의 데모 회차(10/22 목, 홍대·강남, 가상 참가자 23명)가 만들어져요. 다른 사람의 데모와 섞이지 않아요.
      </p>

      <section className="mt-10 rounded-card bg-mist p-5">
        <h2 className="text-[17px] font-bold">3분 데모 순서</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
          <li>프로필·선호 입력 후 신청 상태 확인</li>
          <li>[마감 시각으로 이동] → 자동 매칭·재배치·확정, 함께하게 된 이유</li>
          <li>식당 자동 배정과 단체방 안내, D-1 리마인드, 식사 중 대화 카드</li>
          <li>식사 후 피드백 → 다음 회차 매칭에 반영된 결과 비교</li>
          <li>매칭 실패 참가자 시점, 운영자 예외 처리함(식당 부족 1건)</li>
        </ol>
        <Link href="/admin" className="mt-4 inline-block text-[15px] font-semibold underline underline-offset-4">운영자 어드민 열기</Link>
      </section>

      <section className="mt-6 rounded-card bg-mist p-5">
        <h2 className="text-[17px] font-bold">보안 설계</h2>
        <ul className="mt-3 space-y-1.5 text-[15px] leading-relaxed">
          <li>인증은 Supabase Auth에 맡기고, 비밀번호 저장·세션 관리를 직접 만들지 않았어요.</li>
          <li>모든 테이블에 접근 규칙(RLS)을 켜고 기본값은 전부 거부예요. 로그인한 사람도 자기 데모 데이터만 읽을 수 있어요.</li>
          <li>결제·매칭·피드백 같은 쓰기는 서버에서 입력값을 검증한 뒤에만 실행돼요.</li>
          <li>데모는 방문자마다 분리된 샌드박스에서 돌고, 실제 개인정보는 쓰지 않아요.</li>
        </ul>
        <a href="https://github.com/YUJEONGLEEEEE/social-dining-mvp" className="mt-4 inline-block text-[15px] font-semibold underline underline-offset-4">GitHub 저장소</a>
      </section>
    </main>
  );
}
