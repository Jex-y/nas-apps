import { describe, expect, test } from "bun:test";
import type { Answer, Question } from "./questions";
import { type RankingInput, scoreProperty } from "./ranking";

const QUESTIONS: readonly Question[] = [
  { key: "retirement", kind: "exclusion", label: "Retirement", reason: "Retirement property", instructions: "?" },
  { key: "lift", kind: "feature", label: "Lift", points: 2, instructions: "?" },
  {
    key: "outdoor",
    kind: "choice",
    label: "Outdoor space",
    instructions: "?",
    options: {
      balcony: { label: "Balcony", description: "", points: 2 },
      none: { label: "None", description: "", points: 0 },
    },
  },
  {
    key: "condition",
    kind: "score",
    label: "Condition",
    instructions: "?",
    levels: [
      { label: "Needs work", description: "", points: -3 },
      { label: "Good", description: "", points: 1 },
    ],
  },
];

const nothing: RankingInput = { answers: new Map(), commutes: [], pricePerSqft: null, medianPricePerSqft: null };
const answering = (answers: Record<string, Answer>): RankingInput => ({
  ...nothing,
  answers: new Map(Object.entries(answers)),
});

describe("scoring a property", () => {
  test("scores nothing it knows nothing about", () => {
    expect(scoreProperty(QUESTIONS, nothing)).toEqual({ kind: "scored", total: 0, contributions: [] });
  });

  test("weighs each answer by how likely Jev thinks it is", () => {
    const ranking = scoreProperty(
      QUESTIONS,
      answering({
        retirement: { kind: "noul", yes: 0.1 },
        lift: { kind: "noul", yes: 0.9 },
        outdoor: { kind: "choice", probabilities: { balcony: 0.75, none: 0.25 } },
        condition: { kind: "score", probabilities: [0.5, 0.5] },
      }),
    );

    expect(ranking).toEqual({
      kind: "scored",
      total: expect.closeTo(1.8 + 1.5 - 1, 9),
      contributions: [
        { label: "Lift", detail: "Yes", points: expect.closeTo(1.8, 9) },
        { label: "Outdoor space", detail: "Balcony", points: 1.5 },
        { label: "Condition", detail: "Needs work", points: -1 },
      ],
    });
  });

  test("is ruled out by an exclusion Jev is sure of, whatever else it has going for it", () => {
    expect(
      scoreProperty(QUESTIONS, answering({ retirement: { kind: "noul", yes: 0.95 }, lift: { kind: "noul", yes: 1 } })),
    ).toEqual({ kind: "excluded", reason: "Retirement property" });
  });

  test("loses a tenth of a point per minute of commute over 40", () => {
    const ranking = scoreProperty(QUESTIONS, {
      ...nothing,
      commutes: [
        { destinationId: crypto.randomUUID(), name: "Office", minutes: 65 },
        { destinationId: crypto.randomUUID(), name: "Gym", minutes: 20 },
        { destinationId: crypto.randomUUID(), name: "Island", minutes: null },
      ],
    });

    expect(ranking).toEqual({
      kind: "scored",
      total: expect.closeTo(-2.5, 9),
      contributions: [
        { label: "Commute to Office", detail: "65 min", points: expect.closeTo(-2.5, 9) },
        { label: "Commute to Gym", detail: "20 min", points: 0 },
      ],
    });
  });

  test("rewards value per sq ft against the inbox, up to four points either way", () => {
    const value = (pricePerSqft: number) => {
      const ranking = scoreProperty(QUESTIONS, { ...nothing, pricePerSqft, medianPricePerSqft: 600 });
      return ranking.kind === "scored" ? ranking.contributions : [];
    };

    expect(value(540)).toEqual([
      { label: "Price per sq ft", detail: "10% below the inbox median", points: expect.closeTo(2, 9) },
    ]);
    expect(value(660)).toEqual([
      { label: "Price per sq ft", detail: "10% above the inbox median", points: expect.closeTo(-2, 9) },
    ]);
    expect(value(300)[0]?.points).toBe(4);
    expect(value(1200)[0]?.points).toBe(-4);
  });

  test("ignores an answer that does not fit its question", () => {
    expect(scoreProperty(QUESTIONS, answering({ lift: { kind: "score", probabilities: [1] } }))).toEqual({
      kind: "scored",
      total: 0,
      contributions: [],
    });
  });
});
