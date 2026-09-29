import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@apps/core";
import { createFlatsApp } from "@apps/flats";
import { flatsMigrations } from "@apps/flats/migrations";
import { createPetApp } from "@apps/pet";
import { petMigrations } from "@apps/pet/migrations";
import { createStatusApp, parseBuildInfo } from "@apps/status";

export const appMigrations: readonly AppMigrations[] = [coreMigrations, flatsMigrations, petMigrations];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createFlatsApp(context), createPetApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
