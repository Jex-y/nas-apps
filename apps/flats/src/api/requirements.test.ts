import { describe, expect, test } from "bun:test";
import { Requirements } from "../contract";
import { breach, DEFAULT_REQUIREMENTS } from "./requirements";

describe("requirements documents", () => {
  test("the defaults are a valid document", () => {
    expect(Requirements.parse(DEFAULT_REQUIREMENTS)).toEqual(DEFAULT_REQUIREMENTS);
  });

  test("refuse a misspelt field rather than ignoring it", () => {
    const [first, ...rest] = DEFAULT_REQUIREMENTS.questions;
    const misspelt = { ...DEFAULT_REQUIREMENTS, questions: [{ ...first, pionts: 2 }, ...rest] };

    expect(Requirements.safeParse(misspelt).success).toBe(false);
  });

  test("refuse two questions with one key", () => {
    const [first] = DEFAULT_REQUIREMENTS.questions;
    const duplicated = { ...DEFAULT_REQUIREMENTS, questions: [first, first] };

    expect(Requirements.safeParse(duplicated).error?.issues[0]?.message).toBe("Question keys must be unique");
  });
});

describe("limits", () => {
  const limits = { minSizeSqft: 650, maxAnnualServiceCharge: 6000, minLeaseYears: 90 };
  const facts = { sizeSqft: 700, annualServiceCharge: 3000, leaseYearsRemaining: 120 };

  test("name the first one a property breaks", () => {
    expect(breach(facts, limits)).toBeNull();
    expect(breach({ ...facts, sizeSqft: 649 }, limits)).toBe("Under 650 sq ft");
    expect(breach({ ...facts, annualServiceCharge: 6000.01 }, limits)).toBe("Service charge over £6,000");
    expect(breach({ ...facts, leaseYearsRemaining: 89 }, limits)).toBe("Lease under 90 years");
  });

  test("break nothing a listing does not state, or that is turned off", () => {
    expect(breach({ sizeSqft: null, annualServiceCharge: null, leaseYearsRemaining: null }, limits)).toBeNull();
    expect(breach({ ...facts, sizeSqft: 100 }, { ...limits, minSizeSqft: null })).toBeNull();
  });
});
