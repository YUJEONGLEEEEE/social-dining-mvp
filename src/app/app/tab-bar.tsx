"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "홈", icon: "house" },
  { href: "/app/apply", label: "신청", icon: "calendar" },
  { href: "/app/table", label: "내 식탁", icon: "chats" },
  { href: "/app/my", label: "마이", icon: "user" },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="주요 메뉴" className="fixed bottom-0 z-20 flex w-full max-w-[430px] justify-around bg-paper px-6 pb-5 pt-2.5 shadow-[0_-1px_0_var(--mist)]">
      {TABS.map((t) => {
        const active = t.href === "/app" ? path === "/app" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 text-[13px] ${active ? "font-bold text-ink" : "text-graphite"}`}>
            <Icon name={t.icon} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
