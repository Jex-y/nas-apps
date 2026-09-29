import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@apps/core";
import { createFlatsApp } from "@apps/flats";
import { flatsMigrations } from "@apps/flats/migrations";
import { createStatusApp, parseBuildInfo } from "@apps/status";
import { createTasksApp } from "@apps/tasks";
import { tasksMigrations } from "@apps/tasks/migrations";

export const appMigrations: readonly AppMigrations[] = [coreMigrations, flatsMigrations, tasksMigrations];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createFlatsApp(context), createTasksApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
