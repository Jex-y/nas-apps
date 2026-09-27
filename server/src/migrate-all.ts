import { migrateApp } from "@nas/core";
import type { SQL } from "bun";
import { appMigrations } from "./apps";

export const migrateAll = async (sql: SQL): Promise<void> => {
  for (const app of appMigrations) {
    await migrateApp(sql, app);
    console.log(`Migrated ${app.slug}`);
  }
};
