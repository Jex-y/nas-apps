import type { AppMigrations } from "./database";

/** The platform's own tables (the job queue); migrate before any app. */
export const coreMigrations: AppMigrations = { slug: "jobs", folder: "packages/core/drizzle" };
