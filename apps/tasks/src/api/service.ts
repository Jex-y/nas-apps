import { HttpError } from "@nas/core";
import { and, asc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { MoveTask, NewTask, ProjectView, SaveProject, Status, Task, UpdateTask } from "../contract";
import { blockers, canDependOn } from "../plan";
import type { TasksDb } from "./db";
import { dependencies, projects, tasks } from "./schema";
import { readProjectList, readProjectView } from "./views";

export type TasksServiceDeps = {
  readonly db: TasksDb;
  readonly now: () => Date;
};

type Tx = Parameters<Parameters<TasksDb["transaction"]>[0]>[0];
type TaskRow = typeof tasks.$inferSelect;

const titles = (list: readonly Task[]) => list.map((task) => `"${task.title}"`).join(", ");

/** Rewrites a column's order with `task` placed above `beforeId`, or at the bottom when that is `null`. */
const placeInColumn = async (tx: Tx, task: TaskRow, status: Status, beforeId: string | null) => {
  const column = (
    await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, task.projectId), eq(tasks.status, status), ne(tasks.id, task.id)))
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
  ).map((row) => row.id);
  const at = beforeId === null ? column.length : column.indexOf(beforeId);
  if (at === -1) {
    throw new HttpError(400, "The task to go before is not in that column");
  }
  column.splice(at, 0, task.id);
  const positions = sql.join(
    column.map((id, index) => sql`when ${id}::uuid then ${index}::int`),
    sql` `,
  );
  await tx
    .update(tasks)
    .set({ status, position: sql`case ${tasks.id} ${positions} end` })
    .where(inArray(tasks.id, column));
};

/** Only work yet to begin may wait on unfinished tasks, so every started task's dependencies are done. */
const checkMove = (view: ProjectView, task: Task, status: Status) => {
  const byId = new Map(view.tasks.map((other) => [other.id, other]));
  const waiting = blockers(task, byId);
  if (status !== "todo" && waiting.length > 0) {
    throw new HttpError(409, `Waiting on ${titles(waiting)}`);
  }
  const started = view.tasks.filter((other) => other.dependsOn.includes(task.id) && other.status !== "todo");
  if (task.status === "done" && status !== "done" && started.length > 0) {
    throw new HttpError(409, `${titles(started)} already started on the strength of this`);
  }
};

/**
 * Every change to projects and tasks, shared by the HTTP API and the MCP server. Each change answers with the
 * project as it now is, and fails with an {@link HttpError} saying why it was refused.
 */
export const createTasksService = ({ db, now }: TasksServiceDeps) => {
  /** Changes a project with its row locked, so concurrent edits cannot together close a cycle or tangle a column. */
  const changeProject = async (
    projectId: string,
    change: (tx: Tx, view: ProjectView) => Promise<void>,
  ): Promise<ProjectView> => {
    await db.transaction(async (tx) => {
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
      await change(tx, await readProjectView(tx, projectId));
    });
    return readProjectView(db, projectId);
  };

  const changeTask = async (
    taskId: string,
    change: (tx: Tx, row: TaskRow, task: Task, view: ProjectView) => Promise<void>,
  ): Promise<ProjectView> => {
    const [found] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId));
    if (found === undefined) {
      throw new HttpError(404, "Not found");
    }
    return changeProject(found.projectId, async (tx, view) => {
      const [row] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      const task = view.tasks.find((other) => other.id === taskId);
      if (row === undefined || task === undefined) {
        throw new HttpError(404, "Not found");
      }
      await change(tx, row, task, view);
    });
  };

  return {
    listProjects: () => readProjectList(db),

    getProject: (projectId: string) => readProjectView(db, projectId),

    createProject: async ({ name }: SaveProject): Promise<ProjectView> => {
      const [project] = await db.insert(projects).values({ name }).returning({ id: projects.id });
      if (project === undefined) {
        throw new Error("insert returned nothing");
      }
      return readProjectView(db, project.id);
    },

    renameProject: (projectId: string, { name }: SaveProject) =>
      changeProject(projectId, async (tx, view) => {
        await tx.update(projects).set({ name }).where(eq(projects.id, view.id));
      }),

    deleteProject: async (projectId: string): Promise<void> => {
      const deleted = await db.delete(projects).where(eq(projects.id, projectId)).returning({ id: projects.id });
      if (deleted.length === 0) {
        throw new HttpError(404, "Not found");
      }
    },

    /** Adds a task at the bottom of To do. */
    createTask: (projectId: string, { dependsOn, ...input }: NewTask) =>
      changeProject(projectId, async (tx, view) => {
        const known = new Set(view.tasks.map((task) => task.id));
        if (!dependsOn.every((dependsOnId) => known.has(dependsOnId))) {
          throw new HttpError(400, "A task can only depend on tasks in its own project");
        }
        const [bottom] = await tx
          .select({ position: max(tasks.position) })
          .from(tasks)
          .where(and(eq(tasks.projectId, view.id), eq(tasks.status, "todo")));
        const [task] = await tx
          .insert(tasks)
          .values({ ...input, projectId: view.id, position: (bottom?.position ?? -1) + 1 })
          .returning({ id: tasks.id });
        if (task === undefined) {
          throw new Error("insert returned nothing");
        }
        if (dependsOn.length > 0) {
          await tx
            .insert(dependencies)
            .values([...new Set(dependsOn)].map((dependsOnId) => ({ taskId: task.id, dependsOnId })));
        }
      }),

    updateTask: (taskId: string, update: UpdateTask) =>
      changeTask(taskId, async (tx, row) => {
        await tx.update(tasks).set(update).where(eq(tasks.id, row.id));
      }),

    deleteTask: (taskId: string) =>
      changeTask(taskId, async (tx, row) => {
        await tx.delete(tasks).where(eq(tasks.id, row.id));
      }),

    /** Moves a task to a column, stamping when it starts and finishes. */
    moveTask: (taskId: string, { status, beforeId }: MoveTask) =>
      changeTask(taskId, async (tx, row, task, view) => {
        checkMove(view, task, status);
        const at = now();
        await tx
          .update(tasks)
          .set({
            startedAt: status === "todo" ? null : row.status === "todo" ? at : (row.startedAt ?? at),
            completedAt: status !== "done" ? null : row.status === "done" ? row.completedAt : at,
          })
          .where(eq(tasks.id, row.id));
        await placeInColumn(tx, row, status, beforeId);
      }),

    addDependency: (taskId: string, dependsOnId: string) =>
      changeTask(taskId, async (tx, row, task, view) => {
        const dependency = view.tasks.find((other) => other.id === dependsOnId);
        if (dependency === undefined) {
          throw new HttpError(400, "A task can only depend on tasks in its own project");
        }
        if (dependsOnId === task.id) {
          throw new HttpError(400, "A task cannot depend on itself");
        }
        if (!canDependOn(view.tasks, task.id, dependsOnId)) {
          throw new HttpError(409, `"${dependency.title}" already waits on "${task.title}"`);
        }
        if (task.status !== "todo" && dependency.status !== "done") {
          throw new HttpError(409, "A task already started can only depend on tasks that are done");
        }
        await tx.insert(dependencies).values({ taskId: row.id, dependsOnId }).onConflictDoNothing();
      }),

    removeDependency: (taskId: string, dependsOnId: string) =>
      changeTask(taskId, async (tx, row) => {
        await tx
          .delete(dependencies)
          .where(and(eq(dependencies.taskId, row.id), eq(dependencies.dependsOnId, dependsOnId)));
      }),
  };
};

export type TasksService = ReturnType<typeof createTasksService>;
