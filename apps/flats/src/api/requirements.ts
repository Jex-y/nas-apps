import { eq, sql } from "drizzle-orm";
import { type Limits, Requirements } from "../contract";
import type { FlatsDb } from "./db";
import { QUESTIONS } from "./questions";
import { requirements } from "./schema";

export const DEFAULT_REQUIREMENTS: Requirements = {
  limits: { minSizeSqft: 650, maxAnnualServiceCharge: 6000, minLeaseYears: 90 },
  questions: [...QUESTIONS],
};

/** The property facts the limits read. */
export type LimitedFacts = {
  readonly sizeSqft: number | null;
  readonly annualServiceCharge: number | null;
  readonly leaseYearsRemaining: number | null;
};

/** The limit the facts break, as a reason to reject, or `null`; a fact the listing doesn't state breaks nothing. */
export const breach = (facts: LimitedFacts, limits: Limits): string | null => {
  if (limits.minSizeSqft !== null && facts.sizeSqft !== null && facts.sizeSqft < limits.minSizeSqft) {
    return `Under ${limits.minSizeSqft.toLocaleString("en-GB")} sq ft`;
  }
  if (
    limits.maxAnnualServiceCharge !== null &&
    facts.annualServiceCharge !== null &&
    facts.annualServiceCharge > limits.maxAnnualServiceCharge
  ) {
    return `Service charge over £${limits.maxAnnualServiceCharge.toLocaleString("en-GB")}`;
  }
  if (
    limits.minLeaseYears !== null &&
    facts.leaseYearsRemaining !== null &&
    facts.leaseYearsRemaining < limits.minLeaseYears
  ) {
    return `Lease under ${limits.minLeaseYears} years`;
  }
  return null;
};

export const loadRequirements = async (db: FlatsDb): Promise<Requirements> => {
  const [saved] = await db.select({ document: requirements.document }).from(requirements).where(eq(requirements.id, 1));
  return saved === undefined ? DEFAULT_REQUIREMENTS : Requirements.parse(saved.document);
};

export const saveRequirements = async (db: FlatsDb, document: Requirements): Promise<void> => {
  await db
    .insert(requirements)
    .values({ id: 1, document })
    .onConflictDoUpdate({ target: requirements.id, set: { document, updatedAt: sql`now()` } });
};
