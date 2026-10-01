import { KINDS, type Kind, type NetWorthSeries } from "../contract";
import { addDays, daysBetween } from "./calendar";

export type BalancePoint = {
  readonly accountId: string;
  readonly kind: Kind;
  readonly date: string;
  readonly amount: number;
};

/** At most `limit` evenly spaced days from `from`, always ending on `to`. */
export const sampleDates = (from: string, to: string, limit: number): readonly string[] => {
  const span = Math.max(0, daysBetween(from, to));
  const step = Math.max(1, Math.ceil((span + 1) / limit));
  const steps = Math.floor(span / step);
  return Array.from({ length: steps + 1 }, (_, index) => addDays(to, (index - steps) * step));
};

/**
 * Net worth on each of `dates`: every account at its latest balance on or before that day. `dates` must ascend;
 * `points` may come in any order, and may start before the first date so balances carry into the range.
 */
export const netWorthSeries = (points: readonly BalancePoint[], dates: readonly string[]): NetWorthSeries => {
  const ordered = points.toSorted((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<string, BalancePoint>();
  let next = 0;
  return dates.map((date) => {
    for (let point = ordered[next]; point !== undefined && point.date <= date; point = ordered[++next]) {
      latest.set(point.accountId, point);
    }
    const byKind = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<Kind, number>;
    for (const { kind, amount } of latest.values()) {
      byKind[kind] += amount;
    }
    return { date, byKind };
  });
};
