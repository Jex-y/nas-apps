import { describe, expect, test } from "bun:test";
import { monthsBefore } from "./calendar";
import { type BalancePoint, netWorthSeries, sampleDates } from "./net-worth";

const point = (accountId: string, kind: BalancePoint["kind"], date: string, amount: number): BalancePoint => ({
  accountId,
  kind,
  date,
  amount,
});

const NOTHING = { cash: 0, investment: 0, property: 0, pension: 0, debt: 0, other: 0 };

describe("netWorthSeries", () => {
  test("carries each account's latest balance forward, counting it from its first", () => {
    const series = netWorthSeries(
      [
        point("isa", "investment", "2026-09-03", 500),
        point("current", "cash", "2026-09-02", 80),
        point("current", "cash", "2026-08-20", 100),
        point("loan", "debt", "2026-09-02", -300),
      ],
      ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"],
    );

    expect(series).toEqual([
      { date: "2026-09-01", byKind: { ...NOTHING, cash: 100 } },
      { date: "2026-09-02", byKind: { ...NOTHING, cash: 80, debt: -300 } },
      { date: "2026-09-03", byKind: { ...NOTHING, cash: 80, debt: -300, investment: 500 } },
      { date: "2026-09-04", byKind: { ...NOTHING, cash: 80, debt: -300, investment: 500 } },
    ]);
  });
});

describe("sampleDates", () => {
  test("gives every day of a short range", () => {
    expect(sampleDates("2026-09-28", "2026-10-01", 366)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
    expect(sampleDates("2026-10-01", "2026-10-01", 366)).toEqual(["2026-10-01"]);
  });

  test("thins a long range evenly, still ending on the last day", () => {
    const dates = sampleDates("2020-01-01", "2026-10-01", 366);

    expect(dates.length).toBeLessThanOrEqual(366);
    expect(dates.at(-1)).toBe("2026-10-01");
    expect(dates.slice(-3)).toEqual(["2026-09-17", "2026-09-24", "2026-10-01"]);
  });
});

describe("monthsBefore", () => {
  test("lands on the same day, or the month's last when it has none", () => {
    expect(monthsBefore("2026-09-21", 12)).toBe("2025-09-21");
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBefore("2026-01-15", 2)).toBe("2025-11-15");
  });
});
