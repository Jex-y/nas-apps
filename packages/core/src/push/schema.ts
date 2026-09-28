import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const pushSchema = pgSchema("push");

/** A browser's Web Push subscription; the endpoint is unique per browser install and app origin. */
export const subscriptions = pushSchema.table("subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  login: text("login").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
