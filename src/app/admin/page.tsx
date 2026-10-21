import { requireDemoSession } from "@/lib/auth/session";
import { currentWeek, getOverview, weeksSoFar } from "@/lib/admin/overview";
import { WeekTabs } from "./week-tabs";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel } from "@/lib/format";
import { Icon } from "@/components/icons";
import { closeExceptionAction, resolveVenueShortageAction } from "../actions";

const TYPE_LABEL: Record<string, string> = {
  venue_shortage: "식당 부족",
  table_underfilled: "인원 부족 테이블",
  safety_report: "신고",
  payment_failed: "결제 실패",
  notification_failed: "알림 실패",
  other: "기타",
};

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ error?: string; week?: string }> }) {
  const { error, week } = await searchParams;
  const session = await requireDemoSession();
  const o = await getOverview(session, currentWeek(session, week));
  const open = o.exceptions.filter((e) => e.status === "open");
  const resolved = o.exceptions.filter((e) => e.status === "resolved");

  return (
    <main>
      <WeekTabs weeks={weeksSoFar(session)} current={o.weekOf} path="/admin" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[22px] font-extrabold tracking-[-0.03em]">{dateLabel(`${o.weekOf}T10:00:00Z`)} 회차</h1>
        <p className="text-[14px] text-graphite">
          {o.run?.finished_at ? "매칭 마감(화요일 24시)에 자동 매칭 완료 · 운영자 승인 없이 확정" : "매칭 마감(화요일 24시) 전 · 신청 접수 중"}
        </p>
      </div>

      <section aria-label="현황" className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="결제 완료" value={`${o.kpi.paid}명`} />
        <Kpi label="자동 확정 테이블" value={`${o.kpi.tables}개`} />
        <Kpi label="매칭 성공률" value={`${o.kpi.autoRate}%`} note={`${o.kpi.seated}명 배정 · ${o.kpi.failed}명 실패`} />
        <Kpi label="처리할 예외" value={`${o.kpi.open}건`} alert={o.kpi.open > 0} />
      </section>
      <section aria-label="확인할 사람" className="mt-3 grid grid-cols-3 gap-3">
        <Kpi label="실패 후 선택 대기" value={`${o.kpi.choosing}명`} note="참가자가 직접 이동·보관·환불" />
        <Kpi label="노쇼 후보" value={`${o.kpi.noShow}명`} note="신청자·결제·참석에서 확정" />
        <Kpi label="미처리 신고" value={`${o.kpi.reports}건`} alert={o.kpi.reports > 0} />
      </section>

      <section className="mt-8">
        <h2 className="text-[17px] font-bold">예외 처리함</h2>
        <p className="mt-1 text-[14px] text-graphite">자동 재시도로도 해결되지 않은 건만 여기에 와요. 정상 흐름은 운영자 확인 없이 끝나요.</p>
        {error && <p role="alert" className="mt-3 text-[15px] font-medium text-danger">처리하지 못했어요. 같은 지역의 식당을 골라 다시 시도해 주세요.</p>}
        {open.length === 0 && (
          <p className="mt-3 rounded-btn bg-mist p-4 text-[15px]">처리할 예외가 없어요.{!o.run && " 매칭이 끝나면 자동 처리 결과를 보여드려요."}</p>
        )}
        <ul className="mt-3 space-y-3">
          {open.map((e) => {
            const detail = e.detail as Record<string, string | number>;
            return (
              <li key={e.id} className="rounded-btn bg-danger-soft p-4">
                <div className="flex items-start gap-3">
                  <Icon name="warning" size={22} className="mt-0.5 shrink-0 text-danger" />
                  <div className="min-w-0 flex-1 text-[15px]">
                    <p className="font-bold">{e.title} <span className="font-medium text-danger">· {TYPE_LABEL[e.type]}</span></p>
                    {e.type === "venue_shortage" && (
                      <p className="mt-0.5 leading-relaxed">{REGION_LABEL[String(detail.region)]} {detail.members}명 테이블 · {String(detail.message)}</p>
                    )}
                    {e.type === "safety_report" && <p className="mt-0.5 leading-relaxed">신고 사유: {String(detail.reason)} · 두 사람은 이미 서로 매칭되지 않도록 차단했어요.</p>}
                    {e.type === "other" && <p className="mt-0.5 leading-relaxed">{String(detail.message ?? "")}</p>}
                  </div>
                </div>
                {e.type === "venue_shortage" ? (
                  <form action={resolveVenueShortageAction} className="mt-3 flex flex-wrap items-center gap-2 pl-[34px]">
                    <input type="hidden" name="exceptionId" value={e.id} />
                    <label htmlFor={`venue-${e.id}`} className="sr-only">대체 식당</label>
                    <select id={`venue-${e.id}`} name="venueId" required className="h-10 min-w-0 flex-1 rounded-sm border-[1.5px] border-line bg-paper px-3 text-[14px]">
                      {/* Same-region partners only; with no seats left the operator calls ahead for one more table. */}
                      {o.venues.filter((v) => v.region === detail.region).sort((a, b) => b.tables_available - a.tables_available || b.rating - a.rating).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} · 평점 {v.rating} · {v.tables_available > 0 ? `남은 테이블 ${v.tables_available}` : "전화로 추가 좌석 확인"}
                        </option>
                      ))}
                    </select>
                    <button className="h-10 rounded-sm bg-ink px-4 text-[14px] font-bold text-paper">대체 식당 지정</button>
                  </form>
                ) : (
                  <form action={closeExceptionAction} className="mt-3 flex flex-wrap gap-2 pl-[34px]">
                    <input type="hidden" name="exceptionId" value={e.id} />
                    {e.type === "safety_report" && (
                      <>
                        <label htmlFor={`sanction-${e.id}`} className="sr-only">신고 대상 조치</label>
                        <select id={`sanction-${e.id}`} name="sanction" defaultValue="warn" className="h-10 rounded-sm border-[1.5px] border-line bg-paper px-3 text-[14px]">
                          <option value="none">조치 없음</option>
                          <option value="warn">경고</option>
                          <option value="restrict">4주 신청 제한</option>
                          <option value="ban">영구 이용 제한</option>
                        </select>
                        <p className="w-full text-[13px] text-graphite">제한은 다음 신청부터 적용돼요. 이미 확정된 회차는 그대로 두고 필요하면 연락해요.</p>
                      </>
                    )}
                    <label htmlFor={`note-${e.id}`} className="sr-only">처리 메모</label>
                    <input id={`note-${e.id}`} name="note" maxLength={300} placeholder="처리 메모 (선택)" className="h-10 min-w-0 flex-1 rounded-sm border-[1.5px] border-line bg-paper px-3 text-[14px]" />
                    <button className="h-10 rounded-sm bg-ink px-4 text-[14px] font-bold text-paper">확인 완료</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {resolved.length > 0 && (
          <details className="mt-3 text-[14px]">
            <summary className="cursor-pointer text-graphite">처리 완료 {resolved.length}건</summary>
            <ul className="mt-2 space-y-1">
              {resolved.map((e) => <li key={e.id} className="rounded-sm bg-mist px-3 py-2">{e.title} · {e.resolution}</li>)}
            </ul>
          </details>
        )}
      </section>

      {o.feedback.count > 0 && (
        <section className="mt-8">
          <h2 className="text-[17px] font-bold">피드백 요약 · 누적 {o.feedback.count}명 응답</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">
            <Kpi label="전체 만족도" value={`${o.feedback.rating ?? "-"}`} />
            <Kpi label="분위기" value={`${o.feedback.mood ?? "-"}`} />
            <Kpi label="대화" value={`${o.feedback.talk ?? "-"}`} />
            <Kpi label="식당" value={`${o.feedback.venue ?? "-"}`} />
            <Kpi label="재참여 의향" value={o.feedback.rejoin === null ? "-" : `${o.feedback.rejoin}%`} />
            <Kpi label="추천 의향" value={o.feedback.recommend === null ? "-" : `${o.feedback.recommend}%`} />
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-[17px] font-bold">테이블</h2>
        {o.tables.length === 0 ? (
          <p className="mt-3 rounded-btn bg-mist p-4 text-[15px]">아직 매칭 전이에요. 위의 데모 바에서 매칭 마감 시각으로 이동하면 자동 매칭이 실행돼요.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[14px] tabular-nums">
              <thead>
                <tr className="border-b border-ink text-left text-graphite">
                  <th className="px-2.5 py-2 font-semibold">지역</th>
                  <th className="px-2.5 py-2 font-semibold">인원</th>
                  <th className="px-2.5 py-2 font-semibold">나이</th>
                  <th className="px-2.5 py-2 font-semibold">점수</th>
                  <th className="px-2.5 py-2 font-semibold">식당</th>
                  <th className="px-2.5 py-2 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {o.tables.map((t) => {
                  const members = t.table_members.filter((m) => !m.left_at);
                  const women = members.filter((m) => m.profiles.gender === "female").length;
                  const ages = members.map((m) => 2026 - m.profiles.birth_year);
                  return (
                    <tr key={t.id} className="border-b border-line">
                      <td className="px-2.5 py-2.5">{REGION_LABEL[t.event_slots.region]}</td>
                      <td className="px-2.5 py-2.5">{members.length}명 (여{women} 남{members.length - women})</td>
                      <td className="px-2.5 py-2.5">{Math.min(...ages)}~{Math.max(...ages)}세</td>
                      <td className="px-2.5 py-2.5">{t.score}</td>
                      <td className={`px-2.5 py-2.5 ${t.venues ? "" : "text-graphite"}`}>{t.venues?.name ?? "미배정"}</td>
                      <td className="px-2.5 py-2.5">
                        {t.venues ? (
                          <span className="rounded-full bg-mist px-2.5 py-1 text-[13px] font-bold">자동 확정</span>
                        ) : (
                          <span className="rounded-full bg-danger-soft px-2.5 py-1 text-[13px] font-bold text-danger">식당 부족</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Kpi({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className={`rounded-btn px-4 py-3.5 ${alert ? "bg-danger-soft text-danger" : "bg-mist"}`}>
      <p className={`text-[14px] ${alert ? "" : "text-graphite"}`}>{label}</p>
      <p className="mt-0.5 text-[28px] font-extrabold tracking-[-0.03em]">{value}</p>
      {note && <p className="text-[13px] text-graphite">{note}</p>}
    </div>
  );
}
