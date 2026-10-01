import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type MoneyDb = BunSQLDatabase<typeof schema>;

export const moneyDb = (sql: SQL): MoneyDb => drizzle({ client: sql, schema });
