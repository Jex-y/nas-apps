import { type AppContext, type AppModule, appRoutes, createBlobStore, trailingSlashRedirect } from "@nas/core";
import { parseStreetsConfig } from "./api/config";
import { streetsDb } from "./api/db";
import { createOAuthStates } from "./api/oauth-state";
import { createOverpass, type Overpass } from "./api/overpass";
import { createStreetsRoutes } from "./api/routes";
import { createStravaApi, type StravaApi } from "./api/strava";
import { createStreetsWork } from "./api/work";
import page from "./web/index.html";

/** The outside services streets talks to; tests swap in fakes. */
export type StreetsAdapters = {
  /** `null` when no Strava API application is configured. */
  readonly strava: StravaApi | null;
  readonly overpass: Overpass;
};

const realAdapters = (context: AppContext): StreetsAdapters => {
  const { strava } = parseStreetsConfig(context.env);
  return { strava: strava === null ? null : createStravaApi(strava), overpass: createOverpass() };
};

export const createStreetsApp = (
  context: AppContext,
  adapters: StreetsAdapters = realAdapters(context),
): AppModule => {
  const db = streetsDb(context.sql);
  const now = () => new Date();
  const work = createStreetsWork({
    db,
    blob: createBlobStore(context.blob, "streets"),
    queue: context.jobs,
    notifier: context.notifier("streets"),
    strava: adapters.strava,
    overpass: adapters.overpass,
    publicUrl: context.publicUrl,
    now,
  });

  return {
    slug: "streets",
    title: "Every street",
    routes: appRoutes({
      "/streets": trailingSlashRedirect("streets"),
      "/streets/*": page,
      ...createStreetsRoutes({
        db,
        identity: context.identity,
        work,
        strava: adapters.strava,
        states: createOAuthStates(),
        publicUrl: context.publicUrl,
        now,
      }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
  };
};
