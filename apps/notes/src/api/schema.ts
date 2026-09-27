import { bigint, index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

/** The blob lives at `notes/<id>` in object storage; the row is written only once the blob exists. */
export const attachments = notesSchema.table(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("attachments_note_id_idx").on(table.noteId)],
);
