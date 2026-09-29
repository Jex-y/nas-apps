import { describe, expect, test } from "bun:test";
import type { Question } from "../contract";
import { currentAnswers, exclusion, fingerprint, unanswered } from "./questions";

const retirement: Question = {
  key: "retirement",
  kind: "exclusion",
  label: "Retirement",
  reason: "Retirement property",
  instructions: "Is it a retirement property?",
};
const lift: Question = { key: "lift", kind: "feature", label: "Lift", points: 1, instructions: "Is there a lift?" };

describe("fingerprints", () => {
  test("change when the wording does, not the labels or points", () => {
    expect(fingerprint({ ...lift, label: "Has a lift", points: 3 })).toBe(fingerprint(lift));
    expect(fingerprint({ ...lift, instructions: "Does the building have a lift?" })).not.toBe(fingerprint(lift));
    expect(fingerprint({ ...lift, criteria: { yes: "A lift", no: "No lift" } })).not.toBe(fingerprint(lift));
  });

  test("only answers to the current wording count", () => {
    const stored = [
      { questionKey: "lift", fingerprint: fingerprint(lift), answer: { kind: "noul" as const, yes: 0.9 } },
      { questionKey: "retirement", fingerprint: "reworded", answer: { kind: "noul" as const, yes: 0.9 } },
      { questionKey: "dropped", fingerprint: "anything", answer: { kind: "noul" as const, yes: 0.9 } },
    ];

    expect([...currentAnswers([retirement, lift], stored).keys()]).toEqual(["lift"]);
    expect(unanswered([retirement, lift], stored)).toEqual([retirement]);
  });
});

test("an exclusion rules a property out only when Jev is sure", () => {
  const saying = (yes: number) => new Map([["retirement", { kind: "noul" as const, yes }]]);

  expect(exclusion([retirement, lift], saying(0.93))).toBe("Retirement property");
  expect(exclusion([retirement, lift], saying(0.8))).toBeNull();
  expect(exclusion([retirement, lift], new Map())).toBeNull();
  expect(exclusion([lift], new Map([["lift", { kind: "noul" as const, yes: 1 }]]))).toBeNull();
});
