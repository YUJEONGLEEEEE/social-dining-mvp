"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "대시보드·예외 처리함" },
  { href: "/admin/matching", label: "자동 매칭 모니터" },
  { href: "/admin/rules", label: "매칭 규칙·가중치" },
  { href: "/admin/logs", label: "자동 처리 기록" },
];

export function AdminNav({ openCount }: { openCount: number }) {
  const path = usePathname();
  return (
    <nav aria-label="운영자 메뉴" className="flex gap-1 overflow-x-auto bg-mist px-3 py-3 text-[14px] md:w-[220px] md:shrink-0 md:flex-col md:px-3 md:py-5">
      <p className="hidden px-2.5 pb-4 text-[16px] font-extrabold tracking-[-0.03em] md:block">우연한 식탁 운영</p>
      {ITEMS.map((item) => {
        const active = path === item.href;
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={`flex h-[38px] shrink-0 items-center justify-between gap-2 rounded-sm px-2.5 ${active ? "bg-ink font-bold text-paper" : "text-charcoal"}`}>
            {item.label}
            {item.href === "/admin" && openCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[12px] font-bold text-paper">{openCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
