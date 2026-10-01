import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@apps/core";
import { liftsDb } from "./api/db";
import { createLiftsMcp } from "./api/mcp";
import { createLiftsRoutes } from "./api/routes";
import { createLiftsService } from "./api/service";
import { createLiftsWork } from "./api/work";
import page from "./web/index.html";

/** The clock, which stamps sets logged and workouts finished over MCP and ages out remembered pushes; tests pin it. */
export type LiftsAdapters = { readonly now: () => Date };

export const createLiftsApp = (context: AppContext, { now }: LiftsAdapters = { now: () => new Date() }): AppModule => {
  const db = liftsDb(context.sql);
  const service = createLiftsService({ db });
  const work = createLiftsWork({ db, now });

  return {
    slug: "lifts",
    title: "Lifts",
    routes: appRoutes({
      "/lifts": trailingSlashRedirect("lifts"),
      "/lifts/*": page,
      ...createLiftsRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createLiftsMcp({ service, now }),
    offlinePage: page,
  };
};
