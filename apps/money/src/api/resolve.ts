import type { Candidate } from "./prices";

/** How far a candidate's price may sit from the broker's and still be the same security, as a fraction. */
const TOLERANCE = 0.05;

const MAX_NAME_WORDS = 6;

/**
 * What to search FT Markets for, most specific first: the broker's code, which finds a share by its ticker, then ever
 * shorter starts of the name, since FT matches nothing once a query holds a word it does not know.
 */
export const searchQueries = (code: string, name: string): readonly string[] => {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "");
  const longest = Math.min(words.length, MAX_NAME_WORDS);
  const starts = Array.from({ length: Math.max(0, longest - 1) }, (_, index) =>
    words.slice(0, longest - index).join(" "),
  );
  return [...new Set([code, ...starts])];
};

/** Listings a UK broker's sterling price could have come from. */
export const sterlingCandidates = (candidates: readonly Candidate[]): readonly Candidate[] =>
  candidates.filter(({ symbol }) => /:(GBP|GBX|LSE)$/.test(symbol));

/** Whether two prices in pence are close enough to be one security a few days apart. */
export const agrees = (price: number, reference: number): boolean =>
  reference > 0 && Math.abs(price - reference) / reference <= TOLERANCE;
