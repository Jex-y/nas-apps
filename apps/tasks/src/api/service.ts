import { HttpError } from "@nas/core";
import { and, asc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { MoveTask, NewTask, Status, Task, TaskList, UpdateTask } from "../contract";
import { blockers, canDependOn } from "../plan";
import type { TasksDb } from "./db";
import { dependencies, tasks } from "./schema";
import { readTasks } from "./views";

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
      .where(and(eq(tasks.owner, task.owner), eq(tasks.status, status), ne(tasks.id, task.id)))
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
const checkMove = (list: TaskList, task: Task, status: Status) => {
  const byId = new Map(list.map((other) => [other.id, other]));
  const waiting = blockers(task, byId);
  if (status !== "todo" && waiting.length > 0) {
    throw new HttpError(409, `Waiting on ${titles(waiting)}`);
  }
  const started = list.filter((other) => other.dependsOn.includes(task.id) && other.status !== "todo");
  if (task.status === "done" && status !== "done" && started.length > 0) {
    throw new HttpError(409, `${titles(started)} already started on the strength of this`);
  }
};

/**
 * Every change to someone's list, shared by the HTTP API and the MCP server. Each answers with the list as it now
 * is, and fails with an {@link HttpError} saying why it was refused. Nobody can see or touch another's tasks.
 */
export const createTasksService = ({ db, now }: TasksServiceDeps) => {
  /**
   * Changes an owner's list under a transaction-scoped lock on that owner, so concurrent edits cannot together close a
   * cycle or tangle a column.
   */
  const change = async (owner: string, apply: (tx: Tx, list: TaskList) => Promise<void>): Promise<TaskList> => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tasks:${owner}`}, 0))`);
      await apply(tx, await readTasks(tx, owner));
    });
    return readTasks(db, owner);
  };

  const changeTask = (
    owner: string,
    taskId: string,
    apply: (tx: Tx, row: TaskRow, task: Task, list: TaskList) => Promise<void>,
  ): Promise<TaskList> =>
    change(owner, async (tx, list) => {
      const [row] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.owner, owner)));
      const task = list.find((other) => other.id === taskId);
      if (row === undefined || task === undefined) {
        throw new HttpError(404, "Not found");
      }
      await apply(tx, row, task, list);
    });

  return {
    list: (owner: string) => readTasks(db, owner),

    /** Adds a task at the bottom of To do. */
    createTask: (owner: string, { dependsOn, ...input }: NewTask) =>
      change(owner, async (tx, list) => {
        const known = new Set(list.map((task) => task.id));
        if (!dependsOn.every((dependsOnId) => known.has(dependsOnId))) {
          throw new HttpError(400, "A task can only depend on your own tasks");
        }
        const [bottom] = await tx
          .select({ position: max(tasks.position) })
          .from(tasks)
          .where(and(eq(tasks.owner, owner), eq(tasks.status, "todo")));
        const [task] = await tx
          .insert(tasks)
          .values({ ...input, owner, position: (bottom?.position ?? -1) + 1 })
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

    updateTask: (owner: string, taskId: string, update: UpdateTask) =>
      changeTask(owner, taskId, async (tx, row) => {
        await tx.update(tasks).set(update).where(eq(tasks.id, row.id));
      }),

    deleteTask: (owner: string, taskId: string) =>
      changeTask(owner, taskId, async (tx, row) => {
        await tx.delete(tasks).where(eq(tasks.id, row.id));
      }),

    /** Moves a task to a column, stamping when it starts and finishes. */
    moveTask: (owner: string, taskId: string, { status, beforeId }: MoveTask) =>
      changeTask(owner, taskId, async (tx, row, task, list) => {
        checkMove(list, task, status);
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

    addDependency: (owner: string, taskId: string, dependsOnId: string) =>
      changeTask(owner, taskId, async (tx, row, task, list) => {
        const dependency = list.find((other) => other.id === dependsOnId);
        if (dependency === undefined) {
          throw new HttpError(400, "A task can only depend on your own tasks");
        }
        if (dependsOnId === task.id) {
          throw new HttpError(400, "A task cannot depend on itself");
        }
        if (!canDependOn(list, task.id, dependsOnId)) {
          throw new HttpError(409, `"${dependency.title}" already waits on "${task.title}"`);
        }
        if (task.status !== "todo" && dependency.status !== "done") {
          throw new HttpError(409, "A task already started can only depend on tasks that are done");
        }
        await tx.insert(dependencies).values({ taskId: row.id, dependsOnId }).onConflictDoNothing();
      }),

    removeDependency: (owner: string, taskId: string, dependsOnId: string) =>
      changeTask(owner, taskId, async (tx, row) => {
        await tx
          .delete(dependencies)
          .where(and(eq(dependencies.taskId, row.id), eq(dependencies.dependsOnId, dependsOnId)));
      }),
  };
};

export type TasksService = ReturnType<typeof createTasksService>;
