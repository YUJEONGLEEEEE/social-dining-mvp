import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requireDemoSession } from "@/lib/auth/session";
import { NEXT_STEP } from "@/lib/demo/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateTimeLabel } from "@/lib/format";
import { advanceDemoAction, resetDemo, switchPersona } from "../actions";
import { TabBar } from "./tab-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDemoSession();
  const next = NEXT_STEP[session.stage];
  // Matching waits for the visitor's own application, so the first step points to 신청 until then.
  const { count: applied } = session.stage === "applied"
    ? await createAdminClient().from("applications").select("id", { count: "exact", head: true }).eq("sandbox_id", session.sandboxId).eq("profile_id", session.meProfileId)
    : { count: 1 };
  return (
    <div className="flex flex-1 flex-col items-center bg-mist">
      <div className="sticky top-0 z-20 w-full max-w-[430px] bg-ink px-4 py-2.5 text-[13px] text-paper">
        <div className="flex items-center justify-between gap-2">
          <span>
            <span className="font-bold">가상 시계</span> {session.demoClock ? dateTimeLabel(session.demoClock) : ""}
          </span>
          {!applied ? (
            <Link href="/app/apply" className="rounded-full bg-honey px-3 py-1.5 font-bold text-ink">먼저 신청하기 →</Link>
          ) : next ? (
            <form action={advanceDemoAction}>
              <input type="hidden" name="from" value={session.stage} />
              <SubmitButton pendingLabel="자동 처리 중…" className="rounded-full bg-honey px-3 py-1.5 font-bold text-ink">{next.label} →</SubmitButton>
            </form>
          ) : (
            <span className="text-paper/70">데모 끝</span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-paper/80">
          <span>{session.persona === "fail" ? "매칭 실패 참가자 시점" : "내 시점"}</span>
          <form action={switchPersona}>
            <input type="hidden" name="persona" value={session.persona === "fail" ? "me" : "fail"} />
            <button className="underline underline-offset-2">{session.persona === "fail" ? "내 시점으로" : "실패 참가자 보기"}</button>
          </form>
          <Link href="/admin" className="underline underline-offset-2">운영자 화면</Link>
          <form action={resetDemo} className="ml-auto">
            <button className="underline underline-offset-2">처음부터</button>
          </form>
        </div>
      </div>
      <div className="flex w-full max-w-[430px] flex-1 flex-col bg-paper pb-[84px]">{children}</div>
      <TabBar />
    </div>
  );
}
