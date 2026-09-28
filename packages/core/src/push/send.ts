import type { SQL } from "bun";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import webpush from "web-push";
import type { Notification, Notifier } from "../notify";
import { subscriptions } from "./schema";

export type WebPushConfig = {
  readonly publicKey: string;
  readonly privateKey: string;
  /** A `mailto:` or `https:` contact the push services can reach if the sender misbehaves. */
  readonly subject: string;
};

/** What the service worker receives; `sw.js` reads exactly these fields. */
export type PushPayload = {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  /** Collapses notifications from the same app on the lock screen. */
  readonly tag: string;
};

const URGENCY = {
  min: "very-low",
  low: "low",
  default: "normal",
  high: "high",
  urgent: "high",
} as const;

const DAY_SECONDS = 24 * 60 * 60;

export const toPushPayload = (topic: string, { title, message, clickUrl }: Notification): PushPayload => ({
  title,
  body: message,
  url: clickUrl ?? `/${topic}/`,
  tag: topic,
});

export type WebPushNotifierOptions = {
  readonly config: WebPushConfig;
  readonly sql: SQL;
  readonly topic: string;
  /** Only this person's browsers; everyone's when omitted. */
  readonly login?: string;
  readonly send?: typeof fetch;
};

/** Sends to every subscribed browser, forgetting the ones the push service reports as gone. */
export const createWebPushNotifier = ({
  config,
  sql,
  topic,
  login,
  send = fetch,
}: WebPushNotifierOptions): Notifier => {
  const db = drizzle({ client: sql });
  return {
    send: async (notification) => {
      const payload = JSON.stringify(toPushPayload(topic, notification));
      const targets = await db
        .select()
        .from(subscriptions)
        .where(login === undefined ? undefined : eq(subscriptions.login, login));
      const results = await Promise.allSettled(
        targets.map(async (target) => {
          const request = webpush.generateRequestDetails(
            {
              endpoint: target.endpoint,
              keys: { p256dh: target.p256dh, auth: target.auth },
            },
            payload,
            {
              vapidDetails: config,
              TTL: DAY_SECONDS,
              urgency: URGENCY[notification.priority ?? "default"],
            },
          );
          const response = await send(request.endpoint, {
            method: request.method,
            headers: Object.fromEntries(
              Object.entries(request.headers)
                .filter(([name]) => name !== "Content-Length")
                .map(([name, value]) => [name, String(value)]),
            ),
            body: new Uint8Array(request.body),
          });
          if (response.status === 404 || response.status === 410) {
            await db.delete(subscriptions).where(eq(subscriptions.endpoint, target.endpoint));
            return;
          }
          if (!response.ok) {
            throw new Error(`Push service rejected the notification: ${response.status} ${await response.text()}`);
          }
        }),
      );
      const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} of ${targets.length} push deliveries failed`);
      }
    },
  };
};
