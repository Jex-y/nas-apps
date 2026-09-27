import { customType } from "drizzle-orm/pg-core";

/**
 * Imported by drizzle-kit, which runs under Node: keep this module free of Bun-only imports.
 *
 * `jsonb` for the Bun SQL driver, which serialises objects itself. drizzle's own `jsonb` stringifies first, so the
 * driver stores a JSON string containing the document rather than the document, and Postgres cannot query into it.
 */
export const jsonb = <T>(name: string) => customType<{ data: T; driverData: T }>({ dataType: () => "jsonb" })(name);
