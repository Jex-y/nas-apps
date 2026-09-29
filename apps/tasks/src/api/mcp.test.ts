import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createTasksTestContext, NOW } from "../../test/support";
import { createTasksApp } from "../module";

const context = createTasksTestContext();
const request = startTestServer((ctx) => [createTasksApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

/** The SDK's own client, reaching the test server as `as` from a tailnet device. */
const connect = async (as = me) => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://apps.test/tasks/mcp"), {
    fetch: (url, init) => request(new URL(url).pathname, { ...init, as }),
  });
  // The SDK's optional `sessionId` is typed without `| undefined`, which `exactOptionalPropertyTypes` rejects.
  await client.connect(transport as Transport);
  return client;
};

type Plan = {
  finishesOn: string | null;
  tasks: { id: string; title: string; status: string; waitingOn: string[]; scheduled: object }[];
};

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content?.text ?? "" };
};

const plan = async (client: Client, name: string, args: Record<string, unknown>) =>
  JSON.parse((await call(client, name, args)).text) as Plan;

describe("tasks mcp", () => {
  test("requires a Tailscale identity", async () => {
    const response = await request("/tasks/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  test("offers tools for the person's tasks and their dependencies", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_dependency",
      "create_task",
      "delete_task",
      "list_tasks",
      "move_task",
      "remove_dependency",
      "update_task",
    ]);
    expect(client.getInstructions()).toContain("dependsOn");
  });

  test("builds a list and reads back its schedule, for the connected person only", async () => {
    const client = await connect();
    const [pack] = (await plan(client, "create_task", { title: "Pack", durationDays: 3 })).tasks;
    await plan(client, "create_task", { title: "Move", dependsOn: [pack?.id], dueOn: "2026-09-25" });

    const list = await plan(client, "list_tasks", {});

    expect(list.finishesOn).toBe("2026-09-24");
    expect(list.tasks).toEqual([
      expect.objectContaining({
        title: "Pack",
        waitingOn: [],
        scheduled: { firstDay: "2026-09-21", lastDay: "2026-09-23", slackDays: 0, critical: true },
      }),
      expect.objectContaining({
        title: "Move",
        dependsOn: [pack?.id],
        waitingOn: [pack?.id],
        scheduled: { firstDay: "2026-09-24", lastDay: "2026-09-24", slackDays: 0, critical: true },
      }),
    ]);
    expect((await plan(await connect(uniqueLogin()), "list_tasks", {})).tasks).toEqual([]);
    expect(await call(await connect(uniqueLogin()), "delete_task", { taskId: pack?.id })).toEqual({
      isError: true,
      text: "Not found",
    });
  });

  test("hands refusals back as tool errors", async () => {
    const client = await connect();
    const [pack] = (await plan(client, "create_task", { title: "Pack" })).tasks;
    const [, move] = (await plan(client, "create_task", { title: "Move", dependsOn: [pack?.id] })).tasks;

    expect(await call(client, "move_task", { taskId: move?.id, status: "doing" })).toEqual({
      isError: true,
      text: 'Waiting on "Pack"',
    });
    expect(await call(client, "add_dependency", { taskId: pack?.id, dependsOnId: move?.id })).toEqual({
      isError: true,
      text: '"Move" already waits on "Pack"',
    });
    expect(await call(client, "update_task", { taskId: pack?.id })).toMatchObject({ isError: true });
    expect((await call(client, "move_task", { taskId: pack?.id, status: "done" })).isError).toBe(false);
  });
});
