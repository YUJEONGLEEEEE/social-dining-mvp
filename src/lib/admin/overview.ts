import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import type { DemoSession } from "../auth/session.ts";

/** Weeks the operator can look at so far; week two appears once the demo has moved on. */
export function weeksSoFar(session: DemoSession) {
  return session.stage === "next_matched" ? ["2026-10-22", "2026-10-29"] : ["2026-10-22"];
}

/** The week the operator is looking at: the one asked for, else the latest. */
export function currentWeek(session: DemoSession, requested?: string) {
  const weeks = weeksSoFar(session);
  return requested && weeks.includes(requested) ? requested : weeks[weeks.length - 1];
}

export async function getOverview(session: DemoSession, weekOf: string) {
  const db = createAdminClient();
  const sid = session.sandboxId;
  const { data: apps } = await db.from("applications").select("id, payment_status, match_status, attendance_status").eq("sandbox_id", sid).eq("week_of", weekOf);
  const { data: tables } = await db
    .from("dining_tables")
    .select("id, score, reason, status, venue_id, venues(name), event_slots!inner(event_date, region), table_members(profile_id, left_at, profiles(display_name, birth_year, gender))")
    .eq("sandbox_id", sid)
    .eq("event_slots.event_date", weekOf)
    .order("score", { ascending: false });
  const { data: exceptions } = await db
    .from("exception_cases")
    .select("id, type, title, status, detail, table_id, retry_count, resolution, created_at, dining_tables(event_slots(event_date))")
    .eq("sandbox_id", sid)
    .order("created_at", { ascending: false });
  // Each week shows its own cases; cases without a table (a failed run) show in every week.
  const exceptionsThisWeek = (exceptions ?? []).filter((e) => {
    const date = (e.dining_tables as unknown as { event_slots: { event_date: string } } | null)?.event_slots.event_date;
    return !date || date === weekOf;
  });
  const { data: venues } = await db.from("venues").select("id, name, region, rating, tables_available").eq("sandbox_id", sid).order("region");
  const { data: feedback } = await db.from("feedbacks")
    .select("rating, rating_mood, rating_talk, rating_venue, would_rejoin, would_recommend, dining_tables!inner(event_slots!inner(event_date))")
    .eq("sandbox_id", sid).lte("dining_tables.event_slots.event_date", weekOf);
  const { data: run } = await db.from("match_runs").select("status, summary, finished_at").eq("sandbox_id", sid).eq("idempotency_key", `week:${weekOf}`).maybeSingle();

  // Everyone who paid for this week, including those later refunded or moved.
  const paid = (apps ?? []).filter((a) => !["pending", "failed"].includes(a.payment_status)).length;
  const seated = (apps ?? []).filter((a) => a.match_status === "confirmed").length;
  const failed = (apps ?? []).filter((a) => a.match_status === "failed" || a.match_status === "resolved").length;
  const open = exceptionsThisWeek.filter((e) => e.status === "open");
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
      // 11장: people still choosing after a failed match, no-show candidates, unhandled reports.
      choosing: (apps ?? []).filter((a) => a.match_status === "failed").length,
      noShow: session.demoClock && new Date(session.demoClock) >= new Date(`${weekOf}T21:00:00+09:00`)
        ? (apps ?? []).filter((a) => a.match_status === "confirmed" && !["checked_in", "no_show"].includes(a.attendance_status)).length
        : 0,
      reports: open.filter((e) => e.type === "safety_report").length,
    },
    tables: (tables ?? []) as unknown as {
      id: string; score: number | null; reason: string | null; status: string; venue_id: string | null;
      venues: { name: string } | null; event_slots: { event_date: string; region: string };
      table_members: { profile_id: string; left_at: string | null; profiles: { display_name: string; birth_year: number; gender: string } }[];
    }[],
    exceptions: exceptionsThisWeek,
    feedback: summarizeFeedback(feedback ?? []),
    venues: venues ?? [],
  };
}

type FeedbackRow = { rating: number; rating_mood: number | null; rating_talk: number | null; rating_venue: number | null; would_rejoin: string | null; would_recommend: string | null };

/** Averages for the operator (11장 dashboard): overall, mood, talk, venue, and intent shares. */
function summarizeFeedback(rows: FeedbackRow[]) {
  const avg = (values: (number | null)[]) => {
    const v = values.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  const share = (values: (string | null)[]) => {
    const v = values.filter(Boolean);
    return v.length ? Math.round((v.filter((x) => x === "yes").length / v.length) * 100) : null;
  };
  return {
    count: rows.length,
    rating: avg(rows.map((r) => r.rating)),
    mood: avg(rows.map((r) => r.rating_mood)),
    talk: avg(rows.map((r) => r.rating_talk)),
    venue: avg(rows.map((r) => r.rating_venue)),
    rejoin: share(rows.map((r) => r.would_rejoin)),
    recommend: share(rows.map((r) => r.would_recommend)),
  };
}
