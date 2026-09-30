import { describe, expect, test } from "bun:test";
import { type Answer, DEFAULT_FACT_RULES, type FactRule, type Question, Requirements } from "./contract";
import { breach, exclusion, type PropertyFacts, pointsFor, type RankingInput, scoreProperty } from "./scoring";

const QUESTIONS: readonly Question[] = [
  { key: "retirement", kind: "exclusion", label: "Retirement", reason: "Retirement property", instructions: "?" },
  { key: "lift", kind: "feature", label: "Lift", points: 2, instructions: "?" },
  {
    key: "outdoor",
    kind: "choice",
    label: "Outdoor space",
    instructions: "?",
    options: [
      { key: "balcony", label: "Balcony", description: "", points: 2 },
      { key: "none", label: "None", description: "", points: 0 },
    ],
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

const LIMITS = { minSizeSqft: 650, maxAnnualServiceCharge: 6000, minLeaseYears: 90 };
const requirements = { questions: QUESTIONS, facts: [...DEFAULT_FACT_RULES] };
const unknown: PropertyFacts = {
  price: null,
  sizeSqft: null,
  bedrooms: null,
  bathrooms: null,
  leaseYearsRemaining: null,
  annualServiceCharge: null,
};
const nothing: RankingInput = { answers: new Map(), facts: unknown, commutes: [], medianPricePerSqft: null };
const answering = (answers: Record<string, Answer>): RankingInput => ({
  ...nothing,
  answers: new Map(Object.entries(answers)),
});

describe("scoring a property", () => {
  test("scores nothing it knows nothing about", () => {
    expect(scoreProperty(requirements, nothing)).toEqual({ kind: "scored", total: 0, contributions: [] });
  });

  test("weighs each answer by how likely Jev thinks it is", () => {
    const ranking = scoreProperty(
      requirements,
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
        { key: "lift", source: "jev", label: "Lift", detail: "Yes", points: expect.closeTo(1.8, 9) },
        { key: "outdoor", source: "jev", label: "Outdoor space", detail: "Balcony", points: 1.5 },
        { key: "condition", source: "jev", label: "Condition", detail: "Needs work", points: -1 },
      ],
    });
  });

  test("is ruled out by an exclusion Jev is sure of, whatever else it has going for it", () => {
    expect(
      scoreProperty(
        requirements,
        answering({ retirement: { kind: "noul", yes: 0.95 }, lift: { kind: "noul", yes: 1 } }),
      ),
    ).toEqual({ kind: "excluded", reason: "Retirement property" });
  });

  test("by default loses a tenth of a point per minute of commute over 40, per destination", () => {
    const office = crypto.randomUUID();
    const ranking = scoreProperty(requirements, {
      ...nothing,
      commutes: [
        { destinationId: office, name: "Office", minutes: 65 },
        { destinationId: crypto.randomUUID(), name: "Gym", minutes: 20 },
        { destinationId: crypto.randomUUID(), name: "Island", minutes: null },
      ],
    });

    expect(ranking).toMatchObject({ kind: "scored", total: expect.closeTo(-2.5, 9) });
    expect(ranking.kind === "scored" && ranking.contributions).toEqual([
      {
        key: `commute_minutes:${office}`,
        source: "fact",
        label: "Commute to Office",
        detail: "65 min",
        points: expect.closeTo(-2.5, 9),
      },
      expect.objectContaining({ label: "Commute to Gym", points: 0 }),
    ]);
  });

  test("by default rewards value per sq ft against the inbox, up to four points either way", () => {
    const value = (price: number) => {
      const ranking = scoreProperty(requirements, {
        ...nothing,
        facts: { ...unknown, price, sizeSqft: 1 },
        medianPricePerSqft: 600,
      });
      return ranking.kind === "scored" ? ranking.contributions : [];
    };

    expect(value(540)).toEqual([
      {
        key: "percent_below_median_price",
        source: "fact",
        label: "Price per sq ft",
        detail: "10% below the inbox median",
        points: expect.closeTo(2, 9),
      },
    ]);
    expect(value(660)[0]).toMatchObject({ detail: "10% above the inbox median", points: expect.closeTo(-2, 9) });
    expect(value(300)[0]?.points).toBe(4);
    expect(value(1200)[0]?.points).toBe(-4);
  });

  test("scores any other fact by its own rule, and skips one the listing does not state", () => {
    const roomier = {
      questions: [],
      facts: [{ fact: "size_sqft", from: 650, perUnit: 0.01, min: 0, max: 2 }],
    } as const;

    expect(scoreProperty(roomier, { ...nothing, facts: { ...unknown, sizeSqft: 800 } })).toEqual({
      kind: "scored",
      total: expect.closeTo(1.5, 9),
      contributions: [
        { key: "size_sqft", source: "fact", label: "Size", detail: "800 sq ft", points: expect.closeTo(1.5, 9) },
      ],
    });
    expect(scoreProperty(roomier, nothing)).toEqual({ kind: "scored", total: 0, contributions: [] });
  });

  test("ignores an answer that does not fit its question", () => {
    expect(scoreProperty(requirements, answering({ lift: { kind: "score", probabilities: [1] } }))).toEqual({
      kind: "scored",
      total: 0,
      contributions: [],
    });
  });
});

describe("fact rules", () => {
  const rule: FactRule = { fact: "size_sqft", from: 600, perUnit: 0.01, min: -1, max: 2 };

  test("score along their line, held within their bounds", () => {
    expect(pointsFor(rule, 700)).toBeCloseTo(1, 9);
    expect(pointsFor(rule, 900)).toBe(2);
    expect(pointsFor(rule, 400)).toBe(-1);
    expect(pointsFor({ ...rule, min: null, max: null }, 1000)).toBeCloseTo(4, 9);
  });

  test("are refused with their bounds the wrong way round, or a fact scored twice", () => {
    const parse = (facts: unknown) => Requirements.safeParse({ limits: LIMITS, questions: [], facts });

    expect(parse([{ ...rule, min: 3 }]).error?.issues[0]?.message).toBe("min must not exceed max");
    expect(parse([rule, rule]).error?.issues[0]?.message).toBe("Score each fact once");
  });

  test("default to today's commute and value scoring for a document saved before facts were scored", () => {
    expect(Requirements.parse({ limits: LIMITS, questions: [] }).facts).toEqual([...DEFAULT_FACT_RULES]);
  });
});

describe("limits", () => {
  const facts = { sizeSqft: 700, annualServiceCharge: 3000, leaseYearsRemaining: 120 };

  test("name the first one a property breaks", () => {
    expect(breach(facts, LIMITS)).toBeNull();
    expect(breach({ ...facts, sizeSqft: 649 }, LIMITS)).toBe("Under 650 sq ft");
    expect(breach({ ...facts, annualServiceCharge: 6000.01 }, LIMITS)).toBe("Service charge over £6,000");
    expect(breach({ ...facts, leaseYearsRemaining: 89 }, LIMITS)).toBe("Lease under 90 years");
  });

  test("break nothing a listing does not state, or that is turned off", () => {
    expect(breach({ sizeSqft: null, annualServiceCharge: null, leaseYearsRemaining: null }, LIMITS)).toBeNull();
    expect(breach({ ...facts, sizeSqft: 100 }, { ...LIMITS, minSizeSqft: null })).toBeNull();
  });
});

test("an exclusion rules a property out only when Jev is sure", () => {
  const [retirement, lift] = QUESTIONS as [Question, Question];
  const saying = (yes: number) => new Map([["retirement", { kind: "noul" as const, yes }]]);

  expect(exclusion([retirement, lift], saying(0.93))).toBe("Retirement property");
  expect(exclusion([retirement, lift], saying(0.8))).toBeNull();
  expect(exclusion([retirement, lift], new Map())).toBeNull();
  expect(exclusion([lift], new Map([["lift", { kind: "noul" as const, yes: 1 }]]))).toBeNull();
});
