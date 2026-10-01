import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@nas/core";
import { createFlatsApp } from "@nas/flats";
import { flatsMigrations } from "@nas/flats/migrations";
import { createStatusApp, parseBuildInfo } from "@nas/status";
import { createStreetsApp } from "@nas/streets";
import { streetsMigrations } from "@nas/streets/migrations";

export const appMigrations: readonly AppMigrations[] = [coreMigrations, flatsMigrations, streetsMigrations];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createFlatsApp(context), createStreetsApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
