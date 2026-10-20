import { notFound, redirect } from "next/navigation";
import { requireDemoSession } from "@/lib/auth/session";
import { getMyTable } from "@/lib/participant/table";
import { createAdminClient } from "@/lib/supabase/admin";
import { FeedbackForm } from "./feedback-form";

export default async function Feedback({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const session = await requireDemoSession();
  if (!/^[0-9a-f-]{36}$/.test(tableId)) notFound();
  const data = await getMyTable(session, tableId);
  if (!data) notFound();
  const { data: done } = await createAdminClient().from("feedbacks").select("id").eq("application_id", data.applicationId).maybeSingle();
  if (done) redirect("/app");
  const people = data.table.table_members
    .filter((m) => !m.left_at && m.profile_id !== session.profileId)
    .map((m) => ({ id: m.profile_id, name: m.profiles.display_name }));
  return (
    <main className="px-5 pt-6">
      <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">오늘 식탁은 어땠나요?</h1>
      <p className="mt-1 text-[15px] text-graphite">1분이면 끝나요.</p>
      <FeedbackForm tableId={tableId} people={people} />
    </main>
  );
}
