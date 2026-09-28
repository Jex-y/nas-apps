import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@nas/core";
import { createFlatsApp } from "@nas/flats";
import { flatsMigrations } from "@nas/flats/migrations";
import { createStatusApp, parseBuildInfo } from "@nas/status";

export const appMigrations: readonly AppMigrations[] = [coreMigrations, flatsMigrations];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createFlatsApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
