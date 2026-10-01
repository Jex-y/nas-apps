import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { SHELL_SLUG } from "../shell/contract";

export const pushSchema = pgSchema("push");

/**
 * A browser's Web Push subscription to one app. Each installed app subscribes for itself, so the endpoint is unique
 * per browser install and app. `topic` is that app's slug; its default is the shell's reserved slug, which no app can
 * send to.
 */
export const subscriptions = pushSchema.table("subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  login: text("login").notNull(),
  topic: text("topic").notNull().default(SHELL_SLUG),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
