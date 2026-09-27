import type { AppContext, AppMigrations, AppModule } from "@nas/core";
import { createNotesApp } from "@nas/notes";
import { notesMigrations } from "@nas/notes/migrations";

export const createApps = (context: AppContext): readonly AppModule[] => [createNotesApp(context)];

export const appMigrations: readonly AppMigrations[] = [notesMigrations];
