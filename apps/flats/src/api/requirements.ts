import { eq, sql } from "drizzle-orm";
import { DEFAULT_FACT_RULES, Requirements } from "../contract";
import type { FlatsDb } from "./db";
import { QUESTIONS } from "./questions";
import { requirements } from "./schema";

export const DEFAULT_REQUIREMENTS: Requirements = {
  limits: { minSizeSqft: 650, maxAnnualServiceCharge: 6000, minLeaseYears: 90 },
  questions: [...QUESTIONS],
  facts: [...DEFAULT_FACT_RULES],
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
