import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@apps/core";
import { createStatusMcp } from "./api/mcp";
import { createStatusReporter, type StatusDeps } from "./api/report";
import { createStatusRoutes } from "./api/routes";
import page from "./web/index.html";

export { parseBuildInfo } from "./api/report";

export const createStatusApp = (context: AppContext, deps: Omit<StatusDeps, "context">): AppModule => {
  const report = createStatusReporter({ context, ...deps });
  return {
    slug: "status",
    title: "System status",
    routes: appRoutes({
      "/status": trailingSlashRedirect("status"),
      "/status/*": page,
      ...createStatusRoutes({ identity: context.identity, report }),
    }),
    jobs: [],
    schedules: [],
    mcp: createStatusMcp(report),
  };
};
