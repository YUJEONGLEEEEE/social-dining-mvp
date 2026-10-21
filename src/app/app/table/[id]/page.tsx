import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDemoSession } from "@/lib/auth/session";
import { getMyTable } from "@/lib/participant/table";
import { BUDGETS, REGION_LABEL } from "@/lib/profile-options";
import { dateTimeLabel } from "@/lib/format";
import { Icon } from "@/components/icons";
import { checkInAction, confirmAttendance, sendChatMessage } from "../../../actions";

export default async function TableRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireDemoSession();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getMyTable(session, id);
  if (!data) notFound();
  const { table, messages, attendance } = data;
  const members = table.table_members.filter((m) => !m.left_at);
  const nameOf = new Map(members.map((m) => [m.profile_id, m.profiles.display_name]));

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 px-4 pb-3 pt-4">
        <Link href="/app" aria-label="홈으로"><Icon name="arrowLeft" /></Link>
        <div>
          <h1 className="text-[16px] font-bold">{dateTimeLabel(table.event_slots.starts_at)} 식탁</h1>
          <p className="text-[13px] text-graphite">{members.length}명 · {table.venues?.name ?? "식당 확정 중"} · {REGION_LABEL[table.event_slots.region]}</p>
        </div>
      </header>

      {table.venues && (
        <section aria-label="식당 정보" className="mx-4 mb-2 rounded-btn bg-pollen px-4 py-3 text-[15px] leading-relaxed">
          <p className="font-bold">{table.venues.name}{table.venues.rating ? ` · 평점 ${table.venues.rating}` : ""}</p>
          <p>{dateTimeLabel(table.event_slots.starts_at)} · 예약명 &ldquo;우연한 식탁&rdquo;</p>
          <p className="text-[14px] text-charcoal">
            {table.venues.address ?? REGION_LABEL[table.event_slots.region]}
            {table.venues.price_band ? ` · 1인 ${BUDGETS.find((b) => b.value === table.venues!.price_band)?.label ?? ""} (현장 결제)` : ""}
          </p>
          <a
            href={`https://map.naver.com/p/search/${encodeURIComponent(`${table.venues.name} ${REGION_LABEL[table.event_slots.region]}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[14px] font-semibold underline underline-offset-4"
          >
            <Icon name="pin" size={16} />지도에서 보기
          </a>
        </section>
      )}

      <details className="mx-4 mb-3 rounded-btn bg-mist px-4 py-3 text-[15px]">
        <summary className="cursor-pointer font-bold">함께하는 사람 {members.length}명</summary>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <li key={m.profile_id} className="rounded-full bg-paper px-3 py-1.5 text-[14px]">
              {m.profiles.display_name} · {2026 - m.profiles.birth_year}세{m.profiles.mbti ? ` · ${m.profiles.mbti}` : ""}
            </li>
          ))}
        </ul>
      </details>

      <section aria-label="단체방 메시지" className="flex flex-1 flex-col gap-2 bg-mist px-3.5 py-3">
        {messages.length === 0 && <p className="py-8 text-center text-[15px] text-graphite">아직 메시지가 없어요.</p>}
        {messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="rounded-[18px] bg-paper px-3.5 py-3 text-[15px] leading-relaxed">
                <p className="mb-1 flex items-center gap-1.5 text-[14px] font-bold"><Icon name="megaphone" size={16} />우연한 식탁 안내</p>
                {m.body}
              </div>
            );
          }
          if (m.kind === "topic_card") {
            const [label, ...rest] = m.body.split(" · ");
            return (
              <div key={m.id} className="rounded-[18px] bg-honey px-4 py-3.5">
                <p className="flex items-center gap-1 text-[13px] font-bold"><Icon name="chatDots" size={14} />{label}</p>
                <p className="mt-1 text-[18px] font-extrabold leading-snug tracking-[-0.02em]">{rest.join(" · ")}</p>
              </div>
            );
          }
          const mine = m.sender_profile_id === session.profileId;
          return (
            <div key={m.id} className={`flex max-w-[78%] flex-col ${mine ? "self-end items-end" : "self-start"}`}>
              {!mine && <span className="mb-0.5 ml-1.5 text-[13px] text-graphite">{nameOf.get(m.sender_profile_id ?? "") ?? "참가자"}</span>}
              <p className={`rounded-[18px] px-3.5 py-2.5 text-[15px] leading-relaxed ${mine ? "bg-pollen" : "bg-paper"}`}>{m.body}</p>
            </div>
          );
        })}
      </section>

      {session.stage === "reminded" && attendance === "none" && (
        <form action={confirmAttendance} className="px-4 pt-3">
          <input type="hidden" name="tableId" value={table.id} />
          <button className="h-[52px] w-full rounded-btn bg-ink font-semibold text-paper">참석할게요</button>
        </form>
      )}
      {session.stage === "reminded" && attendance === "confirmed" && <p className="px-4 pt-3 text-[15px] font-bold">참석 확인 완료 · 내일 만나요</p>}
      {session.stage === "dining" && attendance !== "checked_in" && (
        <form action={checkInAction} className="px-4 pt-3">
          <input type="hidden" name="tableId" value={table.id} />
          <button className="h-[52px] w-full rounded-btn bg-ink font-semibold text-paper">도착했어요 · 체크인</button>
          <p className="mt-1.5 text-center text-[13px] text-graphite">체크인 기록이 없으면 운영자 화면에 노쇼 후보로 표시돼요</p>
        </form>
      )}
      {attendance === "checked_in" && <p className="px-4 pt-3 text-[15px] font-bold">체크인 완료 · 즐거운 식사 되세요</p>}

      <form action={sendChatMessage} className="flex items-center gap-2 px-3.5 py-3">
        <input type="hidden" name="tableId" value={table.id} />
        <label htmlFor="body" className="sr-only">메시지</label>
        <input id="body" name="body" required maxLength={500} placeholder="메시지 보내기" autoComplete="off"
          className="h-11 flex-1 rounded-full bg-mist px-4 text-[15px] outline-none focus:ring-2 focus:ring-ink" />
        <button aria-label="보내기" className="grid size-11 place-items-center rounded-full bg-ink text-paper"><Icon name="send" size={20} /></button>
      </form>
    </main>
  );
}
