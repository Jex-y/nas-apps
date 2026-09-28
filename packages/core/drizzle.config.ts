import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/jobs/schema.ts", "./src/push/schema.ts"],
  out: "./drizzle",
  schemaFilter: ["jobs", "push"],
  migrations: { schema: "drizzle", table: "jobs_migrations" },
});
