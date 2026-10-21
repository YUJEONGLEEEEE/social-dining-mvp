import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

// What a participant can do after a failed match (PRD STA-04~06, PAY-03).
// No operator approval is needed for any of them.

export type ResolveChoice = "move" | "keep" | "refund";
// The next Thursdays the demo can offer, with their Tuesday-24시 deadlines.
const UPCOMING = [
  { date: "2026-10-29", deadline: "2026-10-28" },
  { date: "2026-11-05", deadline: "2026-11-04" },
];

function kst(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();
}

/** Upcoming slots a failed participant can move to (created on demand in the demo). */
export async function alternativeSlots(sandboxId: string, demoClock: string) {
  const db = createAdminClient();
  // The first Thursday whose matching deadline is still ahead on the demo clock.
  const week = UPCOMING.find((w) => new Date(kst(w.deadline, 0)) > new Date(demoClock));
  if (!week) return [];
  for (const region of ["hongdae", "gangnam"]) {
    const { data } = await db.from("event_slots").select("id").eq("sandbox_id", sandboxId).eq("event_date", week.date).eq("region", region).maybeSingle();
    if (!data) {
      await db.from("event_slots").insert({ sandbox_id: sandboxId, event_date: week.date, region, starts_at: kst(week.date, 19), match_deadline_at: kst(week.deadline, 0) });
    }
  }
  const { data } = await db.from("event_slots").select("id, event_date, region, starts_at, match_deadline_at").eq("sandbox_id", sandboxId).eq("event_date", week.date).order("region", { ascending: false });
  return data ?? [];
}

/** What is left to refund for a single pass: paid minus already refunded. A membership is extended instead (FAQ). */
export async function refundableAmount(sandboxId: string, passId: string | null) {
  if (!passId) return 0;
  const db = createAdminClient();
  const { data: pass } = await db.from("passes").select("kind").eq("id", passId).maybeSingle();
  if (pass?.kind !== "single") return 0;
  const { data } = await db.from("payments").select("kind, amount").eq("sandbox_id", sandboxId).eq("pass_id", passId);
  return Math.max(0, (data ?? []).reduce((sum, p) => sum + (p.kind === "pay" ? p.amount : -p.amount), 0));
}

/** Moves the application out of "failed" only once, so a double click cannot pay out twice. */
async function claim(db: ReturnType<typeof createAdminClient>, applicationId: string, update: Record<string, string>) {
  const { data } = await db.from("applications").update(update).eq("id", applicationId).eq("match_status", "failed").select("id");
  return !!data?.length;
}

export async function resolveFailedMatch(sandboxId: string, profileId: string, demoClock: string, applicationId: string, choice: ResolveChoice, slotId: string | null) {
  const db = createAdminClient();
  const { data: app } = await db
    .from("applications")
    .select("id, profile_id, pass_id, match_status, payment_status")
    .eq("sandbox_id", sandboxId)
    .eq("id", applicationId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!app) throw new Error("신청을 찾을 수 없어요.");
  if (app.match_status !== "failed") return { already: true };

  let detail: Record<string, unknown> = {};
  let kind: "moved_slot" | "kept_pass" | "refunded";
  let notice: string;

  if (choice === "move") {
    const slots = await alternativeSlots(sandboxId, demoClock);
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) throw new Error("옮길 일정을 골라 주세요.");
    if (!(await claim(db, app.id, { application_status: "moved", match_status: "resolved" }))) return { already: true };
    // The payment moves with the participant: the new application starts as paid.
    const { data: moved, error } = await db
      .from("applications")
      .insert({ sandbox_id: sandboxId, profile_id: profileId, pass_id: app.pass_id, week_of: slot.event_date, payment_status: "paid" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await db.from("application_options").insert({ sandbox_id: sandboxId, application_id: moved.id, event_slot_id: slot.id, priority: 1 });
    kind = "moved_slot";
    detail = { new_application_id: moved.id, event_slot_id: slot.id };
    notice = "다른 목요일 일정으로 옮겼어요. 결제는 그대로 이어져요.";
  } else if (choice === "keep") {
    if (!(await claim(db, app.id, { match_status: "resolved", payment_status: "pass_kept" }))) return { already: true };
    const { data: pass } = app.pass_id ? await db.from("passes").select("kind, remaining_count").eq("id", app.pass_id).single() : { data: null };
    kind = "kept_pass";
    if (pass && pass.kind !== "single") {
      // Matching already added 7 days to the membership; there is no count to keep.
      detail = { membership: true };
      notice = "멤버십은 그대로 유지돼요. 기간 안에 원하는 날 다시 신청할 수 있어요.";
    } else {
      if (pass) await db.from("passes").update({ remaining_count: (pass.remaining_count ?? 0) + 1 }).eq("id", app.pass_id!);
      notice = "이용권 1회로 보관했어요. 원하는 날 다시 신청할 수 있어요.";
    }
  } else {
    // Mock refund to the original payment method, no account details or approval needed.
    const amount = await refundableAmount(sandboxId, app.pass_id);
    if (!(await claim(db, app.id, { match_status: "resolved", payment_status: "refunded" }))) return { already: true };
    await db.from("payments").insert({ sandbox_id: sandboxId, application_id: app.id, pass_id: app.pass_id, kind: "refund", amount });
    kind = "refunded";
    detail = { amount };
    notice = `${amount.toLocaleString("ko-KR")}원을 원래 결제 수단으로 환불했어요.`;
  }

  await db.from("match_resolutions").insert({ sandbox_id: sandboxId, application_id: app.id, kind, reason: "참가자 선택", detail });
  await db.from("notifications").insert({
    sandbox_id: sandboxId, profile_id: profileId, type: "match_resolved", title: "선택하신 대로 처리했어요", body: notice,
    link: `/app/resolve/${app.id}`, dedupe_key: `match_resolved:${app.id}`,
  });
  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "application", entity_id: app.id, actor: "participant", action: `resolve_${choice}`,
    before: { match_status: app.match_status, payment_status: app.payment_status }, after: { kind, ...detail },
  });
  return { already: false };
}
