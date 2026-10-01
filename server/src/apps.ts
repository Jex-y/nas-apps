import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@apps/core";
import { createFlatsApp } from "@apps/flats";
import { flatsMigrations } from "@apps/flats/migrations";
import { createMoneyApp } from "@apps/money";
import { moneyMigrations } from "@apps/money/migrations";
import { createStatusApp, parseBuildInfo } from "@apps/status";
import { createTasksApp } from "@apps/tasks";
import { tasksMigrations } from "@apps/tasks/migrations";

export const appMigrations: readonly AppMigrations[] = [
  coreMigrations,
  flatsMigrations,
  moneyMigrations,
  tasksMigrations,
];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createFlatsApp(context), createMoneyApp(context), createTasksApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
