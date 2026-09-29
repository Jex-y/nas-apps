import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["tasks"],
  migrations: { schema: "drizzle", table: "tasks_migrations" },
});
