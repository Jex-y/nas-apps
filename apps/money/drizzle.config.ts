import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["money"],
  migrations: { schema: "drizzle", table: "money_migrations" },
});
