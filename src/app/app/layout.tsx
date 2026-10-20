import Link from "next/link";
import { requireDemoSession } from "@/lib/auth/session";
import { resetDemo, switchPersona } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDemoSession();
  return (
    <div className="flex flex-1 flex-col items-center bg-mist">
      <div className="w-full max-w-[430px] border-b border-line bg-paper px-4 py-2 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">데모 · {session.persona === "fail" ? "매칭 실패 참가자 시점" : "내 시점"}</span>
          <div className="flex items-center gap-3">
            <form action={switchPersona}>
              <input type="hidden" name="persona" value={session.persona === "fail" ? "me" : "fail"} />
              <button className="underline underline-offset-2">{session.persona === "fail" ? "내 시점으로" : "실패 참가자 보기"}</button>
            </form>
            <Link href="/admin" className="underline underline-offset-2">운영자</Link>
            <form action={resetDemo}>
              <button className="underline underline-offset-2">처음부터</button>
            </form>
          </div>
        </div>
      </div>
      <div className="flex w-full max-w-[430px] flex-1 flex-col bg-paper">{children}</div>
    </div>
  );
}
