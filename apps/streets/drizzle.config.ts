import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["streets"],
  migrations: { schema: "drizzle", table: "streets_migrations" },
});
