import "server-only";
import { createAdminClient } from "../supabase/admin.ts";
import type { DemoSession } from "../auth/session.ts";

/** A table the current persona sits at, or null. Membership is checked on the server. */
export async function getMyTable(session: DemoSession, tableId: string) {
  const db = createAdminClient();
  const { data: seat } = await db
    .from("table_members")
    .select("application_id, applications(attendance_status)")
    .eq("sandbox_id", session.sandboxId)
    .eq("table_id", tableId)
    .eq("profile_id", session.profileId)
    .is("left_at", null)
    .maybeSingle();
  if (!seat) return null;

  const { data: table } = await db
    .from("dining_tables")
    .select("id, reason, venues(name, address), event_slots(starts_at, region), table_members(profile_id, left_at, profiles(display_name, birth_year, mbti))")
    .eq("id", tableId)
    .single();
  const { data: messages } = await db
    .from("chat_messages")
    .select("id, kind, body, sender_profile_id, created_at")
    .eq("table_id", tableId)
    .order("created_at");
  return {
    table: table as unknown as {
      id: string; reason: string | null; venues: { name: string; address: string | null } | null;
      event_slots: { starts_at: string; region: string };
      table_members: { profile_id: string; left_at: string | null; profiles: { display_name: string; birth_year: number; mbti: string | null } }[];
    },
    applicationId: seat.application_id,
    attendance: (seat.applications as unknown as { attendance_status: string }).attendance_status,
    messages: messages ?? [],
  };
}

/** The latest table of the current persona, for the "내 식탁" tab. */
export async function latestTableId(session: DemoSession) {
  const { data } = await createAdminClient()
    .from("table_members")
    .select("table_id, joined_at")
    .eq("sandbox_id", session.sandboxId)
    .eq("profile_id", session.profileId)
    .is("left_at", null)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.table_id ?? null;
}
