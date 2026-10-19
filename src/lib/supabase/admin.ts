import "server-only";
import { createClient } from "@supabase/supabase-js";

// Secret-key client that bypasses RLS. Server only: matching jobs, admin actions, seeding.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
