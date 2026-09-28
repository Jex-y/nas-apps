import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type PetDb = BunSQLDatabase<typeof schema>;

export const petDb = (sql: SQL): PetDb => drizzle({ client: sql, schema });
