import type { SQL } from "bun";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import type { AppModule } from "../app-module";
import { HttpError, parseBody } from "../http";
import { type IdentityMode, resolveViewer } from "../identity";
import { subscriptions } from "../push/schema";
import { createWebPushNotifier, type WebPushConfig } from "../push/send";
import { SHELL_ICONS_FOLDER } from "./assets";
import { PushEndpoint, type PushSettings, PushSubscriptionInput, SHELL_API, type ShellApp } from "./contract";
import page from "./index.html";
import serviceWorker from "./sw.js" with { type: "text" };

/** The installable wrapper around every app: launcher, manifest, service worker and push subscriptions. */
export type ShellOptions = {
  readonly identity: IdentityMode;
  readonly sql: SQL;
  /** `null` turns push off: the launcher hides it and subscribing is refused. */
  readonly webPush: WebPushConfig | null;
};

/** Reserved so no app's routes can collide with the shell's. */
export const SHELL_SLUG = "shell";

const THEME_COLOR = "#ecebe7";

const manifest = {
  name: "Apps",
  short_name: "Apps",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    { src: "/shell/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/shell/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};

const icon = (size: number) => () =>
  new Response(Bun.file(`${SHELL_ICONS_FOLDER}/icon-${size}.png`), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });

export const createShellRoutes = (apps: readonly AppModule[], { identity, sql, webPush }: ShellOptions) => {
  const db = drizzle({ client: sql });
  const launchable: ShellApp[] = apps.map(({ slug, title }) => ({ slug, title }));
  const settings: PushSettings =
    webPush === null ? { enabled: false } : { enabled: true, publicKey: webPush.publicKey };
  const requirePush = (): WebPushConfig => {
    if (webPush === null) {
      throw new HttpError(409, "Push notifications are not configured on this server");
    }
    return webPush;
  };

  return {
    "/": page,
    "/manifest.webmanifest": Response.json(manifest, { headers: { "Content-Type": "application/manifest+json" } }),
    "/sw.js": () =>
      new Response(serviceWorker, {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
      }),
    "/shell/icons/icon-180.png": icon(180),
    "/shell/icons/icon-192.png": icon(192),
    "/shell/icons/icon-512.png": icon(512),
    [`${SHELL_API}/apps`]: Response.json(launchable),
    [`${SHELL_API}/push`]: Response.json(settings),
    [`${SHELL_API}/push/subscriptions`]: {
      POST: async (request: Request) => {
        const { login } = resolveViewer(identity, request);
        requirePush();
        const { endpoint, keys } = await parseBody(request, PushSubscriptionInput);
        await db
          .insert(subscriptions)
          .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, login })
          .onConflictDoUpdate({ target: subscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth, login } });
        return new Response(null, { status: 204 });
      },
      DELETE: async (request: Request) => {
        const { login } = resolveViewer(identity, request);
        const { endpoint } = await parseBody(request, PushEndpoint);
        await db.delete(subscriptions).where(and(eq(subscriptions.endpoint, endpoint), eq(subscriptions.login, login)));
        return new Response(null, { status: 204 });
      },
    },
    [`${SHELL_API}/push/test`]: {
      POST: async (request: Request) => {
        const { login } = resolveViewer(identity, request);
        await createWebPushNotifier({ config: requirePush(), sql, topic: SHELL_SLUG, login }).send({
          title: "Notifications are on",
          message: "This is how updates from your apps will arrive.",
          clickUrl: "/",
        });
        return new Response(null, { status: 204 });
      },
    },
  };
};
