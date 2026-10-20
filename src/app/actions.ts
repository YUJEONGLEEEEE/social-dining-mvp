"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDemoSandbox } from "@/lib/demo/sandbox";
import { PERSONA_COOKIE, getDemoSession, requireDemoSession, type Persona } from "@/lib/auth/session";
import { BUDGETS, INTERESTS, MBTI_TYPES, PERSONALITY, WANTS } from "@/lib/profile-options";

/** [데모 시작]: an anonymous account plus a private sandbox for this visitor. */
export async function startDemo() {
  if (await getDemoSession()) redirect("/app");
  const supabase = await createClient();
  let { data } = await supabase.auth.getUser();
  if (!data.user) {
    const signIn = await supabase.auth.signInAnonymously();
    if (signIn.error || !signIn.data.user) redirect("/?error=start");
    data = { user: signIn.data.user };
  }
  await createDemoSandbox(data.user!.id, { displayName: "나", gender: "female" });
  (await cookies()).delete(PERSONA_COOKIE);
  redirect("/app/onboarding");
}

/** [처음부터 다시]: drops this visitor's sandbox (cascade) and builds a fresh one. */
export async function resetDemo() {
  const session = await requireDemoSession();
  await createAdminClient().from("sandboxes").delete().eq("id", session.sandboxId).eq("owner_user_id", session.userId);
  await createDemoSandbox(session.userId, { displayName: "나", gender: "female" });
  (await cookies()).delete(PERSONA_COOKIE);
  redirect("/app/onboarding");
}

export async function switchPersona(formData: FormData) {
  await requireDemoSession();
  const persona: Persona = formData.get("persona") === "fail" ? "fail" : "me";
  (await cookies()).set(PERSONA_COOKIE, persona, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/app");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(PERSONA_COOKIE);
  redirect("/");
}

export type ProfileFormState = { error?: string };

const pickAll = (formData: FormData, key: string, allowed: string[]) =>
  formData.getAll(key).map(String).filter((v) => allowed.includes(v));

/** Profile and preferences (PRD ACC-02~05). Every field is checked on the server. */
export async function saveProfile(_: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const session = await requireDemoSession();
  const name = String(formData.get("name") ?? "").trim();
  const birthYear = Number(formData.get("birthYear"));
  const gender = formData.get("gender");
  const job = String(formData.get("job") ?? "").trim();
  const mbti = String(formData.get("mbti") ?? "");
  const budget = String(formData.get("budget") ?? "");
  const food = String(formData.get("food") ?? "").trim();
  const interests = pickAll(formData, "interests", INTERESTS);
  const personality = pickAll(formData, "personality", PERSONALITY);
  const wants = pickAll(formData, "wants", WANTS);

  if (name.length < 1 || name.length > 20) return { error: "이름은 1~20자로 입력해 주세요." };
  if (!Number.isInteger(birthYear) || birthYear < 1960 || birthYear > 2006) return { error: "출생연도를 확인해 주세요. (만 20세 이상)" };
  if (gender !== "female" && gender !== "male") return { error: "성별을 골라 주세요." };
  if (job.length > 30) return { error: "직업은 30자 이내로 입력해 주세요." };
  if (mbti && !MBTI_TYPES.includes(mbti)) return { error: "MBTI를 목록에서 골라 주세요." };
  if (!BUDGETS.some((b) => b.value === budget)) return { error: "식사 가격대를 골라 주세요." };
  if (food.length > 100) return { error: "못 먹는 음식은 100자 이내로 입력해 주세요." };
  if (!interests.length || !personality.length || !wants.length) return { error: "관심사, 나의 성향, 만나고 싶은 사람을 하나 이상 골라 주세요." };
  if (formData.get("consent") !== "on") return { error: "개인정보 수집·이용과 운영 정책에 동의해야 신청할 수 있어요." };

  const { error } = await createAdminClient()
    .from("profiles")
    .update({
      display_name: name, birth_year: birthYear, gender, job: job || null, mbti: mbti || null, mbti_raw: mbti || null,
      budget, food_restrictions: food || null, interests, personality, wants, consented_at: new Date().toISOString(),
    })
    .eq("id", session.meProfileId)
    .eq("sandbox_id", session.sandboxId);
  if (error) return { error: "저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  redirect("/app");
}

export type LoginState = { error?: string };

/** Test-account login (PRD ACC-01 allows test accounts for the hackathon). */
export async function signInTestAccount(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password || email.length > 100 || password.length > 100) return { error: "이메일과 비밀번호를 입력해 주세요." };

  const supabase = await createClient();
  await supabase.auth.signOut();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  // Same message for every failure, so the form does not reveal which accounts exist.
  if (error || !data.user) return { error: "이메일 또는 비밀번호가 맞지 않아요." };

  const db = createAdminClient();
  const { data: sandbox } = await db.from("sandboxes").select("id").eq("owner_user_id", data.user.id).limit(1).maybeSingle();
  if (!sandbox) await createDemoSandbox(data.user.id, { displayName: "나", gender: "female" });

  const store = await cookies();
  if (data.user.app_metadata?.persona === "fail") {
    store.set(PERSONA_COOKIE, "fail", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  } else {
    store.delete(PERSONA_COOKIE);
  }
  redirect(data.user.app_metadata?.role === "operator" ? "/admin" : "/app");
}
