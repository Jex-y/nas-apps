import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@nas/core";
import { createFlatsApp } from "@nas/flats";
import { flatsMigrations } from "@nas/flats/migrations";
import { createNotesApp } from "@nas/notes";
import { notesMigrations } from "@nas/notes/migrations";
import { createStatusApp, parseBuildInfo } from "@nas/status";

export const appMigrations: readonly AppMigrations[] = [coreMigrations, notesMigrations, flatsMigrations];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [createNotesApp(context), createFlatsApp(context)];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
