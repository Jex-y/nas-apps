import {
  date,
  doublePrecision,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ACCESSORIES, INTERACTIONS, SPECIES, TRAITS } from "../contract";

export const petSchema = pgSchema("pet");

export const species = petSchema.enum("species", SPECIES);
export const trait = petSchema.enum("trait", TRAITS);
export const accessory = petSchema.enum("accessory", ACCESSORIES);
export const interaction = petSchema.enum("interaction", INTERACTIONS);
export const nudgeKind = petSchema.enum("nudge_kind", ["evening", "goal", "stale"]);

const localDate = (name: string) => date(name, { mode: "string" });
const at = (name: string) => timestamp(name, { withTimezone: true }).notNull();

/**
 * One person's Apple Health totals for one London day, as the Shortcut last sent them. Kept apart from the pet,
 * so walking done before hatching still counts on the day it hatches.
 */
export const days = petSchema.table(
  "days",
  {
    login: text("login").notNull(),
    date: localDate("date").notNull(),
    steps: integer("steps").notNull(),
    distanceMeters: doublePrecision("distance_meters"),
    activeEnergyKcal: doublePrecision("active_energy_kcal"),
    receivedAt: at("received_at"),
  },
  (table) => [primaryKey({ columns: [table.login, table.date] })],
);

/** Each tailnet login keeps one pet. Everything else about it is derived from its history, never stored. */
export const pets = petSchema.table("pets", {
  id: uuid("id").primaryKey().defaultRandom(),
  login: text("login").notNull().unique(),
  name: text("name").notNull(),
  species: species("species").notNull(),
  trait: trait("trait").notNull(),
  accessory: accessory("accessory"),
  hatchedAt: at("hatched_at"),
});

/** A goal holds from its date until the next one, so changing it never rewrites which past days were fed. */
export const goals = petSchema.table(
  "goals",
  {
    petId: uuid("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    since: localDate("since").notNull(),
    steps: integer("steps").notNull(),
  },
  (table) => [primaryKey({ columns: [table.petId, table.since] })],
);

export const interactions = petSchema.table(
  "interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    petId: uuid("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    kind: interaction("kind").notNull(),
    at: at("at"),
  },
  (table) => [index().on(table.petId, table.at)],
);

/** Notifications already sent, so each kind goes out at most once per pet per London day. */
export const nudges = petSchema.table(
  "nudges",
  {
    petId: uuid("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    date: localDate("date").notNull(),
    kind: nudgeKind("kind").notNull(),
    sentAt: at("sent_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.petId, table.date, table.kind] })],
);
