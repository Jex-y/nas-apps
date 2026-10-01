import type { SQL } from "bun";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import type { AppModule } from "../app-module";
import { parseBody } from "../http";
import { type IdentityMode, resolveViewer } from "../identity";
import { subscriptions } from "../push/schema";
import { createWebPushNotifier, type WebPushConfig } from "../push/send";
import { findTheme } from "../web/theme";
import { identityAt, markFor } from "./artwork";
import {
  appShellPath,
  PushEndpoint,
  type PushSettings,
  PushSubscriptionInput,
  type SavedTheme,
  SHELL_API,
  SHELL_SLUG,
  type ShellApp,
  ThemeChoice,
} from "./contract";
import { ICON_SIZES, type IconSize, renderIcons } from "./icons";
import page from "./index.html";
import { themes } from "./schema";
import settingsPage from "./settings.html";
import serviceWorker from "./sw.js" with { type: "text" };

/** The launcher, and around each app its own installable wrapper: manifest, icons, settings and push subscriptions. */
export type ShellOptions = {
  readonly identity: IdentityMode;
  readonly sql: SQL;
  readonly webPush: WebPushConfig;
};

/** The default theme's light ground; the manifest is fixed, so the pages set their own colour once they load. */
const THEME_COLOR = "#e4e8ee";

const MANIFEST_ICON_SIZES = [192, 512] as const satisfies readonly IconSize[];

/** Each app's scope is its own path, so the apps install side by side without one capturing another's pages. */
const manifest = ({ slug, title }: ShellApp) => ({
  name: title,
  short_name: title,
  id: `/${slug}/`,
  start_url: `/${slug}/`,
  scope: `/${slug}/`,
  display: "standalone",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: MANIFEST_ICON_SIZES.map((size) => ({
    src: `${appShellPath(slug)}/icons/icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose: "any maskable",
  })),
});

const lazy = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let made: Promise<T> | undefined;
  return () => {
    made ??= make();
    return made;
  };
};

export const createShellRoutes = (
  apps: readonly AppModule[],
  { identity, sql, webPush }: ShellOptions,
): Bun.Serve.Routes<undefined, string> => {
  const db = drizzle({ client: sql });
  const launchable: ShellApp[] = apps.map(({ slug, title }) => ({ slug, title }));
  const settings: PushSettings = { publicKey: webPush.publicKey };

  const appRoutes = (app: ShellApp, index: number): Bun.Serve.Routes<undefined, string> => {
    const { slug, title } = app;
    const base = appShellPath(slug);
    const api = `${base}/api`;
    // The launcher draws the same mark on the app's tile.
    const icons = lazy(() => renderIcons(markFor(slug, identityAt(index, launchable.length))));
    const icon = (size: IconSize) => async () =>
      new Response((await icons())[size], {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });

    return {
      [`${base}/settings`]: settingsPage,
      [`${base}/manifest.webmanifest`]: Response.json(manifest(app), {
        headers: { "Content-Type": "application/manifest+json" },
      }),
      ...Object.fromEntries(ICON_SIZES.map((size) => [`${base}/icons/icon-${size}.png`, icon(size)])),
      [`${api}/push`]: Response.json(settings),
      [`${api}/push/subscriptions`]: {
        POST: async (request: Request) => {
          const { login } = resolveViewer(identity, request);
          const { endpoint, keys } = await parseBody(request, PushSubscriptionInput);
          const subscription = { p256dh: keys.p256dh, auth: keys.auth, login, topic: slug };
          await db
            .insert(subscriptions)
            .values({ endpoint, ...subscription })
            .onConflictDoUpdate({ target: subscriptions.endpoint, set: subscription });
          return new Response(null, { status: 204 });
        },
        DELETE: async (request: Request) => {
          const { login } = resolveViewer(identity, request);
          const { endpoint } = await parseBody(request, PushEndpoint);
          await db
            .delete(subscriptions)
            .where(
              and(eq(subscriptions.endpoint, endpoint), eq(subscriptions.login, login), eq(subscriptions.topic, slug)),
            );
          return new Response(null, { status: 204 });
        },
      },
      [`${api}/push/test`]: {
        POST: async (request: Request) => {
          const { login } = resolveViewer(identity, request);
          await createWebPushNotifier({ config: webPush, sql, topic: slug, login }).send({
            title: "Notifications are on",
            message: `This is how updates from ${title} will arrive.`,
          });
          return new Response(null, { status: 204 });
        },
      },
    };
  };

  return {
    "/": page,
    [`/${SHELL_SLUG}/settings`]: settingsPage,
    "/sw.js": () =>
      new Response(serviceWorker, {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
      }),
    [`${SHELL_API}/apps`]: Response.json(launchable),
    [`${SHELL_API}/theme`]: {
      GET: async (request: Request) => {
        const { login } = resolveViewer(identity, request);
        const [saved] = await db.select().from(themes).where(eq(themes.login, login));
        return Response.json({ theme: findTheme(saved?.theme ?? null) } satisfies SavedTheme);
      },
      PUT: async (request: Request) => {
        const { login } = resolveViewer(identity, request);
        const { theme } = await parseBody(request, ThemeChoice);
        await db
          .insert(themes)
          .values({ login, theme })
          .onConflictDoUpdate({ target: themes.login, set: { theme, updatedAt: new Date() } });
        return new Response(null, { status: 204 });
      },
    },
    ...Object.assign({}, ...launchable.map(appRoutes)),
  };
};
