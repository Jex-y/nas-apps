import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@nas/core";
import { createNotesRoutes } from "./api/routes";
import page from "./web/index.html";

export const createNotesApp = (context: AppContext): AppModule => ({
  slug: "notes",
  title: "Notes",
  routes: appRoutes({
    "/notes": trailingSlashRedirect("notes"),
    "/notes/*": page,
    ...createNotesRoutes(context),
  }),
  jobs: [],
  schedules: [],
});
