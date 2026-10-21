import Link from "next/link";
import { dateLabel } from "@/lib/format";

/** Switches the operator view between the demo's weeks (shown once there are two). */
export function WeekTabs({ weeks, current, path }: { weeks: string[]; current: string; path: string }) {
  if (weeks.length < 2) return null;
  return (
    <nav aria-label="회차 선택" className="mb-4 flex gap-2 text-[14px]">
      {weeks.map((w) => (
        <Link key={w} href={`${path}?week=${w}`} aria-current={w === current ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 ${w === current ? "bg-ink font-bold text-paper" : "bg-mist"}`}>
          {dateLabel(`${w}T10:00:00Z`)} 회차
        </Link>
      ))}
    </nav>
  );
}
