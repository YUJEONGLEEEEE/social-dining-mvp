// Re-match every past slot in the base sandbox with the engine and compare
// against the synthesized history (age-sorted chunks, the "manual" baseline).
//
// Usage: node --env-file=.env.local scripts/evaluate-matching.ts

import { createClient } from "@supabase/supabase-js";
import { DEFAULT_RULES, matchWeek, scoreTable, type Applicant, type Candidate, type Relations } from "../src/lib/matching/engine.ts";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

async function all<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

type Profile = { id: string; display_name: string; birth_year: number; gender: "female" | "male"; mbti: string | null; interests: string[]; personality: string[]; wants: string[] };
type Option = { application_id: string; event_slot_id: string };
type Member = { table_id: string; profile_id: string };
type Slot = { id: string; is_history: boolean };
type Application = { id: string; profile_id: string };

const [profiles, applications, options, slots, members] = await Promise.all([
  all<Profile>("profiles", "id, display_name, birth_year, gender, mbti, interests, personality, wants"),
  all<Application>("applications", "id, profile_id"),
  all<Option>("application_options", "application_id, event_slot_id"),
  all<Slot>("event_slots", "id, is_history"),
  all<Member>("table_members", "table_id, profile_id"),
]);

const profileById = new Map(profiles.map((p) => [p.id, p]));
const appById = new Map(applications.map((a) => [a.id, a]));
const historySlots = new Set(slots.filter((s) => s.is_history).map((s) => s.id));
const noRelations: Relations = { forbidden: new Set(), met: new Set(), mutualAgain: new Set() };

const toCandidate = (applicationId: string): Candidate => {
  const p = profileById.get(appById.get(applicationId)!.profile_id)!;
  return { applicationId, profileId: p.id, name: p.display_name, birthYear: p.birth_year, gender: p.gender, mbti: p.mbti, interests: p.interests, personality: p.personality, wants: p.wants };
};

// Baseline: the history tables as stored.
const baseline = new Map<string, Candidate[]>();
for (const m of members) {
  const p = profileById.get(m.profile_id)!;
  const list = baseline.get(m.table_id) ?? [];
  list.push({ applicationId: m.profile_id, profileId: p.id, name: p.display_name, birthYear: p.birth_year, gender: p.gender, mbti: p.mbti, interests: p.interests, personality: p.personality, wants: p.wants });
  baseline.set(m.table_id, list);
}

// Engine: same applicants, same slots, no prior relations (fair comparison).
const applicants: Applicant[] = options
  .filter((o) => historySlots.has(o.event_slot_id))
  .map((o) => ({ candidate: toCandidate(o.application_id), slotIds: [o.event_slot_id] }));
const result = matchWeek(applicants, noRelations, DEFAULT_RULES);

function summarize(tables: Candidate[][], unmatched: number) {
  const scores = tables.map((t) => scoreTable(t, noRelations, DEFAULT_RULES).score);
  const minority = (t: Candidate[]) => Math.min(t.filter((m) => m.gender === "female").length, t.filter((m) => m.gender === "male").length);
  return {
    tables: tables.length,
    seated: tables.reduce((n, t) => n + t.length, 0),
    unmatched,
    singleGender: tables.filter((t) => minority(t) === 0).length,
    onlyOneOtherGender: tables.filter((t) => minority(t) === 1).length,
    avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
    belowMinScore: scores.filter((s) => s < DEFAULT_RULES.minScore).length,
  };
}

const totalApplicants = applicants.length;
const baselineTables = [...baseline.values()];
console.table({
  "before (age-sorted)": summarize(baselineTables, totalApplicants - baselineTables.reduce((n, t) => n + t.length, 0)),
  "engine": summarize(result.tables.map((t) => t.members), result.unmatched.length),
});
console.log("sample reason:", result.tables[0]?.reason);
