"use client";

import { useActionState } from "react";
import { submitFeedbackAction, type FeedbackState } from "../../../actions";
import { Icon } from "@/components/icons";
import { inputClass } from "@/components/ui";

const CHOICES = [
  { value: "again", label: "또 만나요" },
  { value: "neutral", label: "보통" },
  { value: "never", label: "다시 안 만날래요" },
];

export function FeedbackForm({ tableId, people }: { tableId: string; people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(submitFeedbackAction, {});
  return (
    <form action={action} className="mt-5 space-y-6">
      <input type="hidden" name="tableId" value={tableId} />
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">만족도</legend>
        <div className="flex flex-row-reverse justify-end gap-1">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rating" value={n} required className="peer sr-only" />
              <span className="sr-only">{n}점</span>
              {/* Stars up to the checked one turn ink, using the reversed order trick. */}
              <Icon name="star" size={36} className="text-[#cfcfcf] peer-checked:text-ink peer-focus-visible:outline-2" />
            </label>
          ))}
        </div>
      </fieldset>
      <style>{`fieldset div:has(input[name=rating]) label:has(:checked) ~ label svg { color: var(--ink); }`}</style>

      <fieldset>
        <legend className="mb-1 text-[15px] font-bold">다시 만나고 싶은 사람</legend>
        <p className="mb-2 flex items-center gap-1.5 text-[14px] text-graphite"><Icon name="lock" size={16} />상대에게 보이지 않고 다음 매칭에만 쓰여요</p>
        <ul className="space-y-1">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 py-1.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-mist text-[15px] font-bold">{p.name[0]}</span>
              <span className="flex-1 text-[15px]">{p.name}</span>
              <span className="flex gap-1">
                {CHOICES.map((c) => (
                  <label key={c.value} className="cursor-pointer">
                    <input type="radio" name={`person:${p.id}`} value={c.value} defaultChecked={c.value === "neutral"} className="peer sr-only" />
                    <span className="inline-flex h-[34px] items-center rounded-full bg-mist px-2.5 text-[13px] peer-checked:bg-honey peer-checked:font-bold peer-focus-visible:outline-2">{c.label}</span>
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </fieldset>

      <div>
        <label htmlFor="comment" className="mb-2 block text-[15px] font-bold">한마디 (선택)</label>
        <textarea id="comment" name="comment" maxLength={1000} rows={3} className={`${inputClass} h-auto py-3`} placeholder="좋았던 점이나 아쉬웠던 점" />
      </div>

      <details className="rounded-btn bg-mist p-4 text-[15px]">
        <summary className="cursor-pointer font-bold">불편한 일이 있었나요? 신고하기</summary>
        <p className="mt-2 text-[14px] text-graphite">신고한 사람과는 다시 매칭되지 않고, 운영자가 확인해요.</p>
        <select name="report" className={`${inputClass} mt-2`} defaultValue="">
          <option value="">신고할 사람 선택</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <textarea name="reportReason" maxLength={500} rows={2} className={`${inputClass} mt-2 h-auto py-3`} placeholder="어떤 일이 있었는지 알려주세요" />
      </details>

      {state.error && <p role="alert" className="text-[15px] font-medium text-danger">{state.error}</p>}
      <button disabled={pending} className="h-[52px] w-full rounded-btn bg-ink font-semibold text-paper disabled:bg-mist disabled:text-[#9a9a9a]">
        {pending ? "보내는 중…" : "제출하기"}
      </button>
    </form>
  );
}
