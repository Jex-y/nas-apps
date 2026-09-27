import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@nas/core";
import { createFlatsApp } from "@nas/flats";
import { flatsMigrations } from "@nas/flats/migrations";
import { createNotesApp } from "@nas/notes";
import { notesMigrations } from "@nas/notes/migrations";

export const createApps = (context: AppContext): readonly AppModule[] => [
  createNotesApp(context),
  createFlatsApp(context),
];

export const appMigrations: readonly AppMigrations[] = [coreMigrations, notesMigrations, flatsMigrations];
