import { beforeEach } from "bun:test";
import { type AppContext, drainJobs, type Notification } from "@nas/core";
import { createTestContext } from "@nas/core/testing";
import { londonDate } from "../src/api/calendar";
import { petDb } from "../src/api/db";
import type { DayTotal } from "../src/api/life";
import { days, goals, pets } from "../src/api/schema";
import { createPetWork } from "../src/api/work";
import { DEFAULT_STEP_GOAL, type Trait } from "../src/contract";

/** Noon on a British Summer Time Monday: the pet is awake and it is not yet evening. */
export const NOON = new Date("2026-09-21T11:00:00Z");

export type Sent = { readonly login: string; readonly notification: Notification };

/**
 * The pet's work over the real test database, with the clock pinned and notifications collected per owner. Call
 * once per test file: it owns that file's connection, and empties the pet tables and pet jobs before each test.
 */
export const createPetTestbed = () => {
  const context: AppContext = createTestContext();
  const db = petDb(context.sql);

  const setup = (now = NOON, send: (sent: Sent) => Promise<void> = async () => {}) => {
    const sent: Sent[] = [];
    const work = createPetWork({
      db,
      queue: context.jobs,
      notifier: (login) => ({
        send: async (notification) => {
          await send({ login, notification });
          sent.push({ login, notification });
        },
      }),
      publicUrl: "https://apps.example",
      now: () => now,
    });
    return { work, sent, drain: () => drainJobs(context.sql, work.jobs) };
  };

  /** A pet hatched at `hatchedAt` with the default goal, skipping the dice. */
  const hatch = async (login: string, hatchedAt: Date, trait: Trait = "greedy") => {
    const [pet] = await db.insert(pets).values({ login, name: "Pip", species: "chick", trait, hatchedAt }).returning();
    if (pet === undefined) {
      throw new Error("no pet");
    }
    await db.insert(goals).values({ petId: pet.id, since: londonDate(hatchedAt), steps: DEFAULT_STEP_GOAL });
    return pet;
  };

  const walk = (login: string, totals: readonly DayTotal[], receivedAt: Date) =>
    db.insert(days).values(totals.map((total) => ({ login, ...total, receivedAt })));

  beforeEach(async () => {
    await context.sql`truncate pet.pets, pet.days cascade`;
    await context.sql`delete from jobs.jobs where name like 'pet.%'`;
  });

  return { context, db, setup, hatch, walk };
};
