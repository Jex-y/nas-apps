import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type FlatsDb = BunSQLDatabase<typeof schema>;

export const flatsDb = (sql: SQL): FlatsDb => drizzle({ client: sql, schema });
