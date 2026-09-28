import { sql } from "drizzle-orm";
import { bigint, index, integer, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jsonb } from "../columns";

export const jobsSchema = pgSchema("jobs");

export const jobState = jobsSchema.enum("job_state", ["pending", "dead"]);

/**
 * A job is `pending` until it succeeds (the row is deleted) or exhausts its attempts (`dead`, kept for inspection).
 * A pending job whose `locked_until` is in the future is running; once that lease lapses any worker may reclaim it.
 */
export const jobs = jobsSchema.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    payload: jsonb<unknown>("payload").notNull(),
    state: jobState("state").notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    /** When `last_error` was recorded; null on rows that failed before this column existed. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_claimable_idx").on(table.runAt).where(sql`${table.state} = 'pending'`),
    uniqueIndex("jobs_pending_dedupe_key_idx")
      .on(table.name, table.dedupeKey)
      .where(sql`${table.state} = 'pending' and ${table.dedupeKey} is not null`),
  ],
);

/** The last time slot each schedule enqueued, so restarts and concurrent schedulers never enqueue a slot twice. */
export const schedules = jobsSchema.table("schedules", {
  name: text("name").primaryKey(),
  lastSlot: bigint("last_slot", { mode: "number" }).notNull(),
});

export const jobOutcome = jobsSchema.enum("job_outcome", ["completed", "retrying", "dead"]);

/** How many attempts of each job ended each way per UTC hour; a completed job leaves no other trace. */
export const hourlyOutcomes = jobsSchema.table(
  "hourly_outcomes",
  {
    name: text("name").notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    outcome: jobOutcome("outcome").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.hour, table.outcome] })],
);
