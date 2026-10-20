import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDemoSession } from "@/lib/auth/session";
import { getJourney } from "@/lib/participant/journey";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel, dateTimeLabel, durationLabel, timeLabel } from "@/lib/format";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function AppHome() {
  const session = await requireDemoSession();
  const journey = await getJourney(session);
  if (session.persona === "me" && !journey.profile?.consented_at) redirect("/app/onboarding");

  const { application, table, slots } = journey;
  const name = journey.profile?.display_name ?? "";
  const status = application?.match_status;
  const slot = slots[0];

  return (
    <main className="px-5 pt-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-[20px] font-extrabold tracking-[-0.04em]">우연한 식탁</span>
        <Link href="/app/notifications" aria-label={`알림 ${journey.unread}개`} className="relative">
          <Icon name="bell" />
          {journey.unread > 0 && (
            <span className="absolute -right-1.5 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-paper bg-honey px-1 text-[11px] font-bold">
              {journey.unread}
            </span>
          )}
        </Link>
      </header>

      {!application && (
        <Hello name={name} line="아직 신청한 식탁이 없어요" title={"목요일 저녁,\n처음 보는 사람들과"} />
      )}

      {application && status === "waiting" && slot && (
        <>
          <Hello name={name} line="신청이 접수됐어요" title={"목요일 저녁,\n누구와 만나게 될까요?"} />
          <section className="rounded-card bg-mist p-5">
            <Badge><Icon name="hourglass" size={14} />매칭 대기</Badge>
            <p className="mt-3 text-[22px] font-extrabold tracking-[-0.03em]">
              매칭까지 {session.demoClock ? durationLabel(session.demoClock, slot.match_deadline_at) : ""}
            </p>
            <p className="mt-1 text-[15px] leading-relaxed">
              {dateTimeLabel(slot.match_deadline_at)}에 결제를 마친 신청자끼리 자동으로 식탁을 정해요. 그 전까지는 환불할 수 있어요.
            </p>
            <dl className="mt-4 space-y-1.5 text-[15px]">
              <Row label="일정" value={`${dateLabel(slot.starts_at)} ${timeLabel(slot.starts_at)}`} />
              <Row label="지역" value={slots.map((s) => REGION_LABEL[s.region]).join(" → ") + (slots.length > 1 ? " (재배치 후보 포함)" : "")} />
              <Row label="결제" value={application.payment_status === "paid" ? "1회권 결제 완료" : "결제 대기"} />
            </dl>
          </section>
        </>
      )}

      {application && status === "confirmed" && table && (
        <>
          <Hello
            name={name}
            line={session.stage === "next_matched" ? "다음 주 식탁도 정해졌어요" : "이번 주 식탁이 정해졌어요"}
            title={`${dateLabel(table.startsAt).replace(/ \(.\)/, "")} 저녁,\n${table.members.length - 1}명과 함께해요`}
          />
          <section className="overflow-hidden rounded-card bg-mist">
            <div className="p-5">
              <Badge><Icon name="check" size={14} />매칭 확정</Badge>
              <p className="mt-2.5 text-[22px] font-extrabold tracking-[-0.03em]">{dateTimeLabel(table.startsAt)}</p>
              <p className="mt-1 flex items-center gap-3 text-[15px] text-graphite">
                <span className="flex items-center gap-1"><Icon name="pin" size={16} />{table.venueName ?? "식당 확정 중"} · {REGION_LABEL[table.region]}</span>
                <span className="flex items-center gap-1"><Icon name="users" size={16} />{table.members.length}명</span>
              </p>
              <h2 className="mt-5 text-[15px] font-bold">함께하게 된 이유</h2>
              <p className="mt-1 text-[15px] leading-relaxed">{table.reason}</p>
              {table.myReason && <p className="mt-2 text-[14px] text-graphite">나와 맞는 점 · {table.myReason}</p>}
              <StageAction stage={session.stage} tableId={table.id} feedbackDone={journey.feedbackDone} />
            </div>
          </section>
        </>
      )}

      {application && (status === "failed" || status === "resolved") && (
        <>
          <Hello name={name} line="이번 주 매칭 결과를 알려드려요" title={"이번 목요일엔\n딱 맞는 식탁을 찾지 못했어요"} />
          <section className="rounded-card bg-mist p-5">
            <Badge tone="plain"><Icon name="calendarX" size={14} />이번 회차 매칭 안 됨</Badge>
            <p className="mt-3 text-[15px] leading-relaxed">{application.match_note}</p>
            <p className="mt-3 flex items-start gap-2 rounded-btn bg-paper p-3.5 text-[15px] leading-relaxed">
              <Icon name="shield" size={20} className="mt-0.5 shrink-0" />
              결제는 그대로 보관돼 있어요. 다른 일정으로 옮기거나, 이용권으로 보관하거나, 환불받을 수 있어요.
            </p>
            <Link href={`/app/resolve/${application.id}`} className="mt-4 flex h-[52px] items-center justify-center rounded-btn bg-ink font-semibold text-paper">
              {status === "resolved" ? "처리 결과 보기" : "다음 선택하기"}
            </Link>
          </section>
        </>
      )}

      <section className="mt-4 rounded-card bg-mist p-5 text-[15px] leading-relaxed">
        <h2 className="font-bold">환불·취소 규정</h2>
        <p className="mt-1 text-graphite">화요일 24시(매칭 마감) 전까지 전액 환불. 이후와 당일 취소는 환불되지 않아요. 노쇼 2회가 쌓이면 4주간 신청이 제한돼요.</p>
      </section>
    </main>
  );
}

function Hello({ name, line, title }: { name: string; line: string; title: string }) {
  return (
    <div className="mb-5 mt-1">
      <p className="text-[15px] text-graphite">{name}님, {line}</p>
      <h1 className="mt-1.5 whitespace-pre-line text-[30px] font-extrabold leading-[1.2] tracking-[-0.035em]">{title}</h1>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-10 shrink-0 text-graphite">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StageAction({ stage, tableId, feedbackDone }: { stage: string; tableId: string; feedbackDone: boolean }) {
  const button = "mt-5 flex h-[52px] items-center justify-center rounded-btn bg-ink font-semibold text-paper";
  if (stage === "finished" && !feedbackDone) return <Link href={`/app/feedback/${tableId}`} className={button}>오늘 식탁 피드백 남기기</Link>;
  if (stage === "dining") return <Link href={`/app/table/${tableId}`} className={button}>대화 카드 보기</Link>;
  return <Link href={`/app/table/${tableId}`} className={button}>단체방 열기</Link>;
}
