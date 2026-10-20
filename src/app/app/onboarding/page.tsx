import { createAdminClient } from "@/lib/supabase/admin";
import { requireDemoSession } from "@/lib/auth/session";
import { ProfileForm } from "./profile-form";

export default async function Onboarding() {
  const session = await requireDemoSession();
  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("display_name, birth_year, gender, job, mbti, budget, food_restrictions, interests, personality, wants")
    .eq("id", session.meProfileId)
    .eq("sandbox_id", session.sandboxId)
    .single();
  return (
    <main className="px-5 pb-10 pt-6">
      <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">어떤 사람을 만나고 싶나요?</h1>
      <p className="mt-1 text-[15px] text-graphite">데모용으로 미리 채워 두었어요. 바꾸면 매칭 결과도 달라져요.</p>
      <ProfileForm profile={profile!} />
    </main>
  );
}
