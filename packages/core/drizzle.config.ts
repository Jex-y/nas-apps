import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/jobs/schema.ts",
  out: "./drizzle",
  schemaFilter: ["jobs"],
  migrations: { schema: "drizzle", table: "jobs_migrations" },
});
