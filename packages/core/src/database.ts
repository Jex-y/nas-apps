import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { DatabaseConfig } from "./config";

export const createSql = (config: DatabaseConfig): SQL => new SQL({ adapter: "postgres", ...config, max: 5 });

/**
 * Each app owns the Postgres schema named after its slug. Its migration journal must stay out of that
 * schema: the migrator creates the journal's schema first, which would make the app's `CREATE SCHEMA` fail.
 */
export type AppMigrations = {
  readonly slug: string;
  /** Relative to the repo root, which is the working directory for every entrypoint. */
  readonly folder: string;
};

export const migrateApp = (sql: SQL, app: AppMigrations): Promise<void> =>
  migrate(drizzle({ client: sql }), {
    migrationsFolder: app.folder,
    migrationsSchema: "drizzle",
    migrationsTable: `${app.slug}_migrations`,
  });
