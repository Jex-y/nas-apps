import { type AppContext, type AppModule, appRoutes, resolveViewer, trailingSlashRedirect } from "@nas/core";
import { tasksDb } from "./api/db";
import { handleMcp } from "./api/mcp";
import { createTasksRoutes } from "./api/routes";
import { createTasksService } from "./api/service";
import { createTasksWork } from "./api/work";
import page from "./web/index.html";

/** The clock, which stamps when tasks start and finish and decides when reminders go out; tests pin it. */
export type TasksAdapters = { readonly now: () => Date };

export const createTasksApp = (context: AppContext, { now }: TasksAdapters = { now: () => new Date() }): AppModule => {
  const db = tasksDb(context.sql);
  const service = createTasksService({ db, now });
  const work = createTasksWork({ db, notifier: context.notifier("tasks"), publicUrl: context.publicUrl, now });
  const mcp = handleMcp({ service, now });
  const serveMcp = (request: Request) => {
    resolveViewer(context.identity, request);
    return mcp(request);
  };

  return {
    slug: "tasks",
    title: "Tasks",
    routes: appRoutes({
      "/tasks": trailingSlashRedirect("tasks"),
      "/tasks/*": page,
      "/tasks/mcp": { GET: serveMcp, POST: serveMcp, DELETE: serveMcp },
      ...createTasksRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
  };
};
