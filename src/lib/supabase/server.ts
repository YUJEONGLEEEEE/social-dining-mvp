import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// The session cookie is never read by browser scripts, so it stays httpOnly (XSS cannot steal it).
const SESSION_COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const };

// Server client for Server Components and Server Actions, bound to the user's session.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...SESSION_COOKIE }),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
          }
        },
      },
    },
  );
}
