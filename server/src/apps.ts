import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@nas/core";
import { createFlatsApp } from "@nas/flats";
import { flatsMigrations } from "@nas/flats/migrations";
import { createPetApp } from "@nas/pet";
import { petMigrations } from "@nas/pet/migrations";
import { createStatusApp, parseBuildInfo } from "@nas/status";
import { createTasksApp } from "@nas/tasks";
import { tasksMigrations } from "@nas/tasks/migrations";

export const appMigrations: readonly AppMigrations[] = [
  coreMigrations,
  flatsMigrations,
  petMigrations,
  tasksMigrations,
];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createFlatsApp(context), createPetApp(context), createTasksApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
