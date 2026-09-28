import { afterEach, expect, test } from "bun:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { type AppMigrations, readMigrationState } from "./database";
import { coreMigrations } from "./migrations";
import { createTestContext } from "./testing";

const { sql } = createTestContext();

const journal = readMigrationFiles({
  migrationsFolder: coreMigrations.folder,
}).map((m) => m.folderMillis);
const app: AppMigrations = {
  slug: `test_${crypto.randomUUID().replaceAll("-", "")}`,
  folder: coreMigrations.folder,
};
const table = `drizzle.${app.slug}_migrations`;

afterEach(async () => {
  await sql.unsafe(`drop table if exists ${table}`);
});

const recordApplied = async (createdAt: readonly number[]) => {
  await sql.unsafe(`create table ${table} (id serial primary key, hash text not null, created_at bigint)`);
  for (const millis of createdAt) {
    await sql.unsafe(`insert into ${table} (hash, created_at) values ('test', ${millis})`);
  }
};

test("every migration is pending before the app's journal table exists", async () => {
  expect(await readMigrationState(sql, app)).toEqual({
    kind: "pending",
    applied: 0,
    pending: journal.length,
  });
});

test("is current once every migration in the folder is applied", async () => {
  await recordApplied(journal);
  expect(await readMigrationState(sql, app)).toEqual({
    kind: "current",
    applied: journal.length,
  });
});

test("counts migrations newer than the folder's as unknown", async () => {
  await recordApplied([...journal, Math.max(...journal) + 1]);
  expect(await readMigrationState(sql, app)).toEqual({
    kind: "ahead",
    applied: journal.length + 1,
    unknown: 1,
  });
});

test("the platform's own migrations are applied by the test preload", async () => {
  expect(await readMigrationState(sql, coreMigrations)).toEqual({
    kind: "current",
    applied: journal.length,
  });
});
