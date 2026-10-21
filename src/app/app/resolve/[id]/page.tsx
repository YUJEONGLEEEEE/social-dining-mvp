import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { alternativeSlots, refundableAmount } from "@/lib/participant/resolve";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateTimeLabel } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { resolveFailedMatchAction } from "../../../actions";

const RESULT: Record<string, string> = {
  moved_slot: "다른 목요일 일정으로 옮겼어요. 결제는 그대로 이어지고, 마감 시각에 다시 자동 매칭돼요.",
  kept_pass: "이용권 1회로 보관했어요. 원하는 날 다시 신청할 수 있어요.",
  membership_extended: "멤버십 이용 기한이 7일 늘어났어요.",
};

export default async function Resolve({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await requireDemoSession();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = createAdminClient();
  const { data: app } = await db.from("applications").select("id, match_status, match_note, pass_id")
    .eq("sandbox_id", session.sandboxId).eq("id", id).eq("profile_id", session.profileId).maybeSingle();
  if (!app) notFound();
  const { data: resolutions } = await db.from("match_resolutions").select("kind, detail").eq("application_id", id).order("created_at");
  const failed = app.match_status === "failed";
  const slots = failed && session.demoClock ? await alternativeSlots(session.sandboxId, session.demoClock) : [];
  const refund = failed ? await refundableAmount(session.sandboxId, app.pass_id) : 0;
  const { data: pass } = app.pass_id ? await db.from("passes").select("kind").eq("id", app.pass_id).maybeSingle() : { data: null };
  const membership = !!pass && pass.kind !== "single";

  return (
    <main className="flex flex-1 flex-col px-5 pt-4">
      <Link href="/app" aria-label="홈으로" className="py-2"><Icon name="arrowLeft" /></Link>
      <Badge tone="plain"><Icon name="calendarX" size={14} />이번 회차 매칭 안 됨</Badge>
      <h1 className="mt-2.5 text-[24px] font-extrabold leading-snug tracking-[-0.03em]">이번 목요일엔 딱 맞는 식탁을 찾지 못했어요</h1>
      <p className="mt-2 text-[15px] leading-relaxed">{app.match_note}</p>
      <p className="mt-3 flex items-start gap-2 rounded-btn bg-mist p-3.5 text-[15px] leading-relaxed">
        <Icon name="shield" size={20} className="mt-0.5 shrink-0" />결제는 그대로 보관돼 있어요. 운영자 확인 없이 바로 처리돼요.
      </p>

      {app.match_status === "failed" ? (
        <form action={resolveFailedMatchAction} className="mt-6 flex flex-1 flex-col">
          <input type="hidden" name="applicationId" value={app.id} />
          {error && <p role="alert" className="mb-3 text-[15px] font-medium text-danger">처리하지 못했어요. 화면을 새로 고친 뒤 다시 골라 주세요.</p>}
          {slots.length > 0 ? <h2 className="text-[15px] font-bold">이런 일정은 어때요?</h2> : <p className="text-[15px] text-graphite">지금 옮길 수 있는 일정이 없어요. 다음 회차 매칭이 이미 끝났어요.</p>}
          <div className="mt-2.5 space-y-2">
            {slots.map((s, i) => (
              <label key={s.id} className="flex min-h-[62px] cursor-pointer items-center justify-between rounded-btn bg-mist px-4 has-[:checked]:bg-paper has-[:checked]:ring-2 has-[:checked]:ring-ink">
                <span className="text-[15px]">
                  <span className="font-bold">{dateTimeLabel(s.starts_at)} · {REGION_LABEL[s.region]}</span>
                  <span className="block text-[14px] text-graphite">자리 여유 있음 · 마감 {dateTimeLabel(s.match_deadline_at)}</span>
                </span>
                <input type="radio" name="slotId" value={s.id} defaultChecked={i === 0} className="size-5 accent-ink" />
              </label>
            ))}
          </div>
          <div className="mt-auto space-y-2 py-5">
            {slots.length > 0 && <button name="choice" value="move" className="h-[52px] w-full rounded-btn bg-ink font-semibold text-paper">이 일정으로 옮기기</button>}
            <button name="choice" value="keep" className="h-[52px] w-full rounded-btn border-[1.5px] border-ink font-semibold">{membership ? "멤버십 유지하고 나중에 신청하기" : "이용권으로 보관하기"}</button>
            {refund > 0 && <button name="choice" value="refund" className="h-11 w-full font-medium text-graphite underline underline-offset-4">{refund.toLocaleString("ko-KR")}원 환불받기</button>}
          </div>
        </form>
      ) : (
        <section className="mt-6 rounded-card bg-pollen p-5">
          <h2 className="flex items-center gap-1.5 text-[16px] font-bold"><Icon name="check" size={18} />처리했어요</h2>
          {resolutions?.map((r, i) => (
            <p key={i} className="mt-1.5 text-[15px] leading-relaxed">
              {r.kind === "refunded"
                ? `${Number((r.detail as { amount?: number })?.amount ?? 0).toLocaleString("ko-KR")}원을 원래 결제 수단으로 환불했어요. (모의 환불)`
                : r.kind === "kept_pass" && (r.detail as { membership?: boolean } | null)?.membership
                  ? "멤버십은 그대로 유지돼요. 기간 안에 원하는 날 다시 신청할 수 있어요."
                  : RESULT[r.kind]}
            </p>
          ))}
          {resolutions?.some((r) => r.kind === "kept_pass") && <Link href="/app/apply" className="mt-4 flex h-[52px] items-center justify-center rounded-btn border-[1.5px] border-ink font-semibold">추가 결제 없이 다시 신청하기</Link>}
          <Link href="/app" className="mt-4 flex h-[52px] items-center justify-center rounded-btn bg-ink font-semibold text-paper">홈으로</Link>
        </section>
      )}
    </main>
  );
}
