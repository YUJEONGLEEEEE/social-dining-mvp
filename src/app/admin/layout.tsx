import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { NEXT_STEP } from "@/lib/demo/clock";
import { dateTimeLabel } from "@/lib/format";
import { advanceDemoAction } from "../actions";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDemoSession();
  const { count } = await createAdminClient()
    .from("exception_cases")
    .select("id", { count: "exact", head: true })
    .eq("sandbox_id", session.sandboxId)
    .eq("status", "open");
  const next = NEXT_STEP[session.stage];
  const { count: applied } = session.stage === "applied"
    ? await createAdminClient().from("applications").select("id", { count: "exact", head: true }).eq("sandbox_id", session.sandboxId).eq("profile_id", session.meProfileId)
    : { count: 1 };
  return (
    <div className="flex flex-1 flex-col bg-mist">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink px-5 py-2.5 text-[14px] text-paper">
        <span><span className="font-bold">가상 시계</span> {session.demoClock ? dateTimeLabel(session.demoClock) : ""}</span>
        <div className="flex items-center gap-4">
          {!applied ? (
            <Link href="/app/apply" className="rounded-full bg-honey px-3 py-1.5 font-bold text-ink">참가자 앱에서 먼저 신청하기 →</Link>
          ) : next && (
            <form action={advanceDemoAction}>
              <input type="hidden" name="from" value={session.stage} />
              <input type="hidden" name="back" value="/admin" />
              <SubmitButton pendingLabel="자동 처리 중…" className="rounded-full bg-honey px-3 py-1.5 font-bold text-ink">{next.label} →</SubmitButton>
            </form>
          )}
          <Link href="/app" className="underline underline-offset-2">참가자 앱으로</Link>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col md:flex-row">
        <AdminNav openCount={count ?? 0} />
        <div className="min-w-0 flex-1 bg-paper px-5 py-6 md:px-8">{children}</div>
      </div>
    </div>
  );
}
