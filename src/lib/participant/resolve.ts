import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

// What a participant can do after a failed match (PRD STA-04~06, PAY-03).
// No operator approval is needed for any of them.

export type ResolveChoice = "move" | "keep" | "refund";
const NEXT_WEEK = "2026-10-29";
const PRICE = 9900;

function kst(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();
}

/** Upcoming slots a failed participant can move to (created on demand in the demo). */
export async function alternativeSlots(sandboxId: string) {
  const db = createAdminClient();
  for (const region of ["hongdae", "gangnam"]) {
    const { data } = await db.from("event_slots").select("id").eq("sandbox_id", sandboxId).eq("event_date", NEXT_WEEK).eq("region", region).maybeSingle();
    if (!data) {
      await db.from("event_slots").insert({ sandbox_id: sandboxId, event_date: NEXT_WEEK, region, starts_at: kst(NEXT_WEEK, 19), match_deadline_at: kst("2026-10-28", 0) });
    }
  }
  const { data } = await db.from("event_slots").select("id, region, starts_at, match_deadline_at").eq("sandbox_id", sandboxId).eq("event_date", NEXT_WEEK).order("region", { ascending: false });
  return data ?? [];
}

export async function resolveFailedMatch(sandboxId: string, profileId: string, applicationId: string, choice: ResolveChoice, slotId: string | null) {
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
    const slots = await alternativeSlots(sandboxId);
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) throw new Error("옮길 일정을 골라 주세요.");
    // The payment moves with the participant: the new application starts as paid.
    const { data: moved, error } = await db
      .from("applications")
      .insert({ sandbox_id: sandboxId, profile_id: profileId, pass_id: app.pass_id, week_of: NEXT_WEEK, payment_status: "paid" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await db.from("application_options").insert({ sandbox_id: sandboxId, application_id: moved.id, event_slot_id: slot.id, priority: 1 });
    await db.from("applications").update({ application_status: "moved", match_status: "resolved" }).eq("id", app.id);
    kind = "moved_slot";
    detail = { new_application_id: moved.id, event_slot_id: slot.id };
    notice = "다음 주 목요일 일정으로 옮겼어요. 결제는 그대로 이어져요.";
  } else if (choice === "keep") {
    await db.from("applications").update({ match_status: "resolved", payment_status: "pass_kept" }).eq("id", app.id);
    if (app.pass_id) {
      const { data: pass } = await db.from("passes").select("remaining_count").eq("id", app.pass_id).single();
      if (pass && pass.remaining_count !== null) await db.from("passes").update({ remaining_count: pass.remaining_count + 1 }).eq("id", app.pass_id);
    }
    kind = "kept_pass";
    notice = "이용권 1회로 보관했어요. 원하는 날 다시 신청할 수 있어요.";
  } else {
    // Mock refund to the original payment method, no account details or approval needed.
    await db.from("applications").update({ match_status: "resolved", payment_status: "refunded" }).eq("id", app.id);
    await db.from("payments").insert({ sandbox_id: sandboxId, application_id: app.id, pass_id: app.pass_id, kind: "refund", amount: PRICE });
    kind = "refunded";
    notice = `${PRICE.toLocaleString("ko-KR")}원을 원래 결제 수단으로 환불했어요.`;
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
