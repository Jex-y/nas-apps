import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { COMPETITION_LIFTS, SET_KINDS } from "../contract";

export const liftsSchema = pgSchema("lifts");

export const competitionLift = liftsSchema.enum("competition_lift", COMPETITION_LIFTS);
export const setKind = liftsSchema.enum("set_kind", SET_KINDS);

const instant = (name: string) => timestamp(name, { withTimezone: true });
const kilograms = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });

/**
 * Ids come from whoever creates the row, so a device can write while offline. Every child names its parent together
 * with the owner, which is why each table is unique on (owner, id): nothing can hang off another person's rows.
 */
const identity = () => ({
  id: uuid("id").primaryKey(),
  owner: text("owner").notNull(),
});

export const exercises = liftsSchema.table(
  "exercises",
  {
    ...identity(),
    name: text("name").notNull(),
    lift: competitionLift("lift"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.owner, table.id), unique().on(table.owner, table.lift)],
);

export const workouts = liftsSchema.table(
  "workouts",
  {
    ...identity(),
    date: date("date", { mode: "string" }).notNull(),
    finishedAt: instant("finished_at"),
    notes: text("notes").notNull().default(""),
    bodyweightKg: kilograms("bodyweight_kg"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.owner, table.id), index().on(table.owner, table.date)],
);

export const entries = liftsSchema.table(
  "entries",
  {
    ...identity(),
    workoutId: uuid("workout_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    position: integer("position").notNull(),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    unique().on(table.owner, table.id),
    foreignKey({ columns: [table.owner, table.workoutId], foreignColumns: [workouts.owner, workouts.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [table.owner, table.exerciseId], foreignColumns: [exercises.owner, exercises.id] }),
    index().on(table.owner, table.workoutId),
    index().on(table.owner, table.exerciseId),
  ],
);

export const sets = liftsSchema.table(
  "sets",
  {
    ...identity(),
    entryId: uuid("entry_id").notNull(),
    position: integer("position").notNull(),
    weightKg: kilograms("weight_kg").notNull(),
    reps: integer("reps").notNull(),
    rpe: numeric("rpe", { precision: 3, scale: 1, mode: "number" }),
    kind: setKind("kind").notNull(),
    loggedAt: instant("logged_at").notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.owner, table.entryId], foreignColumns: [entries.owner, entries.id] }).onDelete(
      "cascade",
    ),
    index().on(table.owner, table.entryId),
    check("weight_not_negative", sql`${table.weightKg} >= 0`),
    check("reps_not_negative", sql`${table.reps} >= 0`),
    check("rpe_in_half_steps", sql`${table.rpe} between 1 and 10 and ${table.rpe} * 2 = trunc(${table.rpe} * 2)`),
  ],
);

/** The pushes already applied, so a device retrying one after a lost answer changes nothing. */
export const pushes = liftsSchema.table(
  "pushes",
  {
    owner: text("owner").notNull(),
    key: text("key").notNull(),
    appliedAt: instant("applied_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.key] })],
);
