import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import { createTasksTestContext, NOW } from "../../test/support";
import { type CreateTask, type Status, TaskList } from "../contract";
import { createTasksApp } from "../module";

const context = createTasksTestContext();
const request = startTestServer((ctx) => [createTasksApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

const send = (path: string, method: string, body?: unknown, as = me) =>
  request(`/tasks/api${path}`, {
    as,
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

const listOf = async (response: Response, status = 200) => {
  expect(response.status).toBe(status);
  return TaskList.parse(await response.json());
};

const errorOf = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  return ((await response.json()) as { error: string }).error;
};

/** Adds tasks in order, returning every task's id by title. */
const addTasks = async <const T extends string>(
  ...inputs: (CreateTask & { title: T })[]
): Promise<Record<T, string>> => {
  let list = await listOf(await send("/tasks", "GET"));
  for (const input of inputs) {
    list = await listOf(await send("/tasks", "POST", input), 201);
  }
  return Object.fromEntries(list.map((task) => [task.title, task.id])) as Record<T, string>;
};

const move = (taskId: string, status: Status, beforeId: string | null = null) =>
  send(`/tasks/${taskId}/move`, "PUT", { status, beforeId });

const columns = (list: TaskList) =>
  Object.fromEntries(
    (["todo", "doing", "done"] as const).map((status) => [
      status,
      list.filter((task) => task.status === status).map((task) => task.title),
    ]),
  );

describe("tasks api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/tasks/api/tasks")).status).toBe(401);
  });

  test("serves the page, and JSON 404s for unknown tasks", async () => {
    expect(await (await request("/tasks/")).text()).toContain('<div id="root">');
    expect((await send(`/tasks/${crypto.randomUUID()}`, "DELETE")).status).toBe(404);
    expect((await send("/tasks/nope", "DELETE")).status).toBe(404);
  });

  test("keeps each person's tasks to themselves", async () => {
    const { Pack } = await addTasks({ title: "Pack" });
    const someone = uniqueLogin();

    expect(await listOf(await send("/tasks", "GET", undefined, someone))).toEqual([]);
    expect((await send(`/tasks/${Pack}`, "PATCH", { title: "Mine now" }, someone)).status).toBe(404);
    expect((await send(`/tasks/${Pack}/move`, "PUT", { status: "done", beforeId: null }, someone)).status).toBe(404);
    expect((await send(`/tasks/${Pack}`, "DELETE", undefined, someone)).status).toBe(404);
    expect(await errorOf(await send("/tasks", "POST", { title: "Unpack", dependsOn: [Pack] }, someone), 400)).toBe(
      "A task can only depend on your own tasks",
    );
    expect((await listOf(await send("/tasks", "GET"))).map((task) => task.title)).toEqual(["Pack"]);
  });
});

describe("tasks", () => {
  test("creates tasks at the bottom of the to-do column with their dependencies", async () => {
    const { Pack } = await addTasks({ title: "Pack", durationDays: 3, dueOn: "2026-09-30" });

    const list = await listOf(
      await send("/tasks", "POST", { title: "Load van", dependsOn: [Pack, Pack], notes: "Heavy first" }),
      201,
    );

    expect(list).toEqual([
      expect.objectContaining({ title: "Pack", durationDays: 3, dueOn: "2026-09-30", dependsOn: [] }),
      expect.objectContaining({ title: "Load van", notes: "Heavy first", status: "todo", dependsOn: [Pack] }),
    ]);
  });

  test("edits and deletes a task, dropping it from its dependents", async () => {
    const { Pack } = await addTasks({ title: "Pack" });
    const { "Load van": load } = await addTasks({ title: "Load van", dependsOn: [Pack] });

    const edited = await listOf(await send(`/tasks/${Pack}`, "PATCH", { title: "Pack boxes", startOn: "2026-09-25" }));
    expect(edited[0]).toMatchObject({ title: "Pack boxes", startOn: "2026-09-25" });
    expect((await send(`/tasks/${Pack}`, "PATCH", {})).status).toBe(400);

    const after = await listOf(await send(`/tasks/${Pack}`, "DELETE"));
    expect(after).toEqual([expect.objectContaining({ id: load, dependsOn: [] })]);
    expect((await send(`/tasks/${Pack}`, "DELETE")).status).toBe(404);
  });
});

describe("dependencies", () => {
  test("adds and removes edges", async () => {
    const { A, B } = await addTasks({ title: "A" }, { title: "B" });

    expect((await listOf(await send(`/tasks/${B}/dependencies/${A}`, "PUT")))[1]?.dependsOn).toEqual([A]);
    expect((await listOf(await send(`/tasks/${B}/dependencies/${A}`, "PUT")))[1]?.dependsOn).toEqual([A]);
    expect((await listOf(await send(`/tasks/${B}/dependencies/${A}`, "DELETE")))[1]?.dependsOn).toEqual([]);
  });

  test("refuses any edge that would close a cycle", async () => {
    const { A, B, C } = await addTasks({ title: "A" }, { title: "B" }, { title: "C" });
    await send(`/tasks/${B}/dependencies/${A}`, "PUT");
    await send(`/tasks/${C}/dependencies/${B}`, "PUT");

    expect(await errorOf(await send(`/tasks/${A}/dependencies/${C}`, "PUT"), 409)).toBe('"C" already waits on "A"');
    expect(await errorOf(await send(`/tasks/${A}/dependencies/${A}`, "PUT"), 400)).toBe(
      "A task cannot depend on itself",
    );
  });

  test("refuses edges to someone else's tasks", async () => {
    const someone = uniqueLogin();
    const [theirs] = await listOf(await send("/tasks", "POST", { title: "Weed" }, someone), 201);
    const { Pack } = await addTasks({ title: "Pack" });

    expect((await send(`/tasks/${Pack}/dependencies/${theirs?.id}`, "PUT")).status).toBe(400);
  });

  test("keeps concurrent edges acyclic", async () => {
    const { A, B } = await addTasks({ title: "A" }, { title: "B" });

    const statuses = await Promise.all([
      send(`/tasks/${A}/dependencies/${B}`, "PUT"),
      send(`/tasks/${B}/dependencies/${A}`, "PUT"),
    ]).then((responses) => responses.map((response) => response.status).sort());

    expect(statuses).toEqual([200, 409]);
  });

  test("lets a started task depend only on finished ones", async () => {
    const { A, B } = await addTasks({ title: "A" }, { title: "B" });
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
    const { A, B, C } = await addTasks({ title: "A" }, { title: "B" }, { title: "C" });

    expect(columns(await listOf(await move(C, "todo", A)))).toEqual({ todo: ["C", "A", "B"], doing: [], done: [] });

    await move(A, "doing");
    const started = await listOf(await move(B, "doing", A));
    expect(columns(started)).toEqual({ todo: ["C"], doing: ["B", "A"], done: [] });
    expect(started.find((task) => task.id === A)).toMatchObject({ startedAt: NOW.toISOString(), completedAt: null });

    const finished = await listOf(await move(A, "done"));
    expect(finished.find((task) => task.id === A)).toMatchObject({
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
    });

    const reopened = await listOf(await move(A, "todo"));
    expect(reopened.find((task) => task.id === A)).toMatchObject({ startedAt: null, completedAt: null });
    expect(columns(reopened)).toEqual({ todo: ["C", "A"], doing: ["B"], done: [] });
  });

  test("refuses to place a task before one in another column", async () => {
    const { A, B } = await addTasks({ title: "A" }, { title: "B" });

    expect((await move(A, "doing", B)).status).toBe(400);
  });

  test("keeps a task waiting until its dependencies are done", async () => {
    const { Pack } = await addTasks({ title: "Pack" });
    const { Load } = await addTasks({ title: "Load", dependsOn: [Pack] });

    expect(await errorOf(await move(Load, "doing"), 409)).toBe('Waiting on "Pack"');
    await move(Pack, "done");
    expect((await move(Load, "doing")).status).toBe(200);

    expect(await errorOf(await move(Pack, "doing"), 409)).toBe('"Load" already started on the strength of this');
  });
});
