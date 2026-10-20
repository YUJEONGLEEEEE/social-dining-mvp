"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows progress and blocks double clicks while the action runs. */
export function SubmitButton({ children, pendingLabel, className }: { children: React.ReactNode; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} aria-busy={pending} className={`${className ?? ""} disabled:opacity-70`}>
      {pending ? pendingLabel : children}
    </button>
  );
}
