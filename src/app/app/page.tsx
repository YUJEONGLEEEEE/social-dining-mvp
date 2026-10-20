import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireDemoSession } from "@/lib/auth/session";

export default async function AppHome() {
  const session = await requireDemoSession();
  const db = createAdminClient();
  const { data: me } = await db.from("profiles").select("display_name, consented_at").eq("id", session.meProfileId).single();
  if (!me?.consented_at && session.persona === "me") redirect("/app/onboarding");
  const { data: profile } = await db.from("profiles").select("display_name").eq("id", session.profileId).single();
  return (
    <main className="px-5 pt-6">
      <p className="text-[15px] text-graphite">{profile?.display_name}님, 신청이 접수됐어요</p>
      <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-[-0.035em]">목요일 저녁,<br />누구와 만나게 될까요?</h1>
    </main>
  );
}
