/** A linear map from values in `[min, max]` to percentages across a track. */
export type Scale = { readonly min: number; readonly max: number; readonly at: (value: number) => number };

/**
 * Spans `values`, and 0 too with `withZero`, padded by `padding` of the range each side so marks at the ends stay
 * clear of the edge.
 */
export const scaleOver = (values: readonly number[], { padding = 0.06, withZero = true } = {}): Scale => {
  const low = Math.min(...(withZero ? [0] : []), ...values);
  const high = Math.max(...(withZero ? [0] : []), ...values);
  const span = high - low || 1;
  const min = low - span * padding;
  const max = high + span * padding;
  return { min, max, at: (value) => ((value - min) / (max - min)) * 100 };
};

/** Symmetric about 0, so a positive and a negative effect of the same size sit the same distance from the centre. */
export const symmetricScale = (values: readonly number[], padding = 0.08): Scale => {
  const reach = Math.max(0.5, ...values.map(Math.abs)) * (1 + padding);
  return { min: -reach, max: reach, at: (value) => ((value + reach) / (2 * reach)) * 100 };
};

/** Round tick values across the scale: steps of 1, 2 or 5 times a power of ten, as near `count` of them as fit. */
export const ticks = ({ min, max }: Scale, count = 5): number[] => {
  const rough = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  // The nearest round step, not the next one up, which can leave a single tick on a short scale.
  const step = [1, 2, 5, 10]
    .map((factor) => factor * power)
    .reduce((best, candidate) => (Math.abs(candidate - rough) < Math.abs(best - rough) ? candidate : best));
  const first = Math.ceil(min / step) * step;
  return Array.from({ length: Math.floor((max - first) / step) + 1 }, (_, index) =>
    Number((first + index * step).toFixed(10)),
  );
};
