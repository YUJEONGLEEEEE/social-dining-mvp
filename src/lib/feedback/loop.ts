import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import { DEFAULT_RULES, matchWeek, pairKey, type Applicant, type Relations, type Rules } from "../matching/engine.ts";

// Feedback after the meal, and how it changes the next match:
//   both chose "again"  -> mutual_again (score bonus next time)
//   "never"             -> disliked (never the same table again, a hard rule)
//   sat together        -> met (lowers the "new people" score)

type Db = ReturnType<typeof createAdminClient>;
export type PersonChoice = { targetProfileId: string; choice: "again" | "neutral" | "never" };
export type Intent = "yes" | "maybe" | "no";
export type FeedbackDetail = { mood?: number; talk?: number; venue?: number; rejoin?: Intent; recommend?: Intent };

const NEXT_WEEK = "2026-10-29";

function kst(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();
}

async function upsertRelations(db: Db, sandboxId: string, rows: { profile_id: string; other_profile_id: string; kind: string; source: string }[]) {
  if (!rows.length) return;
  const { error } = await db
    .from("user_relations")
    .upsert(rows.map((r) => ({ ...r, sandbox_id: sandboxId })), { onConflict: "profile_id,other_profile_id,kind", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** Records one participant's feedback. Submitting twice keeps the first answer. */
export async function submitFeedback(
  sandboxId: string,
  applicationId: string,
  input: { rating: number; comment?: string; choices: PersonChoice[]; detail?: FeedbackDetail },
  actor: string,
) {
  const db = createAdminClient();
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error("만족도는 1~5 사이로 골라 주세요.");

  const { data: seat } = await db
    .from("table_members")
    .select("table_id, profile_id")
    .eq("sandbox_id", sandboxId)
    .eq("application_id", applicationId)
    .is("left_at", null)
    .maybeSingle();
  if (!seat) throw new Error("이 신청으로 앉은 테이블이 없어요.");

  const { data: existing } = await db.from("feedbacks").select("id").eq("application_id", applicationId).maybeSingle();
  if (existing) return { feedbackId: existing.id, duplicate: true };

  const { data: tablemates } = await db.from("table_members").select("profile_id").eq("table_id", seat.table_id).is("left_at", null);
  const others = new Set((tablemates ?? []).map((m) => m.profile_id).filter((id) => id !== seat.profile_id));
  // Only people who were actually at this table can be rated.
  const choices = input.choices.filter((c) => others.has(c.targetProfileId));

  const { data: feedback, error } = await db
    .from("feedbacks")
    .insert({
      sandbox_id: sandboxId, application_id: applicationId, table_id: seat.table_id, rating: input.rating, comment: input.comment?.slice(0, 1000) || null,
      rating_mood: input.detail?.mood ?? null, rating_talk: input.detail?.talk ?? null, rating_venue: input.detail?.venue ?? null,
      would_rejoin: input.detail?.rejoin ?? null, would_recommend: input.detail?.recommend ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (choices.length) {
    const { error: peopleError } = await db.from("feedback_people").insert(choices.map((c) => ({
      sandbox_id: sandboxId, feedback_id: feedback.id, target_profile_id: c.targetProfileId, choice: c.choice,
    })));
    if (peopleError) throw new Error(peopleError.message);
  }

  const me = seat.profile_id;
  const relations = [...others].flatMap((other) => [
    { profile_id: me, other_profile_id: other, kind: "met", source: "feedback" },
    { profile_id: other, other_profile_id: me, kind: "met", source: "feedback" },
  ]);
  for (const c of choices.filter((x) => x.choice === "never")) {
    relations.push({ profile_id: me, other_profile_id: c.targetProfileId, kind: "disliked", source: "feedback" });
  }

  // "again" becomes mutual only when the other person chose "again" for me too.
  const againTargets = choices.filter((c) => c.choice === "again").map((c) => c.targetProfileId);
  if (againTargets.length) {
    const { data: theirs } = await db
      .from("feedback_people")
      .select("target_profile_id, feedbacks!inner(table_id, applications!inner(profile_id))")
      .eq("target_profile_id", me)
      .eq("choice", "again")
      .eq("feedbacks.table_id", seat.table_id);
    const likedMeBack = new Set(
      (theirs ?? []).map((r) => (r.feedbacks as unknown as { applications: { profile_id: string } }).applications.profile_id),
    );
    for (const target of againTargets.filter((t) => likedMeBack.has(t))) {
      relations.push(
        { profile_id: me, other_profile_id: target, kind: "mutual_again", source: "feedback" },
        { profile_id: target, other_profile_id: me, kind: "mutual_again", source: "feedback" },
      );
    }
  }
  await upsertRelations(db, sandboxId, relations);

  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "feedback", entity_id: feedback.id, actor, action: "submit_feedback",
    after: { rating: input.rating, again: againTargets.length, never: choices.filter((c) => c.choice === "never").length },
  });
  return { feedbackId: feedback.id, duplicate: false };
}

/**
 * Demo only: the virtual tablemates answer too, so mutual choices can form.
 * A virtual person says "again" to tablemates who share two or more interests with them.
 */
export async function simulateVirtualFeedback(sandboxId: string, weekOf: string) {
  const db = createAdminClient();
  const { data: seats, error } = await db
    .from("table_members")
    .select("application_id, table_id, profile_id, profiles!inner(is_virtual, interests), dining_tables!inner(event_slots!inner(event_date))")
    .eq("sandbox_id", sandboxId)
    .eq("dining_tables.event_slots.event_date", weekOf)
    .is("left_at", null);
  if (error) throw new Error(error.message);
  type Seat = { application_id: string; table_id: string; profile_id: string; profiles: { is_virtual: boolean; interests: string[] } };
  const rows = seats as unknown as Seat[];

  let submitted = 0;
  for (const seat of rows.filter((s) => s.profiles.is_virtual)) {
    const mates = rows.filter((s) => s.table_id === seat.table_id && s.profile_id !== seat.profile_id);
    const choices: PersonChoice[] = mates.map((m) => {
      const shared = m.profiles.interests.filter((i) => seat.profiles.interests.includes(i)).length;
      return { targetProfileId: m.profile_id, choice: shared >= 2 || !m.profiles.is_virtual ? "again" : "neutral" };
    });
    // Varied but repeatable answers, so the operator's summary has something to show.
    const n = seat.profiles.interests.length;
    const detail: FeedbackDetail = { mood: 3 + (n % 3), talk: 3 + ((n + 1) % 3), venue: 4, rejoin: n % 4 === 0 ? "maybe" : "yes", recommend: n % 3 === 0 ? "maybe" : "yes" };
    const result = await submitFeedback(sandboxId, seat.application_id, { rating: 4, choices, detail }, "demo-simulation");
    if (!result.duplicate) submitted++;
  }
  return { submitted };
}

/**
 * Demo only: everyone who sat at a table this week applies again for next
 * Thursday, and matching runs with the relations the feedback just created.
 */
export async function openNextWeek(sandboxId: string, weekOf: string) {
  const db = createAdminClient();
  const { data: slot } = await db.from("event_slots").select("id").eq("sandbox_id", sandboxId).eq("event_date", NEXT_WEEK).eq("region", "hongdae").maybeSingle();
  let slotId = slot?.id;
  if (!slotId) {
    const { data: created, error } = await db
      .from("event_slots")
      .insert({ sandbox_id: sandboxId, event_date: NEXT_WEEK, region: "hongdae", starts_at: kst(NEXT_WEEK, 19), match_deadline_at: kst("2026-10-28", 0) })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    slotId = created.id;
  }

  // A new week means fresh restaurant inventory (Hongdae keeps its demo limit of one table per venue).
  await db.from("venues").update({ tables_available: 3 }).eq("sandbox_id", sandboxId).neq("region", "hongdae");
  await db.from("venues").update({ tables_available: 1 }).eq("sandbox_id", sandboxId).eq("region", "hongdae");

  const { data: seated } = await db
    .from("table_members")
    .select("profile_id, dining_tables!inner(event_slots!inner(event_date))")
    .eq("sandbox_id", sandboxId)
    .eq("dining_tables.event_slots.event_date", weekOf)
    .is("left_at", null);
  // People under a no-show or report restriction do not re-apply automatically.
  const { data: restricted } = await db.from("profiles").select("id").eq("sandbox_id", sandboxId).gt("restricted_until", kst(NEXT_WEEK, 0));
  const blocked = new Set((restricted ?? []).map((r) => r.id));
  const people = [...new Set((seated ?? []).map((s) => s.profile_id))].filter((p) => !blocked.has(p));
  const { data: already } = await db.from("applications").select("profile_id").eq("sandbox_id", sandboxId).eq("week_of", NEXT_WEEK);
  const fresh = people.filter((p) => !(already ?? []).some((a) => a.profile_id === p));
  if (fresh.length) {
    const { data: passes } = await db.from("applications").select("profile_id, pass_id").eq("sandbox_id", sandboxId).eq("week_of", weekOf).in("profile_id", fresh);
    const passOf = new Map((passes ?? []).map((p) => [p.profile_id, p.pass_id]));
    const apps = fresh.map((profile_id) => ({ id: crypto.randomUUID(), sandbox_id: sandboxId, profile_id, pass_id: passOf.get(profile_id) ?? null, week_of: NEXT_WEEK, payment_status: "paid" }));
    await db.from("applications").insert(apps);
    await db.from("application_options").insert(apps.map((a) => ({ sandbox_id: sandboxId, application_id: a.id, event_slot_id: slotId, priority: 1 })));
  }
  return { weekOf: NEXT_WEEK, applicants: people.length };
}

/**
 * Demo explanation: matches the same applicants twice, once ignoring the
 * feedback-created relations and once with them, and reports what changed for
 * one participant. Nothing is written.
 */
export async function compareFeedbackEffect(sandboxId: string, weekOf: string, profileId: string) {
  const db = createAdminClient();
  const { data: apps, error } = await db
    .from("applications")
    .select("id, application_options(event_slot_id, priority), profiles!inner(id, display_name, birth_year, gender, mbti, interests, personality, wants)")
    .eq("sandbox_id", sandboxId)
    .eq("week_of", weekOf)
    .eq("payment_status", "paid");
  if (error) throw new Error(error.message);
  const { data: rels } = await db.from("user_relations").select("profile_id, other_profile_id, kind, source").eq("sandbox_id", sandboxId);
  // Same rules the real run used, so "before" differs only by the feedback.
  const { data: run } = await db.from("match_runs").select("rules_snapshot").eq("sandbox_id", sandboxId).eq("idempotency_key", `week:${weekOf}`).maybeSingle();
  const snapshot = run?.rules_snapshot as Rules | null;
  const rules = snapshot && "minScore" in snapshot ? snapshot : DEFAULT_RULES;

  type P = { id: string; display_name: string; birth_year: number; gender: "female" | "male"; mbti: string | null; interests: string[]; personality: string[]; wants: string[] };
  const applicants: Applicant[] = apps.map((a) => {
    const p = a.profiles as unknown as P;
    return {
      candidate: { applicationId: a.id, profileId: p.id, name: p.display_name, birthYear: p.birth_year, gender: p.gender, mbti: p.mbti, interests: p.interests, personality: p.personality, wants: p.wants },
      slotIds: (a.application_options as { event_slot_id: string; priority: number }[]).sort((x, y) => x.priority - y.priority).map((o) => o.event_slot_id),
    };
  });
  const build = (withFeedback: boolean): Relations => {
    const r: Relations = { forbidden: new Set(), met: new Set(), mutualAgain: new Set() };
    for (const x of rels ?? []) {
      if (!withFeedback && x.source === "feedback") continue;
      const key = pairKey(x.profile_id, x.other_profile_id);
      if (x.kind === "blocked" || x.kind === "disliked") r.forbidden.add(key);
      else if (x.kind === "met") r.met.add(key);
      else if (x.kind === "mutual_again") r.mutualAgain.add(key);
    }
    return r;
  };
  const withFeedback = build(true);
  const tablemates = (rel: Relations) => {
    const table = matchWeek(applicants, rel, rules).tables.find((t) => t.members.some((m) => m.profileId === profileId));
    return { members: table?.members.filter((m) => m.profileId !== profileId) ?? [], reason: table?.reason ?? null, score: table?.score ?? null };
  };
  const before = tablemates(build(false));
  // "After" is the table this person was actually seated at, not a re-run.
  const { data: seat } = await db
    .from("table_members")
    .select("table_id, dining_tables!inner(reason, score, event_slots!inner(event_date))")
    .eq("profile_id", profileId)
    .eq("dining_tables.event_slots.event_date", weekOf)
    .is("left_at", null)
    .maybeSingle();
  const { data: mates } = seat
    ? await db.from("table_members").select("profile_id, profiles(display_name)").eq("table_id", seat.table_id).is("left_at", null).neq("profile_id", profileId)
    : { data: [] };
  const seated = seat?.dining_tables as unknown as { reason: string | null; score: number | null } | undefined;
  const after = {
    members: (mates ?? []).map((m) => ({ profileId: m.profile_id, name: (m.profiles as unknown as { display_name: string }).display_name })),
    reason: seated?.reason ?? null,
    score: seated?.score ?? null,
  };
  const label = (id: string) => {
    const key = pairKey(profileId, id);
    if (withFeedback.forbidden.has(key)) return "never";
    if (withFeedback.mutualAgain.has(key)) return "mutual_again";
    if (withFeedback.met.has(key)) return "met";
    return "new";
  };
  return {
    before: { ...before, members: before.members.map((m) => ({ name: m.name, relation: label(m.profileId) })) },
    after: { ...after, members: after.members.map((m) => ({ name: m.name, relation: label(m.profileId) })) },
  };
}
