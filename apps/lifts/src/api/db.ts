import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type LiftsDb = BunSQLDatabase<typeof schema>;

export const liftsDb = (sql: SQL): LiftsDb => drizzle({ client: sql, schema });
