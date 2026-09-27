import {
  type AppContext,
  type AppModule,
  appRoutes,
  createBlobStore,
  createNotifier,
  trailingSlashRedirect,
} from "@nas/core";
import { flatsDb } from "./api/db";
import { BROWSER_USER_AGENT, createHttpFetcher } from "./api/fetcher";
import { rightmove } from "./api/portals/rightmove";
import { createFlatsRoutes } from "./api/routes";
import { createFlatsWork } from "./api/work";

/** Page requests to a portal are spaced like a person browsing; its image CDN can take them faster. */
const intervalMs = (host: string): number => (host.startsWith("www.") ? 5_000 : 250);

export const createFlatsApp = (context: AppContext): AppModule => {
  const db = flatsDb(context.sql);
  const blob = createBlobStore(context.blob, "flats");
  const parsers = [rightmove];
  const work = createFlatsWork({
    db,
    blob,
    queue: context.jobs,
    notifier: createNotifier(context.notify, "flats"),
    fetcher: createHttpFetcher({ userAgent: BROWSER_USER_AGENT, intervalMs }),
    parsers: { rightmove },
    publicUrl: context.publicUrl,
    now: () => new Date(),
  });

  return {
    slug: "flats",
    title: "Flat hunt",
    routes: appRoutes({
      "/flats": trailingSlashRedirect("flats"),
      ...createFlatsRoutes({ db, blob, identity: context.identity, work, parsers }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
  };
};
