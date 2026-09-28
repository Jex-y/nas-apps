import type { SQL } from "bun";
import { z } from "zod";
import { createWebPushNotifier, type WebPushConfig } from "./push/send";

export type NtfyConfig = {
  /** The ntfy server's base URL. */
  readonly url: string;
  /** An ntfy access token (`tk_…`); omit for a server that allows anonymous publishing. */
  readonly token?: string;
};

export type NotifyConfig = {
  readonly ntfy: NtfyConfig;
  /** `null` when no VAPID keys are configured; notifications then go to ntfy only. */
  readonly webPush: WebPushConfig | null;
};

/** Compose passes an unset optional variable through as `""`. */
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const NotifyEnv = z
  .object({
    NTFY_URL: z.url(),
    NTFY_TOKEN: z.string().startsWith("tk_").optional(),
    VAPID_PUBLIC_KEY: optional(z.string().min(1)),
    VAPID_PRIVATE_KEY: optional(z.string().min(1)),
    VAPID_SUBJECT: optional(z.string().regex(/^(mailto:|https:)/)),
  })
  .refine(
    (env) =>
      [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].every((value) => value === undefined) ||
      [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].every((value) => value !== undefined),
    {
      message: "Set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none",
      path: ["VAPID_PUBLIC_KEY"],
    },
  );

export const parseNotifyConfig = (env: Readonly<Record<string, string | undefined>>): NotifyConfig => {
  const result = NotifyEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const { NTFY_URL: url, NTFY_TOKEN: token, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = result.data;
  return {
    ntfy: token === undefined ? { url } : { url, token },
    webPush:
      VAPID_PUBLIC_KEY === undefined || VAPID_PRIVATE_KEY === undefined || VAPID_SUBJECT === undefined
        ? null
        : {
            publicKey: VAPID_PUBLIC_KEY,
            privateKey: VAPID_PRIVATE_KEY,
            subject: VAPID_SUBJECT,
          },
  };
};

export const PRIORITIES = {
  min: 1,
  low: 2,
  default: 3,
  high: 4,
  urgent: 5,
} as const;

export type Notification = {
  readonly title: string;
  readonly message: string;
  /** Opened when the notification is tapped. */
  readonly clickUrl?: string;
  readonly priority?: keyof typeof PRIORITIES;
  /** ntfy tags; names of emoji shortcodes render as icons. */
  readonly tags?: readonly string[];
};

/** Push notifications scoped to one app. */
export type Notifier = {
  readonly send: (notification: Notification) => Promise<void>;
};

/** Gives each app a notifier for its own topic, named after its slug. */
export type NotifierFactory = (topic: string) => Notifier;

export const createNtfyNotifier = (config: NtfyConfig, topic: string): Notifier => ({
  send: async ({ title, message, clickUrl, priority = "default", tags = [] }) => {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.token !== undefined && {
          Authorization: `Bearer ${config.token}`,
        }),
      },
      body: JSON.stringify({
        topic,
        title,
        message,
        priority: PRIORITIES[priority],
        tags,
        ...(clickUrl !== undefined && { click: clickUrl }),
      }),
    });
    if (!response.ok) {
      throw new Error(`ntfy rejected the notification: ${response.status} ${await response.text()}`);
    }
  },
});

/**
 * Sends to every configured channel. One failing channel does not stop the others, but the send still throws,
 * so a job that retries it re-sends to the channels that succeeded.
 */
const fanOut = (notifiers: readonly Notifier[]): Notifier => ({
  send: async (notification) => {
    const results = await Promise.allSettled(notifiers.map((notifier) => notifier.send(notification)));
    const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (failures.length > 0) {
      throw new AggregateError(failures, "A notification channel failed");
    }
  },
});

export const createNotifierFactory =
  (config: NotifyConfig, sql: SQL): NotifierFactory =>
  (topic) =>
    fanOut([
      createNtfyNotifier(config.ntfy, topic),
      ...(config.webPush === null ? [] : [createWebPushNotifier({ config: config.webPush, sql, topic })]),
    ]);
