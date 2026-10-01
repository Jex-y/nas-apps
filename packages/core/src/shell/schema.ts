import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const shellSchema = pgSchema("shell");

/** The theme each person chose, kept here so every browser and installed app they use follows it. */
export const themes = shellSchema.table("themes", {
  login: text("login").primaryKey(),
  /** A `ThemeId` when written; a theme since removed reads as no choice. */
  theme: text("theme").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
