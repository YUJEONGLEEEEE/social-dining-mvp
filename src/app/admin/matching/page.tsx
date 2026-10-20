import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentWeek } from "@/lib/admin/overview";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel } from "@/lib/format";

const RESOLUTION: Record<string, string> = {
  moved_slot: "다른 일정으로 이동", kept_pass: "이용권 보관", refunded: "환불", membership_extended: "멤버십 7일 연장", waitlist_filled: "대기자 충원",
};

export default async function MatchingMonitor() {
  const session = await requireDemoSession();
  const weekOf = currentWeek(session);
  const db = createAdminClient();
  const { data: run } = await db.from("match_runs").select("summary, rules_snapshot").eq("sandbox_id", session.sandboxId).eq("idempotency_key", `week:${weekOf}`).maybeSingle();
  const { data: tables } = await db
    .from("dining_tables")
    .select("id, score, reason, event_slots!inner(event_date, region), table_members(joined_reason, left_at, profiles(display_name, birth_year, gender, mbti))")
    .eq("sandbox_id", session.sandboxId)
    .eq("event_slots.event_date", weekOf)
    .order("score", { ascending: false });
  const { data: failed } = await db
    .from("applications")
    .select("id, match_note, match_status, profiles(display_name, birth_year), match_resolutions(kind)")
    .eq("sandbox_id", session.sandboxId)
    .eq("week_of", weekOf)
    .in("match_status", ["failed", "resolved"]);
  const summary = run?.summary as { tables: number; seated: number; failed: number; moved: number } | undefined;
  const rules = run?.rules_snapshot as { minScore: number; maxAgeGap: number } | undefined;

  return (
    <main>
      <h1 className="text-[22px] font-extrabold tracking-[-0.03em]">자동 매칭 모니터 · {dateLabel(`${weekOf}T10:00:00Z`)}</h1>
      {!summary ? (
        <p className="mt-4 rounded-btn bg-mist p-4 text-[15px]">아직 이 회차의 매칭이 실행되지 않았어요.</p>
      ) : (
        <>
          <p className="mt-2 text-[15px] leading-relaxed">
            필수 조건(4~6명, 나이 차 {rules?.maxAgeGap ?? 8}살 이내, 차단·비선호 없음)을 지킨 테이블 중 점수 {rules?.minScore ?? 60}점 이상만 자동 확정했어요.
            테이블 {summary.tables}개 · {summary.seated}명 배정 · 다른 일정으로 재배치 {summary.moved}명 · 실패 {summary.failed}명.
          </p>
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {(tables ?? []).map((t) => {
              const slot = t.event_slots as unknown as { region: string };
              const members = (t.table_members as unknown as { joined_reason: string | null; left_at: string | null; profiles: { display_name: string; birth_year: number; gender: string; mbti: string | null } }[]).filter((m) => !m.left_at);
              return (
                <li key={t.id} className="rounded-btn bg-mist p-4 text-[14px]">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[15px] font-bold">{REGION_LABEL[slot.region]} · {members.length}명</p>
                    <p className="text-[20px] font-extrabold tabular-nums">{t.score}점</p>
                  </div>
                  <p className="mt-1.5 leading-relaxed">{t.reason}</p>
                  <ul className="mt-2.5 space-y-1">
                    {members.map((m, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-[120px] shrink-0 font-semibold">{m.profiles.display_name} <span className="font-normal text-graphite">{2026 - m.profiles.birth_year}{m.profiles.gender === "female" ? "여" : "남"}{m.profiles.mbti ? ` ${m.profiles.mbti}` : ""}</span></span>
                        <span className="text-graphite">{m.joined_reason}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <h2 className="mt-8 text-[17px] font-bold">매칭되지 않은 신청</h2>
          {(failed ?? []).length === 0 && <p className="mt-2 text-[15px] text-graphite">없어요.</p>}
          <ul className="mt-2 space-y-2">
            {(failed ?? []).map((f) => {
              const p = f.profiles as unknown as { display_name: string; birth_year: number };
              const res = (f.match_resolutions as unknown as { kind: string }[]).map((r) => RESOLUTION[r.kind]);
              return (
                <li key={f.id} className="rounded-btn bg-mist p-4 text-[14px]">
                  <p className="font-bold">{p.display_name} · {2026 - p.birth_year}세</p>
                  <p className="mt-0.5">사유: {f.match_note}</p>
                  <p className="mt-0.5 text-graphite">처리: {res.length ? res.join(", ") : "참가자 선택 대기 (일정 이동·이용권 보관·환불 안내 발송됨)"}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
