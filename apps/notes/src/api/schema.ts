import { index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notesSchema = pgSchema("notes");

export const notes = notesSchema.table(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notes_owner_created_at_idx").on(table.owner, table.createdAt)],
);
