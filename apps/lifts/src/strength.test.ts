import { describe, expect, test } from "bun:test";
import type { LiftSet } from "./contract";
import { bestEstimate, estimatedMax, repRecords, tonnage } from "./strength";

type Shorthand = Pick<LiftSet, "weightKg" | "reps" | "rpe" | "kind">;

const work = (weightKg: number, reps: number, rpe: number | null = null): Shorthand => ({
  weightKg,
  reps,
  rpe,
  kind: "work",
});
const warmup = (weightKg: number, reps: number): Shorthand => ({ weightKg, reps, rpe: null, kind: "warmup" });

describe("estimatedMax", () => {
  test("follows the RPE chart, in whole and half steps", () => {
    expect(estimatedMax(work(100, 1, 10))).toBe(100);
    expect(estimatedMax(work(86.3, 5, 10))).toBeCloseTo(100, 5);
    expect(estimatedMax(work(81.1, 5, 8))).toBeCloseTo(100, 5);
    expect(estimatedMax(work(93.85, 1, 8.5))).toBeCloseTo(100, 5);
    expect(estimatedMax(work(82.4, 4, 7.5))).toBeCloseTo(100, 5);
  });

  test("takes a set without an RPE as all-out", () => {
    expect(estimatedMax(work(140, 3))).toBe(estimatedMax(work(140, 3, 10)));
  });

  test("says nothing of a miss, or of a set beyond the chart", () => {
    expect(estimatedMax(work(200, 0))).toBeNull();
    expect(estimatedMax(work(60, 17))).toBeNull();
    expect(estimatedMax(work(60, 12, 5))).toBeNull();
    expect(estimatedMax(work(60, 16))).toBeCloseTo(60 / 0.572, 5);
  });
});

describe("bestEstimate", () => {
  test("picks the work set implying the most, ignoring warm-ups", () => {
    const top = work(140, 5, 8);
    expect(bestEstimate([warmup(180, 1), work(140, 1, 6), top, work(130, 5, 8)])?.set).toBe(top);
    expect(bestEstimate([warmup(100, 5), work(100, 0)])).toBeNull();
  });
});

describe("repRecords", () => {
  test("keeps the heaviest set at each rep count that no longer set matches", () => {
    const records = repRecords([
      work(100, 5),
      work(110, 3),
      work(100, 3),
      work(105, 1),
      work(120, 1),
      warmup(150, 1),
      work(90, 8),
      work(90, 6),
    ]);

    expect(records.map(({ reps, set }) => [reps, set.weightKg])).toEqual([
      [1, 120],
      [3, 110],
      [5, 100],
      [8, 90],
    ]);
  });
});

describe("tonnage", () => {
  test("adds up the work sets", () => {
    expect(tonnage([warmup(60, 5), work(100, 5), work(102.5, 4)])).toBe(910);
  });
});
