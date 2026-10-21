import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import { runMatching } from "../matching/run.ts";
import { postConversationCards, requestFeedback, sendReminders } from "../automation/meetup.ts";
import { openNextWeek, simulateVirtualFeedback } from "../feedback/loop.ts";
import { DEMO_WEEK } from "./sandbox.ts";
import { submitApplication } from "../participant/apply.ts";

// The demo bar moves a virtual clock through the S1 scenario. Each step runs
// the same automation the real schedule would run at that time, in order.

export const STAGES = ["applied", "matched", "reminded", "dining", "finished", "next_matched"] as const;
export type Stage = (typeof STAGES)[number];

export const NEXT_STEP: Record<Stage, { label: string; clock: string } | null> = {
  applied: { label: "매칭 마감 시각으로 이동", clock: "2026-10-21T00:00:00+09:00" },
  matched: { label: "모임 하루 전으로 이동", clock: "2026-10-21T19:00:00+09:00" },
  reminded: { label: "식사 시작", clock: "2026-10-22T19:00:00+09:00" },
  dining: { label: "식사 종료", clock: "2026-10-22T21:30:00+09:00" },
  finished: { label: "다음 회차 매칭 실행", clock: "2026-10-28T00:00:00+09:00" },
  next_matched: null,
};

export const STAGE_CLOCK: Record<Stage, string> = {
  applied: "2026-10-20T10:00:00+09:00",
  matched: NEXT_STEP.applied!.clock,
  reminded: NEXT_STEP.matched!.clock,
  dining: NEXT_STEP.reminded!.clock,
  finished: NEXT_STEP.dining!.clock,
  next_matched: NEXT_STEP.finished!.clock,
};

/** Runs the automation for the next stage. Steps are idempotent, so a double click is harmless. */
export async function advanceDemo(sandboxId: string, ownerUserId: string, from: Stage, actor: string) {
  const db = createAdminClient();
  const { data: sandbox } = await db.from("sandboxes").select("demo_stage, me_profile_id").eq("id", sandboxId).eq("owner_user_id", ownerUserId).single();
  if (!sandbox || sandbox.demo_stage !== from) return; // stale button: someone already advanced
  const index = STAGES.indexOf(from);
  const to = STAGES[index + 1];
  if (!to) return;

  // Claim the step first, so two quick clicks cannot run the same automation twice.
  const { data: claimed } = await db.from("sandboxes").update({ demo_stage: to }).eq("id", sandboxId).eq("demo_stage", from).select("id");
  if (!claimed?.length) return;
  try {
    if (from === "applied") {
      // Normally the visitor applies on the 신청 screen first. When the clock is moved from the
      // operator screen or the failing participant's view instead, "me" applies with the defaults
      // (Hongdae, single pass) so the scenario never gets stuck.
      const { count } = await db.from("applications").select("id", { count: "exact", head: true }).eq("sandbox_id", sandboxId).eq("profile_id", sandbox.me_profile_id);
      if (!count) {
        const { data: slot } = await db.from("event_slots").select("id").eq("sandbox_id", sandboxId).eq("event_date", DEMO_WEEK).eq("region", "hongdae").single();
        if (slot) await submitApplication(sandboxId, sandbox.me_profile_id, STAGE_CLOCK.applied, slot.id, false, "single");
      }
    }
    await runStep(sandboxId, from, actor);
  } catch (error) {
    await db.from("sandboxes").update({ demo_stage: from }).eq("id", sandboxId);
    throw error;
  }

  await db.from("sandboxes").update({ demo_clock: STAGE_CLOCK[to] }).eq("id", sandboxId);
  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "sandbox", entity_id: sandboxId, actor, action: "advance_demo_clock",
    before: { stage: from }, after: { stage: to, clock: STAGE_CLOCK[to] },
  });
}

async function runStep(sandboxId: string, from: Stage, actor: string) {
  const db = createAdminClient();
  if (from === "applied") await runMatching(sandboxId, DEMO_WEEK, actor);
  if (from === "matched") {
    await sendReminders(sandboxId, DEMO_WEEK);
    await addVirtualChatter(sandboxId);
  }
  if (from === "reminded") {
    await postConversationCards(sandboxId, DEMO_WEEK);
    // Virtual tablemates arrive on their own; the visitor checks in with the button in the group chat.
    const { data: virtual } = await db.from("applications").select("id, profiles!inner(is_virtual)")
      .eq("sandbox_id", sandboxId).eq("week_of", DEMO_WEEK).eq("match_status", "confirmed").eq("profiles.is_virtual", true);
    const ids = (virtual ?? []).map((a) => a.id);
    if (ids.length) await db.from("applications").update({ attendance_status: "checked_in", checked_in_at: STAGE_CLOCK.dining }).in("id", ids);
  }
  if (from === "dining") {
    await requestFeedback(sandboxId, DEMO_WEEK);
    await simulateVirtualFeedback(sandboxId, DEMO_WEEK);
  }
  if (from === "finished") {
    const next = await openNextWeek(sandboxId, DEMO_WEEK);
    await runMatching(sandboxId, next.weekOf, actor);
  }
}

const CHATTER = [
  "안녕하세요! 목요일에 뵐게요. 다들 이 근처 자주 오세요?",
  "반가워요 :) 저는 퇴근하고 바로 갈 것 같아요. 조금 늦으면 먼저 시작해 주세요!",
];

/** Demo only: two virtual tablemates say hello in each group chat, so the room is not empty. */
async function addVirtualChatter(sandboxId: string) {
  const db = createAdminClient();
  const { data: tables } = await db
    .from("dining_tables")
    .select("id, table_members(profile_id, profiles(is_virtual))")
    .eq("sandbox_id", sandboxId)
    .eq("status", "confirmed");
  for (const t of tables ?? []) {
    const virtual = (t.table_members as unknown as { profile_id: string; profiles: { is_virtual: boolean } }[])
      .filter((m) => m.profiles.is_virtual)
      .slice(0, CHATTER.length);
    const rows = virtual.map((m, i) => ({
      sandbox_id: sandboxId, table_id: t.id, sender_profile_id: m.profile_id, kind: "user", body: CHATTER[i],
      dedupe_key: `table:${t.id}:chatter:${i}`,
    }));
    // The dedupe index is partial, which upsert cannot target, so skip keys that already exist.
    const { data: existing } = await db.from("chat_messages").select("dedupe_key").eq("table_id", t.id).like("dedupe_key", "%:chatter:%");
    const fresh = rows.filter((r) => !(existing ?? []).some((e) => e.dedupe_key === r.dedupe_key));
    if (fresh.length) await db.from("chat_messages").insert(fresh);
  }
}
