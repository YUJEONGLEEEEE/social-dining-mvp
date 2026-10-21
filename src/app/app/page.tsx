import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDemoSession } from "@/lib/auth/session";
import { getJourney } from "@/lib/participant/journey";
import { compareFeedbackEffect, hasFeedback } from "@/lib/feedback/loop";
import { REGION_LABEL } from "@/lib/profile-options";
import { dateLabel, dateTimeLabel, durationLabel, timeLabel } from "@/lib/format";
import { PASS_PLANS } from "@/lib/participant/apply";
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
  // The before/after comparison only makes sense for someone who sat down last week and left feedback.
  const effect = session.stage === "next_matched" && session.persona === "me" && status === "confirmed" && application?.week_of === "2026-10-29"
    && (await hasFeedback(session.sandboxId, session.profileId, "2026-10-22"))
    ? await compareFeedbackEffect(session.sandboxId, "2026-10-29", session.profileId)
    : null;

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
        <>
          <Hello name={name} line="아직 신청한 식탁이 없어요" title={"목요일 저녁,\n처음 보는 사람들과"} />
          <section className="rounded-card bg-mist p-5">
            <p className="text-[15px] leading-relaxed">날짜·지역과 이용권을 고르고 결제하면, 화요일 24시 매칭 마감에 4~6명 식탁이 자동으로 정해져요.</p>
            <Link href="/app/apply" className="mt-4 flex h-[52px] items-center justify-center rounded-btn bg-ink font-semibold text-paper">이번 주 식탁 신청하기</Link>
          </section>
        </>
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
              <Row label="결제" value={application.payment_status !== "paid" ? "결제 대기" : journey.pass ? `${PASS_PLANS[journey.pass.kind as keyof typeof PASS_PLANS]?.name} 결제 완료` : "데모 자동 신청"} />
            </dl>
          </section>
        </>
      )}

      {application && status === "confirmed" && table && (
        <>
          <Hello
            name={name}
            line={effect ? "다음 주 식탁도 정해졌어요" : "식탁이 정해졌어요"}
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
              {status === "resolved" ? "선택하신 대로 처리했어요. 결과는 아래에서 볼 수 있어요." : "결제는 그대로 보관돼 있어요. 다른 일정으로 옮기거나, 보관하거나, 환불받을 수 있어요."}
            </p>
            <Link href={`/app/resolve/${application.id}`} className="mt-4 flex h-[52px] items-center justify-center rounded-btn bg-ink font-semibold text-paper">
              {status === "resolved" ? "처리 결과 보기" : "다음 선택하기"}
            </Link>
          </section>
        </>
      )}

      {effect && <FeedbackEffect effect={effect} />}

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
      {/* The demo visitor is called "나", which reads oddly with 님. */}
      <p className="text-[15px] text-graphite">{name && name !== "나" ? `${name}님, ` : ""}{line}</p>
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

const RELATION: Record<string, string> = {
  never: "다시 안 만날래요",
  mutual_again: "서로 또 만나요",
  met: "지난주 만남",
  new: "처음",
};

function FeedbackEffect({ effect }: { effect: Awaited<ReturnType<typeof compareFeedbackEffect>> }) {
  const column = (title: string, side: typeof effect.before) => (
    <div className="rounded-btn bg-paper p-3.5">
      <p className="text-[13px] font-bold text-graphite">{title}</p>
      <ul className="mt-2 space-y-1 text-[14px]">
        {side.members.map((m) => (
          <li key={m.name} className="flex justify-between gap-2">
            <span>{m.name}</span>
            <span className={m.relation === "never" ? "font-bold text-danger" : m.relation === "mutual_again" ? "font-bold" : "text-graphite"}>{RELATION[m.relation]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="mt-4 rounded-card bg-mist p-5">
      <h2 className="text-[17px] font-bold">피드백이 다음 매칭에 반영됐어요</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-graphite">
        같은 신청자로 매칭을 두 번 돌려 비교했어요. &lsquo;다시 안 만날래요&rsquo;는 같은 테이블이 될 수 없고, 서로 &lsquo;또 만나요&rsquo;는 가산점, 지난주에 만난 사람은 새로운 사람 점수에서 감점돼요.
      </p>
      <div className="mt-3 space-y-2">
        {column("피드백 반영 전", effect.before)}
        {column("반영 후 (실제 결과)", effect.after)}
      </div>
    </section>
  );
}

function StageAction({ stage, tableId, feedbackDone }: { stage: string; tableId: string; feedbackDone: boolean }) {
  const button = "mt-5 flex h-[52px] items-center justify-center rounded-btn bg-ink font-semibold text-paper";
  if (stage === "finished" && feedbackDone) return <p className="mt-5 rounded-btn bg-paper p-4 text-[15px] font-bold">피드백을 보냈어요. 위의 데모 바로 다음 회차 매칭을 실행해 보세요.</p>;
  if (stage === "finished" && !feedbackDone) return <Link href={`/app/feedback/${tableId}`} className={button}>오늘 식탁 피드백 남기기</Link>;
  if (stage === "dining") return <Link href={`/app/table/${tableId}`} className={button}>체크인하고 대화 카드 보기</Link>;
  return <Link href={`/app/table/${tableId}`} className={button}>단체방 열기</Link>;
}
