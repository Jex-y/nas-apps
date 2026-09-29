import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { startTestServer, uniqueLogin } from "@nas/core/testing";
import { createTasksTestContext, NOW } from "../../test/support";
import { createTasksApp } from "../module";

const context = createTasksTestContext();
const request = startTestServer((ctx) => [createTasksApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

/** The SDK's own client, reaching the test server as a tailnet member. */
const connect = async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://apps.test/tasks/mcp"), {
    fetch: (url, init) => request(new URL(url).pathname, { ...init, as: me }),
  });
  // The SDK's optional `sessionId` is typed without `| undefined`, which `exactOptionalPropertyTypes` rejects.
  await client.connect(transport as Transport);
  return client;
};

type Plan = {
  id: string;
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

  test("offers tools for projects, tasks and dependencies", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_dependency",
      "create_project",
      "create_task",
      "delete_project",
      "delete_task",
      "get_project",
      "list_projects",
      "move_task",
      "remove_dependency",
      "rename_project",
      "update_task",
    ]);
    expect(client.getInstructions()).toContain("dependsOn");
  });

  test("builds a project and reads back its schedule", async () => {
    const client = await connect();
    const { id } = await plan(client, "create_project", { name: "Move house" });
    const packed = await plan(client, "create_task", { projectId: id, title: "Pack", durationDays: 3 });
    const pack = packed.tasks[0]?.id;
    await plan(client, "create_task", { projectId: id, title: "Move", dependsOn: [pack], dueOn: "2026-09-25" });

    const project = await plan(client, "get_project", { projectId: id });

    expect(project.finishesOn).toBe("2026-09-24");
    expect(project.tasks).toEqual([
      expect.objectContaining({
        title: "Pack",
        waitingOn: [],
        scheduled: { firstDay: "2026-09-21", lastDay: "2026-09-23", slackDays: 0, critical: true },
      }),
      expect.objectContaining({
        title: "Move",
        dependsOn: [pack],
        waitingOn: [pack],
        scheduled: { firstDay: "2026-09-24", lastDay: "2026-09-24", slackDays: 0, critical: true },
      }),
    ]);
  });

  test("hands refusals back as tool errors", async () => {
    const client = await connect();
    const { id } = await plan(client, "create_project", { name: "Move house" });
    const [pack] = (await plan(client, "create_task", { projectId: id, title: "Pack" })).tasks;
    const [, move] = (await plan(client, "create_task", { projectId: id, title: "Move", dependsOn: [pack?.id] })).tasks;

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
