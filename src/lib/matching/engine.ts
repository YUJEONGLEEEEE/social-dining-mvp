// Matching engine: pure functions, no database access.
//
// Hard constraints (a table that breaks one is never confirmed):
//   same slot, 4-6 people, age gap <= rules.maxAgeGap, no blocked/disliked pair.
// Preference score (0-100): gender balance, MBTI, shared interests,
//   wanted personality, new people. Pairs who both chose "again" last time add a bonus (+5 each, up to +10).

export type Gender = "female" | "male";

export type Candidate = {
  applicationId: string;
  profileId: string;
  name: string;
  birthYear: number;
  gender: Gender;
  mbti: string | null;
  interests: string[];
  personality: string[];
  wants: string[];
};

export type Applicant = {
  candidate: Candidate;
  /** Slot ids in order of preference. The first one is tried first. */
  slotIds: string[];
};

export type Rules = {
  weightGender: number;
  weightMbti: number;
  weightInterests: number;
  weightWants: number;
  weightNewPeople: number;
  minScore: number;
  maxAgeGap: number;
};

export const DEFAULT_RULES: Rules = {
  weightGender: 30,
  weightMbti: 20,
  weightInterests: 20,
  weightWants: 15,
  weightNewPeople: 15,
  minScore: 60,
  maxAgeGap: 8,
};

export type Relations = {
  /** Pairs that must never share a table (blocked or disliked, either direction). */
  forbidden: Set<string>;
  met: Set<string>;
  mutualAgain: Set<string>;
};

export type Breakdown = {
  gender: number;
  mbti: number;
  interests: number;
  wants: number;
  newPeople: number;
  mutualBonus: number;
};

export type MatchedTable = {
  slotId: string;
  members: Candidate[];
  score: number;
  breakdown: Breakdown;
  reason: string;
  memberReasons: Record<string, string>;
  /** Applicants placed here from another slot they had also chosen. */
  movedIn: string[];
};

export type Unmatched = {
  candidate: Candidate;
  reason: string;
};

export type MatchResult = {
  tables: MatchedTable[];
  unmatched: Unmatched[];
};

export const MIN_SIZE = 4;
export const MAX_SIZE = 6;

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const WANT_TO_TRAITS: Record<string, string[]> = {
  "편하고 유머 있는 사람": ["가볍고 유머 있는 대화를 좋아함"],
  "잔잔하고 안정적인 사람": ["잔잔하고 조용한 편", "경청을 잘 함"],
  "깊은 대화가 되는 사람": ["깊은 대화를 좋아함"],
  "열정 있는 사람": ["활기차고 에너지 있는 편", "이야기를 이끄는 편"],
};

function wantSatisfied(want: string, me: Candidate, other: Candidate) {
  if (want === "나와 비슷한 사람") return other.personality.some((t) => me.personality.includes(t));
  if (want === "나와 다른 자극을 주는 사람") return other.personality.some((t) => !me.personality.includes(t));
  const traits = WANT_TO_TRAITS[want];
  return traits ? other.personality.some((t) => traits.includes(t)) : false;
}

function genderScore(members: Candidate[]) {
  const female = members.filter((m) => m.gender === "female").length;
  const minority = Math.min(female, members.length - female);
  if (minority === 0) return 0;
  if (minority === 1) return 0.3;
  return 0.7 + 0.3 * Math.min(1, minority / (members.length / 2));
}

function mbtiScore(members: Candidate[]) {
  const known = members.map((m) => m.mbti).filter((t): t is string => !!t);
  if (known.length < 2) return 0.5;
  const mixedEI = new Set(known.map((t) => t[0])).size > 1 ? 0.5 : 0;
  const n = known.filter((t) => t[1] === "N").length;
  const sameNS = Math.max(n, known.length - n) / known.length;
  return mixedEI + 0.5 * sameNS;
}

function topInterest(members: Candidate[]) {
  const counts = new Map<string, number>();
  for (const m of members) for (const i of m.interests) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best: [string, number] = ["", 0];
  for (const entry of counts) if (entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
  return { interest: best[0], count: best[1] };
}

function interestScore(members: Candidate[]) {
  const top = topInterest(members);
  let overlapping = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      pairs++;
      if (members[i].interests.some((x) => members[j].interests.includes(x))) overlapping++;
    }
  }
  return 0.6 * (top.count / members.length) + 0.4 * (pairs ? overlapping / pairs : 0);
}

function wantsScore(members: Candidate[]) {
  let total = 0;
  for (const me of members) {
    if (me.wants.length === 0) {
      total += 1;
      continue;
    }
    const others = members.filter((o) => o !== me);
    const met = me.wants.filter((w) => others.some((o) => wantSatisfied(w, me, o))).length;
    total += met / me.wants.length;
  }
  return total / members.length;
}

function pairs(members: Candidate[]) {
  const out: [Candidate, Candidate][] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) out.push([members[i], members[j]]);
  return out;
}

export function scoreTable(members: Candidate[], relations: Relations, rules: Rules) {
  const all = pairs(members);
  const mutual = (a: Candidate, b: Candidate) => relations.mutualAgain.has(pairKey(a.profileId, b.profileId));
  // A pair who both asked to meet again is not counted against "new people".
  const metPairs = all.filter(([a, b]) => relations.met.has(pairKey(a.profileId, b.profileId)) && !mutual(a, b)).length;
  const mutualPairs = all.filter(([a, b]) => mutual(a, b)).length;

  const breakdown: Breakdown = {
    gender: genderScore(members),
    mbti: mbtiScore(members),
    interests: interestScore(members),
    wants: wantsScore(members),
    newPeople: all.length ? 1 - metPairs / all.length : 1,
    mutualBonus: Math.min(10, mutualPairs * 5),
  };
  const weights = rules.weightGender + rules.weightMbti + rules.weightInterests + rules.weightWants + rules.weightNewPeople;
  const weighted =
    breakdown.gender * rules.weightGender +
    breakdown.mbti * rules.weightMbti +
    breakdown.interests * rules.weightInterests +
    breakdown.wants * rules.weightWants +
    breakdown.newPeople * rules.weightNewPeople;
  // The optimizer uses the uncapped value so the reunion bonus still counts at the top end.
  const raw = (weights ? (weighted / weights) * 100 : 0) + breakdown.mutualBonus;
  return { score: Math.round(Math.min(100, raw) * 10) / 10, raw, breakdown };
}

/** Number of hard-constraint violations (0 means the table may be confirmed). */
export function violations(members: Candidate[], relations: Relations, rules: Rules) {
  let count = 0;
  if (members.length < MIN_SIZE || members.length > MAX_SIZE) count++;
  const years = members.map((m) => m.birthYear);
  const gap = Math.max(...years) - Math.min(...years);
  if (gap > rules.maxAgeGap) count += gap - rules.maxAgeGap;
  for (const [a, b] of pairs(members)) if (relations.forbidden.has(pairKey(a.profileId, b.profileId))) count += 10;
  return count;
}

// ---------------------------------------------------------------------------
// Explanations ("why you are at this table")
// ---------------------------------------------------------------------------

const WANT_PHRASE: Record<string, string> = {
  "깊은 대화가 되는 사람": "깊은 대화를 원하는 분들이 모였어요.",
  "편하고 유머 있는 사람": "편하고 유머 있는 대화를 좋아하는 분들이 함께해요.",
  "잔잔하고 안정적인 사람": "잔잔하고 편안한 분위기를 좋아하는 분들이에요.",
  "열정 있는 사람": "에너지 넘치는 대화를 기대하는 분들이 모였어요.",
  "나와 다른 자극을 주는 사람": "서로 다른 이야기에서 자극을 얻고 싶은 분들이에요.",
  "나와 비슷한 사람": "결이 비슷한 사람을 찾는 분들이 모였어요.",
};

const COUNT_WORD = ["", "한", "두", "세", "네", "다섯", "여섯"];

export function explainTable(members: Candidate[], relations: Relations) {
  const sentences: string[] = [];
  const top = topInterest(members);
  if (top.count >= 2) {
    const who = top.count === members.length ? `${COUNT_WORD[members.length]} 명 모두` : `${COUNT_WORD[top.count]} 명이`;
    sentences.push(`${who} '${top.interest}'에 관심이 있어요.`);
  }

  const mutual = pairs(members).filter(([a, b]) => relations.mutualAgain.has(pairKey(a.profileId, b.profileId))).length;
  const met = pairs(members).filter(([a, b]) => relations.met.has(pairKey(a.profileId, b.profileId))).length;
  if (mutual > 0) sentences.push("지난번 서로 '또 만나요'를 고른 분들이 다시 만나요.");
  else if (met === 0) sentences.push("모두 처음 만나는 사이예요.");

  // The most shared wish at this table, so each table reads differently.
  const wishes = new Map<string, number>();
  for (const m of members) for (const w of m.wants) if (WANT_PHRASE[w]) wishes.set(w, (wishes.get(w) ?? 0) + 1);
  const [wish, wishCount] = [...wishes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ["", 0];
  if (wishCount >= 2) sentences.push(WANT_PHRASE[wish]);

  const ei = new Set(members.map((m) => m.mbti?.[0]).filter(Boolean));
  if (ei.size > 1) sentences.push("이야기를 이끄는 분과 잘 들어주는 분이 고루 섞였어요.");

  const years = members.map((m) => m.birthYear);
  const nowYear = 2026;
  sentences.push(`나이대는 ${nowYear - Math.max(...years)}~${nowYear - Math.min(...years)}세예요.`);
  return sentences.slice(0, 3).join(" ");
}

function explainMember(me: Candidate, members: Candidate[]) {
  const others = members.filter((o) => o !== me);
  const shared = me.interests.filter((i) => others.some((o) => o.interests.includes(i)));
  const wanted = me.wants.filter((w) => others.some((o) => wantSatisfied(w, me, o)));
  const parts: string[] = [];
  if (shared.length) parts.push(`공통 관심사: ${shared.slice(0, 2).join(", ")}`);
  if (wanted.length) parts.push(`원하는 상대: ${wanted[0]}`);
  return parts.join(" · ") || "필수 조건 충족";
}

// ---------------------------------------------------------------------------
// Grouping within one slot
// ---------------------------------------------------------------------------

function tableCount(n: number) {
  let k = Math.ceil(n / MAX_SIZE);
  while (k > 0 && n / k < MIN_SIZE) k--;
  return k;
}

function objective(groups: Candidate[][], relations: Relations, rules: Rules) {
  let total = 0;
  for (const g of groups) {
    if (g.length === 0) continue;
    total += scoreTable(g, relations, rules).raw - 1000 * violations(g, relations, rules);
  }
  return total;
}

/** Splits one slot's candidates into tables, improving with swaps and moves. */
export function groupSlot(candidates: Candidate[], relations: Relations, rules: Rules) {
  const sorted = [...candidates].sort((a, b) => a.birthYear - b.birthYear || a.profileId.localeCompare(b.profileId));
  const k = tableCount(sorted.length);
  if (k === 0) return { groups: [] as Candidate[][], leftover: sorted };

  // Start from age-contiguous chunks, then let the local search balance the rest.
  const groups: Candidate[][] = [];
  let start = 0;
  for (let t = 0; t < k; t++) {
    const size = Math.min(MAX_SIZE, Math.ceil((sorted.length - start) / (k - t)));
    groups.push(sorted.slice(start, start + size));
    start += size;
  }
  const leftover = sorted.slice(start);

  // Best-improvement local search: each round applies the single swap or move
  // that raises the objective most. Taking the first improvement instead can trade
  // a forbidden pair for an age violation and get stuck there.
  let best = objective(groups, relations, rules);
  for (let round = 0; round < 200; round++) {
    let bestMove: (() => void) | null = null;
    let bestValue = best;
    for (let a = 0; a < groups.length; a++) {
      for (let b = 0; b < groups.length; b++) {
        if (a === b) continue;
        if (a < b) {
          for (let i = 0; i < groups[a].length; i++) {
            for (let j = 0; j < groups[b].length; j++) {
              [groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]];
              const value = objective(groups, relations, rules);
              [groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]];
              if (value > bestValue + 1e-9) {
                bestValue = value;
                const [ga, gb, ii, jj] = [a, b, i, j];
                bestMove = () => {
                  [groups[ga][ii], groups[gb][jj]] = [groups[gb][jj], groups[ga][ii]];
                };
              }
            }
          }
        }
        // Moves keep sizes inside 4-6.
        if (groups[a].length <= MIN_SIZE || groups[b].length >= MAX_SIZE) continue;
        for (let i = 0; i < groups[a].length; i++) {
          const [moved] = groups[a].splice(i, 1);
          groups[b].push(moved);
          const value = objective(groups, relations, rules);
          groups[b].pop();
          groups[a].splice(i, 0, moved);
          if (value > bestValue + 1e-9) {
            bestValue = value;
            const [from, to, ii] = [a, b, i];
            bestMove = () => {
              const [m] = groups[from].splice(ii, 1);
              groups[to].push(m);
            };
          }
        }
      }
    }
    if (!bestMove) break;
    bestMove();
    best = bestValue;
  }
  return { groups, leftover };
}

/** Removes members until the table is valid; returns the removed ones. */
function repair(group: Candidate[], relations: Relations, rules: Rules) {
  const removed: Candidate[] = [];
  while (group.length >= MIN_SIZE && violations(group, relations, rules) > 0) {
    let worst = 0;
    let worstValue = Infinity;
    for (let i = 0; i < group.length; i++) {
      const rest = group.filter((_, j) => j !== i);
      const value = violations(rest, relations, rules) * 1000 - scoreTable(rest, relations, rules).score;
      if (value < worstValue) {
        worstValue = value;
        worst = i;
      }
    }
    removed.push(...group.splice(worst, 1));
  }
  return removed;
}

function failureReason(candidate: Candidate, pool: Candidate[], rules: Rules) {
  if (pool.length < MIN_SIZE) return `같은 날짜·지역을 고른 신청자가 ${MIN_SIZE}명이 안 됐어요.`;
  const sameAge = pool.filter((o) => o !== candidate && Math.abs(o.birthYear - candidate.birthYear) <= rules.maxAgeGap).length;
  if (sameAge + 1 < MIN_SIZE) return `같은 회차에 나이 조건(${rules.maxAgeGap}살 이내)이 맞는 신청자가 부족했어요.`;
  return "같은 회차에서 조건이 맞는 테이블을 만들지 못했어요.";
}

// ---------------------------------------------------------------------------
// One matching round for a week: first choices, then other chosen slots.
// ---------------------------------------------------------------------------

export function matchWeek(applicants: Applicant[], relations: Relations, rules: Rules = DEFAULT_RULES): MatchResult {
  const tables: MatchedTable[] = [];
  const byId = new Map(applicants.map((a) => [a.candidate.applicationId, a]));
  const reasons = new Map<string, string>();

  // Seats a candidate at an open spot of a confirmed table in the slot, if it stays valid.
  const seat = (slotId: string, c: Candidate, moved: boolean) => {
    const fits = tables
      .filter((t) => t.slotId === slotId && t.members.length < MAX_SIZE)
      .map((t) => ({ t, next: [...t.members, c] }))
      .filter(({ next }) => violations(next, relations, rules) === 0)
      .map(({ t, next }) => ({ t, next, score: scoreTable(next, relations, rules) }))
      .filter(({ score }) => score.score >= rules.minScore)
      .sort((x, y) => y.score.score - x.score.score);
    if (!fits.length) return false;
    const { t, next, score } = fits[0];
    t.members = next;
    t.score = score.score;
    t.breakdown = score.breakdown;
    t.reason = explainTable(next, relations);
    t.memberReasons = Object.fromEntries(next.map((m) => [m.applicationId, explainMember(m, next)]));
    if (moved) t.movedIn.push(c.applicationId);
    reasons.delete(c.applicationId);
    return true;
  };

  const runSlot = (slotId: string, pool: Candidate[], movedIn: Set<string>) => {
    const { groups, leftover } = groupSlot(pool, relations, rules);
    const left: Candidate[] = [...leftover];
    for (const group of groups) {
      left.push(...repair(group, relations, rules));
      if (group.length < MIN_SIZE) {
        left.push(...group);
        continue;
      }
      const { score, breakdown } = scoreTable(group, relations, rules);
      if (score < rules.minScore) {
        for (const m of group) reasons.set(m.applicationId, `테이블 점수가 최소 기준(${rules.minScore}점)에 못 미쳤어요.`);
        left.push(...group);
        continue;
      }
      tables.push({
        slotId,
        members: group,
        score,
        breakdown,
        reason: explainTable(group, relations),
        memberReasons: Object.fromEntries(group.map((m) => [m.applicationId, explainMember(m, group)])),
        movedIn: group.filter((m) => movedIn.has(m.applicationId)).map((m) => m.applicationId),
      });
    }
    const stillLeft = left.filter((c) => !seat(slotId, c, movedIn.has(c.applicationId)));
    for (const c of stillLeft) if (!reasons.has(c.applicationId)) reasons.set(c.applicationId, failureReason(c, pool, rules));
    return stillLeft;
  };

  // Round 1: everyone in their first-choice slot.
  const firstPools = new Map<string, Candidate[]>();
  for (const a of applicants) {
    const slot = a.slotIds[0];
    if (!slot) continue;
    firstPools.set(slot, [...(firstPools.get(slot) ?? []), a.candidate]);
  }
  let unplaced: Candidate[] = [];
  for (const slotId of [...firstPools.keys()].sort()) unplaced.push(...runSlot(slotId, firstPools.get(slotId)!, new Set()));

  // Round 2: reassign to other chosen slots, joining open seats first.
  const stillUnplaced: Candidate[] = [];
  const secondPools = new Map<string, Candidate[]>();
  for (const c of unplaced.sort((a, b) => a.applicationId.localeCompare(b.applicationId))) {
    const alternatives = byId.get(c.applicationId)!.slotIds.slice(1);
    if (alternatives.some((slotId) => seat(slotId, c, true))) continue;
    if (alternatives.length) secondPools.set(alternatives[0], [...(secondPools.get(alternatives[0]) ?? []), c]);
    else stillUnplaced.push(c);
  }
  for (const [slotId, pool] of secondPools) {
    stillUnplaced.push(...runSlot(slotId, pool, new Set(pool.map((c) => c.applicationId))));
  }
  unplaced = stillUnplaced;

  return {
    tables,
    unmatched: unplaced.map((candidate) => ({ candidate, reason: reasons.get(candidate.applicationId) ?? "조건이 맞는 테이블을 찾지 못했어요." })),
  };
}
