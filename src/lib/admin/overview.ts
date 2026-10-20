import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import type { DemoSession } from "../auth/session.ts";

/** The week the operator is looking at: the next one once the demo has moved on. */
export function currentWeek(session: DemoSession) {
  return session.stage === "next_matched" ? "2026-10-29" : "2026-10-22";
}

export async function getOverview(session: DemoSession, weekOf: string) {
  const db = createAdminClient();
  const sid = session.sandboxId;
  const { data: apps } = await db.from("applications").select("id, payment_status, match_status").eq("sandbox_id", sid).eq("week_of", weekOf);
  const { data: tables } = await db
    .from("dining_tables")
    .select("id, score, reason, status, venue_id, venues(name), event_slots!inner(event_date, region), table_members(profile_id, left_at, profiles(display_name, birth_year, gender))")
    .eq("sandbox_id", sid)
    .eq("event_slots.event_date", weekOf)
    .order("score", { ascending: false });
  const { data: exceptions } = await db
    .from("exception_cases")
    .select("id, type, title, status, detail, table_id, retry_count, resolution, created_at")
    .eq("sandbox_id", sid)
    .order("created_at", { ascending: false });
  const { data: venues } = await db.from("venues").select("id, name, region, rating, tables_available").eq("sandbox_id", sid).order("region");
  const { data: run } = await db.from("match_runs").select("status, summary, finished_at").eq("sandbox_id", sid).eq("idempotency_key", `week:${weekOf}`).maybeSingle();

  // Everyone who paid for this week, including those later refunded or moved.
  const paid = (apps ?? []).filter((a) => !["pending", "failed"].includes(a.payment_status)).length;
  const seated = (apps ?? []).filter((a) => a.match_status === "confirmed").length;
  const failed = (apps ?? []).filter((a) => a.match_status === "failed" || a.match_status === "resolved").length;
  const open = (exceptions ?? []).filter((e) => e.status === "open");
  return {
    weekOf,
    run,
    kpi: {
      paid,
      tables: (tables ?? []).length,
      autoRate: paid ? Math.round((seated / paid) * 100) : 0,
      seated,
      failed,
      open: open.length,
    },
    tables: (tables ?? []) as unknown as {
      id: string; score: number | null; reason: string | null; status: string; venue_id: string | null;
      venues: { name: string } | null; event_slots: { event_date: string; region: string };
      table_members: { profile_id: string; left_at: string | null; profiles: { display_name: string; birth_year: number; gender: string } }[];
    }[],
    exceptions: exceptions ?? [],
    venues: venues ?? [],
  };
}
