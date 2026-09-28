import { SQL } from "bun";
import { sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";
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

const MIGRATIONS_SCHEMA = "drizzle";
const migrationsTable = (app: AppMigrations): string => `${app.slug}_migrations`;

export const migrateApp = (sql: SQL, app: AppMigrations): Promise<void> =>
  migrate(drizzle({ client: sql }), {
    migrationsFolder: app.folder,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: migrationsTable(app),
  });

export type MigrationState =
  | { readonly kind: "current"; readonly applied: number }
  | {
      readonly kind: "pending";
      readonly applied: number;
      readonly pending: number;
    }
  /** The database holds migrations newer than this build's, as after rolling back to an older release. */
  | {
      readonly kind: "ahead";
      readonly applied: number;
      readonly unknown: number;
    };

const TableExists = z.tuple([z.object({ exists: z.boolean() })]);
const AppliedMigrations = z.array(z.object({ created_at: z.coerce.number() }));

/** Compares the way the migrator does: by each migration's folder timestamp, which it stores as `created_at`. */
export const readMigrationState = async (sql: SQL, app: AppMigrations): Promise<MigrationState> => {
  const db = drizzle({ client: sql });
  const [{ exists }] = TableExists.parse(
    await db.execute(
      raw`select exists (select from pg_tables where schemaname = ${MIGRATIONS_SCHEMA} and tablename = ${migrationsTable(app)}) as exists`,
    ),
  );
  const table = raw`${raw.identifier(MIGRATIONS_SCHEMA)}.${raw.identifier(migrationsTable(app))}`;
  const applied = exists
    ? AppliedMigrations.parse(await db.execute(raw`select created_at from ${table}`)).map((row) => row.created_at)
    : [];
  const known = readMigrationFiles({ migrationsFolder: app.folder }).map((migration) => migration.folderMillis);

  const lastApplied = Math.max(-Infinity, ...applied);
  const lastKnown = Math.max(-Infinity, ...known);
  const pending = known.filter((millis) => millis > lastApplied).length;
  const unknown = applied.filter((millis) => millis > lastKnown).length;

  if (pending > 0) {
    return { kind: "pending", applied: applied.length, pending };
  }
  return unknown > 0
    ? { kind: "ahead", applied: applied.length, unknown }
    : { kind: "current", applied: applied.length };
};
