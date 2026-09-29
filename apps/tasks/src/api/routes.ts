import { defineRoutes, HttpError, type IdentityMode, parseBody, parseParam, resolveViewer } from "@nas/core";
import { and, asc, eq, inArray, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { CreateTask, MoveTask, type ProjectView, SaveProject, type Status, type Task, UpdateTask } from "../contract";
import { blockers, canDependOn } from "../plan";
import type { TasksDb } from "./db";
import { dependencies, projects, tasks } from "./schema";
import { readProjectList, readProjectView } from "./views";

export type TasksRoutesDeps = {
  readonly db: TasksDb;
  readonly identity: IdentityMode;
  readonly now: () => Date;
};

type Tx = Parameters<Parameters<TasksDb["transaction"]>[0]>[0];
type TaskRow = typeof tasks.$inferSelect;

const titles = (list: readonly Task[]) => list.map((task) => `"${task.title}"`).join(", ");

/** Rewrites a column's order with `taskId` placed above `beforeId`, or at the bottom when that is `null`. */
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

export const createTasksRoutes = ({ db, identity, now }: TasksRoutesDeps) => {
  /**
   * Changes a project with its row locked, so concurrent edits cannot together close a cycle or tangle a column,
   * and answers with the project as it now is.
   */
  const changeProject = async (
    projectId: string,
    change: (tx: Tx, view: ProjectView) => Promise<void>,
    status = 200,
  ): Promise<Response> => {
    await db.transaction(async (tx) => {
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
      await change(tx, await readProjectView(tx, projectId));
    });
    return Response.json(await readProjectView(db, projectId), { status });
  };

  const changeTask = async (
    taskId: string,
    change: (tx: Tx, row: TaskRow, task: Task, view: ProjectView) => Promise<void>,
  ): Promise<Response> => {
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

  const id = (value: string) => parseParam(value, z.uuid());

  return defineRoutes({
    "/tasks/api/projects": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await readProjectList(db));
      },
      POST: async (request) => {
        resolveViewer(identity, request);
        const { name } = await parseBody(request, SaveProject);
        const [project] = await db.insert(projects).values({ name }).returning({ id: projects.id });
        if (project === undefined) {
          throw new Error("insert returned nothing");
        }
        return Response.json(await readProjectView(db, project.id), { status: 201 });
      },
    },
    "/tasks/api/projects/:id": {
      GET: async (request) => {
        resolveViewer(identity, request);
        return Response.json(await readProjectView(db, id(request.params.id)));
      },
      PATCH: async (request) => {
        resolveViewer(identity, request);
        const { name } = await parseBody(request, SaveProject);
        return changeProject(id(request.params.id), async (tx, view) => {
          await tx.update(projects).set({ name }).where(eq(projects.id, view.id));
        });
      },
      DELETE: async (request) => {
        resolveViewer(identity, request);
        const deleted = await db
          .delete(projects)
          .where(eq(projects.id, id(request.params.id)))
          .returning({ id: projects.id });
        if (deleted.length === 0) {
          throw new HttpError(404, "Not found");
        }
        return new Response(null, { status: 204 });
      },
    },
    "/tasks/api/projects/:id/tasks": {
      POST: async (request) => {
        resolveViewer(identity, request);
        const { dependsOn, ...input } = await parseBody(request, CreateTask);
        return changeProject(
          id(request.params.id),
          async (tx, view) => {
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
          },
          201,
        );
      },
    },
    "/tasks/api/tasks/:id": {
      PATCH: async (request) => {
        resolveViewer(identity, request);
        const update = await parseBody(request, UpdateTask);
        return changeTask(id(request.params.id), async (tx, row) => {
          await tx.update(tasks).set(update).where(eq(tasks.id, row.id));
        });
      },
      DELETE: async (request) => {
        resolveViewer(identity, request);
        return changeTask(id(request.params.id), async (tx, row) => {
          await tx.delete(tasks).where(eq(tasks.id, row.id));
        });
      },
    },
    "/tasks/api/tasks/:id/move": {
      PUT: async (request) => {
        resolveViewer(identity, request);
        const { status, beforeId } = await parseBody(request, MoveTask);
        return changeTask(id(request.params.id), async (tx, row, task, view) => {
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
        });
      },
    },
    "/tasks/api/tasks/:id/dependencies/:dependsOnId": {
      PUT: async (request) => {
        resolveViewer(identity, request);
        const dependsOnId = id(request.params.dependsOnId);
        return changeTask(id(request.params.id), async (tx, row, task, view) => {
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
        });
      },
      DELETE: async (request) => {
        resolveViewer(identity, request);
        const dependsOnId = id(request.params.dependsOnId);
        return changeTask(id(request.params.id), async (tx, row) => {
          await tx
            .delete(dependencies)
            .where(and(eq(dependencies.taskId, row.id), eq(dependencies.dependsOnId, dependsOnId)));
        });
      },
    },
  });
};
