import { beforeEach, describe, expect, test } from "bun:test";
import { createTestContext, startTestServer, uniqueLogin } from "@nas/core/testing";
import { type CreateTask, ProjectList, ProjectView, type Status } from "../contract";
import { createTasksApp } from "../module";

const NOW = new Date("2026-09-21T11:00:00Z");
const context = createTestContext();
const request = startTestServer((ctx) => [createTasksApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

beforeEach(async () => {
  await context.sql`truncate tasks.projects cascade`;
});

const send = (path: string, method: string, body?: unknown) =>
  request(`/tasks/api${path}`, {
    as: me,
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

const view = async (response: Response, status = 200) => {
  expect(response.status).toBe(status);
  return ProjectView.parse(await response.json());
};

const errorOf = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  return ((await response.json()) as { error: string }).error;
};

const createProject = async (name = "Move house") => view(await send("/projects", "POST", { name }), 201);

/** Adds tasks in order, returning every task's id by title. */
const addTasks = async <const T extends string>(
  projectId: string,
  ...inputs: (CreateTask & { title: T })[]
): Promise<Record<T, string>> => {
  let project = await view(await send(`/projects/${projectId}`, "GET"));
  for (const input of inputs) {
    project = await view(await send(`/projects/${projectId}/tasks`, "POST", input), 201);
  }
  return Object.fromEntries(project.tasks.map((task) => [task.title, task.id])) as Record<T, string>;
};

const move = (taskId: string, status: Status, beforeId: string | null = null) =>
  send(`/tasks/${taskId}/move`, "PUT", { status, beforeId });

const columns = (project: ProjectView) =>
  Object.fromEntries(
    (["todo", "doing", "done"] as const).map((status) => [
      status,
      project.tasks.filter((task) => task.status === status).map((task) => task.title),
    ]),
  );

describe("tasks api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/tasks/api/projects")).status).toBe(401);
  });

  test("serves the page, and JSON 404s for unknown projects", async () => {
    expect(await (await request("/tasks/")).text()).toContain('<div id="root">');
    expect((await send(`/projects/${crypto.randomUUID()}`, "GET")).status).toBe(404);
    expect((await send("/projects/nope", "GET")).status).toBe(404);
  });

  test("lists projects with a count per column", async () => {
    const { id } = await createProject();
    const ids = await addTasks(id, { title: "Pack" }, { title: "Book van" });
    await move(ids.Pack, "done");
    await createProject("Garden");

    const list = ProjectList.parse(await (await send("/projects", "GET")).json());

    expect(list).toEqual([
      { id, name: "Move house", counts: { todo: 1, doing: 0, done: 1 } },
      { id: expect.any(String), name: "Garden", counts: { todo: 0, doing: 0, done: 0 } },
    ]);
  });

  test("renames and deletes a project with its tasks", async () => {
    const { id } = await createProject();
    await addTasks(id, { title: "Pack" });

    expect((await view(await send(`/projects/${id}`, "PATCH", { name: "Moving" }))).name).toBe("Moving");
    expect((await send(`/projects/${id}`, "DELETE")).status).toBe(204);
    expect((await send(`/projects/${id}`, "GET")).status).toBe(404);
    expect([...(await context.sql`select id from tasks.tasks`)]).toEqual([]);
  });
});

describe("tasks", () => {
  test("creates tasks at the bottom of the to-do column with their dependencies", async () => {
    const { id } = await createProject();
    const { Pack } = await addTasks(id, { title: "Pack", durationDays: 3, dueOn: "2026-09-30" });

    const project = await view(
      await send(`/projects/${id}/tasks`, "POST", { title: "Load van", dependsOn: [Pack, Pack], notes: "Heavy first" }),
      201,
    );

    expect(project.tasks).toEqual([
      expect.objectContaining({ title: "Pack", durationDays: 3, dueOn: "2026-09-30", dependsOn: [] }),
      expect.objectContaining({ title: "Load van", notes: "Heavy first", status: "todo", dependsOn: [Pack] }),
    ]);
  });

  test("refuses dependencies on another project's tasks", async () => {
    const other = await createProject("Garden");
    const { Weed } = await addTasks(other.id, { title: "Weed" });
    const { id } = await createProject();

    expect(await errorOf(await send(`/projects/${id}/tasks`, "POST", { title: "Pack", dependsOn: [Weed] }), 400)).toBe(
      "A task can only depend on tasks in its own project",
    );
  });

  test("edits and deletes a task, dropping it from its dependents", async () => {
    const { id } = await createProject();
    const { Pack } = await addTasks(id, { title: "Pack" });
    const { "Load van": load } = await addTasks(id, { title: "Load van", dependsOn: [Pack] });

    const edited = await view(await send(`/tasks/${Pack}`, "PATCH", { title: "Pack boxes", startOn: "2026-09-25" }));
    expect(edited.tasks[0]).toMatchObject({ title: "Pack boxes", startOn: "2026-09-25" });
    expect((await send(`/tasks/${Pack}`, "PATCH", {})).status).toBe(400);

    const after = await view(await send(`/tasks/${Pack}`, "DELETE"));
    expect(after.tasks).toEqual([expect.objectContaining({ id: load, dependsOn: [] })]);
    expect((await send(`/tasks/${Pack}`, "DELETE")).status).toBe(404);
  });
});

describe("dependencies", () => {
  test("adds and removes edges", async () => {
    const { id } = await createProject();
    const { A, B } = await addTasks(id, { title: "A" }, { title: "B" });

    expect((await view(await send(`/tasks/${B}/dependencies/${A}`, "PUT"))).tasks[1]?.dependsOn).toEqual([A]);
    expect((await view(await send(`/tasks/${B}/dependencies/${A}`, "PUT"))).tasks[1]?.dependsOn).toEqual([A]);
    expect((await view(await send(`/tasks/${B}/dependencies/${A}`, "DELETE"))).tasks[1]?.dependsOn).toEqual([]);
  });

  test("refuses any edge that would close a cycle", async () => {
    const { id } = await createProject();
    const { A, B, C } = await addTasks(id, { title: "A" }, { title: "B" }, { title: "C" });
    await send(`/tasks/${B}/dependencies/${A}`, "PUT");
    await send(`/tasks/${C}/dependencies/${B}`, "PUT");

    expect(await errorOf(await send(`/tasks/${A}/dependencies/${C}`, "PUT"), 409)).toBe('"C" already waits on "A"');
    expect(await errorOf(await send(`/tasks/${A}/dependencies/${A}`, "PUT"), 400)).toBe(
      "A task cannot depend on itself",
    );
  });

  test("refuses edges across projects", async () => {
    const garden = await createProject("Garden");
    const { Weed } = await addTasks(garden.id, { title: "Weed" });
    const { id } = await createProject();
    const { Pack } = await addTasks(id, { title: "Pack" });

    expect((await send(`/tasks/${Pack}/dependencies/${Weed}`, "PUT")).status).toBe(400);
  });

  test("keeps concurrent edges acyclic", async () => {
    const { id } = await createProject();
    const { A, B } = await addTasks(id, { title: "A" }, { title: "B" });

    const statuses = await Promise.all([
      send(`/tasks/${A}/dependencies/${B}`, "PUT"),
      send(`/tasks/${B}/dependencies/${A}`, "PUT"),
    ]).then((responses) => responses.map((response) => response.status).sort());

    expect(statuses).toEqual([200, 409]);
  });

  test("lets a started task depend only on finished ones", async () => {
    const { id } = await createProject();
    const { A, B } = await addTasks(id, { title: "A" }, { title: "B" });
    await move(B, "doing");

    expect(await errorOf(await send(`/tasks/${B}/dependencies/${A}`, "PUT"), 409)).toBe(
      "A task already started can only depend on tasks that are done",
    );
    await move(A, "done");
    expect((await send(`/tasks/${B}/dependencies/${A}`, "PUT")).status).toBe(200);
  });
});

describe("the board", () => {
  test("orders each column and moves tasks between them, stamping when they start and finish", async () => {
    const { id } = await createProject();
    const { A, B, C } = await addTasks(id, { title: "A" }, { title: "B" }, { title: "C" });

    expect(columns(await view(await move(C, "todo", A)))).toEqual({
      todo: ["C", "A", "B"],
      doing: [],
      done: [],
    });

    await move(A, "doing");
    const started = await view(await move(B, "doing", A));
    expect(columns(started)).toEqual({ todo: ["C"], doing: ["B", "A"], done: [] });
    expect(started.tasks.find((task) => task.id === A)).toMatchObject({
      startedAt: NOW.toISOString(),
      completedAt: null,
    });

    const finished = await view(await move(A, "done"));
    expect(finished.tasks.find((task) => task.id === A)).toMatchObject({
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
    });

    const reopened = await view(await move(A, "todo"));
    expect(reopened.tasks.find((task) => task.id === A)).toMatchObject({ startedAt: null, completedAt: null });
    expect(columns(reopened)).toEqual({ todo: ["C", "A"], doing: ["B"], done: [] });
  });

  test("refuses to place a task before one in another column", async () => {
    const { id } = await createProject();
    const { A, B } = await addTasks(id, { title: "A" }, { title: "B" });

    expect((await move(A, "doing", B)).status).toBe(400);
  });

  test("keeps a task waiting until its dependencies are done", async () => {
    const { id } = await createProject();
    const { Pack } = await addTasks(id, { title: "Pack" });
    const { Load } = await addTasks(id, { title: "Load", dependsOn: [Pack] });

    expect(await errorOf(await move(Load, "doing"), 409)).toBe('Waiting on "Pack"');
    await move(Pack, "done");
    expect((await move(Load, "doing")).status).toBe(200);

    expect(await errorOf(await move(Pack, "doing"), 409)).toBe('"Load" already started on the strength of this');
  });
});
