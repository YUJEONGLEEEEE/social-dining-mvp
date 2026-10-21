import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getJourney } from "@/lib/participant/journey";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel, dateTimeLabel, timeLabel, won } from "@/lib/format";
import { PASS_PLANS, keptPass } from "@/lib/participant/apply";
import { ApplyForm } from "./apply-form";

const PAYMENT_LABEL: Record<string, string> = {
  pending: "결제 대기", paid: "결제 완료", refund_requested: "환불 처리 중", refunded: "환불 완료", pass_kept: "이용권으로 보관", failed: "결제 실패",
};
const NOTES: Record<string, string> = {
  single: "한 번 참여",
  membership_1m: "기간 내 매주 참여, 매칭 실패 시 기한 7일 연장",
};
const PASSES = Object.entries(PASS_PLANS).map(([kind, p]) => ({ kind, name: p.name, price: p.price, note: NOTES[kind] ?? "" }));

export default async function Apply() {
  const session = await requireDemoSession();
  const journey = await getJourney(session);
  const { data: slots } = await createAdminClient()
    .from("event_slots")
    .select("id, event_date, region, starts_at, match_deadline_at, status")
    .eq("sandbox_id", session.sandboxId)
    .eq("is_history", false)
    .order("event_date")
    .order("region", { ascending: false }); // 홍대 first: most demo applicants chose it
  const chosen = new Set(journey.slots.map((s) => s.id));
  const open = (slots ?? []).filter((s) => session.demoClock && s.match_deadline_at > new Date(session.demoClock).toISOString());

  // The form opens while there is an open week this person has not applied to yet.
  const { data: active } = open.length
    ? await createAdminClient().from("applications").select("id").eq("sandbox_id", session.sandboxId).eq("profile_id", session.profileId)
      .in("week_of", [...new Set(open.map((s) => s.event_date))]).not("application_status", "in", "(cancelled,moved)").limit(1)
    : { data: [] };
  if (open.length && !active?.length) {
    const kept = await keptPass(session.sandboxId, session.profileId);
    return (
      <main className="px-5 pb-10 pt-6">
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">이번 주 식탁 신청</h1>
        <p className="mt-1 text-[15px] text-graphite">날짜·지역과 이용권을 고르고 결제하면 신청이 끝나요. 매칭 마감에 자동으로 식탁이 정해져요.</p>
        <ApplyForm
          slots={open.map((s) => ({ id: s.id, title: `${dateLabel(s.starts_at)} ${timeLabel(s.starts_at)} · ${REGION_LABEL[s.region]}`, deadline: dateTimeLabel(s.match_deadline_at) }))}
          plans={PASSES}
          kept={!!kept}
        />
      </main>
    );
  }

  return (
    <main className="px-5 pt-6">
      <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">신청</h1>
      <p className="mt-1 text-[15px] text-graphite">날짜와 지역을 여러 개 고르면, 첫 번째에서 안 맞을 때 다른 후보로 자동 재배치해요.</p>

      <h2 className="mt-6 text-[15px] font-bold">모집 중인 회차</h2>
      <ul className="mt-2 space-y-2">
        {slots?.map((s) => (
          <li key={s.id} className={`rounded-btn p-4 text-[15px] ${chosen.has(s.id) ? "bg-pollen" : "bg-mist"}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{dateLabel(s.starts_at)} {timeLabel(s.starts_at)} · {REGION_LABEL[s.region]}</span>
              {chosen.has(s.id) && <span className="text-[13px] font-bold">내 신청</span>}
            </div>
            <p className="mt-1 text-graphite">신청 마감 {dateTimeLabel(s.match_deadline_at)}</p>
          </li>
        ))}
      </ul>

      {journey.application && (
        <section className="mt-6 rounded-card bg-mist p-5 text-[15px]">
          <h2 className="font-bold">내 신청</h2>
          <dl className="mt-2 space-y-1.5">
            <div className="flex justify-between"><dt className="text-graphite">이용권</dt><dd>{PASS_PLANS[journey.pass?.kind as keyof typeof PASS_PLANS]?.name ?? "1회권"} · {won(journey.pass?.price ?? 9900)}</dd></div>
            <div className="flex justify-between"><dt className="text-graphite">결제 상태</dt><dd className="font-bold">{PAYMENT_LABEL[journey.application.payment_status]}</dd></div>
            <div className="flex justify-between"><dt className="text-graphite">결제 방식</dt><dd>모의 결제 (해커톤 허용 범위)</dd></div>
          </dl>
        </section>
      )}

      <h2 className="mt-6 text-[15px] font-bold">이용권</h2>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {PASSES.map((p) => (
          <li key={p.name} className="rounded-btn bg-mist p-4">
            <p className="text-[15px] font-bold">{p.name}</p>
            <p className="mt-0.5 text-[17px] font-extrabold">{won(p.price)}</p>
            {p.note && <p className="mt-1 text-[13px] leading-snug text-graphite">{p.note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[14px] leading-relaxed text-graphite">
        화요일 24시 이후 환불 불가 · 당일 취소 환불 없음 · 노쇼 2회 시 4주 신청 제한
      </p>
    </main>
  );
}
