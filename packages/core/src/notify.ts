import { z } from "zod";

export type NotifyConfig = {
  /** The ntfy server's base URL. */
  readonly url: string;
  /** An ntfy access token (`tk_…`); omit for a server that allows anonymous publishing. */
  readonly token?: string;
};

const NotifyEnv = z.object({
  NTFY_URL: z.url(),
  NTFY_TOKEN: z.string().startsWith("tk_").optional(),
});

export const parseNotifyConfig = (env: Readonly<Record<string, string | undefined>>): NotifyConfig => {
  const result = NotifyEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const { NTFY_URL: url, NTFY_TOKEN: token } = result.data;
  return token === undefined ? { url } : { url, token };
};

const PRIORITIES = { min: 1, low: 2, default: 3, high: 4, urgent: 5 } as const;

export type Notification = {
  readonly title: string;
  readonly message: string;
  /** Opened when the notification is tapped. */
  readonly clickUrl?: string;
  readonly priority?: keyof typeof PRIORITIES;
  /** ntfy tags; names of emoji shortcodes render as icons. */
  readonly tags?: readonly string[];
};

/** Push notifications scoped to one app: everything goes to the ntfy topic named after it. */
export type Notifier = {
  readonly send: (notification: Notification) => Promise<void>;
};

export const createNotifier = (config: NotifyConfig, topic: string): Notifier => ({
  send: async ({ title, message, clickUrl, priority = "default", tags = [] }) => {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.token !== undefined && { Authorization: `Bearer ${config.token}` }),
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
