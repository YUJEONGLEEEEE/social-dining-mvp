import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { mealIsOver } from "@/lib/participant/table";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel, won } from "@/lib/format";
import { confirmNoShowAction } from "../../actions";

// 운영자 화면 4·9: applicants, payments and attendance in one list (PAY-01, SAF-02).

const PAYMENT: Record<string, string> = {
  pending: "결제 대기", paid: "결제 완료", refund_requested: "환불 처리 중", refunded: "환불 완료", pass_kept: "이용권 보관", failed: "결제 실패",
};
const MATCH: Record<string, string> = {
  waiting: "매칭 대기", matching: "매칭 중", reassigning: "재배치 중", confirmed: "확정", failed: "실패", resolved: "실패 처리 완료",
};
const PASS: Record<string, string> = { single: "1회권", membership_1m: "멤버십 1개월", membership_3m: "멤버십 3개월", membership_6m: "멤버십 6개월" };

type Row = {
  id: string; week_of: string; payment_status: string; match_status: string; attendance_status: string; application_status: string;
  profiles: { display_name: string; is_virtual: boolean; no_show_count: number; restricted_until: string | null };
  passes: { kind: string; price: number } | null;
  feedbacks: { id: string }[] | { id: string } | null;
  application_options: { priority: number; event_slots: { region: string; starts_at: string } }[];
};

export default async function Participants() {
  const session = await requireDemoSession();
  const { data } = await createAdminClient()
    .from("applications")
    .select("id, week_of, payment_status, match_status, attendance_status, application_status, profiles(display_name, is_virtual, no_show_count, restricted_until), passes(kind, price), feedbacks(id), application_options(priority, event_slots(region, starts_at))")
    .eq("sandbox_id", session.sandboxId)
    .order("week_of")
    .order("created_at");
  const rows = (data ?? []) as unknown as Row[];
  const weeks = [...new Set(rows.map((r) => r.week_of))];
  // Me and the failing participant first, so the demo's own people are easy to find.
  const order = (r: Row) => (r.profiles.is_virtual ? 1 : 0);

  return (
    <main>
      <h1 className="text-[22px] font-extrabold tracking-[-0.03em]">신청자·결제·참석</h1>
      <p className="mt-1 text-[14px] text-graphite">
        체크인 기록 없이 식사가 끝나면 노쇼 후보로 표시돼요. 운영자가 확정하면 노쇼 횟수가 쌓이고, 2회가 되면 4주간 신청이 제한돼요.
      </p>
      {weeks.length === 0 && <p className="mt-4 rounded-btn bg-mist p-4 text-[15px]">아직 신청이 없어요.</p>}
      {weeks.map((week) => {
        const list = rows.filter((r) => r.week_of === week).sort((a, b) => order(a) - order(b));
        const paid = list.filter((r) => r.payment_status === "paid").length;
        return (
          <section key={week} className="mt-6">
            <h2 className="text-[17px] font-bold">{dateLabel(`${week}T10:00:00Z`)} 회차 · {list.length}명 · 결제 완료 {paid}명</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[14px] tabular-nums">
                <thead>
                  <tr className="border-b border-ink text-left text-graphite">
                    {["이름", "희망 지역(1순위)", "이용권", "결제", "매칭", "참석", "피드백", "노쇼·제한"].map((h) => <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const slot = [...r.application_options].sort((a, b) => a.priority - b.priority)[0]?.event_slots;
                    const fb = Array.isArray(r.feedbacks) ? r.feedbacks.length > 0 : !!r.feedbacks;
                    const candidate = r.match_status === "confirmed" && slot && mealIsOver(slot.starts_at, session.demoClock)
                      && r.attendance_status !== "checked_in" && r.attendance_status !== "no_show";
                    const restricted = r.profiles.restricted_until && session.demoClock && r.profiles.restricted_until > session.demoClock;
                    return (
                      <tr key={r.id} className={`border-b border-line ${candidate ? "bg-danger-soft" : ""}`}>
                        <td className="px-2.5 py-2.5 font-semibold">{r.profiles.display_name}{r.profiles.is_virtual || r.profiles.display_name === "나" ? "" : " (나)"}</td>
                        <td className="px-2.5 py-2.5">{slot ? REGION_LABEL[slot.region] : "-"}</td>
                        <td className="px-2.5 py-2.5">{r.passes ? `${PASS[r.passes.kind]} ${won(r.passes.price)}` : "-"}</td>
                        <td className="px-2.5 py-2.5">{PAYMENT[r.payment_status]}</td>
                        <td className="px-2.5 py-2.5">{r.application_status === "moved" ? "다른 일정으로 이동" : MATCH[r.match_status]}</td>
                        <td className="px-2.5 py-2.5">
                          {r.attendance_status === "checked_in" ? "체크인" : r.attendance_status === "no_show" ? <span className="font-bold text-danger">노쇼</span>
                            : candidate ? (
                              <form action={confirmNoShowAction} className="flex items-center gap-2">
                                <span className="font-bold text-danger">노쇼 후보</span>
                                <input type="hidden" name="applicationId" value={r.id} />
                                <button className="rounded-sm bg-ink px-2.5 py-1 text-[13px] font-bold text-paper">노쇼 확정</button>
                              </form>
                            ) : r.attendance_status === "confirmed" ? "참석 예정" : "-"}
                        </td>
                        <td className="px-2.5 py-2.5">{fb ? "제출" : "-"}</td>
                        <td className="px-2.5 py-2.5">
                          {r.profiles.no_show_count}회{restricted ? (
                            <span className="ml-1 font-bold text-danger">
                              · {new Date(r.profiles.restricted_until!).getFullYear() > 2100 ? "영구 제한" : `${dateLabel(r.profiles.restricted_until!)}까지 제한`}
                            </span>
                          ) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </main>
  );
}
