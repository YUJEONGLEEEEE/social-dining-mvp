import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

// A demo sandbox is one visitor's private copy of an upcoming Thursday:
// ~20 virtual people copied from the base data (with their past meetings),
// the visitor's own profile, and one participant who is set up to fail matching.

export const DEMO_WEEK = "2026-10-22";
const DEMO_CLOCK = "2026-10-20T10:00:00+09:00";
const SINGLE_PRICE = 9900;

type Db = ReturnType<typeof createAdminClient>;

function kst(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();
}

async function check<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  // Inserts without .select() return null data; callers that read rows always select.
  return data as NonNullable<T>;
}

async function pickPeople(db: Db, baseId: string) {
  // People who already sat together in Hongdae, so past feedback can shape the next match.
  // Balanced by gender (the survey is about 2:1 female) so the demo week can seat mixed tables.
  const tables = await check(
    db.from("dining_tables")
      .select("id, event_slots!inner(region, event_date), table_members(profile_id, profiles(gender))")
      .eq("sandbox_id", baseId)
      .eq("event_slots.region", "hongdae")
      .order("event_slots(event_date)", { ascending: false })
      .limit(14),
  );
  const female: string[] = [];
  const male: string[] = [];
  for (const t of tables) {
    for (const m of t.table_members as unknown as { profile_id: string; profiles: { gender: string } }[]) {
      const list = m.profiles.gender === "male" ? male : female;
      if (!list.includes(m.profile_id)) list.push(m.profile_id);
    }
  }
  return [...female.slice(0, 13), ...male.slice(0, 9)];
}

export async function createDemoSandbox(ownerUserId: string, me: { displayName: string; gender: "female" | "male" }) {
  const db = createAdminClient();
  const base = await check(db.from("sandboxes").select("id").eq("kind", "base").single());

  const sandbox = await check(
    db.from("sandboxes").insert({ kind: "demo", owner_user_id: ownerUserId, demo_clock: DEMO_CLOCK }).select("id").single(),
  );
  const sid = sandbox.id;
  await check(db.from("matching_rules").insert({ sandbox_id: sid }));

  // Venues: Hongdae has seats for two tables only, so a larger week raises a venue-shortage case.
  const venues = await check(db.from("venues").select("name, region, address, price_band, rating").eq("sandbox_id", base.id));
  await check(db.from("venues").insert(venues.map((v) => ({ ...v, sandbox_id: sid, tables_available: v.region === "hongdae" ? 1 : 3 }))));

  // Slots for the demo week.
  const slotRows = (["hongdae", "gangnam"] as const).map((region) => ({
    id: crypto.randomUUID(),
    sandbox_id: sid,
    event_date: DEMO_WEEK,
    region,
    starts_at: kst(DEMO_WEEK, 19),
    match_deadline_at: kst("2026-10-21", 0),
  }));
  await check(db.from("event_slots").insert(slotRows));
  const [hongdae, gangnam] = slotRows;

  // Virtual people and their relations, remapped to new ids.
  const sourceIds = await pickPeople(db, base.id);
  const sources = await check(
    db.from("profiles")
      .select("id, display_name, birth_year, gender, mbti, mbti_raw, interests, personality, wants, budget, food_restrictions, region_raw")
      .in("id", sourceIds),
  );
  const idMap = new Map(sources.map((p) => [p.id, crypto.randomUUID()]));
  const profiles = sources.map((p) => ({ ...p, id: idMap.get(p.id)!, source_profile_id: p.id, sandbox_id: sid, is_virtual: true }));

  // The visitor sits in the middle of the group's ages; the failing participant is far outside it.
  const years = sources.map((p) => p.birth_year).sort((a, b) => a - b);
  const medianYear = years[Math.floor(years.length / 2)];
  const meId = crypto.randomUUID();
  const failId = crypto.randomUUID();
  profiles.push(
    {
      id: meId, sandbox_id: sid, source_profile_id: null, is_virtual: false, display_name: me.displayName,
      birth_year: medianYear, gender: me.gender, mbti: "ENFP", mbti_raw: "ENFP",
      interests: ["여행", "맛집·카페 탐방"], personality: ["깊은 대화를 좋아함", "경청을 잘 함"],
      wants: ["깊은 대화가 되는 사람", "편하고 유머 있는 사람"], budget: "20k_30k", food_restrictions: null, region_raw: "홍대/합정",
    },
    {
      id: failId, sandbox_id: sid, source_profile_id: null, is_virtual: true, display_name: "박민호",
      birth_year: years[0] - 12, gender: "male", mbti: "ISTJ", mbti_raw: "ISTJ",
      interests: ["독서·글쓰기"], personality: ["잔잔하고 조용한 편"], wants: ["잔잔하고 안정적인 사람"],
      budget: "30k_plus", food_restrictions: null, region_raw: "홍대/합정",
    },
  );
  await check(db.from("profiles").insert(profiles));
  await check(db.from("sandboxes").update({ me_profile_id: meId, fail_profile_id: failId }).eq("id", sid));

  const relations = await check(
    db.from("user_relations").select("profile_id, other_profile_id, kind, source").in("profile_id", sourceIds).in("other_profile_id", sourceIds),
  );
  if (relations.length) {
    await check(db.from("user_relations").insert(relations.map((r) => ({
      ...r, sandbox_id: sid, profile_id: idMap.get(r.profile_id)!, other_profile_id: idMap.get(r.other_profile_id)!,
    }))));
  }

  // Passes, paid applications and slot choices. A few people also accept Gangnam.
  // The visitor is left out: they apply and pay on the 신청 screen themselves.
  const applicants = profiles.filter((p) => p.id !== meId);
  const passes = applicants.map((p) => ({
    id: crypto.randomUUID(), sandbox_id: sid, profile_id: p.id, kind: "single", price: SINGLE_PRICE, remaining_count: 0,
  }));
  await check(db.from("passes").insert(passes));
  const applications = applicants.map((p, i) => ({
    id: crypto.randomUUID(), sandbox_id: sid, profile_id: p.id, pass_id: passes[i].id, week_of: DEMO_WEEK,
    payment_status: "paid", created_at: kst("2026-10-15", 12),
  }));
  await check(db.from("applications").insert(applications));
  await check(db.from("payments").insert(applications.map((a) => ({
    sandbox_id: sid, application_id: a.id, pass_id: a.pass_id, kind: "pay", amount: SINGLE_PRICE,
  }))));
  const options = applications.flatMap((a, i) => {
    const rows = [{ sandbox_id: sid, application_id: a.id, event_slot_id: hongdae.id, priority: 1 }];
    if (i % 4 === 0) rows.push({ sandbox_id: sid, application_id: a.id, event_slot_id: gangnam.id, priority: 2 });
    return rows;
  });
  await check(db.from("application_options").insert(options));

  await check(db.from("audit_logs").insert({
    sandbox_id: sid, entity: "sandbox", entity_id: sid, actor: "system", action: "create_demo_sandbox",
    after: { people: profiles.length, week: DEMO_WEEK },
  }));

  return { sandboxId: sid, meProfileId: meId, failProfileId: failId };
}
