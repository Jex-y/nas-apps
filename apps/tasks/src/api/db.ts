import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type TasksDb = BunSQLDatabase<typeof schema>;

export const tasksDb = (sql: SQL): TasksDb => drizzle({ client: sql, schema });
