"use client";

import { useActionState } from "react";
import { signInTestAccount, type LoginState } from "./actions";
import { Button, FieldLabel, inputClass } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInTestAccount, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      <div>
        <FieldLabel htmlFor="email">이메일</FieldLabel>
        <input id="email" name="email" type="email" autoComplete="username" required maxLength={100} className={inputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="password">비밀번호</FieldLabel>
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={100} className={inputClass} />
      </div>
      {state.error && <p role="alert" className="text-[15px] font-medium text-danger">{state.error}</p>}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "로그인 중…" : "테스트 계정으로 로그인"}</Button>
    </form>
  );
}
