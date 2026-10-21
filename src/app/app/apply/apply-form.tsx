"use client";

import { useActionState, useState } from "react";
import { applyAction, type ApplyState } from "../../actions";
import { Button } from "@/components/ui";

type Slot = { id: string; title: string; deadline: string };
type Plan = { kind: string; name: string; price: number; note: string };

export function ApplyForm({ slots, plans, kept }: { slots: Slot[]; plans: Plan[]; kept: boolean }) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(applyAction, {});
  const [kind, setKind] = useState(plans[0].kind);
  const price = plans.find((p) => p.kind === kind)!.price;

  return (
    <form action={action} className="mt-6 space-y-6">
      <fieldset>
        <legend className="text-[15px] font-bold">1. 날짜·지역</legend>
        <div className="mt-2 space-y-2">
          {slots.map((s, i) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-btn bg-mist p-4 text-[15px] has-[:checked]:bg-pollen">
              <input type="radio" name="slot" value={s.id} defaultChecked={i === 0} required className="size-5 accent-ink" />
              <span>
                <span className="block font-bold">{s.title}</span>
                <span className="text-graphite">신청 마감 {s.deadline}</span>
              </span>
            </label>
          ))}
        </div>
        {slots.length > 1 && (
          <label className="mt-3 flex items-start gap-3 text-[15px] leading-relaxed">
            <input type="checkbox" name="otherSlots" className="mt-1 size-5 accent-ink" />
            <span>같은 날 다른 지역도 괜찮아요. 첫 번째 지역에서 안 맞으면 자동으로 옮겨 드려요.</span>
          </label>
        )}
      </fieldset>

      {kept ? (
        <section>
          <h2 className="text-[15px] font-bold">2. 이용권</h2>
          <input type="hidden" name="pass" value="single" />
          <p className="mt-2 rounded-btn bg-pollen p-4 text-[15px] leading-relaxed">지난번 매칭이 안 돼 보관한 1회권을 사용해요. 추가 결제는 없어요.</p>
        </section>
      ) : (
      <fieldset>
        <legend className="text-[15px] font-bold">2. 이용권</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {plans.map((p) => (
            <label key={p.kind} className="cursor-pointer rounded-btn bg-mist p-4 has-[:checked]:bg-pollen has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink">
              <input type="radio" name="pass" value={p.kind} checked={kind === p.kind} onChange={() => setKind(p.kind)} className="sr-only" />
              <span className="block text-[15px] font-bold">{p.name}</span>
              <span className="mt-0.5 block text-[17px] font-extrabold">{p.price.toLocaleString("ko-KR")}원</span>
              {p.note && <span className="mt-1 block text-[13px] leading-snug text-graphite">{p.note}</span>}
            </label>
          ))}
        </div>
      </fieldset>
      )}

      <section>
        <h2 className="text-[15px] font-bold">3. 결제</h2>
        {!kept && (
          <p className="mt-2 rounded-btn bg-mist p-4 text-[15px] leading-relaxed">
            모의 결제예요. 실제 돈은 나가지 않고, 바로 결제 완료로 처리돼요.
          </p>
        )}
        <label className="mt-3 flex items-start gap-3 text-[15px] leading-relaxed">
          <input type="checkbox" name="agree" required className="mt-1 size-5 accent-ink" />
          <span>화요일 24시(매칭 마감) 이후 환불 불가, 당일 취소 환불 없음 규정을 확인했어요.</span>
        </label>
      </section>

      {state.error && <p role="alert" className="text-[15px] font-medium text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "신청 중…" : kept ? "보관한 이용권으로 신청하기" : `${price.toLocaleString("ko-KR")}원 결제하고 신청하기`}</Button>
    </form>
  );
}
