import type { PropertySummary, Ranking } from "../../../../contract";

const scoreOf = (ranking: Ranking): number => (ranking.kind === "scored" ? ranking.total : Number.NEGATIVE_INFINITY);

/** Highest score first, excluded properties last, in their original order among equals. */
export const bestFirst = (properties: readonly PropertySummary[]): PropertySummary[] =>
  properties.toSorted((a, b) => scoreOf(b.ranking) - scoreOf(a.ranking) || 0);
