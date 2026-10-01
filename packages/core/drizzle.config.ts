import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/jobs/schema.ts", "./src/push/schema.ts", "./src/shell/schema.ts"],
  out: "./drizzle",
  schemaFilter: ["jobs", "push", "shell"],
  migrations: { schema: "drizzle", table: "jobs_migrations" },
});
