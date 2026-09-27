import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["flats"],
  migrations: { schema: "drizzle", table: "flats_migrations" },
});
