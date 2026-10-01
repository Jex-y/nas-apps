import { describe, expect, test } from "bun:test";
import { monthStarts, niceTicks } from "./chart";

describe("niceTicks", () => {
  test("brackets the range with round steps", () => {
    expect(niceTicks(12_300, 48_900, 4)).toEqual([10_000, 20_000, 30_000, 40_000, 50_000]);
    expect(niceTicks(-2_600, 1_400, 4)).toEqual([-3_000, -2_000, -1_000, 0, 1_000, 2_000]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  test("still gives a scale when every value is the same", () => {
    expect(niceTicks(5_000, 5_000, 4)).toEqual([5_000, 6_000]);
    expect(niceTicks(0, 0, 4)).toEqual([0, 0.2]);
  });
});

describe("monthStarts", () => {
  const dates = ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-09-01", "2026-10-03", "2026-11-01"];

  test("finds where each month begins", () => {
    expect(monthStarts(dates, 10)).toEqual([2, 4, 5, 6]);
  });

  test("thins them to fit", () => {
    expect(monthStarts(dates, 2)).toEqual([2, 5]);
  });
});
