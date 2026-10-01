import { z } from "zod";

/**
 * Reserved as an app slug and as the first path segment inside every app, so no app's routes can collide with the
 * shell's.
 */
export const SHELL_SLUG = "shell";

/** The launcher's own API. */
export const SHELL_API = `/${SHELL_SLUG}/api`;

/** Where the shell serves an app's manifest, icons, settings page and push API: inside the app's own scope. */
export const appShellPath = (slug: string) => `/${slug}/${SHELL_SLUG}`;

/** The app a page belongs to, from its first path segment; `null` on the launcher's own pages. */
export const appSlugAt = (pathname: string): string | null => {
  const [, first = ""] = pathname.split("/");
  return first === "" || first === SHELL_SLUG ? null : first;
};

export const ShellApp = z.object({ slug: z.string(), title: z.string() });
export const ShellApps = z.array(ShellApp);
export type ShellApp = z.infer<typeof ShellApp>;

export const PushSettings = z.object({ publicKey: z.string() });
export type PushSettings = z.infer<typeof PushSettings>;

/** The shape of `PushSubscription.toJSON()`, narrowed to what sending needs. */
export const PushSubscriptionInput = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

export const PushEndpoint = z.object({ endpoint: z.url() });
export type PushEndpoint = z.infer<typeof PushEndpoint>;
