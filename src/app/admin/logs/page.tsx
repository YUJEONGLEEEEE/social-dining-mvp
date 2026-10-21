import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const ACTION: Record<string, string> = {
  create_demo_sandbox: "데모 회차 생성",
  advance_demo_clock: "가상 시계 진행",
  run_matching: "자동 매칭 실행",
  assign_venues: "식당 자동 배정",
  resolve_venue_shortage: "대체 식당 지정",
  close_exception: "예외 확인 완료",
  submit_feedback: "피드백 제출",
  confirm_attendance: "참석 확인",
  resolve_move: "실패 처리: 일정 이동",
  resolve_keep: "실패 처리: 이용권 보관",
  resolve_refund: "실패 처리: 환불",
  update_rules: "매칭 규칙 변경",
  apply_and_pay: "신청·모의 결제",
  apply_with_kept_pass: "보관 이용권으로 신청",
  check_in: "체크인",
};
const ACTOR: Record<string, string> = {
  system: "시스템", operator: "운영자", participant: "참가자", "demo-visitor": "데모 진행", "test-account": "데모 진행", "demo-simulation": "가상 참가자",
};
const TYPE: Record<string, string> = {
  match_confirmed: "확정 안내", match_failed: "매칭 실패 안내", reminder: "D-1 리마인드", feedback_request: "피드백 요청", match_resolved: "실패 처리 결과",
};

export default async function Logs() {
  const session = await requireDemoSession();
  const db = createAdminClient();
  const { data: logs } = await db.from("audit_logs").select("id, action, actor, reason, after").eq("sandbox_id", session.sandboxId).order("id", { ascending: false }).limit(60);
  const { data: notes } = await db.from("notifications").select("type, delivery_status").eq("sandbox_id", session.sandboxId);
  const byType = new Map<string, number>();
  for (const n of notes ?? []) byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
  const failedDelivery = (notes ?? []).filter((n) => n.delivery_status === "failed").length;

  return (
    <main>
      <h1 className="text-[22px] font-extrabold tracking-[-0.03em]">자동 처리 기록</h1>
      <h2 className="mt-5 text-[17px] font-bold">자동 메시지 발송</h2>
      <ul className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
        {[...byType].map(([type, count]) => (
          <li key={type} className="rounded-btn bg-mist px-4 py-3">
            <p className="text-[13px] text-graphite">{TYPE[type] ?? type}</p>
            <p className="text-[22px] font-extrabold tabular-nums">{count}건</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[14px] text-graphite">발송 실패 {failedDelivery}건 · 같은 안내는 중복 방지 키로 한 번만 발송돼요.</p>

      <h2 className="mt-8 text-[17px] font-bold">상태 변경 기록 (최근 60건)</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-ink text-left text-graphite">
              <th className="px-2.5 py-2 font-semibold">무엇을</th>
              <th className="px-2.5 py-2 font-semibold">누가</th>
              <th className="px-2.5 py-2 font-semibold">내용</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id} className="border-b border-line align-top">
                <td className="px-2.5 py-2.5 font-semibold">{ACTION[l.action] ?? l.action}</td>
                <td className="px-2.5 py-2.5">{ACTOR[l.actor] ?? l.actor}</td>
                <td className="px-2.5 py-2.5 text-graphite">{l.reason ?? (l.after ? JSON.stringify(l.after).slice(0, 120) : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
