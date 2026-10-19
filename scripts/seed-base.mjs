// Load cleaned virtual people into the base sandbox and synthesize past meetings.
//
// Usage: node --env-file=.env.local scripts/seed-base.mjs
// Input: data/private/virtual_people.json (from clean_virtual_data.py)
//
// Safe to re-run: the previous base sandbox is deleted first (cascade).
// Randomness is seeded, so every run produces the same history.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TODAY = "2026-10-19";
const PRICE_SINGLE = 9900;
const AGE_GAP = 8;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Seeded PRNG (mulberry32) so the synthetic history is reproducible.
let seed = 20261015;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (items) => items[Math.floor(rand() * items.length)];

async function insert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

function kstDate(isoDate, hour) {
  return new Date(`${isoDate}T${String(hour).padStart(2, "0")}:00:00+09:00`).toISOString();
}
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const VENUES = {
  hongdae: [["소담식당", 4.6, "20k_30k"], ["연남 화로", 4.5, "30k_plus"], ["합정 키친", 4.4, "10k_20k"]],
  gangnam: [["신논현 다이닝", 4.5, "30k_plus"], ["강남 한상", 4.3, "20k_30k"], ["역삼 비스트로", 4.4, "20k_30k"]],
  euljiro: [["을지로 노포", 4.6, "10k_20k"], ["종로 한옥집", 4.5, "20k_30k"], ["을지 와인바", 4.4, "30k_plus"]],
  jamsil: [["잠실 호수뷰", 4.4, "30k_plus"], ["송리단길 키친", 4.5, "20k_30k"], ["석촌 화덕", 4.3, "20k_30k"]],
};

const CARDS = [
  ["opening", "오늘 여기 오기까지 가장 기대한 것 한 가지는?"],
  ["opening", "요즘 가장 자주 가는 동네와 그 이유는?"],
  ["opening", "여행 갈 때 계획형인가요, 즉흥형인가요?"],
  ["opening", "최근에 가 본 곳 중 남에게 알려주기 아까운 곳은?"],
  ["middle", "요즘 빠져 있는 것 하나를 1분 안에 영업해 주세요."],
  ["middle", "일 말고 나를 소개하는 한 문장은?"],
  ["middle", "올해 새로 시작해 본 것, 혹은 시작하고 싶은 것은?"],
  ["middle", "친구들이 나를 찾는 순간은 주로 언제인가요?"],
  ["middle", "인생 영화나 책 한 편과 그 장면은?"],
  ["closing", "오늘 대화에서 가장 기억에 남는 한 마디는?"],
  ["closing", "다음 목요일에 해 보고 싶은 것 하나는?"],
  ["closing", "오늘 만난 사람들에게 추천하고 싶은 것 하나는?"],
];

async function main() {
  const people = JSON.parse(readFileSync(new URL("../data/private/virtual_people.json", import.meta.url), "utf8"));

  // 1. Fresh base sandbox (the previous one cascades away).
  await db.from("sandboxes").delete().eq("kind", "base");
  const base = randomUUID();
  await insert("sandboxes", [{ id: base, kind: "base" }]);
  await insert("matching_rules", [{ sandbox_id: base }]);

  // 2. Shared conversation cards.
  await db.from("conversation_cards").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await insert("conversation_cards", CARDS.map(([stage, body]) => ({ stage, body })));

  // 3. Venues.
  const venueRows = [];
  const venuesByRegion = {};
  for (const [region, list] of Object.entries(VENUES)) {
    venuesByRegion[region] = [];
    for (const [name, rating, price_band] of list) {
      const id = randomUUID();
      venuesByRegion[region].push(id);
      venueRows.push({ id, sandbox_id: base, name, region, rating, price_band, tables_available: 4 });
    }
  }
  await insert("venues", venueRows);

  // 4. Profiles.
  const profileId = new Map(people.map((p) => [p.key, randomUUID()]));
  await insert("profiles", people.map((p) => ({
    id: profileId.get(p.key),
    sandbox_id: base,
    display_name: p.display_name,
    birth_year: p.birth_year,
    gender: p.gender,
    mbti: p.mbti,
    mbti_raw: p.mbti_raw,
    interests: p.interests,
    personality: p.personality,
    wants: p.wants,
    budget: p.budget,
    food_restrictions: p.food_restrictions,
    region_raw: p.region_raw,
    is_virtual: true,
  })));

  // 5. Event slots and applications. Each person joins one region per chosen date.
  const slots = new Map();
  const slotFor = (eventDate, region) => {
    const key = `${eventDate}|${region}`;
    if (!slots.has(key)) {
      const past = eventDate < TODAY;
      slots.set(key, {
        row: {
          id: randomUUID(),
          sandbox_id: base,
          event_date: eventDate,
          region,
          starts_at: kstDate(eventDate, 19),
          match_deadline_at: kstDate(addDays(eventDate, -1), 0),
          status: past ? "done" : "open",
          is_history: past,
        },
        applicants: [],
      });
    }
    return slots.get(key);
  };

  const applications = [];
  const options = [];
  const payments = [];
  for (const p of people) {
    if (p.regions.length === 0) continue; // outside the four Seoul regions: not matched
    for (const eventDate of p.dates) {
      const slot = slotFor(eventDate, pick(p.regions));
      const past = eventDate < TODAY;
      const app = {
        id: randomUUID(),
        sandbox_id: base,
        profile_id: profileId.get(p.key),
        week_of: eventDate,
        application_status: "submitted",
        payment_status: "paid",
        match_status: past ? "confirmed" : "waiting",
        attendance_status: "none",
        created_at: kstDate(addDays(eventDate, -7), 12),
      };
      applications.push(app);
      options.push({ id: randomUUID(), sandbox_id: base, application_id: app.id, event_slot_id: slot.row.id, priority: 1, note: p.date_note });
      payments.push({ id: randomUUID(), sandbox_id: base, application_id: app.id, kind: "pay", amount: PRICE_SINGLE, created_at: app.created_at });
      slot.applicants.push({ app, person: p });
    }
  }

  // 6. History: group past applicants into tables of 4-6 within the age gap.
  const tables = [];
  const members = [];
  const resolutions = [];
  const relations = new Map();
  const feedbacks = [];
  const feedbackPeople = [];
  const noShows = new Map();
  const addRelation = (a, b, kind) => {
    const key = `${a}|${b}|${kind}`;
    if (!relations.has(key)) relations.set(key, { id: randomUUID(), sandbox_id: base, profile_id: a, other_profile_id: b, kind, source: "seed_history" });
  };

  for (const slot of slots.values()) {
    if (!slot.row.is_history) continue;
    const queue = [...slot.applicants].sort((x, y) => x.person.birth_year - y.person.birth_year);
    const groups = [];
    while (queue.length >= 4) {
      // Split what is left as evenly as possible into tables of 4-6.
      let k = Math.ceil(queue.length / 6);
      while (k > 0 && queue.length / k < 4) k--;
      if (k === 0) break;
      const size = Math.min(6, Math.ceil(queue.length / k));
      const group = queue.splice(0, size);
      const gap = group.at(-1).person.birth_year - group[0].person.birth_year;
      if (gap > AGE_GAP) {
        // Drop the oldest member back to the failed pile and keep the rest if still 4+.
        const trimmed = group.filter((g) => g.person.birth_year - group[0].person.birth_year <= AGE_GAP);
        queue.push(...group.filter((g) => !trimmed.includes(g)));
        queue.sort((x, y) => x.person.birth_year - y.person.birth_year);
        if (trimmed.length < 4) {
          for (const g of trimmed) failed(g);
          continue;
        }
        groups.push(trimmed);
      } else {
        groups.push(group);
      }
    }
    for (const g of queue) failed(g);

    function failed({ app }) {
      app.match_status = "resolved";
      app.payment_status = "pass_kept";
      resolutions.push({ id: randomUUID(), sandbox_id: base, application_id: app.id, kind: "kept_pass", reason: "같은 회차에 나이 조건(8살 이내)이 맞는 신청자가 부족" });
    }

    for (const group of groups) {
      const table = {
        id: randomUUID(),
        sandbox_id: base,
        event_slot_id: slot.row.id,
        venue_id: pick(venuesByRegion[slot.row.region]),
        status: "done",
        reason: "지난 회차 기록",
      };
      tables.push(table);
      const attended = [];
      for (const { app, person } of group) {
        const pid = profileId.get(person.key);
        members.push({ id: randomUUID(), sandbox_id: base, table_id: table.id, application_id: app.id, profile_id: pid, joined_reason: "seed_history" });
        if (rand() < 0.04) {
          app.attendance_status = "no_show";
          noShows.set(pid, (noShows.get(pid) ?? 0) + 1);
        } else {
          app.attendance_status = "checked_in";
          app.checked_in_at = kstDate(slot.row.event_date, 19);
          attended.push({ app, pid });
        }
      }
      for (const a of attended) for (const b of attended) if (a.pid !== b.pid) addRelation(a.pid, b.pid, "met");

      const choices = new Map();
      for (const { app, pid } of attended) {
        if (rand() > 0.75) continue; // not everyone leaves feedback
        const feedback = {
          id: randomUUID(),
          sandbox_id: base,
          application_id: app.id,
          table_id: table.id,
          rating: rand() < 0.15 ? 3 : rand() < 0.55 ? 4 : 5,
          is_synthetic: true,
          created_at: kstDate(slot.row.event_date, 23),
        };
        feedbacks.push(feedback);
        for (const other of attended) {
          if (other.pid === pid) continue;
          const r = rand();
          const choice = r < 0.35 ? "again" : r < 0.92 ? "neutral" : "never";
          feedbackPeople.push({ id: randomUUID(), sandbox_id: base, feedback_id: feedback.id, target_profile_id: other.pid, choice });
          choices.set(`${pid}|${other.pid}`, choice);
          if (choice === "never") addRelation(pid, other.pid, "disliked");
        }
      }
      for (const [key, choice] of choices) {
        const [a, b] = key.split("|");
        if (choice === "again" && choices.get(`${b}|${a}`) === "again") addRelation(a, b, "mutual_again");
      }
    }
  }

  await insert("event_slots", [...slots.values()].map((s) => s.row));
  await insert("applications", applications);
  await insert("application_options", options);
  await insert("payments", payments);
  await insert("dining_tables", tables);
  await insert("table_members", members);
  await insert("match_resolutions", resolutions);
  await insert("user_relations", [...relations.values()]);
  await insert("feedbacks", feedbacks);
  await insert("feedback_people", feedbackPeople);
  for (const [id, count] of noShows) {
    const { error } = await db.from("profiles").update({ no_show_count: count }).eq("id", id);
    if (error) throw new Error(`profiles: ${error.message}`);
  }
  await insert("audit_logs", [{
    sandbox_id: base,
    entity: "sandbox",
    entity_id: base,
    actor: "seed-script",
    action: "seed_base",
    reason: "가상데이터 적재와 지난 회차 이력 합성",
    after: { profiles: people.length, slots: slots.size, tables: tables.length },
  }]);

  const count = (kind) => [...relations.values()].filter((r) => r.kind === kind).length;
  console.log({
    profiles: people.length,
    slots: slots.size,
    applications: applications.length,
    historyTables: tables.length,
    failedApplications: resolutions.length,
    feedbacks: feedbacks.length,
    met: count("met"),
    mutualAgain: count("mutual_again"),
    disliked: count("disliked"),
    noShowPeople: noShows.size,
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
