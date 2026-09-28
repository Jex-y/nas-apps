import { and, asc, eq, gte, max } from "drizzle-orm";
import type { PetView } from "../contract";
import { addDays, londonDate } from "./calendar";
import type { PetDb } from "./db";
import { type DayTotal, derivePet, type Goal, type InteractionEvent, todayOf } from "./life";
import { days, goals, interactions, pets } from "./schema";

/** The history page's span, which is also how far back days are read before a pet has hatched. */
export const HISTORY_DAYS = 14;

/** The database or a transaction on it. */
export type PetReader = Pick<PetDb, "select">;

/** Everything a person's pet is derived from. */
export type Records = {
  readonly pet: typeof pets.$inferSelect | null;
  readonly goals: readonly Goal[];
  /** From hatching or the start of the history page, whichever is earlier. */
  readonly days: readonly DayTotal[];
  readonly interactions: readonly InteractionEvent[];
  readonly lastHealthAt: Date | null;
};

export const readRecords = async (db: PetReader, login: string, now: Date): Promise<Records> => {
  const [pet = null] = await db.select().from(pets).where(eq(pets.login, login));
  const historyStart = addDays(londonDate(now), 1 - HISTORY_DAYS);
  const hatchedOn = pet === null ? historyStart : londonDate(pet.hatchedAt);
  const since = hatchedOn < historyStart ? hatchedOn : historyStart;

  const walked = await db
    .select({ date: days.date, steps: days.steps })
    .from(days)
    .where(and(eq(days.login, login), gte(days.date, since)))
    .orderBy(asc(days.date));
  const [latest] = await db
    .select({ at: max(days.receivedAt) })
    .from(days)
    .where(eq(days.login, login));
  const lastHealthAt = latest?.at ?? null;
  if (pet === null) {
    return { pet, goals: [], days: walked, interactions: [], lastHealthAt };
  }
  return {
    pet,
    goals: await db.select({ since: goals.since, steps: goals.steps }).from(goals).where(eq(goals.petId, pet.id)),
    days: walked,
    interactions: await db
      .select({ kind: interactions.kind, at: interactions.at })
      .from(interactions)
      .where(eq(interactions.petId, pet.id)),
    lastHealthAt,
  };
};

export const viewOf = ({ pet, goals, days, interactions, lastHealthAt }: Records, now: Date): PetView => ({
  today: todayOf(goals, days, now),
  lastHealthAt: lastHealthAt?.toISOString() ?? null,
  pet: pet === null ? null : derivePet({ pet, goals, days, interactions, now }),
});
