import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import { runMatching } from "../matching/run.ts";
import { postConversationCards, requestFeedback, sendReminders } from "../automation/meetup.ts";
import { openNextWeek, simulateVirtualFeedback } from "../feedback/loop.ts";
import { DEMO_WEEK } from "./sandbox.ts";

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
  const { data: sandbox } = await db.from("sandboxes").select("demo_stage").eq("id", sandboxId).eq("owner_user_id", ownerUserId).single();
  if (!sandbox || sandbox.demo_stage !== from) return; // stale button: someone already advanced

  const index = STAGES.indexOf(from);
  const to = STAGES[index + 1];
  if (!to) return;

  if (from === "applied") await runMatching(sandboxId, DEMO_WEEK, actor);
  if (from === "matched") await sendReminders(sandboxId, DEMO_WEEK);
  if (from === "reminded") {
    await postConversationCards(sandboxId, DEMO_WEEK);
    await db.from("applications").update({ attendance_status: "checked_in", checked_in_at: STAGE_CLOCK.dining })
      .eq("sandbox_id", sandboxId).eq("week_of", DEMO_WEEK).eq("match_status", "confirmed");
  }
  if (from === "dining") {
    await requestFeedback(sandboxId, DEMO_WEEK);
    await simulateVirtualFeedback(sandboxId, DEMO_WEEK);
  }
  if (from === "finished") {
    const next = await openNextWeek(sandboxId, DEMO_WEEK);
    await runMatching(sandboxId, next.weekOf, actor);
  }

  await db.from("sandboxes").update({ demo_stage: to, demo_clock: STAGE_CLOCK[to] }).eq("id", sandboxId);
  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "sandbox", entity_id: sandboxId, actor, action: "advance_demo_clock",
    before: { stage: from }, after: { stage: to, clock: STAGE_CLOCK[to] },
  });
}
