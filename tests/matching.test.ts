import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULES,
  matchWeek,
  pairKey,
  scoreTable,
  violations,
  type Applicant,
  type Candidate,
  type Relations,
} from "../src/lib/matching/engine.ts";

const none = (): Relations => ({ forbidden: new Set(), met: new Set(), mutualAgain: new Set() });

function person(id: string, birthYear: number, gender: "female" | "male", extra: Partial<Candidate> = {}): Candidate {
  return {
    applicationId: `app-${id}`,
    profileId: `p-${id}`,
    name: id,
    birthYear,
    gender,
    mbti: "INFJ",
    interests: ["여행"],
    personality: ["깊은 대화를 좋아함"],
    wants: ["깊은 대화가 되는 사람"],
    ...extra,
  };
}

const at = (slot: string, ...people: Candidate[]): Applicant[] => people.map((candidate) => ({ candidate, slotIds: [slot] }));

test("every confirmed table has 4-6 people within the age gap", () => {
  const people = Array.from({ length: 23 }, (_, i) => person(`${i}`, 1990 + (i % 9), i % 3 === 0 ? "male" : "female"));
  const { tables } = matchWeek(at("s1", ...people), none());
  assert.ok(tables.length > 0);
  for (const t of tables) {
    assert.ok(t.members.length >= 4 && t.members.length <= 6);
    const years = t.members.map((m) => m.birthYear);
    assert.ok(Math.max(...years) - Math.min(...years) <= DEFAULT_RULES.maxAgeGap);
    assert.equal(violations(t.members, none(), DEFAULT_RULES), 0);
  }
});

test("blocked or disliked pairs never share a table", () => {
  const people = Array.from({ length: 8 }, (_, i) => person(`${i}`, 1995, i % 2 ? "male" : "female"));
  const relations = none();
  relations.forbidden.add(pairKey("p-0", "p-1"));
  relations.forbidden.add(pairKey("p-2", "p-3"));
  const { tables } = matchWeek(at("s1", ...people), relations);
  for (const t of tables) {
    const ids = t.members.map((m) => m.profileId);
    assert.ok(!(ids.includes("p-0") && ids.includes("p-1")));
    assert.ok(!(ids.includes("p-2") && ids.includes("p-3")));
  }
});

test("fewer than four people fail with a reason", () => {
  const { tables, unmatched } = matchWeek(at("s1", person("a", 1995, "female"), person("b", 1995, "male"), person("c", 1996, "female")), none());
  assert.equal(tables.length, 0);
  assert.equal(unmatched.length, 3);
  assert.ok(unmatched.every((u) => u.reason.length > 0));
});

test("age outliers fail with the age reason instead of breaking a table", () => {
  const people = [1995, 1995, 1996, 1996, 1997, 1980].map((y, i) => person(`${i}`, y, i % 2 ? "male" : "female"));
  const { tables, unmatched } = matchWeek(at("s1", ...people), none());
  assert.equal(tables.length, 1);
  assert.deepEqual(unmatched.map((u) => u.candidate.name), ["5"]);
  assert.match(unmatched[0].reason, /나이 조건/);
});

test("single-gender tables score lower than mixed ones", () => {
  const women = [0, 1, 2, 3].map((i) => person(`w${i}`, 1995, "female"));
  const mixed = [person("a", 1995, "female"), person("b", 1995, "female"), person("c", 1995, "male"), person("d", 1995, "male")];
  assert.ok(scoreTable(mixed, none(), DEFAULT_RULES).score > scoreTable(women, none(), DEFAULT_RULES).score);
});

test("mutual 'again' feedback raises the score", () => {
  const group = [person("a", 1995, "female"), person("b", 1995, "female"), person("c", 1995, "male"), person("d", 1995, "male")];
  const relations = none();
  const before = scoreTable(group, relations, DEFAULT_RULES).score;
  relations.mutualAgain.add(pairKey("p-a", "p-c"));
  assert.ok(scoreTable(group, relations, DEFAULT_RULES).score > before);
});

test("unplaced applicants move to their second-choice slot", () => {
  const hongdae = [person("h1", 1995, "female"), person("h2", 1995, "male"), person("h3", 1996, "female"), person("h4", 1996, "male")];
  const moving = person("x", 1995, "female");
  const applicants: Applicant[] = [
    ...at("hongdae", ...hongdae),
    { candidate: moving, slotIds: ["gangnam", "hongdae"] },
  ];
  const { tables, unmatched } = matchWeek(applicants, none());
  assert.equal(unmatched.length, 0);
  const table = tables.find((t) => t.members.includes(moving));
  assert.equal(table?.slotId, "hongdae");
  assert.deepEqual(table?.movedIn, ["app-x"]);
});

test("the same input always gives the same tables", () => {
  const people = Array.from({ length: 17 }, (_, i) => person(`${i}`, 1990 + (i % 7), i % 2 ? "male" : "female", { interests: [i % 2 ? "여행" : "음악"] }));
  const first = matchWeek(at("s1", ...people), none()).tables.map((t) => t.members.map((m) => m.name).join(","));
  const second = matchWeek(at("s1", ...people.slice().reverse()), none()).tables.map((t) => t.members.map((m) => m.name).join(","));
  assert.deepEqual(first, second);
});

test("every table explains why its members are together", () => {
  const people = Array.from({ length: 6 }, (_, i) => person(`${i}`, 1995, i % 2 ? "male" : "female"));
  const [table] = matchWeek(at("s1", ...people), none()).tables;
  assert.match(table.reason, /여섯 명 모두 '여행'/);
  assert.ok(Object.values(table.memberReasons).every((r) => r.length > 0));
});
