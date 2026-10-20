import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import { DEFAULT_RULES, matchWeek, pairKey, type Applicant, type Candidate, type Relations, type Rules } from "./engine.ts";

type Db = ReturnType<typeof createAdminClient>;

export type RunSummary = {
  runId: string;
  reused: boolean;
  tables: number;
  seated: number;
  failed: number;
  moved: number;
};

async function loadRules(db: Db, sandboxId: string): Promise<Rules> {
  const { data } = await db.from("matching_rules").select("*").eq("sandbox_id", sandboxId).maybeSingle();
  if (!data) return DEFAULT_RULES;
  return {
    weightGender: Number(data.weight_gender),
    weightMbti: Number(data.weight_mbti),
    weightInterests: Number(data.weight_interests),
    weightWants: Number(data.weight_wants),
    weightNewPeople: Number(data.weight_new_people),
    minScore: Number(data.min_score),
    maxAgeGap: data.max_age_gap,
  };
}

async function loadRelations(db: Db, sandboxId: string): Promise<Relations> {
  const { data, error } = await db.from("user_relations").select("profile_id, other_profile_id, kind").eq("sandbox_id", sandboxId);
  if (error) throw error;
  const relations: Relations = { forbidden: new Set(), met: new Set(), mutualAgain: new Set() };
  for (const r of data) {
    const key = pairKey(r.profile_id, r.other_profile_id);
    if (r.kind === "blocked" || r.kind === "disliked") relations.forbidden.add(key);
    else if (r.kind === "met") relations.met.add(key);
    else if (r.kind === "mutual_again") relations.mutualAgain.add(key);
  }
  return relations;
}

/**
 * Runs matching for one week of one sandbox. Running it again for the same
 * week returns the first result instead of creating duplicate tables.
 */
export async function runMatching(sandboxId: string, weekOf: string, actor: string): Promise<RunSummary> {
  const db = createAdminClient();
  const idempotencyKey = `week:${weekOf}`;

  const { data: existing } = await db
    .from("match_runs")
    .select("id, status, summary")
    .eq("sandbox_id", sandboxId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing?.status === "succeeded") {
    return { ...(existing.summary as Omit<RunSummary, "runId" | "reused">), runId: existing.id, reused: true };
  }
  if (existing?.status === "running") throw new Error("이미 매칭이 진행 중이에요.");
  // A failed run left nothing confirmed, so it can be retried with the same key.
  if (existing) await db.from("match_runs").delete().eq("id", existing.id);

  const rules = await loadRules(db, sandboxId);
  const { data: run, error: runError } = await db
    .from("match_runs")
    .insert({ sandbox_id: sandboxId, idempotency_key: idempotencyKey, rules_snapshot: rules })
    .select("id")
    .single();
  // A unique-key conflict means another request started this run first.
  if (runError) throw new Error(`이미 매칭이 진행 중이에요 (${runError.code}).`);

  try {
    const { data: slots, error: slotError } = await db
      .from("event_slots")
      .select("id")
      .eq("sandbox_id", sandboxId)
      .eq("event_date", weekOf);
    if (slotError) throw slotError;
    const slotIds = slots.map((s) => s.id);

    const { data: apps, error: appError } = await db
      .from("applications")
      .select("id, profile_id, pass_id, application_options(event_slot_id, priority), profiles(id, display_name, birth_year, gender, mbti, interests, personality, wants)")
      .eq("sandbox_id", sandboxId)
      .eq("week_of", weekOf)
      .eq("payment_status", "paid")
      .eq("match_status", "waiting");
    if (appError) throw appError;

    const applicants: Applicant[] = apps.map((a) => {
      const p = a.profiles as unknown as {
        id: string; display_name: string; birth_year: number; gender: "female" | "male";
        mbti: string | null; interests: string[]; personality: string[]; wants: string[];
      };
      const candidate: Candidate = {
        applicationId: a.id,
        profileId: p.id,
        name: p.display_name,
        birthYear: p.birth_year,
        gender: p.gender,
        mbti: p.mbti,
        interests: p.interests,
        personality: p.personality,
        wants: p.wants,
      };
      const options = (a.application_options as { event_slot_id: string; priority: number }[])
        .filter((o) => slotIds.includes(o.event_slot_id))
        .sort((x, y) => x.priority - y.priority)
        .map((o) => o.event_slot_id);
      return { candidate, slotIds: options };
    });

    const relations = await loadRelations(db, sandboxId);
    const result = matchWeek(applicants, relations, rules);

    // Tables and members.
    const tableRows = result.tables.map((t) => ({
      id: crypto.randomUUID(),
      sandbox_id: sandboxId,
      match_run_id: run.id,
      event_slot_id: t.slotId,
      status: "confirmed",
      score: t.score,
      reason: t.reason,
    }));
    if (tableRows.length) {
      const { error } = await db.from("dining_tables").insert(tableRows);
      if (error) throw error;
    }
    const memberRows = result.tables.flatMap((t, i) =>
      t.members.map((m) => ({
        sandbox_id: sandboxId,
        table_id: tableRows[i].id,
        application_id: m.applicationId,
        profile_id: m.profileId,
        joined_reason: t.movedIn.includes(m.applicationId)
          ? `다른 후보 일정으로 재배치 · ${t.memberReasons[m.applicationId]}`
          : t.memberReasons[m.applicationId],
      })),
    );
    if (memberRows.length) {
      const { error } = await db.from("table_members").insert(memberRows);
      if (error) throw error;
    }

    // Application statuses.
    const moved = new Set(result.tables.flatMap((t) => t.movedIn));
    const confirmedIds = result.tables.flatMap((t) => t.members.map((m) => m.applicationId));
    if (confirmedIds.length) {
      const { error } = await db
        .from("applications")
        .update({ match_status: "confirmed", updated_at: new Date().toISOString() })
        .in("id", confirmedIds.filter((id) => !moved.has(id)));
      if (error) throw error;
    }
    for (const id of moved) {
      await db.from("applications").update({ match_status: "confirmed", match_note: "다른 후보 일정으로 재배치됐어요." }).eq("id", id);
    }
    for (const u of result.unmatched) {
      await db.from("applications").update({ match_status: "failed", match_note: u.reason }).eq("id", u.candidate.applicationId);
    }

    // Membership holders get +7 days for each failed match (operating policy).
    const failedIds = result.unmatched.map((u) => u.candidate.applicationId);
    const failedApps = apps.filter((a) => failedIds.includes(a.id) && a.pass_id);
    for (const a of failedApps) {
      const { data: pass } = await db.from("passes").select("id, kind, expires_at, extended_days").eq("id", a.pass_id!).single();
      if (!pass || pass.kind === "single" || !pass.expires_at) continue;
      const expires = new Date(pass.expires_at);
      expires.setDate(expires.getDate() + 7);
      await db.from("passes").update({ expires_at: expires.toISOString(), extended_days: pass.extended_days + 7 }).eq("id", pass.id);
      await db.from("match_resolutions").insert({
        sandbox_id: sandboxId,
        application_id: a.id,
        kind: "membership_extended",
        reason: "매칭 실패로 멤버십 기한 7일 연장",
        detail: { new_expires_at: expires.toISOString() },
      });
    }

    if (slotIds.length) await db.from("event_slots").update({ status: "confirmed" }).in("id", slotIds);

    const summary = {
      tables: result.tables.length,
      seated: confirmedIds.length,
      failed: result.unmatched.length,
      moved: moved.size,
    };
    await db.from("match_runs").update({ status: "succeeded", summary, finished_at: new Date().toISOString() }).eq("id", run.id);
    await db.from("audit_logs").insert({
      sandbox_id: sandboxId,
      entity: "match_run",
      entity_id: run.id,
      actor,
      action: "run_matching",
      after: summary,
      reason: `${weekOf} 회차 자동 매칭`,
    });
    return { ...summary, runId: run.id, reused: false };
  } catch (error) {
    await db.from("match_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
    await db.from("exception_cases").insert({
      sandbox_id: sandboxId,
      type: "other",
      title: "자동 매칭 실행 실패",
      detail: { week_of: weekOf, message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
