import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["pet"],
  migrations: { schema: "drizzle", table: "pet_migrations" },
});
