import { type AppContext, type AppModule, appRoutes, createBlobStore, trailingSlashRedirect } from "@apps/core";
import { parseFlatsConfig } from "./api/config";
import { type CrimeRecords, createPoliceUk } from "./api/crime";
import { flatsDb } from "./api/db";
import { createJevExtractor, type FeatureExtractor } from "./api/extractor";
import { BROWSER_USER_AGENT, createHttpFetcher } from "./api/fetcher";
import { bundleMapWorker } from "./api/mapWorker" with { type: "macro" };
import { createFlatsMcp } from "./api/mcp";
import { createPostcodesIo, createTflPlanner, type Geocoder, type JourneyPlanner } from "./api/places";
import { rightmove } from "./api/portals/rightmove";
import { createFlatsRoutes } from "./api/routes";
import { createFlatsService } from "./api/service";
import { createFlatsWork } from "./api/work";
import { MAP_WORKER_PATH } from "./contract";
import page from "./web/index.html";

/** Bundled while the server is, so it is part of the build rather than read from node_modules at runtime. */
const mapWorker = bundleMapWorker();

/** Page requests to a portal are spaced like a person browsing; its image CDN can take them faster. */
const intervalMs = (host: string): number => (host.startsWith("www.") ? 5_000 : 250);

/** The outside services flats talks to; tests swap in fakes. */
export type FlatsAdapters = {
  readonly geocoder: Geocoder;
  readonly planner: JourneyPlanner | null;
  readonly crime: CrimeRecords;
  readonly extractor: FeatureExtractor | null;
};

const realAdapters = (context: AppContext): FlatsAdapters => {
  const { tflApiKey, typesafeApiKey } = parseFlatsConfig(context.env);
  return {
    geocoder: createPostcodesIo(),
    planner: tflApiKey === null ? null : createTflPlanner(tflApiKey),
    crime: createPoliceUk(),
    extractor: typesafeApiKey === null ? null : createJevExtractor(typesafeApiKey),
  };
};

export const createFlatsApp = (context: AppContext, adapters: FlatsAdapters = realAdapters(context)): AppModule => {
  const db = flatsDb(context.sql);
  const blob = createBlobStore(context.blob, "flats");
  const parsers = [rightmove];
  const work = createFlatsWork({
    db,
    blob,
    queue: context.jobs,
    notifier: context.notifier("flats"),
    fetcher: createHttpFetcher({ userAgent: BROWSER_USER_AGENT, intervalMs }),
    parsers: { rightmove },
    planner: adapters.planner,
    crime: adapters.crime,
    extractor: adapters.extractor,
    publicUrl: context.publicUrl,
    now: () => new Date(),
  });
  const service = createFlatsService({
    db,
    blob,
    work,
    parsers,
    geocoder: adapters.geocoder,
    extractor: adapters.extractor,
  });

  return {
    slug: "flats",
    title: "Flat hunt",
    routes: appRoutes({
      "/flats": trailingSlashRedirect("flats"),
      [MAP_WORKER_PATH]: new Response(mapWorker, {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" },
      }),
      "/flats/*": page,
      ...createFlatsRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createFlatsMcp(service),
  };
};
