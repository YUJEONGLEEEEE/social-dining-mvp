import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "text" };

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base = "inline-flex h-[52px] w-full items-center justify-center gap-1.5 rounded-btn px-5 text-base font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:bg-mist disabled:text-[#9a9a9a]";
  const styles = {
    primary: "bg-ink text-paper",
    secondary: "border-[1.5px] border-ink bg-paper text-ink",
    text: "h-11 bg-transparent font-medium text-graphite underline underline-offset-4",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Badge({ children, tone = "honey" }: { children: ReactNode; tone?: "honey" | "plain" | "danger" }) {
  const tones = { honey: "bg-honey text-ink", plain: "bg-paper text-charcoal", danger: "bg-danger-soft text-danger" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-bold ${tones[tone]}`}>{children}</span>;
}

/** A checkbox or radio styled as a chip; selected chips turn honey. */
export function ChoiceChip({ name, value, label, type = "checkbox", defaultChecked }: {
  name: string; value: string; label: string; type?: "checkbox" | "radio"; defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input className="peer sr-only" type={type} name={name} value={value} defaultChecked={defaultChecked} />
      <span className="inline-flex h-10 items-center whitespace-nowrap rounded-full bg-mist px-4 text-[15px] peer-checked:bg-honey peer-checked:font-bold peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
        {label}
      </span>
    </label>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-2 block text-[15px] font-bold">{children}</label>;
}

export const inputClass =
  "h-12 w-full rounded-sm border-[1.5px] border-line bg-paper px-3.5 text-base outline-none focus:border-2 focus:border-ink";

/** Short policy lines with an icon each, so the rules can be scanned at a glance. */
export function IconList({ items, className = "" }: { items: { icon: IconName; text: ReactNode }[]; className?: string }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[15px] leading-snug">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-paper"><Icon name={item.icon} size={16} /></span>
          <span className="pt-1">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

export const POLICY: { icon: IconName; text: string }[] = [
  { icon: "calendar", text: "화요일 24시(매칭 마감)까지 전액 환불" },
  { icon: "calendarX", text: "마감 이후·당일 취소는 환불 불가" },
  { icon: "warning", text: "노쇼 2회 누적 시 4주간 신청 제한" },
];
