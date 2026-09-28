import type { SQL } from "bun";
import { z } from "zod";
import { createWebPushNotifier, type WebPushConfig } from "./push/send";

export type NotifyConfig = WebPushConfig;

const NotifyEnv = z.object({
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:)/),
});

export const parseNotifyConfig = (env: Readonly<Record<string, string | undefined>>): NotifyConfig => {
  const result = NotifyEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = result.data;
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  };
};

export type NotificationPriority = "min" | "low" | "default" | "high" | "urgent";

export type Notification = {
  readonly title: string;
  readonly message: string;
  /** Opened when the notification is tapped; the app's own page when omitted. */
  readonly clickUrl?: string;
  readonly priority?: NotificationPriority;
};

/** Push notifications scoped to one app. */
export type Notifier = {
  readonly send: (notification: Notification) => Promise<void>;
};

/** Gives each app a notifier for its own topic, named after its slug. */
export type NotifierFactory = (topic: string) => Notifier;

export const createNotifierFactory =
  (config: NotifyConfig, sql: SQL): NotifierFactory =>
  (topic) =>
    createWebPushNotifier({ config, sql, topic });
