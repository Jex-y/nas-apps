import { z } from "zod";

export const SHELL_API = "/shell/api";

export const ShellApp = z.object({ slug: z.string(), title: z.string() });
export const ShellApps = z.array(ShellApp);
export type ShellApp = z.infer<typeof ShellApp>;

export const PushSettings = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({ enabled: z.literal(true), publicKey: z.string() }),
]);
export type PushSettings = z.infer<typeof PushSettings>;

/** The shape of `PushSubscription.toJSON()`, narrowed to what sending needs. */
export const PushSubscriptionInput = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

export const PushEndpoint = z.object({ endpoint: z.url() });
export type PushEndpoint = z.infer<typeof PushEndpoint>;
