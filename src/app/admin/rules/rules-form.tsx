"use client";

import { useActionState } from "react";
import { saveMatchingRules, type RulesState } from "../../actions";

const FIELDS = [
  { key: "weight_gender", label: "성비", help: "2:4까지 허용, 단일 성별·1명만 다른 성별은 크게 감점" },
  { key: "weight_mbti", label: "MBTI", help: "E/I가 섞이면 가산, N/S가 같으면 가산" },
  { key: "weight_interests", label: "공통 관심사", help: "가장 많이 겹치는 관심사와 서로 겹치는 쌍의 비율" },
  { key: "weight_wants", label: "원하는 상대 성향", help: "각자 원한 성향을 가진 사람이 테이블에 있는지" },
  { key: "weight_new_people", label: "새로운 사람 비율", help: "이미 만난 사람이 적을수록 높음 (서로 '또 만나요'는 예외로 가산)" },
] as const;

type Rules = Record<(typeof FIELDS)[number]["key"] | "min_score", number>;

export function RulesForm({ rules }: { rules: Rules }) {
  const [state, action, pending] = useActionState<RulesState, FormData>(saveMatchingRules, {});
  return (
    <form action={action} className="mt-6 max-w-[640px] space-y-4">
      <h2 className="text-[17px] font-bold">선호 가중치</h2>
      {FIELDS.map((f) => (
        <div key={f.key} className="flex items-center gap-4">
          <label htmlFor={f.key} className="flex-1 text-[15px]">
            <span className="font-semibold">{f.label}</span>
            <span className="block text-[13px] text-graphite">{f.help}</span>
          </label>
          <input id={f.key} name={f.key} type="number" min={0} max={50} step={1} required defaultValue={rules[f.key]}
            className="h-11 w-24 rounded-sm border-[1.5px] border-line px-3 text-right text-[16px] tabular-nums focus:border-2 focus:border-ink focus:outline-none" />
        </div>
      ))}
      <div className="flex items-center gap-4 pt-2">
        <label htmlFor="min_score" className="flex-1 text-[15px]">
          <span className="font-semibold">자동 확정 최소 점수</span>
          <span className="block text-[13px] text-graphite">높이면 테이블 품질이 오르고, 낮추면 배정 인원이 늘어요 (100점 만점)</span>
        </label>
        <input id="min_score" name="min_score" type="number" min={0} max={100} step={1} required defaultValue={rules.min_score}
          className="h-11 w-24 rounded-sm border-[1.5px] border-line px-3 text-right text-[16px] tabular-nums focus:border-2 focus:border-ink focus:outline-none" />
      </div>
      {state.error && <p role="alert" className="text-[15px] font-medium text-danger">{state.error}</p>}
      {state.saved && <p role="status" className="text-[15px] font-bold">저장했어요. 다음 매칭부터 적용돼요. 변경 내역은 자동 처리 기록에 남아요.</p>}
      <button disabled={pending} className="h-12 rounded-btn bg-ink px-6 text-[15px] font-semibold text-paper disabled:opacity-60">{pending ? "저장 중…" : "저장"}</button>
    </form>
  );
}
