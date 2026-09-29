import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@apps/core";
import { createFlatsApp } from "@apps/flats";
import { flatsMigrations } from "@apps/flats/migrations";
import { createPetApp } from "@apps/pet";
import { petMigrations } from "@apps/pet/migrations";
import { createStatusApp, parseBuildInfo } from "@apps/status";
import { createTasksApp } from "@apps/tasks";
import { tasksMigrations } from "@apps/tasks/migrations";

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
