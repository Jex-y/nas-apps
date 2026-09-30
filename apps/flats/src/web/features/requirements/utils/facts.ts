import type { FactKey } from "../../../../contract";
import { FACTS } from "../../../../scoring";
import type { Row } from "./rank";

/** A fact's values across the flats in play; a commute contributes one value per destination. */
export const factValues = (fact: FactKey, rows: readonly Row[], median: number | null): number[] =>
  rows.flatMap((row) =>
    fact === "commute_minutes"
      ? row.property.commutes.flatMap((commute) => (commute.minutes === null ? [] : [commute.minutes]))
      : [FACTS[fact].read(row.property, median)].filter((value): value is number => value !== null),
  );
