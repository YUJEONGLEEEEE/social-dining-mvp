import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { RulesForm } from "./rules-form";

export default async function Rules() {
  const session = await requireDemoSession();
  const { data } = await createAdminClient().from("matching_rules").select("*").eq("sandbox_id", session.sandboxId).single();
  return (
    <main>
      <h1 className="text-[22px] font-extrabold tracking-[-0.03em]">매칭 규칙·가중치</h1>
      <section className="mt-4 rounded-btn bg-mist p-4 text-[14px] leading-relaxed">
        <p className="font-bold">필수 조건 (조정 불가)</p>
        <p className="mt-1">같은 날짜·지역 · 4~6명 · 나이 차 8살 이내 · 차단·신고·&lsquo;다시 안 만날래요&rsquo; 관계 없음. 하나라도 어기면 확정하지 않고 재배치해요.</p>
      </section>
      <RulesForm rules={{
        weight_gender: Number(data!.weight_gender), weight_mbti: Number(data!.weight_mbti), weight_interests: Number(data!.weight_interests),
        weight_wants: Number(data!.weight_wants), weight_new_people: Number(data!.weight_new_people), min_score: Number(data!.min_score),
      }} />
    </main>
  );
}
