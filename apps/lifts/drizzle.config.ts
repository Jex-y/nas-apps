import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["lifts"],
  migrations: { schema: "drizzle", table: "lifts_migrations" },
});
