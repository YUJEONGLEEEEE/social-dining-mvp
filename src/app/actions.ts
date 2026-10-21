"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDemoSandbox } from "@/lib/demo/sandbox";
import { STAGES, advanceDemo, type Stage } from "@/lib/demo/clock";
import { resolveFailedMatch, type ResolveChoice } from "@/lib/participant/resolve";
import { mealIsOver } from "@/lib/participant/table";
import { PASS_PLANS, submitApplication, type PassKind } from "@/lib/participant/apply";
import { submitFeedback, type PersonChoice } from "@/lib/feedback/loop";
import { resolveVenueShortage } from "@/lib/automation/meetup";
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
  revalidatePath("/", "layout");
  redirect("/app/onboarding");
}

export async function switchPersona(formData: FormData) {
  await requireDemoSession();
  const persona: Persona = formData.get("persona") === "fail" ? "fail" : "me";
  (await cookies()).set(PERSONA_COOKIE, persona, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  revalidatePath("/", "layout");
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
  // First visit goes on to apply; later edits return home.
  const { count } = await createAdminClient().from("applications").select("id", { count: "exact", head: true })
    .eq("sandbox_id", session.sandboxId).eq("profile_id", session.meProfileId);
  redirect(count ? "/app" : "/app/apply");
}

export type ApplyState = { error?: string };

/** 신청 + 모의 결제 (PRD completion condition 1). Slots and the plan are checked on the server. */
export async function applyAction(_: ApplyState, formData: FormData): Promise<ApplyState> {
  const session = await requireDemoSession();
  const { data: profile } = await createAdminClient().from("profiles").select("consented_at, is_virtual").eq("id", session.profileId).single();
  if (session.persona === "me" && !profile?.consented_at) return { error: "프로필과 개인정보 동의를 먼저 저장해 주세요." };
  const passKind = String(formData.get("pass") ?? "");
  if (!(passKind in PASS_PLANS)) return { error: "이용권을 골라 주세요." };
  if (formData.get("agree") !== "on") return { error: "환불·취소 규정에 동의해 주세요." };
  const result = await submitApplication(
    session.sandboxId, session.profileId, session.demoClock ?? new Date().toISOString(),
    String(formData.get("slot") ?? ""), formData.get("otherSlots") === "on", passKind as PassKind,
  );
  if ("error" in result) return { error: result.error };
  revalidatePath("/", "layout");
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

/** Demo bar: move the virtual clock one step forward. */
export async function advanceDemoAction(formData: FormData) {
  const session = await requireDemoSession();
  const from = String(formData.get("from") ?? "");
  if (!(STAGES as readonly string[]).includes(from)) redirect("/app");
  await advanceDemo(session.sandboxId, session.userId, from as Stage, session.isAnonymous ? "demo-visitor" : "test-account");
  // The demo bar lives in the layout, which a same-URL redirect would otherwise keep stale.
  revalidatePath("/", "layout");
  // Only same-app paths, so the field cannot be used as an open redirect.
  const back = String(formData.get("back") ?? "");
  redirect(/^\/(app|admin)(\/[\w-]+)*$/.test(back) ? back : "/app");
}

/** Group chat message from the current persona. Only members of the table may post. */
export async function sendChatMessage(formData: FormData) {
  const session = await requireDemoSession();
  const tableId = String(formData.get("tableId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/.test(tableId)) redirect("/app");
  if (body.length < 1 || body.length > 500) redirect(`/app/table/${tableId}`);
  const db = createAdminClient();
  const { data: seat } = await db.from("table_members").select("id")
    .eq("sandbox_id", session.sandboxId).eq("table_id", tableId).eq("profile_id", session.profileId).is("left_at", null).maybeSingle();
  if (!seat) redirect("/app");
  await db.from("chat_messages").insert({ sandbox_id: session.sandboxId, table_id: tableId, sender_profile_id: session.profileId, kind: "user", body });
  redirect(`/app/table/${tableId}`);
}

/** D-1 "참석할게요" (attendance confirmed), recorded on the participant's own application. */
export async function confirmAttendance(formData: FormData) {
  const session = await requireDemoSession();
  const tableId = String(formData.get("tableId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(tableId)) redirect("/app");
  const db = createAdminClient();
  const { data: seat } = await db.from("table_members").select("application_id")
    .eq("sandbox_id", session.sandboxId).eq("table_id", tableId).eq("profile_id", session.profileId).is("left_at", null).maybeSingle();
  if (!seat) redirect("/app");
  await db.from("applications").update({ attendance_status: "confirmed" }).eq("id", seat.application_id).eq("attendance_status", "none");
  await db.from("audit_logs").insert({ sandbox_id: session.sandboxId, entity: "application", entity_id: seat.application_id, actor: "participant", action: "confirm_attendance" });
  redirect(`/app/table/${tableId}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Failed match: move to another date, keep the pass, or refund (STA-04~06, PAY-03). */
export async function resolveFailedMatchAction(formData: FormData) {
  const session = await requireDemoSession();
  const applicationId = String(formData.get("applicationId") ?? "");
  const choice = String(formData.get("choice") ?? "");
  const slotId = String(formData.get("slotId") ?? "") || null;
  if (!UUID.test(applicationId) || !["move", "keep", "refund"].includes(choice)) redirect("/app");
  if (slotId && !UUID.test(slotId)) redirect(`/app/resolve/${applicationId}`);
  try {
    await resolveFailedMatch(session.sandboxId, session.profileId, session.demoClock ?? new Date().toISOString(), applicationId, choice as ResolveChoice, slotId);
  } catch {
    // Stale page (reset in another tab, slot gone): show a plain message instead of an error screen.
    redirect(`/app/resolve/${applicationId}?error=1`);
  }
  revalidatePath("/", "layout");
  redirect(`/app/resolve/${applicationId}`);
}

export type FeedbackState = { error?: string };

/** Feedback after the meal, plus an optional safety report (FDB-01~04, SAF-01). */
export async function submitFeedbackAction(_: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const session = await requireDemoSession();
  const tableId = String(formData.get("tableId") ?? "");
  if (!UUID.test(tableId)) return { error: "잘못된 요청이에요." };
  const rating = Number(formData.get("rating"));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "오늘 식탁 만족도를 골라 주세요." };
  const comment = String(formData.get("comment") ?? "").slice(0, 1000);

  const db = createAdminClient();
  const { data: seat } = await db.from("table_members").select("application_id")
    .eq("sandbox_id", session.sandboxId).eq("table_id", tableId).eq("profile_id", session.profileId).is("left_at", null).maybeSingle();
  if (!seat) return { error: "이 식탁의 참가자만 피드백을 남길 수 있어요." };
  const { data: slot } = await db.from("dining_tables").select("event_slots(starts_at)").eq("id", tableId).single();
  const startsAt = (slot?.event_slots as unknown as { starts_at: string } | null)?.starts_at;
  if (!startsAt || !mealIsOver(startsAt, session.demoClock)) return { error: "식사가 끝난 뒤에 피드백을 남길 수 있어요." };

  const choices: PersonChoice[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("person:")) continue;
    const target = key.slice("person:".length);
    if (UUID.test(target) && (value === "again" || value === "neutral" || value === "never")) choices.push({ targetProfileId: target, choice: value });
  }
  let result: Awaited<ReturnType<typeof submitFeedback>>;
  try {
    result = await submitFeedback(session.sandboxId, seat.application_id, { rating, comment, choices }, "participant");
  } catch {
    return { error: "저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  if (result.duplicate) redirect("/app");

  const reported = String(formData.get("report") ?? "");
  const reason = String(formData.get("reportReason") ?? "").trim().slice(0, 500);
  if (UUID.test(reported) && choices.some((c) => c.targetProfileId === reported)) {
    // A report blocks the pair for good and goes to the operator's exception inbox.
    await db.from("user_relations").upsert(
      { sandbox_id: session.sandboxId, profile_id: session.profileId, other_profile_id: reported, kind: "blocked", source: "report" },
      { onConflict: "profile_id,other_profile_id,kind", ignoreDuplicates: true },
    );
    await db.from("exception_cases").insert({
      sandbox_id: session.sandboxId, type: "safety_report", title: "참가자 신고 접수", table_id: tableId,
      detail: { reporter: session.profileId, reported, reason: reason || "사유 미입력" },
    });
  }
  revalidatePath("/", "layout");
  redirect("/app");
}

/** Operator: assign a substitute venue to a venue-shortage case. */
export async function resolveVenueShortageAction(formData: FormData) {
  const session = await requireDemoSession();
  const exceptionId = String(formData.get("exceptionId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");
  if (!UUID.test(exceptionId) || !UUID.test(venueId)) redirect("/admin");
  try {
    await resolveVenueShortage(session.sandboxId, exceptionId, venueId, "operator");
  } catch {
    redirect("/admin?error=venue");
  }
  revalidatePath("/", "layout");
  redirect("/admin");
}

/** Operator: close a safety report after review (the pair stays blocked). */
export async function closeExceptionAction(formData: FormData) {
  const session = await requireDemoSession();
  const exceptionId = String(formData.get("exceptionId") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || "운영자 확인 완료";
  if (!UUID.test(exceptionId)) redirect("/admin");
  const db = createAdminClient();
  const { data: ex } = await db.from("exception_cases").select("id, status").eq("sandbox_id", session.sandboxId).eq("id", exceptionId).maybeSingle();
  if (ex?.status === "open") {
    await db.from("exception_cases").update({ status: "resolved", resolution: note, resolved_at: new Date().toISOString() }).eq("id", ex.id);
    await db.from("audit_logs").insert({ sandbox_id: session.sandboxId, entity: "exception_case", entity_id: ex.id, actor: "operator", action: "close_exception", before: { status: "open" }, after: { status: "resolved" }, reason: note });
  }
  revalidatePath("/", "layout");
  redirect("/admin");
}

export type RulesState = { error?: string; saved?: boolean };

/** Operator: preference weights and minimum score (MAT-15). Applies from the next matching run. */
export async function saveMatchingRules(_: RulesState, formData: FormData): Promise<RulesState> {
  const session = await requireDemoSession();
  const keys = ["weight_gender", "weight_mbti", "weight_interests", "weight_wants", "weight_new_people"] as const;
  const values: Record<string, number> = {};
  for (const key of keys) {
    const v = Number(formData.get(key));
    if (!Number.isFinite(v) || v < 0 || v > 50) return { error: "가중치는 0~50 사이 숫자로 입력해 주세요." };
    values[key] = v;
  }
  if (Object.values(values).every((v) => v === 0)) return { error: "가중치를 하나 이상 0보다 크게 입력해 주세요." };
  const minScore = Number(formData.get("min_score"));
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) return { error: "최소 점수는 0~100 사이로 입력해 주세요." };

  const db = createAdminClient();
  const { data: before } = await db.from("matching_rules").select("*").eq("sandbox_id", session.sandboxId).single();
  await db.from("matching_rules").update({ ...values, min_score: minScore, updated_at: new Date().toISOString() }).eq("sandbox_id", session.sandboxId);
  await db.from("audit_logs").insert({
    sandbox_id: session.sandboxId, entity: "matching_rules", actor: "operator", action: "update_rules",
    before, after: { ...values, min_score: minScore }, reason: "운영자 가중치 조정",
  });
  revalidatePath("/admin/rules");
  return { saved: true };
}
