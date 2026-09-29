import { type AppContext, type AppModule, appRoutes, createBlobStore, trailingSlashRedirect } from "@apps/core";
import { parseFlatsConfig } from "./api/config";
import { flatsDb } from "./api/db";
import { createJevExtractor, type FeatureExtractor } from "./api/extractor";
import { BROWSER_USER_AGENT, createHttpFetcher } from "./api/fetcher";
import { createPostcodesIo, createTflPlanner, type Geocoder, type JourneyPlanner } from "./api/places";
import { rightmove } from "./api/portals/rightmove";
import { QUESTIONS } from "./api/questions";
import { createFlatsRoutes } from "./api/routes";
import { createFlatsWork } from "./api/work";
import page from "./web/index.html";

/** Page requests to a portal are spaced like a person browsing; its image CDN can take them faster. */
const intervalMs = (host: string): number => (host.startsWith("www.") ? 5_000 : 250);

/** The outside services flats talks to; tests swap in fakes. */
export type FlatsAdapters = {
  readonly geocoder: Geocoder;
  readonly planner: JourneyPlanner | null;
  readonly extractor: FeatureExtractor | null;
};

const realAdapters = (context: AppContext): FlatsAdapters => {
  const { tflApiKey, typesafeApiKey } = parseFlatsConfig(context.env);
  return {
    geocoder: createPostcodesIo(),
    planner: tflApiKey === null ? null : createTflPlanner(tflApiKey),
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
    extractor: adapters.extractor,
    questions: QUESTIONS,
    publicUrl: context.publicUrl,
    now: () => new Date(),
  });

  return {
    slug: "flats",
    title: "Flat hunt",
    routes: appRoutes({
      "/flats": trailingSlashRedirect("flats"),
      "/flats/*": page,
      ...createFlatsRoutes({
        db,
        blob,
        identity: context.identity,
        work,
        parsers,
        geocoder: adapters.geocoder,
        questions: QUESTIONS,
      }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
  };
};
