import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@nas/core";
import { tasksDb } from "./api/db";
import { createTasksRoutes } from "./api/routes";
import page from "./web/index.html";

/** The clock, which stamps when tasks start and finish; tests pin it. */
export type TasksAdapters = { readonly now: () => Date };

export const createTasksApp = (
  context: AppContext,
  adapters: TasksAdapters = { now: () => new Date() },
): AppModule => ({
  slug: "tasks",
  title: "Tasks",
  routes: appRoutes({
    "/tasks": trailingSlashRedirect("tasks"),
    "/tasks/*": page,
    ...createTasksRoutes({ db: tasksDb(context.sql), identity: context.identity, ...adapters }),
  }),
  jobs: [],
  schedules: [],
});
