import { type AppContext, type AppModule, appRoutes, createBlobStore, trailingSlashRedirect } from "@apps/core";
import { parseStreetsConfig } from "./api/config";
import { streetsDb } from "./api/db";
import { createStreetsMcp } from "./api/mcp";
import { createOAuthStates } from "./api/oauth-state";
import { createOverpass, type Overpass } from "./api/overpass";
import { createStreetsRoutes } from "./api/routes";
import { createStreetsService } from "./api/service";
import { createStravaApi, type StravaApi } from "./api/strava";
import { createStreetsWork } from "./api/work";
import page from "./web/index.html";

/** The outside services streets talks to, and the clock that times polls and refreshes; tests swap in fakes. */
export type StreetsAdapters = {
  /** `null` when no Strava API application is configured. */
  readonly strava: StravaApi | null;
  readonly overpass: Overpass;
  readonly now: () => Date;
};

const realAdapters = (context: AppContext): StreetsAdapters => {
  const { strava } = parseStreetsConfig(context.env);
  return {
    strava: strava === null ? null : createStravaApi(strava),
    overpass: createOverpass(),
    now: () => new Date(),
  };
};

export const createStreetsApp = (
  context: AppContext,
  { strava, overpass, now }: StreetsAdapters = realAdapters(context),
): AppModule => {
  const db = streetsDb(context.sql);
  const work = createStreetsWork({
    db,
    blob: createBlobStore(context.blob, "streets"),
    queue: context.jobs,
    notifier: (login) => context.notifier("streets", login),
    strava,
    overpass,
    publicUrl: context.publicUrl,
    now,
  });
  const service = createStreetsService({
    db,
    work,
    strava,
    states: createOAuthStates(),
    publicUrl: context.publicUrl,
    now,
  });

  return {
    slug: "streets",
    title: "Every street",
    routes: appRoutes({
      "/streets": trailingSlashRedirect("streets"),
      "/streets/*": page,
      ...createStreetsRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createStreetsMcp(service),
  };
};
