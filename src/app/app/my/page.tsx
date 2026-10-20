import Link from "next/link";
import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel } from "@/lib/format";
import { signOut } from "../../actions";

const MATCH_LABEL: Record<string, string> = {
  waiting: "매칭 대기", matching: "매칭 중", reassigning: "재배치 중", confirmed: "참여", failed: "매칭 안 됨", resolved: "처리 완료",
};

export default async function My() {
  const session = await requireDemoSession();
  const db = createAdminClient();
  const { data: profile } = await db.from("profiles").select("display_name, birth_year, mbti, interests, no_show_count, restricted_until").eq("id", session.profileId).single();
  const { data: passes } = await db.from("passes").select("kind, remaining_count, expires_at").eq("profile_id", session.profileId);
  const { data: history } = await db
    .from("applications")
    .select("id, week_of, match_status, feedbacks(id), application_options(event_slots(region))")
    .eq("profile_id", session.profileId)
    .order("week_of", { ascending: false });

  return (
    <main className="px-5 pt-6">
      <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">마이</h1>
      <section className="mt-4 rounded-card bg-mist p-5 text-[15px]">
        <p className="text-[18px] font-bold">{profile?.display_name}</p>
        <p className="mt-1 text-graphite">{2026 - (profile?.birth_year ?? 2000)}세{profile?.mbti ? ` · ${profile.mbti}` : ""}</p>
        <p className="mt-2">{(profile?.interests as string[] | undefined)?.map((i: string) => i.replace(" (헬스, 러닝, 클라이밍 등)", "")).join(", ")}</p>
        {session.persona === "me" && (
          <Link href="/app/onboarding" className="mt-3 inline-block font-semibold underline underline-offset-4">프로필·선호 수정</Link>
        )}
      </section>

      <section className="mt-4 rounded-card bg-mist p-5 text-[15px]">
        <h2 className="font-bold">이용권</h2>
        {passes?.map((p, i) => (
          <p key={i} className="mt-1.5">
            {p.kind === "single" ? `1회권 · 남은 횟수 ${p.remaining_count}회` : `멤버십 · ${p.expires_at ? `${dateLabel(p.expires_at)}까지` : ""}`}
          </p>
        ))}
        <p className="mt-2 text-[14px] text-graphite">노쇼 {profile?.no_show_count ?? 0}회 · 2회가 되면 4주간 신청이 제한돼요</p>
      </section>

      <section className="mt-4 text-[15px]">
        <h2 className="font-bold">참가 이력</h2>
        <ul className="mt-2 space-y-2">
          {history?.map((h) => {
            const region = (h.application_options as unknown as { event_slots: { region: string } }[])[0]?.event_slots.region;
            const feedback = (h.feedbacks as unknown as { id: string }[] | { id: string } | null);
            const hasFeedback = Array.isArray(feedback) ? feedback.length > 0 : !!feedback;
            return (
              <li key={h.id} className="flex justify-between rounded-btn bg-mist px-4 py-3">
                <span>{dateLabel(`${h.week_of}T10:00:00Z`)} · {region ? REGION_LABEL[region] : ""}</span>
                <span className="text-graphite">{MATCH_LABEL[h.match_status]}{hasFeedback ? " · 피드백 완료" : ""}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-4 rounded-card bg-mist p-5 text-[14px] leading-relaxed text-graphite">
        <h2 className="text-[15px] font-bold text-ink">운영 정책</h2>
        <p className="mt-1">화요일 24시(매칭 마감) 이후 환불 불가 · 당일 취소 환불 없음, 경고 1회 · 노쇼 2회 시 4주 신청 제한 · 매칭이 안 되면 일정 이동·이용권 보관·환불 중 선택 · 멤버십은 실패 1회마다 기한 7일 연장</p>
      </section>

      <form action={signOut} className="py-6">
        <button className="text-[15px] font-medium text-graphite underline underline-offset-4">로그아웃</button>
      </form>
    </main>
  );
}
