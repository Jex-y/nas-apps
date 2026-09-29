import { createSql, parseDatabaseConfig } from "@apps/core";
import { migrateAll } from "./migrate-all";

const sql = createSql(parseDatabaseConfig(process.env));
try {
  await migrateAll(sql);
} finally {
  await sql.close();
}
