import "server-only";
import { createAdminClient } from "../supabase/admin.ts";

// Everything that happens automatically after matching:
// venue assignment, the group chat notice, reminders, conversation cards
// during the meal and the feedback request afterwards.
// Every message has a dedupe key, so re-running a step never sends it twice.

type Db = ReturnType<typeof createAdminClient>;
const VENUE_RETRIES = 3;
const BUDGET_RANK: Record<string, number> = { "10k_20k": 1, "20k_30k": 2, "30k_plus": 3 };

type Notice = { profile_id: string; type: string; title: string; body?: string; link?: string; dedupe_key: string };
type ChatNotice = { table_id: string; kind: "system" | "topic_card"; body: string; dedupe_key: string };

async function sendNotifications(db: Db, sandboxId: string, rows: Notice[]) {
  if (!rows.length) return 0;
  const { data: sent } = await db.from("notifications").select("dedupe_key").eq("sandbox_id", sandboxId).in("dedupe_key", rows.map((r) => r.dedupe_key));
  const already = new Set((sent ?? []).map((r) => r.dedupe_key));
  const fresh = rows.filter((r) => !already.has(r.dedupe_key)).map((r) => ({ ...r, sandbox_id: sandboxId }));
  if (!fresh.length) return 0;
  const { error } = await db.from("notifications").insert(fresh);
  if (error && error.code !== "23505") throw new Error(error.message);
  return fresh.length;
}

async function postChat(db: Db, sandboxId: string, rows: ChatNotice[]) {
  if (!rows.length) return 0;
  const { data: posted } = await db.from("chat_messages").select("dedupe_key").eq("sandbox_id", sandboxId).in("dedupe_key", rows.map((r) => r.dedupe_key));
  const already = new Set((posted ?? []).map((r) => r.dedupe_key));
  // Messages in one batch get increasing timestamps so the chat shows them in order.
  const now = Date.now();
  const fresh = rows
    .filter((r) => !already.has(r.dedupe_key))
    .map((r, i) => ({ ...r, sandbox_id: sandboxId, created_at: new Date(now + i).toISOString() }));
  if (!fresh.length) return 0;
  const { error } = await db.from("chat_messages").insert(fresh);
  if (error && error.code !== "23505") throw new Error(error.message);
  return fresh.length;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 (${days[kst.getUTCDay()]}) 저녁 ${kst.getUTCHours() > 12 ? kst.getUTCHours() - 12 : kst.getUTCHours()}시`;
}

type TableInfo = {
  id: string;
  score: number;
  reason: string | null;
  venue_id: string | null;
  venues: { name: string; address: string | null } | null;
  event_slots: { region: string; starts_at: string; event_date: string };
  table_members: { profile_id: string; left_at: string | null; profiles: { budget: string | null; interests: string[]; is_virtual: boolean } }[];
};

async function loadTables(db: Db, sandboxId: string, filter: { runId?: string; tableId?: string; weekOf?: string }) {
  let query = db
    .from("dining_tables")
    .select("id, score, reason, venue_id, venues(name, address), event_slots!inner(region, starts_at, event_date), table_members(profile_id, left_at, profiles(budget, interests, is_virtual))")
    .eq("sandbox_id", sandboxId)
    .eq("status", "confirmed");
  if (filter.runId) query = query.eq("match_run_id", filter.runId);
  if (filter.tableId) query = query.eq("id", filter.tableId);
  if (filter.weekOf) query = query.eq("event_slots.event_date", filter.weekOf);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as unknown as TableInfo[]).map((t) => ({ ...t, table_members: t.table_members.filter((m) => !m.left_at) }));
}

async function announceTable(db: Db, sandboxId: string, table: TableInfo, venue: { name: string; address: string | null }) {
  const when = timeLabel(table.event_slots.starts_at);
  const members = table.table_members.map((m) => m.profile_id);
  await postChat(db, sandboxId, [
    {
      table_id: table.id,
      kind: "system",
      body: `${when}, ${venue.name}에서 만나요. 예약명은 "우연한 식탁"이에요.${venue.address ? ` (${venue.address})` : ""}`,
      dedupe_key: `table:${table.id}:venue`,
    },
    ...(table.reason ? [{ table_id: table.id, kind: "system" as const, body: `함께하게 된 이유: ${table.reason}`, dedupe_key: `table:${table.id}:reason` }] : []),
    {
      table_id: table.id,
      kind: "system",
      body: "취소 안내: 화요일 24시(매칭 마감) 이후에는 환불되지 않아요. 당일 취소는 환불 없이 경고 1회, 노쇼가 2회 쌓이면 4주간 신청이 제한돼요. 식사비는 현장에서 각자 결제해요.",
      dedupe_key: `table:${table.id}:policy`,
    },
  ]);
  await sendNotifications(db, sandboxId, members.map((profile_id) => ({
    profile_id,
    type: "match_confirmed",
    title: "이번 주 식탁이 정해졌어요",
    body: `${when} · ${venue.name}`,
    link: `/app/table/${table.id}`,
    dedupe_key: `match_confirmed:${table.id}:${profile_id}`,
  })));
}

/** Assigns a venue to every confirmed table of a run and announces it. */
export async function assignVenues(sandboxId: string, runId: string, actor = "system") {
  const db = createAdminClient();
  // Higher scores pick first; in the demo a table with the visitor goes first so their walkthrough is never the shortage case.
  const hasVisitor = (t: TableInfo) => (t.table_members.some((m) => !m.profiles.is_virtual) ? 1 : 0);
  const tables = (await loadTables(db, sandboxId, { runId })).filter((t) => !t.venue_id).sort((a, b) => hasVisitor(b) - hasVisitor(a) || b.score - a.score);
  const { data: venues, error } = await db
    .from("venues")
    .select("id, name, address, region, price_band, rating, tables_available")
    .eq("sandbox_id", sandboxId);
  if (error) throw new Error(error.message);

  let assigned = 0;
  const shortages: string[] = [];
  for (const table of tables) {
    // The table's budget is set by its most budget-conscious member.
    const budget = Math.min(...table.table_members.map((m) => BUDGET_RANK[m.profiles.budget ?? "30k_plus"] ?? 3));
    // Inventory is re-read on every attempt, in case a seat opened up in the meantime.
    let venue: (typeof venues)[number] | undefined;
    for (let attempt = 0; attempt < VENUE_RETRIES && !venue; attempt++) {
      const { data: fresh } = await db.from("venues").select("id, tables_available").eq("sandbox_id", sandboxId).eq("region", table.event_slots.region);
      for (const f of fresh ?? []) {
        const known = venues.find((v) => v.id === f.id);
        if (known) known.tables_available = f.tables_available;
      }
      venue = venues
        .filter((v) => v.region === table.event_slots.region && v.tables_available > 0)
        .sort((a, b) => {
          const fitA = (BUDGET_RANK[a.price_band ?? "20k_30k"] ?? 2) <= budget ? 0 : 1;
          const fitB = (BUDGET_RANK[b.price_band ?? "20k_30k"] ?? 2) <= budget ? 0 : 1;
          return fitA - fitB || Number(b.rating) - Number(a.rating);
        })[0];
    }
    if (!venue) {
      shortages.push(table.id);
      continue;
    }
    venue.tables_available -= 1;
    await db.from("venues").update({ tables_available: venue.tables_available }).eq("id", venue.id);
    await db.from("dining_tables").update({ venue_id: venue.id }).eq("id", table.id);
    await announceTable(db, sandboxId, table, venue);
    assigned++;
  }

  for (const tableId of shortages) {
    const table = tables.find((t) => t.id === tableId)!;
    const { data: open } = await db.from("exception_cases").select("id").eq("table_id", tableId).eq("status", "open").maybeSingle();
    if (!open) {
      await db.from("exception_cases").insert({
        sandbox_id: sandboxId,
        type: "venue_shortage",
        title: "식당 배정 실패",
        table_id: tableId,
        retry_count: VENUE_RETRIES,
        detail: { region: table.event_slots.region, members: table.table_members.length, message: `자동 재시도 ${VENUE_RETRIES}회 후에도 예약 가능한 파트너 식당이 없어요.` },
      });
    }
    await postChat(db, sandboxId, [{
      table_id: tableId,
      kind: "system",
      body: "함께할 분들이 정해졌어요. 식당을 확정하는 중이니 조금만 기다려 주세요.",
      dedupe_key: `table:${tableId}:venue_pending`,
    }]);
    await sendNotifications(db, sandboxId, table.table_members.map((m) => ({
      profile_id: m.profile_id,
      type: "match_confirmed",
      title: "이번 주 식탁이 정해졌어요",
      body: "함께할 분들이 정해졌어요. 식당은 확정되는 대로 알려드릴게요.",
      link: `/app/table/${tableId}`,
      dedupe_key: `match_pending:${tableId}:${m.profile_id}`,
    })));
  }

  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "match_run", entity_id: runId, actor, action: "assign_venues",
    after: { assigned, shortages: shortages.length },
  });
  return { assigned, shortages: shortages.length };
}

/** Operator fixes a venue-shortage case; the table goes back to the normal flow. */
export async function resolveVenueShortage(sandboxId: string, exceptionId: string, venueId: string, actor: string) {
  const db = createAdminClient();
  const { data: ex } = await db.from("exception_cases").select("id, table_id, status, type, dining_tables(event_slots(region))").eq("sandbox_id", sandboxId).eq("id", exceptionId).maybeSingle();
  if (!ex || ex.type !== "venue_shortage" || !ex.table_id) throw new Error("예외 건을 찾을 수 없어요.");
  if (ex.status !== "open") return { alreadyResolved: true };
  const region = (ex.dining_tables as unknown as { event_slots: { region: string } } | null)?.event_slots.region;
  const { data: venue } = await db.from("venues").select("id, name, address, region, tables_available").eq("sandbox_id", sandboxId).eq("id", venueId).maybeSingle();
  // A substitute must be in the same area as the table; seats beyond inventory mean the operator called ahead.
  if (!venue || venue.region !== region) throw new Error("같은 지역의 식당을 골라 주세요.");

  // Claim the case first so a double click assigns only once.
  const { data: claimed } = await db.from("exception_cases")
    .update({ status: "resolved", resolution: `대체 식당 지정: ${venue.name}`, resolved_at: new Date().toISOString() })
    .eq("id", ex.id).eq("status", "open").select("id");
  if (!claimed?.length) return { alreadyResolved: true };
  await db.from("dining_tables").update({ venue_id: venue.id }).eq("id", ex.table_id);
  await db.from("venues").update({ tables_available: Math.max(0, venue.tables_available - 1) }).eq("id", venue.id);
  const [table] = await loadTables(db, sandboxId, { tableId: ex.table_id! });
  if (table) await announceTable(db, sandboxId, table, venue);
  await db.from("audit_logs").insert({
    sandbox_id: sandboxId, entity: "exception_case", entity_id: ex.id, actor, action: "resolve_venue_shortage",
    before: { status: "open" }, after: { status: "resolved", venue_id: venue.id }, reason: "운영자가 대체 식당 지정",
  });
  return { alreadyResolved: false };
}

/** Tells participants who could not be matched why, and what they can do next. */
export async function notifyFailures(sandboxId: string, weekOf: string) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("applications")
    .select("id, profile_id, match_note")
    .eq("sandbox_id", sandboxId)
    .eq("week_of", weekOf)
    .eq("match_status", "failed");
  if (error) throw new Error(error.message);
  return sendNotifications(db, sandboxId, data.map((a) => ({
    profile_id: a.profile_id,
    type: "match_failed",
    title: "이번 주에는 딱 맞는 식탁을 찾지 못했어요",
    body: `${a.match_note ?? ""} 다른 일정으로 옮기거나, 이용권으로 보관하거나, 환불받을 수 있어요.`.trim(),
    link: `/app/resolve/${a.id}`,
    dedupe_key: `match_failed:${a.id}`,
  })));
}

/** The day before: reminder with a request to confirm attendance. */
export async function sendReminders(sandboxId: string, weekOf: string) {
  const db = createAdminClient();
  const tables = await loadTables(db, sandboxId, { weekOf });
  let sent = 0;
  for (const t of tables.filter((x) => x.venue_id)) {
    const place = `${timeLabel(t.event_slots.starts_at)} · ${t.venues?.name ?? ""} · 예약명 "우연한 식탁"`;
    sent += await sendNotifications(db, sandboxId, t.table_members.map((m) => ({
      profile_id: m.profile_id,
      type: "reminder",
      title: "내일 저녁, 우연한 식탁이 열려요",
      body: `${place}. 참석 여부를 알려주세요. 당일 취소는 환불되지 않아요.`,
      link: `/app/table/${t.id}`,
      dedupe_key: `reminder:${t.id}:${m.profile_id}`,
    })));
    await postChat(db, sandboxId, [{
      table_id: t.id, kind: "system",
      body: `내일 만나요! ${place}${t.venues?.address ? ` (${t.venues.address})` : ""}. 참석 여부를 앱에서 눌러 주세요.`,
      dedupe_key: `table:${t.id}:reminder`,
    }]);
  }
  return { sent };
}

/** The interest most of the table shares, for a card made for this table (CON-02). */
function sharedInterest(table: TableInfo) {
  const counts = new Map<string, number>();
  for (const m of table.table_members) for (const i of m.profiles.interests ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] >= 2 ? { label: top[0].replace(/\s*\(.*\)$/, ""), count: top[1] } : null;
}

/** During the meal: one conversation card per stage; the opening card is about what this table shares. */
export async function postConversationCards(sandboxId: string, weekOf: string) {
  const db = createAdminClient();
  const tables = await loadTables(db, sandboxId, { weekOf });
  const { data: cards } = await db.from("conversation_cards").select("stage, body").order("body");
  const pick = (stage: string, offset: number) => {
    const list = (cards ?? []).filter((c) => c.stage === stage);
    return list[offset % list.length]?.body;
  };
  let posted = 0;
  for (const [index, t] of tables.entries()) {
    const shared = sharedInterest(t);
    const opening = shared ? `${shared.count}명이 '${shared.label}'에 관심 있어요. 요즘 가장 좋았던 경험을 하나씩 나눠 볼까요?` : pick("opening", index);
    const rows = (["opening", "middle", "closing"] as const).map((stage, i) => ({
      table_id: t.id,
      kind: "topic_card" as const,
      body: `${["식사 초반", "식사 중반", "식사 후반"][i]} 대화 카드 ${i + 1}/3 · ${stage === "opening" ? opening : pick(stage, index)}`,
      dedupe_key: `table:${t.id}:card:${stage}`,
    })).filter((r) => r.body);
    posted += await postChat(db, sandboxId, rows);
  }
  return { posted };
}

/** After the meal: ask everyone for feedback. */
export async function requestFeedback(sandboxId: string, weekOf: string) {
  const db = createAdminClient();
  const tables = await loadTables(db, sandboxId, { weekOf });
  let sent = 0;
  for (const t of tables) {
    sent += await sendNotifications(db, sandboxId, t.table_members.map((m) => ({
      profile_id: m.profile_id,
      type: "feedback_request",
      title: "오늘 식탁은 어땠나요?",
      body: "1분이면 끝나요. 선택은 상대에게 보이지 않고 다음 매칭에만 쓰여요.",
      link: `/app/feedback/${t.id}`,
      dedupe_key: `feedback_request:${t.id}:${m.profile_id}`,
    })));
  }
  return { sent };
}
