import { asc, eq } from "drizzle-orm";
import type { TaskList } from "../contract";
import type { TasksDb } from "./db";
import { dependencies, tasks } from "./schema";

export type TasksReader = Pick<TasksDb, "select">;

const iso = (instant: Date | null) => instant?.toISOString() ?? null;

export const readTasks = async (db: TasksReader, owner: string): Promise<TaskList> => {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.owner, owner))
    .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.createdAt));
  const edges = await db
    .select({ taskId: dependencies.taskId, dependsOnId: dependencies.dependsOnId })
    .from(dependencies)
    .innerJoin(tasks, eq(tasks.id, dependencies.taskId))
    .where(eq(tasks.owner, owner));
  const dependsOn = Map.groupBy(edges, (edge) => edge.taskId);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    durationDays: row.durationDays,
    startOn: row.startOn,
    dueOn: row.dueOn,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    dependsOn: (dependsOn.get(row.id) ?? []).map((edge) => edge.dependsOnId),
  }));
};
