import { sql } from "drizzle-orm";
import { check, date, index, integer, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { STATUSES } from "../contract";

export const tasksSchema = pgSchema("tasks");

export const status = tasksSchema.enum("status", STATUSES);

const localDate = (name: string) => date(name, { mode: "string" });
const instant = (name: string) => timestamp(name, { withTimezone: true });

/** Shared by everyone on the tailnet, like a whiteboard. */
export const projects = tasksSchema.table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const tasks = tasksSchema.table(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    status: status("status").notNull().default("todo"),
    /** Order within the task's column, from 0 at the top; rewritten for the whole column on every move. */
    position: integer("position").notNull(),
    durationDays: integer("duration_days").notNull().default(1),
    startOn: localDate("start_on"),
    dueOn: localDate("due_on"),
    startedAt: instant("started_at"),
    completedAt: instant("completed_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index().on(table.projectId, table.status, table.position)],
);

/**
 * `taskId` cannot start until `dependsOnId` is done. The API keeps the graph acyclic and within one project; the
 * database can only rule out the one-task cycle.
 */
export const dependencies = tasksSchema.table(
  "dependencies",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnId] }),
    index().on(table.dependsOnId),
    check("no_self_dependency", sql`${table.taskId} <> ${table.dependsOnId}`),
  ],
);
