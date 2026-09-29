import { HttpError } from "@nas/core";
import { asc, count, eq, sql } from "drizzle-orm";
import type { ProjectSummary, ProjectView, Status } from "../contract";
import type { TasksDb } from "./db";
import { dependencies, projects, tasks } from "./schema";

export type TasksReader = Pick<TasksDb, "select">;

const iso = (instant: Date | null) => instant?.toISOString() ?? null;

const countOf = (wanted: Status) => count(sql`case when ${tasks.status} = ${wanted} then 1 end`);

export const readProjectList = async (db: TasksReader): Promise<ProjectSummary[]> => {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      todo: countOf("todo"),
      doing: countOf("doing"),
      done: countOf("done"),
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .groupBy(projects.id)
    .orderBy(asc(projects.createdAt));
  return rows.map(({ id, name, ...counts }) => ({ id, name, counts }));
};

export const readProjectView = async (db: TasksReader, projectId: string): Promise<ProjectView> => {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (project === undefined) {
    throw new HttpError(404, "Not found");
  }
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.status), asc(tasks.position), asc(tasks.createdAt));
  const edges = await db
    .select({ taskId: dependencies.taskId, dependsOnId: dependencies.dependsOnId })
    .from(dependencies)
    .innerJoin(tasks, eq(tasks.id, dependencies.taskId))
    .where(eq(tasks.projectId, projectId));
  const dependsOn = Map.groupBy(edges, (edge) => edge.taskId);

  return {
    id: project.id,
    name: project.name,
    tasks: rows.map((row) => ({
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
    })),
  };
};
