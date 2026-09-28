import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@nas/core";
import type { StatusDeps } from "./api/report";
import { createStatusRoutes } from "./api/routes";
import page from "./web/index.html";

export { parseBuildInfo } from "./api/report";

export const createStatusApp = (context: AppContext, deps: Omit<StatusDeps, "context">): AppModule => ({
  slug: "status",
  title: "System status",
  routes: appRoutes({
    "/status": trailingSlashRedirect("status"),
    "/status/*": page,
    ...createStatusRoutes({ context, ...deps }),
  }),
  jobs: [],
  schedules: [],
});
