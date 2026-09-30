import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@apps/core";
import { tasksDb } from "./api/db";
import { createTasksMcp } from "./api/mcp";
import { createTasksRoutes } from "./api/routes";
import { createTasksService } from "./api/service";
import { createTasksWork } from "./api/work";
import page from "./web/index.html";

/** The clock, which stamps when tasks start and finish and decides when reminders go out; tests pin it. */
export type TasksAdapters = { readonly now: () => Date };

export const createTasksApp = (context: AppContext, { now }: TasksAdapters = { now: () => new Date() }): AppModule => {
  const db = tasksDb(context.sql);
  const service = createTasksService({ db, now });
  const work = createTasksWork({
    db,
    notifier: (owner) => context.notifier("tasks", owner),
    publicUrl: context.publicUrl,
    now,
  });

  return {
    slug: "tasks",
    title: "Tasks",
    routes: appRoutes({
      "/tasks": trailingSlashRedirect("tasks"),
      "/tasks/*": page,
      ...createTasksRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createTasksMcp({ service, now }),
  };
};
