import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type StreetsDb = BunSQLDatabase<typeof schema>;
export type StreetsTx = Parameters<Parameters<StreetsDb["transaction"]>[0]>[0];

export const streetsDb = (sql: SQL): StreetsDb => drizzle({ client: sql, schema });
