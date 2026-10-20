import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import type { DemoSession } from "../auth/session.ts";

export type Journey = Awaited<ReturnType<typeof getJourney>>;

/** Everything the participant screens need for the current persona's latest application. */
export async function getJourney(session: DemoSession) {
  const db = createAdminClient();
  const sid = session.sandboxId;

  const { data: profile } = await db.from("profiles").select("id, display_name, consented_at").eq("id", session.profileId).eq("sandbox_id", sid).single();
  const { data: apps } = await db
    .from("applications")
    .select("id, week_of, application_status, payment_status, match_status, attendance_status, match_note, pass_id, passes(kind, price), application_options(priority, event_slots(id, event_date, region, starts_at, match_deadline_at))")
    .eq("sandbox_id", sid)
    .eq("profile_id", session.profileId)
    .order("week_of", { ascending: false });
  const application = apps?.[0] ?? null;

  let table: {
    id: string; score: number | null; reason: string | null; venueName: string | null; venueAddress: string | null;
    startsAt: string; region: string; myReason: string | null; members: { profileId: string; name: string; age: number }[];
  } | null = null;
  if (application) {
    const { data: seat } = await db
      .from("table_members")
      .select("joined_reason, dining_tables(id, score, reason, venues(name, address), event_slots(starts_at, region))")
      .eq("application_id", application.id)
      .is("left_at", null)
      .maybeSingle();
    const t = seat?.dining_tables as unknown as {
      id: string; score: number | null; reason: string | null; venues: { name: string; address: string | null } | null; event_slots: { starts_at: string; region: string };
    } | undefined;
    if (t) {
      const { data: members } = await db
        .from("table_members")
        .select("profile_id, profiles(display_name, birth_year)")
        .eq("table_id", t.id)
        .is("left_at", null);
      table = {
        id: t.id, score: t.score, reason: t.reason, venueName: t.venues?.name ?? null, venueAddress: t.venues?.address ?? null,
        startsAt: t.event_slots.starts_at, region: t.event_slots.region, myReason: seat!.joined_reason,
        members: (members ?? []).map((m) => {
          const p = m.profiles as unknown as { display_name: string; birth_year: number };
          return { profileId: m.profile_id, name: p.display_name, age: 2026 - p.birth_year };
        }),
      };
    }
  }

  const { count: unread } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("sandbox_id", sid)
    .eq("profile_id", session.profileId)
    .is("read_at", null);

  const { data: feedback } = application
    ? await db.from("feedbacks").select("id").eq("application_id", application.id).maybeSingle()
    : { data: null };

  const options = (application?.application_options ?? []) as unknown as {
    priority: number; event_slots: { id: string; event_date: string; region: string; starts_at: string; match_deadline_at: string };
  }[];
  return {
    profile,
    application,
    slots: options.sort((a, b) => a.priority - b.priority).map((o) => o.event_slots),
    pass: application?.passes as unknown as { kind: string; price: number } | null,
    table,
    unread: unread ?? 0,
    feedbackDone: !!feedback,
  };
}
