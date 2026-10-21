import { redirect } from "next/navigation";
import { requireDemoSession } from "@/lib/auth/session";
import { latestTableId } from "@/lib/participant/table";

export default async function MyTables() {
  const session = await requireDemoSession();
  const id = await latestTableId(session);
  if (id) redirect(`/app/table/${id}`);
  return (
    <main className="px-5 pt-6">
      <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">내 식탁</h1>
      <div className="mt-6 rounded-card bg-mist p-6 text-center">
        <p className="text-[16px] font-bold">아직 정해진 식탁이 없어요</p>
        <p className="mt-1 text-[15px] text-graphite">매칭이 끝나면 함께할 사람들과 단체방이 여기에 생겨요.</p>
      </div>
    </main>
  );
}
