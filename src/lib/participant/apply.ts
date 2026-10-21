import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

// A participant applies and pays on their own (PRD completion condition 1, APP-01~03, PAY-01).
// Payment is a mock that always succeeds, which the hackathon allows.

export const PASS_PLANS = {
  single: { name: "1회권", price: 9900, days: null },
  membership_1m: { name: "멤버십 1개월", price: 35000, days: 30 },
  membership_3m: { name: "멤버십 3개월", price: 75000, days: 90 },
  membership_6m: { name: "멤버십 6개월", price: 120000, days: 180 },
} as const;
export type PassKind = keyof typeof PASS_PLANS;

export async function submitApplication(
  sandboxId: string,
  profileId: string,
  demoClock: string,
  firstSlotId: string,
  otherSlotsOk: boolean,
  passKind: PassKind,
) {
  const db = createAdminClient();
  const plan = PASS_PLANS[passKind];

  // Only open slots of this sandbox, before their matching deadline on the demo clock.
  const { data: open } = await db
    .from("event_slots")
    .select("id, event_date, match_deadline_at")
    .eq("sandbox_id", sandboxId)
    .eq("is_history", false)
    .gt("match_deadline_at", demoClock);
  const first = open?.find((s) => s.id === firstSlotId);
  if (!first) return { error: "신청할 수 있는 일정을 골라 주세요." };
  const slotIds = [first.id, ...(otherSlotsOk ? open!.filter((s) => s.event_date === first.event_date && s.id !== first.id).map((s) => s.id) : [])];

  // SAF-02: no-shows and sanctions block new applications for a while.
  const { data: person } = await db.from("profiles").select("restricted_until").eq("id", profileId).single();
  if (person?.restricted_until && new Date(person.restricted_until) > new Date(demoClock)) {
    return { error: `신청이 ${new Date(person.restricted_until).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}까지 제한돼 있어요.` };
  }

  // One application per person per week, so a double submit cannot pay twice.
  const { data: existing } = await db
    .from("applications")
    .select("id")
    .eq("sandbox_id", sandboxId)
    .eq("profile_id", profileId)
    .eq("week_of", first.event_date)
    .not("application_status", "in", "(cancelled,moved)")
    .limit(1);
  if (existing?.length) return { already: true };

  // A pass kept after a failed match is used first, with no new payment (RET-03).
  const kept = await keptPass(sandboxId, profileId);
  if (kept) {
    const { data: claimed } = await db.from("passes").update({ remaining_count: kept.remaining_count - 1 }).eq("id", kept.id).eq("remaining_count", kept.remaining_count).select("id");
    if (claimed?.length) {
      const { data: app, error } = await db
        .from("applications")
        .insert({ sandbox_id: sandboxId, profile_id: profileId, pass_id: kept.id, week_of: first.event_date, payment_status: "paid", created_at: demoClock })
        .select("id")
        .single();
      if (error) return { error: "신청하지 못했어요. 잠시 후 다시 시도해 주세요." };
      await db.from("application_options").insert(slotIds.map((id, i) => ({ sandbox_id: sandboxId, application_id: app.id, event_slot_id: id, priority: i + 1 })));
      await db.from("notifications").insert({
        sandbox_id: sandboxId, profile_id: profileId, type: "application_paid", title: "보관한 이용권으로 신청했어요",
        body: "추가 결제 없이 신청이 완료됐어요. 매칭 마감 후 결과를 알려드릴게요.", link: "/app", dedupe_key: `application_paid:${app.id}`,
      });
      await db.from("audit_logs").insert({
        sandbox_id: sandboxId, entity: "application", entity_id: app.id, actor: "participant", action: "apply_with_kept_pass",
        after: { pass: kept.id, slots: slotIds },
      });
      return { already: false };
    }
  }

  const startsAt = new Date(demoClock);
  const { data: pass, error: passError } = await db
    .from("passes")
    .insert({
      sandbox_id: sandboxId, profile_id: profileId, kind: passKind, price: plan.price,
      remaining_count: plan.days === null ? 0 : null, starts_at: startsAt.toISOString(),
      expires_at: plan.days === null ? null : new Date(startsAt.getTime() + plan.days * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (passError) return { error: "결제하지 못했어요. 잠시 후 다시 시도해 주세요." };

  const { data: app, error } = await db
    .from("applications")
    .insert({ sandbox_id: sandboxId, profile_id: profileId, pass_id: pass.id, week_of: first.event_date, payment_status: "paid", created_at: startsAt.toISOString() })
    .select("id")
    .single();
  if (error) return { error: "신청하지 못했어요. 잠시 후 다시 시도해 주세요." };

  await db.from("payments").insert({ sandbox_id: sandboxId, application_id: app.id, pass_id: pass.id, kind: "pay", amount: plan.price });
  await db.from("application_options").insert(slotIds.map((id, i) => ({ sandbox_id: sandboxId, application_id: app.id, event_slot_id: id, priority: i + 1 })));
  await db.from("notifications").insert({
    sandbox_id: sandboxId, profile_id: profileId, type: "application_paid", title: "신청과 결제가 완료됐어요",
    body: `${plan.name} ${plan.price.toLocaleString("ko-KR")}원 결제 완료. 화요일 24시 매칭 마감 후 결과를 알려드릴게요.`,
    link: "/app", dedupe_key: `application_paid:${app.id}`,
  });
  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "application", entity_id: app.id, actor: "participant", action: "apply_and_pay",
    after: { pass: passKind, amount: plan.price, slots: slotIds },
  });
  return { already: false };
}

/** A single-use pass returned to the participant after a failed match, if any is left. */
export async function keptPass(sandboxId: string, profileId: string) {
  const { data } = await createAdminClient()
    .from("passes")
    .select("id, remaining_count")
    .eq("sandbox_id", sandboxId)
    .eq("profile_id", profileId)
    .gt("remaining_count", 0)
    .limit(1)
    .maybeSingle();
  return data as { id: string; remaining_count: number } | null;
}
