import type { SQL } from "bun";
import type { BlobConfig } from "./blob";
import type { IdentityMode } from "./identity";
import type { JobQueue, RegisteredJob } from "./jobs/queue";
import type { Schedule } from "./jobs/schedule";
import type { NotifierFactory } from "./notify";

export type AppContext = {
  /** The raw environment, for an app to parse its own settings (e.g. third-party API keys) at its boundary. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly publicUrl: string;
  readonly sql: SQL;
  readonly blob: BlobConfig;
  readonly notifier: NotifierFactory;
  readonly jobs: JobQueue;
  readonly identity: IdentityMode;
};

declare const appRoutesBrand: unique symbol;

/** Route table with its path literals erased so apps can be merged; build one with {@link appRoutes}. */
export type AppRoutes = { readonly [appRoutesBrand]: true };

/**
 * Checks each handler against its own path (so `request.params` is typed), then erases the path literals.
 * Bun matches on those same keys at runtime, so the erasure cannot mismatch a handler with its params.
 */
export const appRoutes = <R extends string>(routes: Bun.Serve.Routes<undefined, R>): AppRoutes =>
  routes as unknown as AppRoutes;

/** Types a partial route table (e.g. an app's API) against its path literals, for spreading into {@link appRoutes}. */
export const defineRoutes = <R extends string>(
  routes: Bun.Serve.Routes<undefined, R>,
): Bun.Serve.Routes<undefined, R> => routes;

export const routePaths = (routes: AppRoutes): readonly string[] => Object.keys(routes);

export const serveRoutes = (routes: AppRoutes): Bun.Serve.Routes<undefined, string> =>
  routes as unknown as Bun.Serve.Routes<undefined, string>;

/**
 * Every route path must start with `/${slug}`, and every job and schedule name with `${slug}.`, so apps can be split
 * into their own servers later.
 */
export type AppModule = {
  readonly slug: string;
  readonly title: string;
  readonly routes: AppRoutes;
  readonly jobs: readonly RegisteredJob[];
  readonly schedules: readonly Schedule[];
};

export const trailingSlashRedirect = (slug: string): Response =>
  new Response(null, { status: 308, headers: { Location: `/${slug}/` } });

export type AppWork = {
  readonly jobs: readonly RegisteredJob[];
  readonly schedules: readonly Schedule[];
};

/** Collects every app's jobs and schedules, refusing names outside the app's `${slug}.` namespace. */
export const collectAppWork = (apps: readonly AppModule[]): AppWork => {
  for (const app of apps) {
    const stray = [...app.jobs, ...app.schedules].find((work) => !work.name.startsWith(`${app.slug}.`));
    if (stray !== undefined) {
      throw new Error(`App "${app.slug}" declares job or schedule "${stray.name}" outside ${app.slug}.`);
    }
  }
  return { jobs: apps.flatMap((app) => app.jobs), schedules: apps.flatMap((app) => app.schedules) };
};
