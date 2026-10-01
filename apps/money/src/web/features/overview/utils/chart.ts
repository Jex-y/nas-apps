import type { Kind, NetWorthPoint } from "../../../../contract";

export const totalOf = (point: NetWorthPoint): number =>
  (Object.values(point.byKind) as number[]).reduce((total, amount) => total + amount, 0);

/** The kinds a point has anything in, for a readout that leaves out the empty ones. */
export const heldKinds = (point: NetWorthPoint): readonly Kind[] =>
  (Object.keys(point.byKind) as Kind[]).filter((kind) => point.byKind[kind] !== 0);

/**
 * Round values spanning `min` to `max` in about `count` steps of 1, 2 or 5 times a power of ten, the first at or
 * below `min` and the last at or above `max`.
 */
export const niceTicks = (min: number, max: number, count: number): readonly number[] => {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude;
  const step = (ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 7 ? 5 : 10) * magnitude;
  const first = Math.floor(min / step) * step;
  const steps = Math.max(1, Math.ceil((max - first) / step - 1e-9));
  return Array.from({ length: steps + 1 }, (_, index) => first + index * step);
};

/** The index of each date that starts a month, thinned evenly to at most `limit` so labels do not collide. */
export const monthStarts = (dates: readonly string[], limit: number): readonly number[] => {
  const starts = dates.flatMap((date, index) =>
    index > 0 && date.slice(0, 7) !== dates[index - 1]?.slice(0, 7) ? [index] : [],
  );
  const every = Math.max(1, Math.ceil(starts.length / Math.max(1, limit)));
  return starts.filter((_, index) => index % every === 0);
};
