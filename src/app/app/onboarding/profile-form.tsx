"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileFormState } from "../../actions";
import { Button, ChoiceChip, FieldLabel, inputClass } from "@/components/ui";
import { BUDGETS, INTERESTS, MBTI_TYPES, PERSONALITY, WANTS } from "@/lib/profile-options";

type Profile = {
  display_name: string; birth_year: number; gender: string; job: string | null; mbti: string | null;
  budget: string | null; food_restrictions: string | null; interests: string[]; personality: string[]; wants: string[];
};

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfile, {});
  return (
    <form action={action} className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="name">이름</FieldLabel>
          <input id="name" name="name" required maxLength={20} defaultValue={profile.display_name} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="birthYear">출생연도</FieldLabel>
          <input id="birthYear" name="birthYear" type="number" inputMode="numeric" required min={1960} max={2006} defaultValue={profile.birth_year} className={inputClass} />
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">성별</legend>
        <div className="flex gap-2">
          <ChoiceChip type="radio" name="gender" value="female" label="여성" defaultChecked={profile.gender === "female"} />
          <ChoiceChip type="radio" name="gender" value="male" label="남성" defaultChecked={profile.gender === "male"} />
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="job">직업</FieldLabel>
          <input id="job" name="job" maxLength={30} placeholder="예: 디자이너" defaultValue={profile.job ?? ""} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="mbti">MBTI</FieldLabel>
          <select id="mbti" name="mbti" defaultValue={profile.mbti ?? ""} className={inputClass}>
            <option value="">모름</option>
            {MBTI_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">요즘 관심사</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((v) => <ChoiceChip key={v} name="interests" value={v} label={v.replace(" (헬스, 러닝, 클라이밍 등)", "")} defaultChecked={profile.interests.includes(v)} />)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">나는 어떤 사람인가요?</legend>
        <div className="flex flex-wrap gap-2">
          {PERSONALITY.map((v) => <ChoiceChip key={v} name="personality" value={v} label={v} defaultChecked={profile.personality.includes(v)} />)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">만나고 싶은 사람</legend>
        <div className="flex flex-wrap gap-2">
          {WANTS.map((v) => <ChoiceChip key={v} name="wants" value={v} label={v} defaultChecked={profile.wants.includes(v)} />)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">식사 가격대</legend>
        <div className="flex gap-2">
          {BUDGETS.map((b) => <ChoiceChip key={b.value} type="radio" name="budget" value={b.value} label={b.label} defaultChecked={profile.budget === b.value} />)}
        </div>
      </fieldset>
      <div>
        <FieldLabel htmlFor="food">못 먹는 음식·알레르기</FieldLabel>
        <input id="food" name="food" maxLength={100} placeholder="없으면 비워 두세요" defaultValue={profile.food_restrictions ?? ""} className={inputClass} />
      </div>
      <label className="flex items-start gap-3 rounded-btn bg-mist p-4 text-[15px] leading-relaxed">
        <input type="checkbox" name="consent" className="mt-1 size-5 accent-ink" required />
        <span>개인정보 수집·이용과 운영 정책(화요일 24시 이후 환불 불가, 당일 취소 환불 없음, 노쇼 2회 시 4주 신청 제한)에 동의해요.</span>
      </label>
      {state.error && <p role="alert" className="text-[15px] font-medium text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "저장 중…" : "저장하고 다음으로"}</Button>
    </form>
  );
}
