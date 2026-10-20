import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server.ts";
import { createAdminClient } from "../supabase/admin.ts";
import type { Stage } from "../demo/clock.ts";

export type Persona = "me" | "fail";
export const PERSONA_COOKIE = "wt_persona";

export type DemoSession = {
  userId: string;
  isAnonymous: boolean;
  role: "participant" | "operator";
  sandboxId: string;
  persona: Persona;
  profileId: string;
  meProfileId: string;
  failProfileId: string | null;
  demoClock: string | null;
  stage: Stage;
};

/**
 * Resolves the signed-in user and their sandbox. The user comes from
 * supabase.auth.getUser(), which validates the token with Supabase,
 * never from anything the browser claims.
 */
export async function getDemoSession(): Promise<DemoSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const db = createAdminClient();
  const { data: sandbox } = await db
    .from("sandboxes")
    .select("id, me_profile_id, fail_profile_id, demo_clock, demo_stage")
    .eq("owner_user_id", user.id)
    .eq("kind", "demo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sandbox?.me_profile_id) return null;

  const store = await cookies();
  const persona: Persona = store.get(PERSONA_COOKIE)?.value === "fail" && sandbox.fail_profile_id ? "fail" : "me";
  return {
    userId: user.id,
    isAnonymous: user.is_anonymous ?? false,
    role: user.app_metadata?.role === "operator" ? "operator" : "participant",
    sandboxId: sandbox.id,
    persona,
    profileId: persona === "fail" ? sandbox.fail_profile_id! : sandbox.me_profile_id,
    meProfileId: sandbox.me_profile_id,
    failProfileId: sandbox.fail_profile_id,
    demoClock: sandbox.demo_clock,
    stage: sandbox.demo_stage as Stage,
  };
}

export async function requireDemoSession() {
  const session = await getDemoSession();
  if (!session) redirect("/");
  return session;
}
