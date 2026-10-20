// Creates (or resets) the three submission test accounts.
// Passwords are random and written to data/private/test-accounts.txt (git-ignored).
//
// Usage: node --env-file=.env.local scripts/create-test-accounts.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ACCOUNTS = [
  { email: "participant@wooyeon-demo.com", label: "참가자", app_metadata: { role: "participant" } },
  { email: "unmatched@wooyeon-demo.com", label: "매칭 실패 참가자", app_metadata: { role: "participant", persona: "fail" } },
  { email: "operator@wooyeon-demo.com", label: "운영자", app_metadata: { role: "operator" } },
];

// Readable but not guessable: 4 groups of 4 from an unambiguous alphabet.
function password() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

const { data: list, error } = await db.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;

const lines = [];
for (const account of ACCOUNTS) {
  const pw = password();
  const existing = list.users.find((u) => u.email === account.email);
  const result = existing
    ? await db.auth.admin.updateUserById(existing.id, { password: pw, app_metadata: account.app_metadata, email_confirm: true })
    : await db.auth.admin.createUser({ email: account.email, password: pw, app_metadata: account.app_metadata, email_confirm: true });
  if (result.error) throw result.error;
  lines.push(`${account.label}\t${account.email}\t${pw}`);
}

const out = new URL("../data/private/test-accounts.txt", import.meta.url);
mkdirSync(new URL("./", out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600 });
console.log(`${ACCOUNTS.length} accounts ready. Passwords saved to data/private/test-accounts.txt`);
