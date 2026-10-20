import Link from "next/link";
import { requireDemoSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function Notifications() {
  const session = await requireDemoSession();
  const db = createAdminClient();
  const { data } = await db
    .from("notifications")
    .select("id, title, body, link, read_at")
    .eq("sandbox_id", session.sandboxId)
    .eq("profile_id", session.profileId)
    .order("created_at", { ascending: false });
  // Opening the inbox marks everything as read.
  await db.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("sandbox_id", session.sandboxId).eq("profile_id", session.profileId).is("read_at", null);

  return (
    <main className="px-5 pt-6">
      <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">알림</h1>
      {!data?.length && <p className="mt-6 text-[15px] text-graphite">아직 받은 알림이 없어요. 매칭이 끝나면 여기로 알려드려요.</p>}
      <ul className="mt-4 space-y-2">
        {data?.map((n) => (
          <li key={n.id}>
            <Link href={n.link ?? "/app"} className={`block rounded-btn p-4 ${n.read_at ? "bg-mist" : "bg-pollen"}`}>
              <p className="text-[16px] font-bold">{n.title}</p>
              {n.body && <p className="mt-1 text-[15px] leading-relaxed">{n.body}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
